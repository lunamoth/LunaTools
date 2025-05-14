/**
 * LunaTools Background Script
 * Handles tab organization, deduplication, window merging, and gesture actions.
 */

// --- Constants ---
const NEW_TAB_URL = "chrome://newtab/";
const PERFORM_GESTURE_ACTION = 'perform-gesture';
const SCRIPT_NAME_BG = "LunaTools BG"; // For console error messages

// --- Utility Functions ---
function isTabAccessError(error) {
  const message = error?.message?.toLowerCase() || "";
  return message.includes("no tab with id") ||
         message.includes("invalid tab id") ||
         message.includes("cannot go back") ||
         message.includes("cannot go forward") ||
         message.includes("tab id not found");
}

function isWindowAccessError(error) {
  const message = error?.message?.toLowerCase() || "";
  return message.includes("no window with id");
}

// --- Gesture Handling ---
async function handleGestureAction(gesture, tabId) {
  try {
    switch (gesture) {
      case 'U': // Up - New Tab
        const currentTab = await chrome.tabs.get(tabId).catch(() => null);
        await chrome.tabs.create({
          index: currentTab ? currentTab.index + 1 : undefined,
          openerTabId: tabId,
          active: true
        });
        break;
      case 'D': // Down - Close Tab
        await chrome.tabs.remove(tabId);
        break;
      case 'R': // Right - Go Forward
        await chrome.tabs.goForward(tabId);
        break;
      case 'L': // Left - Go Back
        await chrome.tabs.goBack(tabId);
        break;
      // No default case needed if all known gestures are handled
    }
  } catch (error) {
    if (!isTabAccessError(error)) {
      // Log only if it's not a common, expected error like tab already closed
      console.error(`${SCRIPT_NAME_BG}: Error performing gesture '${gesture}' on tab ${tabId}:`, error.message);
    }
  }
}

// --- TabManager Class ---
class TabManager {
  constructor() {
    this.urlCache = new Map(); // Map<tabId, {url: URL, windowId: number}>
    this.reverseUrlLookup = new Map(); // Map<urlString, Array<{tabId: number, windowId: number}>>

    // Bind methods that are used as event handlers or passed as callbacks
    this.handleTabRemoved = this.handleTabRemoved.bind(this);
    this.handleTabUpdate = this.handleTabUpdate.bind(this);
    // No need to bind methods called internally with `this.`
  }

  _isTabNotFoundError(error) { // Renamed from manifest for clarity, or use shared utility
    return isTabAccessError(error); // Using the global one for consistency here
  }

  _isValidTabForProcessing(tab) {
    return tab?.id !== undefined && tab.windowId !== undefined;
  }

  _getTabUrlString(tab) {
    // Prioritize actual URL, then pending, then fallback to tab.url
    // Only consider http/https URLs for most processing
    const url = tab?.url;
    const pendingUrl = tab?.pendingUrl;

    if (url && (url.startsWith('http:') || url.startsWith('https:'))) {
      return url;
    }
    if (pendingUrl && (pendingUrl.startsWith('http:') || pendingUrl.startsWith('https:'))) {
      return pendingUrl;
    }
    // Fallback for cases where a non-http URL might still be relevant for cache, though less common
    return url || pendingUrl || null;
  }

  _tryParseUrl(urlString) {
    if (!urlString || urlString === NEW_TAB_URL || !(urlString.startsWith('http:') || urlString.startsWith('https:'))) {
      return null;
    }
    try {
      return new URL(urlString);
    } catch (e) {
      // Silently ignore invalid URLs for parsing in release, or log minimal error if critical
      // console.error(`${SCRIPT_NAME_BG}: Invalid URL for parsing: ${urlString}`, e.message); // Optional: if this is a significant issue
      return null;
    }
  }

