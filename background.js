const NEW_TAB_URL = "chrome://newtab/";
const PERFORM_GESTURE_ACTION = 'perform-gesture';
const FETCH_EXCHANGE_RATE_ACTION = "fetchLunaToolsExchangeRate";
const API_TIMEOUT_MS_EXCHANGE_RATE = 7000;
const CONTEXT_MENU_ID_MERGE_TABS = "lunaToolsMergeTabsContextMenu";

async function updateTabCountBadge() {
  try {
    const allTabs = await chrome.tabs.query({});
    const tabCount = allTabs.length;

    await chrome.action.setBadgeText({
      text: tabCount.toString()
    });

    if (tabCount >= 200) {
      await chrome.action.setBadgeBackgroundColor({
        color: '#EB4D3D'
      });
      await chrome.action.setBadgeTextColor({
        color: '#FFFFFF'
      });
    } else {
      await chrome.action.setBadgeBackgroundColor({
        color: '#FFCB00'
      });
      await chrome.action.setBadgeTextColor({
        color: '#000000'
      });
    }

  } catch (error) {
    console.error("LunaTools: 탭 개수 배지 업데이트 중 오류 발생.", error);
    await chrome.action.setBadgeText({ text: '' });
  }
}

try {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
} catch (e) {
  console.error("Error setting side panel behavior:", e);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID_MERGE_TABS,
    title: "모든 탭을 하나의 창으로 합치기",
    contexts: ["action"]
  });
  updateTabCountBadge();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID_MERGE_TABS) {
    await tabManager.mergeAllWindows();
  }
});


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

async function handleGestureAction(gesture, tabId) {
  try {
    switch (gesture) {
      case 'U':
        await chrome.tabs.reload(tabId, { bypassCache: true });
        break;
      case 'D':
        await chrome.tabs.remove(tabId);
        break;
      case 'R':
        await chrome.tabs.goForward(tabId);
        break;
      case 'L':
        await chrome.tabs.goBack(tabId);
        break;
    }
  } catch (error) {
  }
}

class TabManager {
  constructor() {
    this.urlCache = new Map();
    this.reverseUrlLookup = new Map();

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
      return null;
    }
  }

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
        existingEntry.windowId = windowId;
      }
    } else {
      entries.push({ tabId, windowId });
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
    }
  }

  async sortTabsInCurrentWindow() {
    try {
      const currentWindow = await chrome.windows.getCurrent({ populate: false, windowTypes: ['normal'] });
      if (!currentWindow?.id) return;
      
      await this._sortAndMoveTabsInWindow(currentWindow.id);
    } catch (error) {
    }
  }

  async _sortAndMoveTabsInWindow(windowId) {
    try {
      const tabsInWindow = await chrome.tabs.query({ windowId });
      if (tabsInWindow.length <= 1) return;

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
            })
          );
        }
        return promises;
      }, []);
      
      if (movePromises.length > 0) await Promise.all(movePromises);

    } catch (error) {
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

    return urlA.hash.localeCompare(urlA.hash);
  }

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
              }
          }
      }

      if (existingDuplicateTabIds.length > 0) {
        await this._handleVerifiedDuplicate(currentTab, existingDuplicateTabIds[0], parsedUrl);
      }
    } catch (error) {
    }
  }

  async _handleVerifiedDuplicate(newlyOpenedTab, existingDuplicateId, parsedUrl) {
    try {
      await chrome.tabs.get(newlyOpenedTab.id);
    } catch (e) {
      if (this._isTabNotFoundError(e)) {
        this._removeUrlFromCache(newlyOpenedTab.id, parsedUrl);
        return; 
      }
      return; 
    }

    try {
      await chrome.tabs.get(existingDuplicateId);
    } catch (e) {
      if (this._isTabNotFoundError(e)) {
        this._removeUrlFromCache(existingDuplicateId, parsedUrl);
        return;
      }
      return;
    }
    
    const allTabsWithUrlInWindow = (this.reverseUrlLookup.get(parsedUrl.href) || [])
                                  .filter(t => t.windowId === newlyOpenedTab.windowId);
    if (allTabsWithUrlInWindow.length <= 1) {
        return;
    }

    try {
      if (newlyOpenedTab.active) {
        await chrome.tabs.update(existingDuplicateId, { active: true }).catch(err => {
        });
      }

      await chrome.tabs.remove(newlyOpenedTab.id);
      this._removeUrlFromCache(newlyOpenedTab.id, parsedUrl);

    } catch (error) {
      if (this._isTabNotFoundError(error)) {
        this._removeUrlFromCache(newlyOpenedTab.id, parsedUrl);
      } 
    }
  }

  async mergeAllWindows() {
    console.log("mergeAllWindows_Debug: Function called by context menu or other means");
    try {
      const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      console.log("mergeAllWindows_Debug: allWindows count:", allWindows.length);
      if (allWindows.length <= 1) {
        if (allWindows.length === 1) await this._sortAndMoveTabsInWindow(allWindows[0].id);
        console.log("mergeAllWindows_Debug: Not enough windows to merge or sort.");
        return;
      }

      const targetWindow = await chrome.windows.getCurrent({ windowTypes: ['normal'] });
      if (!targetWindow?.id) {
          console.log("mergeAllWindows_Debug: No target window found.");
          return;
      }
      const targetWindowId = targetWindow.id;
      console.log("mergeAllWindows_Debug: Target window ID:", targetWindowId);


      const tabsToMoveDetails = allWindows.flatMap(win =>
        (win.id !== targetWindowId && win.tabs)
          ? win.tabs.filter(tab => !tab.pinned).map(tab => ({ id: tab.id, windowId: win.id }))
          : []
      );
      console.log("mergeAllWindows_Debug: Tabs to move count:", tabsToMoveDetails.length);
      
      if (tabsToMoveDetails.length > 0) {
          const movePromises = tabsToMoveDetails.map(tabDetail =>
            chrome.tabs.move(tabDetail.id, { windowId: targetWindowId, index: -1 })
              .then(movedTab => {
                  if (movedTab && this._isValidTabForProcessing(movedTab)) {
                      const urlString = this._getTabUrlString(movedTab);
                      const parsedUrl = this._tryParseUrl(urlString);
                      if (parsedUrl) {
                          const oldCacheEntry = this.urlCache.get(movedTab.id);
                          if(oldCacheEntry) this._removeUrlFromCache(movedTab.id, oldCacheEntry.url);
                          this._addUrlToCache(movedTab.id, parsedUrl, movedTab.windowId);
                      }
                  }
              })
              .catch(err => {
                const cachedInfo = this.urlCache.get(tabDetail.id);
                if(cachedInfo) this._removeUrlFromCache(tabDetail.id, cachedInfo.url);
              })
          );
          await Promise.all(movePromises);
          console.log("mergeAllWindows_Debug: Tab move promises resolved.");
      }

      const remainingWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      const windowsToClose = remainingWindows.filter(win => {
        if (win.id === targetWindowId) return false;
        return !win.tabs || win.tabs.length === 0 || win.tabs.every(tab => tab.pinned);
      });
      console.log("mergeAllWindows_Debug: Windows to close count:", windowsToClose.length);


      if (windowsToClose.length > 0) {
          const closePromises = windowsToClose.map(win =>
            chrome.windows.remove(win.id).catch(err => {
            })
          );
          await Promise.all(closePromises);
          console.log("mergeAllWindows_Debug: Window close promises resolved.");
      }

      await this._focusWindow(targetWindowId);
      await this._sortAndMoveTabsInWindow(targetWindowId);
      console.log("mergeAllWindows_Debug: Target window focused and tabs sorted.");

    } catch (error) {
        console.error("mergeAllWindows_Debug: CRITICAL ERROR in mergeAllWindows:", error);
    }
  }
  
  async _focusWindow(windowId) {
    try {
      await chrome.windows.update(windowId, { focused: true });
    } catch (error) {
    }
  }

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

