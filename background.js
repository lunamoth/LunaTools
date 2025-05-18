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
      // Log only if it's not a common, expected error (e.g., tab already closed)
      console.error(`${SCRIPT_NAME_BG}: Gesture '${gesture}' on tab ${tabId} failed:`, error.message);
    }
  }
}

// --- TabManager Class ---
class TabManager {
  constructor() {
    this.urlCache = new Map(); // Map<tabId, {url: URL, windowId: number}>
    this.reverseUrlLookup = new Map(); // Map<urlString, Array<{tabId: number, windowId: number}>>

    this.handleTabRemoved = this.handleTabRemoved.bind(this);
    this.handleTabUpdate = this.handleTabUpdate.bind(this);
  }

  _isTabNotFoundError(error) {
    return isTabAccessError(error);
  }

  _isValidTabForProcessing(tab) {
    return tab?.id !== undefined && tab.windowId !== undefined;
  }

  _getTabUrlString(tab) {
    const url = tab?.url;
    const pendingUrl = tab?.pendingUrl;

    if (url && (url.startsWith('http:') || url.startsWith('https:'))) {
      return url;
    }
    if (pendingUrl && (pendingUrl.startsWith('http:') || pendingUrl.startsWith('https:'))) {
      return pendingUrl;
    }
    return url || pendingUrl || null;
  }

  _tryParseUrl(urlString) {
    if (!urlString || urlString === NEW_TAB_URL || !(urlString.startsWith('http:') || urlString.startsWith('https:'))) {
      return null;
    }
    try {
      return new URL(urlString);
    } catch (e) {
      // Silently ignore invalid URLs for parsing in release
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

    const existingEntry = entries.find(entry => entry.tabId === tabId);
    if (existingEntry) {
      if (existingEntry.windowId !== windowId) {
        existingEntry.windowId = windowId; // Update windowId if tab moved
      }
    } else {
      entries.push({ tabId, windowId }); // Add new entry
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
        this._removeUrlFromCache(tabId, cachedInfo.url);
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
      // Log minimal error for unexpected issues during initialization
      console.error(`${SCRIPT_NAME_BG}: Cache init failed:`, error.message);
    }
  }

  // --- Tab Sorting ---
  async sortTabsInCurrentWindow() {
    try {
      const currentWindow = await chrome.windows.getCurrent({ populate: false, windowTypes: ['normal'] });
      if (!currentWindow?.id) return;
      
      await this._sortAndMoveTabsInWindow(currentWindow.id);
    } catch (error) {
      if (!isWindowAccessError(error)) {
        console.error(`${SCRIPT_NAME_BG}: Sort tabs failed:`, error.message);
      }
    }
  }

  async _sortAndMoveTabsInWindow(windowId) {
    try {
      const tabsInWindow = await chrome.tabs.query({ windowId });
      if (tabsInWindow.length <= 1) return; // No need to sort if 0 or 1 tab

      const tabsWithParsedUrls = tabsInWindow.map(tab => {
        const cachedInfo = this.urlCache.get(tab.id);
        let parsedUrl = cachedInfo?.url;
        if (!parsedUrl) {
          const urlString = this._getTabUrlString(tab);
          parsedUrl = this._tryParseUrl(urlString);
          if (parsedUrl && this._isValidTabForProcessing(tab)) {
            this._addUrlToCache(tab.id, parsedUrl, tab.windowId);
          }
        }
        return { ...tab, parsedUrl };
      }).filter(tab => tab.parsedUrl);

      if (tabsWithParsedUrls.length <= 1) return;

      const originalIndices = new Map(tabsInWindow.map(tab => [tab.id, tab.index]));
      tabsWithParsedUrls.sort((a, b) => this._compareTabUrls(a.parsedUrl, b.parsedUrl));

      const movePromises = tabsWithParsedUrls.reduce((promises, tab, desiredIndex) => {
        const currentIndex = originalIndices.get(tab.id);
        if (typeof currentIndex === 'number' && currentIndex !== desiredIndex && tab.id !== undefined) {
          promises.push(
            chrome.tabs.move(tab.id, { index: desiredIndex }).catch(error => {
              if (!this._isTabNotFoundError(error) && !isWindowAccessError(error)) {
                console.error(`${SCRIPT_NAME_BG}: Move tab ${tab.id} failed during sort:`, error.message);
              }
            })
          );
        }
        return promises;
      }, []);
      
      if (movePromises.length > 0) await Promise.all(movePromises);

    } catch (error) {
      if (!isWindowAccessError(error)) {
        console.error(`${SCRIPT_NAME_BG}: Sort in window ${windowId} failed:`, error.message);
      }
    }
  }

  _compareTabUrls(urlA, urlB) {
    if (!urlA && !urlB) return 0;
    if (!urlA) return 1;
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
    if (!parsedUrl) return;

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
      
      const existingDuplicateTabIds = [];
      for (const { tabId } of potentialDuplicatesInWindow) {
          try {
              await chrome.tabs.get(tabId);
              existingDuplicateTabIds.push(tabId);
          } catch (error) {
              if (this._isTabNotFoundError(error)) {
                  this._removeUrlFromCache(tabId, parsedUrl);
              } else {
                  console.error(`${SCRIPT_NAME_BG}: Verify duplicate tab ${tabId} failed:`, error.message);
              }
          }
      }

      if (existingDuplicateTabIds.length > 0) {
        await this._handleVerifiedDuplicate(currentTab, existingDuplicateTabIds[0], parsedUrl);
      }
    } catch (error) {
      const currentTabId = currentTab?.id;
      if (!this._isTabNotFoundError(error) || (currentTabId && error.message && !error.message.includes(String(currentTabId)))) {
         console.error(`${SCRIPT_NAME_BG}: Duplicate check for tab ${currentTabId || 'N/A'} failed:`, error.message);
      }
    }
  }