  // --- Cache Management ---
  _addUrlToCache(tabId, parsedUrl, windowId) {
    if (!(parsedUrl instanceof URL) || typeof tabId !== 'number' || typeof windowId !== 'number') return;

    this.urlCache.set(tabId, { url: parsedUrl, windowId });

    const urlKey = parsedUrl.href;
    let entries = this.reverseUrlLookup.get(urlKey);
    if (!entries) {
      entries = [];
      this.reverseUrlLookup.set(urlKey, entries);
    }

    // Ensure no duplicate {tabId, windowId} entries for the same URL key
    if (!entries.some(entry => entry.tabId === tabId)) {
      entries.push({ tabId, windowId });
    } else { // Update windowId if tab moved
        const existingEntry = entries.find(entry => entry.tabId === tabId);
        if (existingEntry && existingEntry.windowId !== windowId) {
            existingEntry.windowId = windowId;
        }
    }
  }

  _removeUrlFromCache(tabId, urlInstanceOrString) {
    if (typeof tabId !== 'number') return;
    
    this.urlCache.delete(tabId);

    if (urlInstanceOrString) {
        const urlKey = (urlInstanceOrString instanceof URL) ? urlInstanceOrString.href : urlInstanceOrString;
        this._removeTabIdFromReverseLookup(tabId, urlKey);
    }
  }

  _removeTabIdFromReverseLookup(tabId, urlKey) {
    const entries = this.reverseUrlLookup.get(urlKey);
    if (!entries) return;

    const filteredEntries = entries.filter(entry => entry.tabId !== tabId);
    if (filteredEntries.length === 0) {
      this.reverseUrlLookup.delete(urlKey);
    } else {
      this.reverseUrlLookup.set(urlKey, filteredEntries);
    }
  }

  _removeWindowTabsFromCache(windowId) {
    for (const [tabId, cachedInfo] of this.urlCache.entries()) {
      if (cachedInfo.windowId === windowId) {
        this._removeUrlFromCache(tabId, cachedInfo.url); // Pass URL for reverse lookup removal
      }
    }
  }

  async initializeCache() {
    this.urlCache.clear();
    this.reverseUrlLookup.clear();
    try {
      const allTabs = await chrome.tabs.query({ windowType: 'normal' });
      allTabs.forEach(tab => {
        if (!this._isValidTabForProcessing(tab)) return;
        const urlString = this._getTabUrlString(tab);
        const parsedUrl = this._tryParseUrl(urlString);
        if (parsedUrl) {
          this._addUrlToCache(tab.id, parsedUrl, tab.windowId);
        }
      });
    } catch (error) {
      console.error(`${SCRIPT_NAME_BG}: Error initializing TabManager cache:`, error.message);
    }
  }

  // --- Tab Sorting ---
  async sortTabsInCurrentWindow() {
    try {
      const currentWindow = await chrome.windows.getCurrent({ populate: false, windowTypes: ['normal'] });
      if (!currentWindow?.id) return; // Silently return if no current window
      
      await this._sortAndMoveTabsInWindow(currentWindow.id);
    } catch (error) {
      // Log only if it's not a common window access error (window closed during op)
      if (!isWindowAccessError(error)) {
        console.error(`${SCRIPT_NAME_BG}: Error sorting tabs:`, error.message);
      }
    }
  }

  async _sortAndMoveTabsInWindow(windowId) {
    try {
      const tabsInWindow = await chrome.tabs.query({ windowId });
      if (tabsInWindow.length === 0) return;

      const tabsWithParsedUrls = tabsInWindow.map(tab => {
        const cachedInfo = this.urlCache.get(tab.id);
        let parsedUrl = cachedInfo?.url;
        if (!parsedUrl) {
          const urlString = this._getTabUrlString(tab);
          parsedUrl = this._tryParseUrl(urlString);
          if (parsedUrl && this._isValidTabForProcessing(tab)) {
            this._addUrlToCache(tab.id, parsedUrl, tab.windowId); // Cache if newly parsed
          }
        }
        return { ...tab, parsedUrl };
      }).filter(tab => tab.parsedUrl); // Only sortable tabs

      if (tabsWithParsedUrls.length <= 1) return; // No need to sort one or zero tabs

      const originalIndices = new Map(tabsInWindow.map(tab => [tab.id, tab.index]));
      tabsWithParsedUrls.sort((a, b) => this._compareTabUrls(a.parsedUrl, b.parsedUrl));

      const movePromises = tabsWithParsedUrls.reduce((promises, tab, desiredIndex) => {
        const currentIndex = originalIndices.get(tab.id);
        // Only move if index is different and tab ID is valid
        if (typeof currentIndex === 'number' && currentIndex !== desiredIndex && tab.id !== undefined) {
          promises.push(
            chrome.tabs.move(tab.id, { index: desiredIndex }).catch(error => {
              if (!this._isTabNotFoundError(error) && !isWindowAccessError(error)) {
                console.error(`${SCRIPT_NAME_BG}: Error moving tab ${tab.id} during sort:`, error.message);
              }
            })
          );
        }
        return promises;
      }, []);
      
      if (movePromises.length > 0) await Promise.all(movePromises);

    } catch (error) {
      if (!isWindowAccessError(error)) { // Window closed is an expected scenario
        console.error(`${SCRIPT_NAME_BG}: Error sorting tabs in window ${windowId}:`, error.message);
      }
    }
  }

