/**
 * LunaTools Background Script
 * Handles tab organization, deduplication, window merging, and gesture actions.
 */

// --- Constants ---
const NEW_TAB_URL = "chrome://newtab/";
const PERFORM_GESTURE_ACTION = 'perform-gesture';

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
        // Unknown gesture received
    }
  } catch (error) {
    if (!isTabAccessError(error)) {
      console.error(`LunaTools: Error performing gesture action '${gesture}' on tab ${tabId}:`, error.message);
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
    return error?.message?.includes("No tab with id") || error?.message?.includes("Invalid tab ID");
  }

  async sortTabsInCurrentWindow() {
    try {
      const currentWindow = await chrome.windows.getCurrent({ populate: false, windowTypes: ['normal'] });
      if (!currentWindow?.id) {
        console.error("LunaTools: Could not get current window ID.");
        return;
      }
      await this._sortAndMoveTabsInWindow(currentWindow.id);
    } catch (error) {
      console.error("LunaTools: Error sorting tabs:", error);
    }
  }

  async _sortAndMoveTabsInWindow(windowId) {
    try {
      const tabsInWindow = await chrome.tabs.query({ windowId });
      const tabsWithParsedUrls = this._getTabsWithParsedUrls(tabsInWindow);
      const sortableTabs = tabsWithParsedUrls.filter(tab => tab.parsedUrl);

      const originalIndices = new Map(tabsInWindow.map(tab => [tab.id, tab.index]));
      sortableTabs.sort(this._compareUrls.bind(this));

      const moveOperations = this._createMoveOperations(sortableTabs, originalIndices, windowId);
      if (moveOperations.length > 0) {
        await Promise.all(moveOperations);
      }
    } catch (error) {
      if (isWindowAccessError(error)) {
        // Window not found during sorting, likely closed.
      } else {
        console.error(`LunaTools: Error sorting tabs in window ${windowId}:`, error);
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
              // Tab likely closed before moving, skipping.
            } else {
              console.error(`LunaTools: Error moving tab ${tab.id} in window ${windowId}:`, error);
            }
          });
        movePromises.push(movePromise);
      }
      return movePromises;
    }, []);
  }

  _getTabUrl(tab) {
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
      // console.warn(`${LOG_PREFIX} Invalid URL for duplicate check on tab ${tab.id}: ${tabUrlString}`); // Kept as example if you need specific warnings
      return;
    }

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
        await this._handleDuplicateTab(currentTab, duplicateTabIdsInWindow, parsedUrl);
      }
    } catch (error) {
      console.error(`LunaTools: Error checking/handling duplicates for tab ${currentTab.id}:`, error);
    }
  }

  async _findDuplicateTabIdsInSameWindow(currentTab, parsedUrl) {
    const urlKey = parsedUrl.href;
    const potentialDuplicatesInfo = this.reverseUrlLookup.get(urlKey) || [];
    const duplicateTabIds = [];

    for (const { tabId, windowId } of potentialDuplicatesInfo) {
      if (tabId === currentTab.id || windowId !== currentTab.windowId) continue;

      try {
        await chrome.tabs.get(tabId);
        duplicateTabIds.push(tabId);
      } catch (error) {
        if (this._isTabNotFoundError(error)) {
          this._removeUrlFromCache(tabId, parsedUrl);
        } else {
          console.error(`LunaTools: Error verifying potential duplicate tab ${tabId}:`, error);
        }
      }
    }
    return duplicateTabIds;
  }

  async _handleDuplicateTab(newlyOpenedTab, existingDuplicateIds, parsedUrl) {
    const tabToCloseId = newlyOpenedTab.id;
    const tabToFocusId = existingDuplicateIds[0];

    try {
      await chrome.tabs.get(tabToCloseId);
    } catch (e) {
      if (this._isTabNotFoundError(e)) {
        this._removeUrlFromCache(tabToCloseId, parsedUrl);
        return;
      }
      throw e;
    }
    
    const tabsWithUrlInWindow = (this.reverseUrlLookup.get(parsedUrl.href) || []).filter(t => t.windowId === newlyOpenedTab.windowId);
    if (tabsWithUrlInWindow.length <= 1 && tabsWithUrlInWindow.some(t => t.tabId === tabToCloseId)) {
        return;
    }

    try {
      await chrome.tabs.get(tabToFocusId);

      if (newlyOpenedTab.active) {
        await chrome.tabs.update(tabToFocusId, { active: true }).catch(err => {
          if (this._isTabNotFoundError(err)) { /* Failed to focus existing tab - likely closed. */ }
          else console.error(`LunaTools: Error focusing existing tab ${tabToFocusId}:`, err);
        });
      }

      await chrome.tabs.remove(tabToCloseId).catch(err => {
        if (!this._isTabNotFoundError(err)) {
          console.error(`LunaTools: Error removing duplicate tab ${tabToCloseId}:`, err);
        }
      });

      this._removeUrlFromCache(tabToCloseId, parsedUrl);

    } catch (error) {
      if (this._isTabNotFoundError(error)) {
        this._removeTabIdFromReverseLookup(tabToFocusId, parsedUrl.href);
        try {
          await chrome.tabs.remove(tabToCloseId);
          this._removeUrlFromCache(tabToCloseId, parsedUrl);
        } catch (removeError) {
          if (!this._isTabNotFoundError(removeError)) {
            console.error(`LunaTools: Error removing tab ${tabToCloseId} after its duplicate was gone:`, removeError);
          }
        }
      } else {
        console.error(`LunaTools: Error handling duplicate tab ${tabToCloseId} (acting on existing tab ${tabToFocusId}):`, error);
      }
    }
  }

  async mergeAllWindows() {
    try {
      const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      if (allWindows.length <= 1) {
        const singleWindow = allWindows.length === 1 ? allWindows[0] : await chrome.windows.getCurrent({ windowTypes: ['normal'] }).catch(() => null);
        if (singleWindow?.id) await this._sortAndMoveTabsInWindow(singleWindow.id);
        return;
      }

      const targetWindow = await chrome.windows.getCurrent({ windowTypes: ['normal'] });
      if (!targetWindow?.id) {
        console.error("LunaTools: Could not get current window to merge into.");
        return;
      }
      const targetWindowId = targetWindow.id;

      const tabsToMove = this._getNonPinnedTabsFromOtherWindows(allWindows, targetWindowId);
      
      await this._moveTabsToWindow(tabsToMove, targetWindowId);

      const remainingWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      await this._closeOtherEmptyOrPinnedOnlyWindows(remainingWindows, targetWindowId);

      await this._focusWindow(targetWindowId);
      await this._sortAndMoveTabsInWindow(targetWindowId);

    } catch (error) {
      console.error("LunaTools: Error merging windows:", error);
    }
  }
  
  async _moveTabsToWindow(tabs, targetWindowId) {
    const movePromises = [];

    for (const tab of tabs) {
        try {
            await chrome.tabs.get(tab.id);
            movePromises.push(
                chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 })
                    .catch(err => {
                        if (this._isTabNotFoundError(err)) {
                            // Tab closed before moving, skipping.
                        } else if (isWindowAccessError(err)) {
                            // Target window closed during merge? Skipping move for tab
                        } else {
                            console.error(`LunaTools: Error moving tab ${tab.id} to window ${targetWindowId}:`, err);
                        }
                        const cachedInfo = this.urlCache.get(tab.id);
                        if(cachedInfo) this._removeUrlFromCache(tab.id, cachedInfo.url);
                    })
            );
        } catch (getErr) {
             if (this._isTabNotFoundError(getErr)) {
                 const cachedInfo = this.urlCache.get(tab.id);
                 if(cachedInfo) this._removeUrlFromCache(tab.id, cachedInfo.url);
             } else {
                  console.error(`LunaTools: Error checking tab ${tab.id} before move:`, getErr);
             }
        }
    }
    if (movePromises.length > 0) {
      await Promise.all(movePromises);
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

    const closePromises = windowsToClose.map(win =>
      chrome.windows.remove(win.id).catch(err => {
        if (isWindowAccessError(err)) {
          // Window already closed.
        } else {
          console.error(`LunaTools: Error closing window ${win.id}:`, err);
        }
      })
    );
    await Promise.all(closePromises);
  }

  async _focusWindow(windowId) {
    try {
      await chrome.windows.update(windowId, { focused: true });
    } catch (error) {
      if (isWindowAccessError(error)) {
        // Window not found for focusing.
      } else {
        console.error(`LunaTools: Error focusing window ${windowId}:`, error);
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
        this._removeUrlFromCache(tab.id, oldUrl);
      }
      return;
    }

    let newUrl;
    try {
      newUrl = new URL(newUrlString);
    } catch (e) {
      // console.warn(`${LOG_PREFIX} Invalid URL during update for tab ${tab.id}: ${newUrlString}`, e);
      if (oldCachedInfo) this._removeUrlFromCache(tab.id, oldUrl);
      return;
    }

    const urlChanged = !oldUrl || oldUrl.href !== newUrl.href;
    const windowChanged = oldCachedInfo && oldCachedInfo.windowId !== tab.windowId;

    if (urlChanged || windowChanged) {
      if (oldUrl) this._removeUrlFromCache(tab.id, oldUrl);
      this._addUrlToCache(tab.id, newUrl, tab.windowId);
      await this.checkForDuplicateAndFocusExisting(tab);
    } else if (tab.status === 'complete') {
      await this.checkForDuplicateAndFocusExisting(tab);
    }
  }

  handleTabRemoved(tabId, removeInfo) {
    if (removeInfo?.isWindowClosing) {
      this._removeWindowTabsFromCache(removeInfo.windowId);
      return;
    }
    const cachedInfo = this.urlCache.get(tabId);
    if (cachedInfo) {
      this._removeUrlFromCache(tabId, cachedInfo.url);
    }
  }

  _removeWindowTabsFromCache(windowId) {
    for (const [tabId, cachedInfo] of this.urlCache.entries()) {
      if (cachedInfo.windowId === windowId) {
        this._removeUrlFromCache(tabId, cachedInfo.url);
      }
    }
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
            this._addUrlToCache(tab.id, parsedUrl, tab.windowId);
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
      if (entries[existingEntryIndex].windowId !== windowId) {
        entries[existingEntryIndex].windowId = windowId;
      }
    }
  }

  _removeUrlFromCache(tabId, urlInstance) {
    if (!(urlInstance instanceof URL) || typeof tabId !== 'number') return;
    this.urlCache.delete(tabId);
    this._removeTabIdFromReverseLookup(tabId, urlInstance.href);
  }

  _removeTabIdFromReverseLookup(tabId, urlKey) {
    const entries = this.reverseUrlLookup.get(urlKey);
    if (!entries) return;

    const filteredEntries = entries.filter(entry => entry.tabId !== tabId);

    if (filteredEntries.length === 0) {
      this.reverseUrlLookup.delete(urlKey);
    } else if (filteredEntries.length < entries.length) {
      this.reverseUrlLookup.set(urlKey, filteredEntries);
    }
  }

  async initializeCache() {
    this.urlCache.clear();
    this.reverseUrlLookup.clear();
    try {
      const allTabs = await chrome.tabs.query({ windowType: 'normal' });
      allTabs.forEach(tab => {
        if (tab.id === undefined || tab.windowId === undefined) return;
        const urlString = this._getTabUrl(tab);
        if (urlString && (urlString.startsWith('http:') || urlString.startsWith('https:'))) {
          try {
            const parsedUrl = new URL(urlString);
            this._addUrlToCache(tab.id, parsedUrl, tab.windowId);
          } catch (e) {
            // console.warn(`${LOG_PREFIX} Could not parse initial URL for tab ${tab.id}: ${urlString}`, e);
          }
        }
      });
    } catch (error) {
      console.error("LunaTools: Error initializing TabManager cache:", error);
    }
  }
}