  async _handleVerifiedDuplicate(newlyOpenedTab, existingDuplicateId, parsedUrl) {
    try {
      await chrome.tabs.get(newlyOpenedTab.id); // Check if newlyOpenedTab still exists
    } catch (e) {
      if (this._isTabNotFoundError(e)) {
        this._removeUrlFromCache(newlyOpenedTab.id, parsedUrl);
        return; // Tab to close is already gone
      }
      // For other errors checking newlyOpenedTab, log minimally and potentially abort
      console.error(`${SCRIPT_NAME_BG}: Check tab to close ${newlyOpenedTab.id} failed:`, e.message);
      return; 
    }

    // Ensure existingDuplicateId still exists before acting on it
    try {
      await chrome.tabs.get(existingDuplicateId);
    } catch (e) {
      if (this._isTabNotFoundError(e)) {
        this._removeUrlFromCache(existingDuplicateId, parsedUrl); // Clean cache for the (now gone) existing duplicate
        // Don't close newlyOpenedTab, as its intended duplicate is gone.
        // It might become a duplicate of another tab, or be unique.
        // Let future checks handle it if necessary.
        return;
      }
      console.error(`${SCRIPT_NAME_BG}: Check existing duplicate ${existingDuplicateId} failed:`, e.message);
      return; // Don't proceed if existing duplicate's state is uncertain
    }
    
    // Double check: only close if there are at least two instances of this URL in this window
    const allTabsWithUrlInWindow = (this.reverseUrlLookup.get(parsedUrl.href) || [])
                                  .filter(t => t.windowId === newlyOpenedTab.windowId);
    if (allTabsWithUrlInWindow.length <= 1) {
        return; // No actual duplicate to close now (e.g., one was closed by another process)
    }

    try {
      if (newlyOpenedTab.active) {
        await chrome.tabs.update(existingDuplicateId, { active: true }).catch(err => {
          if (!this._isTabNotFoundError(err) && !isWindowAccessError(err)) {
             console.error(`${SCRIPT_NAME_BG}: Focus existing tab ${existingDuplicateId} failed:`, err.message);
          }
        });
      }

      await chrome.tabs.remove(newlyOpenedTab.id);
      this._removeUrlFromCache(newlyOpenedTab.id, parsedUrl); // Clean cache after successful removal

    } catch (error) { // Errors from update(existing) or remove(newlyOpened)
      if (this._isTabNotFoundError(error)) { // newlyOpenedTab was already removed
        this._removeUrlFromCache(newlyOpenedTab.id, parsedUrl);
      } else if (!isWindowAccessError(error)) {
        console.error(`${SCRIPT_NAME_BG}: Handle verified duplicate (new: ${newlyOpenedTab.id}, exist: ${existingDuplicateId}) failed:`, error.message);
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
      if (!targetWindow?.id) return;
      const targetWindowId = targetWindow.id;

      const tabsToMoveDetails = allWindows.flatMap(win =>
        (win.id !== targetWindowId && win.tabs)
          ? win.tabs.filter(tab => !tab.pinned).map(tab => ({ id: tab.id, windowId: win.id }))
          : []
      );
      
      if (tabsToMoveDetails.length > 0) {
          const movePromises = tabsToMoveDetails.map(tabDetail =>
            chrome.tabs.move(tabDetail.id, { windowId: targetWindowId, index: -1 })
              .then(movedTab => {
                  if (movedTab && this._isValidTabForProcessing(movedTab)) {
                      const urlString = this._getTabUrlString(movedTab);
                      const parsedUrl = this._tryParseUrl(urlString);
                      if (parsedUrl) {
                          const oldCacheEntry = this.urlCache.get(movedTab.id);
                          if(oldCacheEntry) this._removeUrlFromCache(movedTab.id, oldCacheEntry.url); // Important: use old URL string for reverse lookup removal
                          this._addUrlToCache(movedTab.id, parsedUrl, movedTab.windowId);
                      }
                  }
              })
              .catch(err => {
                if (!this._isTabNotFoundError(err) && !isWindowAccessError(err)) {
                  console.error(`${SCRIPT_NAME_BG}: Move tab ${tabDetail.id} to window ${targetWindowId} failed:`, err.message);
                }
                const cachedInfo = this.urlCache.get(tabDetail.id);
                if(cachedInfo) this._removeUrlFromCache(tabDetail.id, cachedInfo.url);
              })
          );
          await Promise.all(movePromises);
      }

      const remainingWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      const windowsToClose = remainingWindows.filter(win => {
        if (win.id === targetWindowId) return false;
        return !win.tabs || win.tabs.length === 0 || win.tabs.every(tab => tab.pinned);
      });

      if (windowsToClose.length > 0) {
          const closePromises = windowsToClose.map(win =>
            chrome.windows.remove(win.id).catch(err => {
              if (!isWindowAccessError(err)) {
                console.error(`${SCRIPT_NAME_BG}: Close window ${win.id} failed:`, err.message);
              }
            })
          );
          await Promise.all(closePromises);
      }

      await this._focusWindow(targetWindowId);
      await this._sortAndMoveTabsInWindow(targetWindowId);

    } catch (error) {
      if (!isWindowAccessError(error)){
        console.error(`${SCRIPT_NAME_BG}: Merge windows failed:`, error.message);
      }
    }
  }
  
  async _focusWindow(windowId) {
    try {
      await chrome.windows.update(windowId, { focused: true });
    } catch (error) {
      if (!isWindowAccessError(error)) {
        console.error(`${SCRIPT_NAME_BG}: Focus window ${windowId} failed:`, error.message);
      }
    }
  }

  // --- Event Handlers for TabManager ---
  async handleTabUpdate(tab) {
    if (!this._isValidTabForProcessing(tab)) return;

    const newUrlString = this._getTabUrlString(tab);
    const oldCachedInfo = this.urlCache.get(tab.id);
    
    if (!newUrlString || !(newUrlString.startsWith('http:') || newUrlString.startsWith('https:'))) {
      if (oldCachedInfo) {
        this._removeUrlFromCache(tab.id, oldCachedInfo.url);
      }
      return;
    }

    const newParsedUrl = this._tryParseUrl(newUrlString);
    if (!newParsedUrl) {
        if (oldCachedInfo) this._removeUrlFromCache(tab.id, oldCachedInfo.url);
        return;
    }

    const urlChanged = !oldCachedInfo || oldCachedInfo.url.href !== newParsedUrl.href;
    const windowChanged = oldCachedInfo && oldCachedInfo.windowId !== tab.windowId;

    if (urlChanged || windowChanged) {
      if (oldCachedInfo) this._removeUrlFromCache(tab.id, oldCachedInfo.url);
      this._addUrlToCache(tab.id, newParsedUrl, tab.windowId);
      await this.checkForDuplicateAndFocusExisting(tab); 
    } else if (tab.status === 'complete' && oldCachedInfo && oldCachedInfo.url.href === newParsedUrl.href) {
      // URL and window didn't change, but tab finished loading. Re-check for duplicates.
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
    // Return true for async response is good practice, though not strictly needed if sendResponse isn't called.
    return true; 
  }
  return false; // No async response or message not handled
});

chrome.action.onClicked.addListener(async () => {
  await tabManager.mergeAllWindows();
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!tabManager._isValidTabForProcessing(tab)) return;
  
  const urlString = tabManager._getTabUrlString(tab);
  const parsedUrl = tabManager._tryParseUrl(urlString);
  if (parsedUrl) {
    tabManager._addUrlToCache(tab.id, parsedUrl, tab.windowId);
    // Duplicate check will be more robustly handled by onUpdated when tab is fully loaded or URL confirmed.
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  let tabToProcess = tab; 
  if (!tabManager._isValidTabForProcessing(tabToProcess) || 
      (!tabToProcess.url && (changeInfo.url || changeInfo.status === 'complete'))) {
    try {
        tabToProcess = await chrome.tabs.get(tabId);
    } catch (error) {
        if (tabManager._isTabNotFoundError(error)) {
            const cachedInfo = tabManager.urlCache.get(tabId);
            if(cachedInfo) tabManager._removeUrlFromCache(tabId, cachedInfo.url);
        } else {
            console.error(`${SCRIPT_NAME_BG}: Get tab ${tabId} in onUpdated failed:`, error.message);
        }
        return;
    }
  }
  
  if (!tabManager._isValidTabForProcessing(tabToProcess)) return;

  // Process only if URL changed or tab finished loading, as these affect duplicate checks.
  if (changeInfo.url || changeInfo.status === 'complete') {
    await tabManager.handleTabUpdate(tabToProcess);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  tabManager.handleTabRemoved(tabId, removeInfo);
});

chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab) { // tab.windowId is now the new windowId
        // Treat as a regular update to refresh cache and check duplicates in the new window context.
        await tabManager.handleTabUpdate(tab); 
    }
  } catch (error) {
    if (tabManager._isTabNotFoundError(error)) {
        const cachedInfo = tabManager.urlCache.get(tabId);
        if(cachedInfo) tabManager._removeUrlFromCache(tabId, cachedInfo.url);
    } else {
      console.error(`${SCRIPT_NAME_BG}: Process attached tab ${tabId} failed:`, error.message);
    }
  }
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  // No specific action needed here for now.
  // If a tab is detached to a new window, onAttached will handle its new state.
  // If it's closed after detaching (e.g. dragging out and closing), onRemoved will handle it.
  // The cache for the tabId might be briefly in an intermediate state if it's being moved,
  // but onAttached or onRemoved should resolve it.
});