  _compareTabUrls(urlA, urlB) { // Expects URL objects
    if (!urlA && !urlB) return 0;
    if (!urlA) return 1;  // Sort nulls (non-HTTP/unparsable) to the end
    if (!urlB) return -1;

    const hostCompare = urlA.hostname.localeCompare(urlB.hostname);
    if (hostCompare !== 0) return hostCompare;

    const pathCompare = urlA.pathname.localeCompare(urlB.pathname);
    if (pathCompare !== 0) return pathCompare;
    
    const searchCompare = urlA.search.localeCompare(urlB.search);
    if (searchCompare !== 0) return searchCompare;

    return urlA.hash.localeCompare(urlB.hash);
  }

  // --- Duplicate Tab Handling ---
  async checkForDuplicateAndFocusExisting(tab) {
    if (!this._isValidTabForProcessing(tab)) return;

    const tabUrlString = this._getTabUrlString(tab);
    const parsedUrl = this._tryParseUrl(tabUrlString);
    if (!parsedUrl) return; // Not a URL we handle for duplicates

    // Ensure cache is up-to-date for the current tab
    const cachedInfo = this.urlCache.get(tab.id);
    if (!cachedInfo || cachedInfo.url.href !== parsedUrl.href || cachedInfo.windowId !== tab.windowId) {
      this._addUrlToCache(tab.id, parsedUrl, tab.windowId);
    }

    await this._findAndHandleDuplicates(tab, parsedUrl);
  }

  async _findAndHandleDuplicates(currentTab, parsedUrl) {
    try {
      const potentialDuplicatesInWindow = (this.reverseUrlLookup.get(parsedUrl.href) || [])
        .filter(entry => entry.tabId !== currentTab.id && entry.windowId === currentTab.windowId);

      if (potentialDuplicatesInWindow.length === 0) return;
      
      // Verify potential duplicates still exist
      const existingDuplicateTabIds = [];
      for (const { tabId } of potentialDuplicatesInWindow) {
          try {
              await chrome.tabs.get(tabId); // Check if tab still exists
              existingDuplicateTabIds.push(tabId);
          } catch (error) {
              if (this._isTabNotFoundError(error)) {
                  this._removeUrlFromCache(tabId, parsedUrl); // Clean up stale cache entry
              } else {
                  console.error(`${SCRIPT_NAME_BG}: Error verifying duplicate tab ${tabId}:`, error.message);
              }
          }
      }

      if (existingDuplicateTabIds.length > 0) {
        await this._handleVerifiedDuplicate(currentTab, existingDuplicateTabIds[0], parsedUrl);
      }
    } catch (error) {
      // Avoid logging if currentTab was closed during check
      if (!this._isTabNotFoundError(error) || (error.message && !error.message.includes(String(currentTab.id)))) {
         console.error(`${SCRIPT_NAME_BG}: Error in duplicate check for tab ${currentTab.id}:`, error.message);
      }
    }
  }

