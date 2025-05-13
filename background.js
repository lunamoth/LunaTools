/**
 * LunaTools Background Script
 * Handles tab organization, deduplication, window merging, and gesture actions.
 */

// --- Constants ---
const NEW_TAB_URL = "chrome://newtab/";
const PERFORM_GESTURE_ACTION = 'perform-gesture';
const LOG_PREFIX = "LunaTools:";

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
/**
 * Handles tab actions based on gesture messages from the content script.
 * @param {string} gesture - The gesture direction ('U', 'D', 'L', 'R').
 * @param {number} tabId - The ID of the tab where the gesture originated.
 */
async function handleGestureAction(gesture, tabId) {
  console.log(`${LOG_PREFIX} Handling gesture '${gesture}' for tab ${tabId}`);
  const activeTabOptions = { active: true };

  try {
    switch (gesture) {
      case 'U': // Up - New Tab
        const currentTab = await chrome.tabs.get(tabId).catch(() => null);
        await chrome.tabs.create({
          index: currentTab ? currentTab.index + 1 : undefined,
          openerTabId: tabId,
          ...activeTabOptions
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
      default:
        console.warn(`${LOG_PREFIX} Unknown gesture received: ${gesture}`);
    }
  } catch (error) {
    if (!isTabAccessError(error)) {
      console.warn(`${LOG_PREFIX} Error performing gesture action '${gesture}' on tab ${tabId}:`, error.message);
    }
    // Common errors like 'cannot go back/forward' or 'tab closed' are suppressed by isTabAccessError.
  }
}

// --- TabManager Class ---
class TabManager {
  constructor() {
    this.urlCache = new Map(); // Map<tabId, {url: URL, windowId: number}>
    this.reverseUrlLookup = new Map(); // Map<urlString, Array<{tabId: number, windowId: number}>>

    // Bind methods used as event handlers
    this.handleTabRemoved = this.handleTabRemoved.bind(this);
    this.handleTabUpdate = this.handleTabUpdate.bind(this);
    // No need to bind compareUrls if only used like this.compareUrls
  }

  _isTabNotFoundError(error) {
    return error?.message?.includes("No tab with id") || error?.message?.includes("Invalid tab ID");
  }

  async sortTabsInCurrentWindow() {
    console.log(`${LOG_PREFIX} Sorting tabs in current window...`);
    try {
      const currentWindow = await chrome.windows.getCurrent({ populate: false, windowTypes: ['normal'] });
      if (!currentWindow?.id) {
        console.error(`${LOG_PREFIX} Could not get current window ID.`);
        return;
      }
      await this._sortAndMoveTabsInWindow(currentWindow.id);
    } catch (error) {
      console.error(`${LOG_PREFIX} Error sorting tabs:`, error);
    }
  }

  async _sortAndMoveTabsInWindow(windowId) {
    try {
      console.log(`${LOG_PREFIX} Sorting tabs in window ${windowId}...`);
      const tabsInWindow = await chrome.tabs.query({ windowId });
      const tabsWithParsedUrls = this._getTabsWithParsedUrls(tabsInWindow);
      const sortableTabs = tabsWithParsedUrls.filter(tab => tab.parsedUrl);

      const originalIndices = new Map(tabsInWindow.map(tab => [tab.id, tab.index]));
      sortableTabs.sort(this._compareUrls.bind(this)); // Bind if necessary, or use arrow function

      const moveOperations = this._createMoveOperations(sortableTabs, originalIndices, windowId);
      if (moveOperations.length > 0) {
        await Promise.all(moveOperations);
        console.log(`${LOG_PREFIX} Moved ${moveOperations.length} tabs for sorting in window ${windowId}.`);
      } else {
        console.log(`${LOG_PREFIX} Tabs in window ${windowId} are already sorted or no sortable tabs found.`);
      }
    } catch (error) {
      if (isWindowAccessError(error)) {
        console.warn(`${LOG_PREFIX} Window ${windowId} not found during sorting, likely closed.`);
      } else {
        console.error(`${LOG_PREFIX} Error sorting tabs in window ${windowId}:`, error);
      }
    }
  }

  _createMoveOperations(sortedTabs, originalIndices, windowId) {
    return sortedTabs.reduce((movePromises, tab, desiredIndex) => {
      const currentIndex = originalIndices.get(tab.id);
      if (typeof currentIndex === 'number' && currentIndex !== desiredIndex) {
        const movePromise = chrome.tabs.move(tab.id, { index: desiredIndex })
          .catch(error => {
            if (this._isTabNotFoundError(error)) {
              console.warn(`${LOG_PREFIX} Tab ${tab.id} likely closed before moving (in window ${windowId}), skipping.`);
            } else {
              console.error(`${LOG_PREFIX} Error moving tab ${tab.id} in window ${windowId}:`, error);
            }
          });
        movePromises.push(movePromise);
      }
      return movePromises;
    }, []);
  }

  _getTabUrl(tab) {
    // Prefer loaded URL if it's a standard web page, otherwise fallback to pendingUrl, then original URL.
    if (tab?.url && tab.url !== 'about:blank' && !tab.url.startsWith('chrome://') && (tab.url.startsWith('http:') || tab.url.startsWith('https:'))) {
      return tab.url;
    }
    return tab?.pendingUrl || tab?.url || null;
  }

  async checkForDuplicateAndFocusExisting(tab) {
    if (!tab?.id || typeof tab.windowId === 'undefined') return;

    const tabUrlString = this._getTabUrl(tab);
    if (!tabUrlString || tabUrlString === NEW_TAB_URL || !(tabUrlString.startsWith('http:') || tabUrlString.startsWith('https:'))) {
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(tabUrlString);
    } catch (e) {
      const oldCachedInfo = this.urlCache.get(tab.id);
      if (oldCachedInfo) this._removeUrlFromCache(tab.id, oldCachedInfo.url);
      console.warn(`${LOG_PREFIX} Invalid URL for duplicate check on tab ${tab.id}: ${tabUrlString}`);
      return;
    }

    // Ensure the URL is cached before checking for duplicates
    const cachedInfo = this.urlCache.get(tab.id);
    if (!cachedInfo || cachedInfo.url.href !== parsedUrl.href || cachedInfo.windowId !== tab.windowId) {
      this._addUrlToCache(tab.id, parsedUrl, tab.windowId);
    }

    await this._findAndHandleDuplicates(tab, parsedUrl);
  }

  async _findAndHandleDuplicates(currentTab, parsedUrl) {
    try {
      const duplicateTabIdsInWindow = await this._findDuplicateTabIdsInSameWindow(currentTab, parsedUrl);

      if (duplicateTabIdsInWindow.length > 0) {
        console.log(`${LOG_PREFIX} Found ${duplicateTabIdsInWindow.length} duplicate(s) for tab ${currentTab.id} (${parsedUrl.href}) in window ${currentTab.windowId}`);
        await this._handleDuplicateTab(currentTab, duplicateTabIdsInWindow, parsedUrl);
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Error checking/handling duplicates for tab ${currentTab.id}:`, error);
    }
  }

  async _findDuplicateTabIdsInSameWindow(currentTab, parsedUrl) {
    const urlKey = parsedUrl.href;
    const potentialDuplicatesInfo = this.reverseUrlLookup.get(urlKey) || [];
    const duplicateTabIds = [];

    for (const { tabId, windowId } of potentialDuplicatesInfo) {
      if (tabId === currentTab.id || windowId !== currentTab.windowId) continue;

      try {
        await chrome.tabs.get(tabId); // Verify tab still exists
        duplicateTabIds.push(tabId);
      } catch (error) {
        if (this._isTabNotFoundError(error)) {
          this._removeUrlFromCache(tabId, parsedUrl); // Clean up cache for non-existent tab
        } else {
          console.error(`${LOG_PREFIX} Error verifying potential duplicate tab ${tabId}:`, error);
        }
      }
    }
    return duplicateTabIds;
  }

  async _handleDuplicateTab(newlyOpenedTab, existingDuplicateIds, parsedUrl) {
    const tabToCloseId = newlyOpenedTab.id;
    const tabToFocusId = existingDuplicateIds[0]; // Focus the first found duplicate

    try {
      await chrome.tabs.get(tabToCloseId); // Check if tab to close still exists
    } catch (e) {
      if (this._isTabNotFoundError(e)) {
        console.warn(`${LOG_PREFIX} Tab ${tabToCloseId} (duplicate) was already closed.`);
        this._removeUrlFromCache(tabToCloseId, parsedUrl);
        return;
      }
      throw e; // Rethrow other errors
    }
    
    // Safety: Ensure we don't close the last tab with this URL in the window (cache might lag)
    const tabsWithUrlInWindow = (this.reverseUrlLookup.get(parsedUrl.href) || []).filter(t => t.windowId === newlyOpenedTab.windowId);
    if (tabsWithUrlInWindow.length <= 1 && tabsWithUrlInWindow.some(t => t.tabId === tabToCloseId)) {
        console.warn(`${LOG_PREFIX} Skipping duplicate removal for tab ${tabToCloseId}, seems it's the last one with URL ${parsedUrl.href} in window ${newlyOpenedTab.windowId}.`);
        return;
    }

    try {
      await chrome.tabs.get(tabToFocusId); // Verify the target existing tab still exists

      if (newlyOpenedTab.active) {
        await chrome.tabs.update(tabToFocusId, { active: true }).catch(err => {
          if (this._isTabNotFoundError(err)) console.warn(`${LOG_PREFIX} Failed to focus existing tab ${tabToFocusId} - likely closed.`);
          else console.error(`${LOG_PREFIX} Error focusing existing tab ${tabToFocusId}:`, err);
        });
      }

      await chrome.tabs.remove(tabToCloseId).catch(err => {
        if (!this._isTabNotFoundError(err)) { // Don't log if already closed
          console.error(`${LOG_PREFIX} Error removing duplicate tab ${tabToCloseId}:`, err);
        }
      });

      console.log(`${LOG_PREFIX} Closed duplicate tab ${tabToCloseId} and attempted to focus existing tab ${tabToFocusId}`);
      this._removeUrlFromCache(tabToCloseId, parsedUrl);

    } catch (error) {
      if (this._isTabNotFoundError(error)) { // existingTabToFocusId was not found
        console.warn(`${LOG_PREFIX} Existing duplicate tab ${tabToFocusId} not found when handling duplicate for tab ${tabToCloseId}. It was likely closed.`);
        this._removeTabIdFromReverseLookup(tabToFocusId, parsedUrl.href); // Clean up its cache entry

        // Since the 'existing' one is gone, remove the 'new' one if it still exists
        try {
          await chrome.tabs.remove(tabToCloseId);
          console.log(`${LOG_PREFIX} Removed tab ${tabToCloseId} as its intended duplicate ${tabToFocusId} was already closed.`);
          this._removeUrlFromCache(tabToCloseId, parsedUrl);
        } catch (removeError) {
          if (!this._isTabNotFoundError(removeError)) {
            console.error(`${LOG_PREFIX} Error removing tab ${tabToCloseId} after its duplicate was gone:`, removeError);
          }
        }
      } else {
        console.error(`${LOG_PREFIX} Error handling duplicate tab ${tabToCloseId} (acting on existing tab ${tabToFocusId}):`, error);
      }
    }
  }

  async mergeAllWindows() {
    console.log(`${LOG_PREFIX} Merging all windows...`);
    try {
      const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      if (allWindows.length <= 1) {
        console.log(`${LOG_PREFIX} No other windows to merge or only one window exists.`);
        const singleWindow = allWindows.length === 1 ? allWindows[0] : await chrome.windows.getCurrent({ windowTypes: ['normal'] }).catch(() => null);
        if (singleWindow?.id) await this._sortAndMoveTabsInWindow(singleWindow.id);
        return;
      }

      const targetWindow = await chrome.windows.getCurrent({ windowTypes: ['normal'] });
      if (!targetWindow?.id) {
        console.error(`${LOG_PREFIX} Could not get current window to merge into.`);
        return;
      }
      const targetWindowId = targetWindow.id;

      console.log(`${LOG_PREFIX} Moving tabs from other windows to window ${targetWindowId}...`);
      const tabsToMove = this._getNonPinnedTabsFromOtherWindows(allWindows, targetWindowId);
      
      await this._moveTabsToWindow(tabsToMove, targetWindowId);

      const remainingWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      await this._closeOtherEmptyOrPinnedOnlyWindows(remainingWindows, targetWindowId);

      await this._focusWindow(targetWindowId);
      await this._sortAndMoveTabsInWindow(targetWindowId);

      console.log(`${LOG_PREFIX} Window merge and sort complete.`);
    } catch (error) {
      console.error(`${LOG_PREFIX} Error merging windows:`, error);
    }
  }
  
  async _moveTabsToWindow(tabs, targetWindowId) {
    let movedCount = 0;
    const movePromises = [];

    for (const tab of tabs) {
        try {
            await chrome.tabs.get(tab.id); // Check if tab still exists
            movePromises.push(
                chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 })
                    .then(() => { movedCount++; })
                    .catch(err => {
                        if (this._isTabNotFoundError(err)) {
                            console.warn(`${LOG_PREFIX} Tab ${tab.id} closed before moving, skipping.`);
                        } else if (isWindowAccessError(err)) {
                            console.warn(`${LOG_PREFIX} Target window ${targetWindowId} closed during merge? Skipping move for tab ${tab.id}.`);
                        } else {
                            console.error(`${LOG_PREFIX} Error moving tab ${tab.id} to window ${targetWindowId}:`, err);
                        }
                        // Ensure cache is cleaned up for unmovable tab if it was in cache
                        const cachedInfo = this.urlCache.get(tab.id);
                        if(cachedInfo) this._removeUrlFromCache(tab.id, cachedInfo.url);
                    })
            );
        } catch (getErr) {
             if (this._isTabNotFoundError(getErr)) {
                 console.warn(`${LOG_PREFIX} Tab ${tab.id} to be moved was already closed, skipping.`);
                 const cachedInfo = this.urlCache.get(tab.id);
                 if(cachedInfo) this._removeUrlFromCache(tab.id, cachedInfo.url);
             } else {
                  console.error(`${LOG_PREFIX} Error checking tab ${tab.id} before move:`, getErr);
             }
        }
    }
    if (movePromises.length > 0) {
      await Promise.all(movePromises);
      console.log(`${LOG_PREFIX} Attempted to move ${movePromises.length} tabs, successfully moved ${movedCount} to window ${targetWindowId}.`);
    } else {
       console.log(`${LOG_PREFIX} No non-pinned tabs found in other windows to move, or all encountered errors.`);
    }
  }

  _getNonPinnedTabsFromOtherWindows(windows, targetWindowId) {
    return windows.flatMap(win =>
      (win.id !== targetWindowId && win.tabs)
        ? win.tabs.filter(tab => !tab.pinned)
        : []
    );
  }

  async _closeOtherEmptyOrPinnedOnlyWindows(windows, targetWindowId) {
    const windowsToClose = windows.filter(win => {
      if (win.id === targetWindowId) return false;
      return !win.tabs || win.tabs.every(tab => tab.pinned);
    });

    if (windowsToClose.length === 0) return;

    console.log(`${LOG_PREFIX} Closing ${windowsToClose.length} other window(s)...`);
    const closePromises = windowsToClose.map(win =>
      chrome.windows.remove(win.id).catch(err => {
        if (isWindowAccessError(err)) {
          console.warn(`${LOG_PREFIX} Window ${win.id} already closed.`);
        } else {
          console.error(`${LOG_PREFIX} Error closing window ${win.id}:`, err);
        }
      })
    );
    await Promise.all(closePromises);
    console.log(`${LOG_PREFIX} Finished closing other windows.`);
  }

  async _focusWindow(windowId) {
    try {
      await chrome.windows.update(windowId, { focused: true });
    } catch (error) {
      if (isWindowAccessError(error)) {
        console.warn(`${LOG_PREFIX} Window ${windowId} not found for focusing.`);
      } else {
        console.error(`${LOG_PREFIX} Error focusing window ${windowId}:`, error);
      }
    }
  }

  async handleTabUpdate(tab) {
    if (!tab?.id || typeof tab.windowId === 'undefined') return;

    const newUrlString = this._getTabUrl(tab);
    const oldCachedInfo = this.urlCache.get(tab.id);
    const oldUrl = oldCachedInfo?.url;

    const isHttpUrl = (urlStr) => urlStr && (urlStr.startsWith('http:') || urlStr.startsWith('https:'));

    if (!isHttpUrl(newUrlString)) {
      if (oldCachedInfo) {
        // console.log(`${LOG_PREFIX} Tab ${tab.id} navigated away from ${oldUrl.href} or to non-http URL, removing from cache.`);
        this._removeUrlFromCache(tab.id, oldUrl);
      }
      return;
    }

    let newUrl;
    try {
      newUrl = new URL(newUrlString);
    } catch (e) {
      console.warn(`${LOG_PREFIX} Invalid URL during update for tab ${tab.id}: ${newUrlString}`, e);
      if (oldCachedInfo) this._removeUrlFromCache(tab.id, oldUrl);
      return;
    }

    const urlChanged = !oldUrl || oldUrl.href !== newUrl.href;
    const windowChanged = oldCachedInfo && oldCachedInfo.windowId !== tab.windowId;

    if (urlChanged || windowChanged) {
      // console.log(`${LOG_PREFIX} URL/WindowId changed for tab ${tab.id}: ${oldUrl?.href} (Win ${oldCachedInfo?.windowId}) -> ${newUrl.href} (Win ${tab.windowId})`);
      if (oldUrl) this._removeUrlFromCache(tab.id, oldUrl);
      this._addUrlToCache(tab.id, newUrl, tab.windowId);
      await this.checkForDuplicateAndFocusExisting(tab);
    } else if (tab.status === 'complete') {
      // URL href didn't change, but page might have internally redirected or finished loading.
      // Re-check for duplicates to be safe.
      await this.checkForDuplicateAndFocusExisting(tab);
    }
  }

  handleTabRemoved(tabId, removeInfo) {
    if (removeInfo?.isWindowClosing) {
      // console.log(`${LOG_PREFIX} Window ${removeInfo.windowId} closing, removing its tabs from cache.`);
      this._removeWindowTabsFromCache(removeInfo.windowId);
      return;
    }
    const cachedInfo = this.urlCache.get(tabId);
    if (cachedInfo) {
      // console.log(`${LOG_PREFIX} Tab ${tabId} removed, removing URL ${cachedInfo.url.href} from cache.`);
      this._removeUrlFromCache(tabId, cachedInfo.url);
    }
  }

  _removeWindowTabsFromCache(windowId) {
    let removedCount = 0;
    for (const [tabId, cachedInfo] of this.urlCache.entries()) {
      if (cachedInfo.windowId === windowId) {
        this._removeUrlFromCache(tabId, cachedInfo.url); // This also handles reverseUrlLookup
        removedCount++;
      }
    }
    // console.log(`${LOG_PREFIX} Removed ${removedCount} tabs associated with closed window ${windowId} from cache.`);
  }

  _getTabsWithParsedUrls(tabs) {
    return tabs.map(tab => {
      const cachedInfo = this.urlCache.get(tab.id);
      let parsedUrl = cachedInfo?.url;

      if (!parsedUrl) {
        const urlString = this._getTabUrl(tab);
        if (urlString && urlString !== NEW_TAB_URL && (urlString.startsWith('http:') || urlString.startsWith('https:'))) {
          try {
            parsedUrl = new URL(urlString);
            this._addUrlToCache(tab.id, parsedUrl, tab.windowId); // Cache if parsed successfully
          } catch (e) {
            // console.warn(`${LOG_PREFIX} Could not parse URL for tab ${tab.id} in _getTabsWithParsedUrls: ${urlString}`, e);
            parsedUrl = null;
          }
        }
      }
      return { ...tab, parsedUrl };
    });
  }

  _compareUrls(tabA, tabB) {
    const urlA = tabA.parsedUrl;
    const urlB = tabB.parsedUrl;

    if (!urlA && !urlB) return 0;
    if (!urlA) return 1; // Invalid URLs (null parsedUrl) go last
    if (!urlB) return -1;

    const hostCompare = urlA.hostname.localeCompare(urlB.hostname);
    if (hostCompare !== 0) return hostCompare;

    const pathCompare = urlA.pathname.localeCompare(urlB.pathname);
    if (pathCompare !== 0) return pathCompare;
    
    const searchCompare = urlA.search.localeCompare(urlB.search);
    if (searchCompare !== 0) return searchCompare;

    return urlA.hash.localeCompare(urlB.hash);
  }

  _addUrlToCache(tabId, url, windowId) {
    if (!(url instanceof URL) || typeof tabId !== 'number' || typeof windowId !== 'number') return;

    this.urlCache.set(tabId, { url, windowId });

    const urlKey = url.href;
    let entries = this.reverseUrlLookup.get(urlKey);
    if (!entries) {
      entries = [];
      this.reverseUrlLookup.set(urlKey, entries);
    }

    const existingEntryIndex = entries.findIndex(entry => entry.tabId === tabId);
    if (existingEntryIndex === -1) {
      entries.push({ tabId, windowId });
    } else {
      // Update windowId if it changed (e.g., tab moved between windows)
      if (entries[existingEntryIndex].windowId !== windowId) {
        entries[existingEntryIndex].windowId = windowId;
      }
    }
    // console.log(`${LOG_PREFIX} Added/Updated tab ${tabId} (Win ${windowId}, URL ${urlKey}). Cache sizes: url=${this.urlCache.size}, reverse=${this.reverseUrlLookup.size}`);
  }

  _removeUrlFromCache(tabId, urlInstance) {
    if (!(urlInstance instanceof URL) || typeof tabId !== 'number') return;
    this.urlCache.delete(tabId);
    this._removeTabIdFromReverseLookup(tabId, urlInstance.href);
    // console.log(`${LOG_PREFIX} Removed tab ${tabId} (${urlInstance.href}) from cache. Cache sizes: url=${this.urlCache.size}, reverse=${this.reverseUrlLookup.size}`);
  }

  _removeTabIdFromReverseLookup(tabId, urlKey) {
    const entries = this.reverseUrlLookup.get(urlKey);
    if (!entries) return;

    const filteredEntries = entries.filter(entry => entry.tabId !== tabId);

    if (filteredEntries.length === 0) {
      this.reverseUrlLookup.delete(urlKey);
      // console.log(`${LOG_PREFIX} URL ${urlKey} removed from reverse lookup as no more tabs point to it.`);
    } else if (filteredEntries.length < entries.length) {
      this.reverseUrlLookup.set(urlKey, filteredEntries);
      // console.log(`${LOG_PREFIX} Removed tab ${tabId} from reverse lookup for URL ${urlKey}.`);
    }
  }

  async initializeCache() {
    console.log(`${LOG_PREFIX} Initializing TabManager cache...`);
    this.urlCache.clear();
    this.reverseUrlLookup.clear();
    try {
      const allTabs = await chrome.tabs.query({ windowType: 'normal' });
      console.log(`${LOG_PREFIX} Found ${allTabs.length} existing tabs to cache.`);
      let cachedCount = 0;
      allTabs.forEach(tab => {
        if (tab.id === undefined || tab.windowId === undefined) return; // Skip incomplete tab objects
        const urlString = this._getTabUrl(tab);
        if (urlString && (urlString.startsWith('http:') || urlString.startsWith('https:'))) {
          try {
            const parsedUrl = new URL(urlString);
            this._addUrlToCache(tab.id, parsedUrl, tab.windowId);
            cachedCount++;
          } catch (e) {
            console.warn(`${LOG_PREFIX} Could not parse initial URL for tab ${tab.id}: ${urlString}`, e);
          }
        }
      });
      console.log(`${LOG_PREFIX} Cache initialized. Cached ${cachedCount} tabs. urlCache size: ${this.urlCache.size}, reverseUrlLookup size: ${this.reverseUrlLookup.size}`);
    } catch (error) {
      console.error(`${LOG_PREFIX} Error initializing TabManager cache:`, error);
    }
  }
}

// --- Initialization and Event Listeners ---
const tabManager = new TabManager();

// Initialize cache on startup
(async () => {
  await tabManager.initializeCache();
})();

// Command Listener (Sort Tabs)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "sort-tabs") {
    await tabManager.sortTabsInCurrentWindow();
  }
});