const tabManager = new TabManager();

(async () => {
  await tabManager.initializeCache();
  updateTabCountBadge();
})();

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "sort-tabs") {
    await tabManager.sortTabsInCurrentWindow();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openTabsInNewTab' && Array.isArray(message.urls)) {
    message.urls.forEach(url => {
        if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
            chrome.tabs.create({ url: url, active: false });
        }
    });
    return false;
  }
    
  if (message?.action === PERFORM_GESTURE_ACTION && message.gesture && sender?.tab?.id != null) {
    handleGestureAction(message.gesture, sender.tab.id);
    return false;
  }

  if (message?.action === FETCH_EXCHANGE_RATE_ACTION && message.from && message.to) {
    const apiUrl = `https://api.frankfurter.app/latest?from=${encodeURIComponent(message.from)}&to=${encodeURIComponent(message.to)}`;
    
    fetch(apiUrl, { signal: AbortSignal.timeout(API_TIMEOUT_MS_EXCHANGE_RATE) })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Network error (status: ${response.status})`);
        }
        return response.json();
      })
      .then(data => {
        if (data.rates && typeof data.rates[message.to] === 'number' && data.date) {
          sendResponse({ data: { rate: data.rates[message.to], date: data.date } });
        } else {
          sendResponse({ error: `API response error: Could not find rate for ${message.to}` });
        }
      })
      .catch(error => {
        let errorMessage = 'Failed to fetch exchange rate.';
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
            errorMessage = 'Request timed out.';
        } else if (error.message && error.message.startsWith('Network error')) {
            errorMessage = error.message;
        } else if (error.message) {
            errorMessage = `API processing error: ${error.message}`;
        }
        sendResponse({ error: errorMessage });
      });
    return true;
  }
  
  return false;
});

chrome.action.onClicked.addListener(async (tab) => {
});

chrome.tabs.onCreated.addListener((tab) => {
  updateTabCountBadge();
  if (!tabManager._isValidTabForProcessing(tab)) return;
  
  const urlString = tabManager._getTabUrlString(tab);
  const parsedUrl = tabManager._tryParseUrl(urlString);
  if (parsedUrl) {
    tabManager._addUrlToCache(tab.id, parsedUrl, tab.windowId);
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
        } 
        return;
    }
  }
  
  if (!tabManager._isValidTabForProcessing(tabToProcess)) return;

  if (changeInfo.url || changeInfo.status === 'complete') {
    await tabManager.handleTabUpdate(tabToProcess);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  updateTabCountBadge();
  tabManager.handleTabRemoved(tabId, removeInfo);
});

chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab) {
        await tabManager.handleTabUpdate(tab); 
    }
  } catch (error) {
    if (tabManager._isTabNotFoundError(error)) {
        const cachedInfo = tabManager.urlCache.get(tabId);
        if(cachedInfo) tabManager._removeUrlFromCache(tabId, cachedInfo.url);
    } 
  }
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
});