  async _handleVerifiedDuplicate(newlyOpenedTab, existingDuplicateId, parsedUrl) {
    // Check if the "newly opened" tab still exists before trying to close it
    try {
      await chrome.tabs.get(newlyOpenedTab.id);
    } catch (e) {
      if (this._isTabNotFoundError(e)) {
        this._removeUrlFromCache(newlyOpenedTab.id, parsedUrl);
        return; // Tab to close is already gone
      }
      // For other errors, let it proceed or log, as it's unexpected
      console.error(`${SCRIPT_NAME_BG}: Error checking tab to close ${newlyOpenedTab.id}:`, e.message);
    }

    // Double check: only close if there's truly more than one instance of this URL in this window
    const allTabsWithUrlInWindow = (this.reverseUrlLookup.get(parsedUrl.href) || [])
                                  .filter(t => t.windowId === newlyOpenedTab.windowId);
    if (allTabsWithUrlInWindow.length <= 1) {
        return; // No actual duplicate to close now
    }

    try {
      // Ensure existing duplicate tab to focus also still exists
      await chrome.tabs.get(existingDuplicateId);

      if (newlyOpenedTab.active) {
        await chrome.tabs.update(existingDuplicateId, { active: true }).catch(err => {
          if (this._isTabNotFoundError(err) || isWindowAccessError(err)) { /* Tab/Window gone, can't focus */ }
          else console.error(`${SCRIPT_NAME_BG}: Error focusing existing tab ${existingDuplicateId}:`, err.message);
        });
      }

      await chrome.tabs.remove(newlyOpenedTab.id).catch(err => {
        if (!this._isTabNotFoundError(err)) { // If not "not found", it's an unexpected error
          console.error(`${SCRIPT_NAME_BG}: Error removing duplicate tab ${newlyOpenedTab.id}:`, err.message);
        }
      });
      this._removeUrlFromCache(newlyOpenedTab.id, parsedUrl); // Clean cache after successful removal

    } catch (error) { // Catching errors related to acting on existingDuplicateId
      if (this._isTabNotFoundError(error)) { // Existing duplicate tab disappeared
        this._removeUrlFromCache(existingDuplicateId, parsedUrl); // Clean its cache entry
        // Try to remove the "newly opened" tab anyway if it still exists
        chrome.tabs.remove(newlyOpenedTab.id).catch(err => {
          if (!this._isTabNotFoundError(err)) {
            console.error(`${SCRIPT_NAME_BG}: Error removing tab ${newlyOpenedTab.id} after its duplicate was gone:`, err.message);
          }
        }).finally(() => {
             this._removeUrlFromCache(newlyOpenedTab.id, parsedUrl);
        });
      } else if (!isWindowAccessError(error)) {
        console.error(`${SCRIPT_NAME_BG}: Error handling verified duplicate (new: ${newlyOpenedTab.id}, existing: ${existingDuplicateId}):`, error.message);
      }
    }
  }