// Message Listener (Gestures from content script)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === PERFORM_GESTURE_ACTION && message.gesture && sender?.tab?.id != null) {
    handleGestureAction(message.gesture, sender.tab.id);
    return true; // Indicate async handling
  }
  return false; // Message not handled
});

// Action Listener (Merge Windows on icon click)
chrome.action.onClicked.addListener(async () => {
  console.log(`${LOG_PREFIX} Browser action clicked.`);
  await tabManager.mergeAllWindows();
});

// Tab Event Listeners
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined || tab.windowId === undefined) return;
  // Initial caching attempt for faster duplicate detection.
  // URL might be pending, so handleTabUpdate will refine this.
  const urlString = tabManager._getTabUrl(tab);
  if (urlString && (urlString.startsWith('http:') || urlString.startsWith('https:'))) {
    try {
      const parsedUrl = new URL(urlString);
      tabManager._addUrlToCache(tab.id, parsedUrl, tab.windowId);
    } catch (e) { /* Ignore invalid pending URLs, onUpdated will handle */ }
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Ensure we have a tab object with necessary properties
  let tabToProcess = tab;
  if (!tabToProcess || typeof tabToProcess.windowId === 'undefined' || typeof tabToProcess.id === 'undefined') {
    if (changeInfo.status === 'complete' || changeInfo.url) { // Only fetch if there's a meaningful change
        try {
            tabToProcess = await chrome.tabs.get(tabId);
        } catch (error) {
            if (!tabManager._isTabNotFoundError(error)) {
                console.warn(`${LOG_PREFIX} Error fetching full tab info for updated tab ${tabId}:`, error);
            }
            return; // Cannot process without tab info
        }
    } else {
        return; // Not enough info to process
    }
  }

  if (tabToProcess && (changeInfo.url || changeInfo.status || changeInfo.pinned !== undefined || changeInfo.audible !== undefined)) {
    await tabManager.handleTabUpdate(tabToProcess);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  tabManager.handleTabRemoved(tabId, removeInfo);
});

chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
  // console.log(`${LOG_PREFIX} Tab ${tabId} attached to window ${attachInfo.newWindowId}`);
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab) await tabManager.handleTabUpdate(tab); // Treat as an update to correct windowId in cache
  } catch (error) {
    if (!tabManager._isTabNotFoundError(error)) {
      console.warn(`${LOG_PREFIX} Error getting attached tab ${tabId} info:`, error);
    }
  }
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  // console.log(`${LOG_PREFIX} Tab ${tabId} detached from window ${detachInfo.oldWindowId}`);
  // No immediate action needed, onAttached to a new window or onRemoved will handle the final state and cache.
});

console.log(`${LOG_PREFIX} Background script loaded and listeners attached.`);