// --- Initialization and Event Listeners ---
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
    return true;
  }
  return false;
});

chrome.action.onClicked.addListener(async () => {
  await tabManager.mergeAllWindows();
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined || tab.windowId === undefined) return;
  const urlString = tabManager._getTabUrl(tab);
  if (urlString && (urlString.startsWith('http:') || urlString.startsWith('https:'))) {
    try {
      const parsedUrl = new URL(urlString);
      tabManager._addUrlToCache(tab.id, parsedUrl, tab.windowId);
    } catch (e) { /* Ignore */ }
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  let tabToProcess = tab;
  if (!tabToProcess || typeof tabToProcess.windowId === 'undefined' || typeof tabToProcess.id === 'undefined') {
    if (changeInfo.status === 'complete' || changeInfo.url) {
        try {
            tabToProcess = await chrome.tabs.get(tabId);
        } catch (error) {
            if (!tabManager._isTabNotFoundError(error)) {
                console.error(`LunaTools: Error fetching full tab info for updated tab ${tabId}:`, error);
            }
            return;
        }
    } else {
        return;
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
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab) await tabManager.handleTabUpdate(tab);
  } catch (error) {
    if (!tabManager._isTabNotFoundError(error)) {
      console.error(`LunaTools: Error getting attached tab ${tabId} info:`, error);
    }
  }
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  // No immediate action needed
});