  // --- Window Merging ---
  async mergeAllWindows() {
    try {
      const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      if (allWindows.length <= 1) {
        if (allWindows.length === 1) await this._sortAndMoveTabsInWindow(allWindows[0].id);
        return;
      }

      const targetWindow = await chrome.windows.getCurrent({ windowTypes: ['normal'] });
      if (!targetWindow?.id) return; // Silently return if no target
      const targetWindowId = targetWindow.id;

      const tabsToMoveDetails = allWindows.flatMap(win =>
        (win.id !== targetWindowId && win.tabs)
          ? win.tabs.filter(tab => !tab.pinned).map(tab => ({ id: tab.id, windowId: win.id })) // Keep original windowId for cache later
          : []
      );
      
      if (tabsToMoveDetails.length > 0) {
          const movePromises = tabsToMoveDetails.map(tabDetail =>
            chrome.tabs.move(tabDetail.id, { windowId: targetWindowId, index: -1 })
              .then(movedTab => {
                  // Update cache for moved tab
                  if (movedTab && this._isValidTabForProcessing(movedTab)) {
                      const urlString = this._getTabUrlString(movedTab);
                      const parsedUrl = this._tryParseUrl(urlString);
                      if (parsedUrl) {
                          // Remove from old windowId context in cache, add to new
                          const oldCacheEntry = this.urlCache.get(movedTab.id);
                          if(oldCacheEntry) this._removeUrlFromCache(movedTab.id, oldCacheEntry.url);
                          this._addUrlToCache(movedTab.id, parsedUrl, movedTab.windowId);
                      }
                  }
              })
              .catch(err => {
                if (!this._isTabNotFoundError(err) && !isWindowAccessError(err)) {
                  console.error(`${SCRIPT_NAME_BG}: Error moving tab ${tabDetail.id} to window ${targetWindowId}:`, err.message);
                }
                // If move fails, remove from cache to avoid inconsistencies if tab is gone
                const cachedInfo = this.urlCache.get(tabDetail.id);
                if(cachedInfo) this._removeUrlFromCache(tabDetail.id, cachedInfo.url);
              })
          );
          await Promise.all(movePromises);
      }


      // Re-query windows to close only those that are now empty or pinned-only
      const remainingWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      const windowsToClose = remainingWindows.filter(win => {
        if (win.id === targetWindowId) return false;
        // A window is effectively empty if it has no tabs or all its tabs are pinned
        return !win.tabs || win.tabs.length === 0 || win.tabs.every(tab => tab.pinned);
      });

      if (windowsToClose.length > 0) {
          const closePromises = windowsToClose.map(win =>
            chrome.windows.remove(win.id).catch(err => {
              if (!isWindowAccessError(err)) { // Window already closed is fine
                console.error(`${SCRIPT_NAME_BG}: Error closing window ${win.id}:`, err.message);
              }
            })
          );
          await Promise.all(closePromises);
      }

      await this._focusWindow(targetWindowId);
      await this._sortAndMoveTabsInWindow(targetWindowId);

    } catch (error) {
      if (!isWindowAccessError(error)){
        console.error(`${SCRIPT_NAME_BG}: Error merging windows:`, error.message);
      }
    }
  }
  
  async _focusWindow(windowId) {
    try {
      await chrome.windows.update(windowId, { focused: true });
    } catch (error) {
      if (!isWindowAccessError(error)) { // Window not found is fine
        console.error(`${SCRIPT_NAME_BG}: Error focusing window ${windowId}:`, error.message);
      }
    }
  }

  // --- Event Handlers for TabManager ---
  async handleTabUpdate(tab) { // Expects full tab object
    if (!this._isValidTabForProcessing(tab)) return;

    const newUrlString = this._getTabUrlString(tab);
    const oldCachedInfo = this.urlCache.get(tab.id);
    
    if (!newUrlString || !(newUrlString.startsWith('http:') || newUrlString.startsWith('https:'))) {
      // Non-HTTP URL or no URL, remove from cache if it was there
      if (oldCachedInfo) {
        this._removeUrlFromCache(tab.id, oldCachedInfo.url);
      }
      return;
    }

    const newParsedUrl = this._tryParseUrl(newUrlString);
    if (!newParsedUrl) { // Invalid new URL
        if (oldCachedInfo) this._removeUrlFromCache(tab.id, oldCachedInfo.url);
        return;
    }

    const urlChanged = !oldCachedInfo || oldCachedInfo.url.href !== newParsedUrl.href;
    const windowChanged = oldCachedInfo && oldCachedInfo.windowId !== tab.windowId;

    if (urlChanged || windowChanged) {
      if (oldCachedInfo) this._removeUrlFromCache(tab.id, oldCachedInfo.url);
      this._addUrlToCache(tab.id, newParsedUrl, tab.windowId);
      // Check for duplicates only if URL is valid and changed or window changed
      await this.checkForDuplicateAndFocusExisting(tab); 
    } else if (tab.status === 'complete' && oldCachedInfo && oldCachedInfo.url.href === newParsedUrl.href) {
      // URL didn't change, but tab loaded; re-check for duplicates in case one was opened while this was loading
      await this.checkForDuplicateAndFocusExisting(tab);
    }
  }

  handleTabRemoved(tabId, removeInfo) {
    if (removeInfo?.isWindowClosing) {
      this._removeWindowTabsFromCache(removeInfo.windowId);
    } else {
      const cachedInfo = this.urlCache.get(tabId);
      if (cachedInfo) {
        this._removeUrlFromCache(tabId, cachedInfo.url);
      }
    }
  }
}

// --- Initialization and Global Event Listeners ---
const tabManager = new TabManager();

// Initialize cache on startup
(async () => {
  await tabManager.initializeCache();
})();

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "sort-tabs") {
    await tabManager.sortTabsInCurrentWindow();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === PERFORM_GESTURE_ACTION && message.gesture && sender?.tab?.id != null) {
    handleGestureAction(message.gesture, sender.tab.id);
    return true; // Indicates async response, though not used here
  }
  return false; // No async response
});

chrome.action.onClicked.addListener(async () => {
  await tabManager.mergeAllWindows();
});

chrome.tabs.onCreated.addListener((tab) => {
  // Minimal handling onCreated, full processing often waits for onUpdated with URL
  if (!tabManager._isValidTabForProcessing(tab)) return;
  
  const urlString = tabManager._getTabUrlString(tab); // Use consistent URL getter
  const parsedUrl = tabManager._tryParseUrl(urlString);
  if (parsedUrl) {
    tabManager._addUrlToCache(tab.id, parsedUrl, tab.windowId);
    // Initial duplicate check can be done here or wait for onUpdated status 'complete'
    // For simplicity and to avoid race conditions with rapidly opening tabs,
    // onUpdated is often a more robust place for the main duplicate check.
    // However, a quick preliminary check here might be useful in some scenarios.
    // For now, relying on onUpdated.
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Ensure we have the full tab object, especially if only tabId and changeInfo are provided
  let tabToProcess = tab; 
  if (!tabManager._isValidTabForProcessing(tabToProcess) || 
      // If critical info is missing but an important change occurred, try to fetch full tab
      (!tabToProcess.url && (changeInfo.url || changeInfo.status === 'complete'))) {
    try {
        tabToProcess = await chrome.tabs.get(tabId);
    } catch (error) {
        if (!tabManager._isTabNotFoundError(error)) { // Tab not found is common
            console.error(`${SCRIPT_NAME_BG}: Error fetching tab ${tabId} in onUpdated:`, error.message);
        }
        // If tab is gone or invalid, remove from cache if present
        const cachedInfo = tabManager.urlCache.get(tabId);
        if(cachedInfo) tabManager._removeUrlFromCache(tabId, cachedInfo.url);
        return;
    }
  }
  
  if (!tabManager._isValidTabForProcessing(tabToProcess)) return; // Still invalid after fetch

  // Process if URL changed, status is complete, or other relevant properties changed
  if (changeInfo.url || changeInfo.status === 'complete' || 
      changeInfo.pinned !== undefined || changeInfo.audible !== undefined) {
    await tabManager.handleTabUpdate(tabToProcess);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  tabManager.handleTabRemoved(tabId, removeInfo);
});

chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
  // When a tab is attached to a new window, its windowId changes.
  // We need to update our cache.
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab) { // tab.windowId will be the new windowId
        await tabManager.handleTabUpdate(tab); // Treat as a regular update
    }
  } catch (error) {
    if (!tabManager._isTabNotFoundError(error)) {
      console.error(`${SCRIPT_NAME_BG}: Error processing attached tab ${tabId}:`, error.message);
    }
    const cachedInfo = tabManager.urlCache.get(tabId);
    if(cachedInfo) tabManager._removeUrlFromCache(tabId, cachedInfo.url);
  }
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  // When a tab is detached, it might be moved to a new window or closed.
  // If it's moved, onAttached will handle the update.
  // If it's part of a window closing, onRemoved with isWindowClosing=true handles it.
  // If it's an individual tab being dragged out to a new window, onAttached will eventually fire.
  // For now, no specific action needed here beyond what other handlers cover.
  // Could preemptively update its windowId in cache to 'detached' state if needed,
  // but onAttached or onRemoved should soon clarify its final state.
});
