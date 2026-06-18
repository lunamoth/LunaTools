const NEW_TAB_URL = "chrome://newtab/";
const PERFORM_GESTURE_ACTION = 'perform-gesture';
const FETCH_EXCHANGE_RATE_ACTION = "fetchLunaToolsExchangeRate";
const API_TIMEOUT_MS_EXCHANGE_RATE = 7000;
const CONTEXT_MENU_ID_MERGE_TABS = "lunaToolsMergeTabsContextMenu";
const BADGE_ALERT_THRESHOLD = 100;
const CURRENCY_CODE_REGEX = /^[A-Z]{3}$/;

async function updateTabCountBadge() {
  try {
    const allTabs = await chrome.tabs.query({});
    const tabCount = allTabs.length;
    const isAlertState = tabCount >= BADGE_ALERT_THRESHOLD;

    await chrome.action.setBadgeText({ text: String(tabCount) });
    await chrome.action.setBadgeBackgroundColor({ color: isAlertState ? '#EB4D3D' : '#FFCB00' });

    if (typeof chrome.action.setBadgeTextColor === 'function') {
      await chrome.action.setBadgeTextColor({ color: isAlertState ? '#FFFFFF' : '#000000' });
    }
  } catch (error) {
    console.error("LunaTools: 탭 개수 배지 업데이트 중 오류 발생.", error);
    try {
      await chrome.action.setBadgeText({ text: '' });
    } catch (_) {
      // 배지 초기화 자체가 실패해도 확장 프로그램의 다른 기능은 계속 동작해야 합니다.
    }
  }
}

function ensureMergeTabsContextMenu() {
  try {
    chrome.contextMenus.remove(CONTEXT_MENU_ID_MERGE_TABS, () => {
      // remove()는 기존 메뉴가 없으면 lastError를 설정합니다. 정상적인 초기화 흐름이므로 무시합니다.
      void chrome.runtime.lastError;
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID_MERGE_TABS,
        title: "모든 탭을 하나의 창으로 합치기",
        contexts: ["action"]
      }, () => {
        if (chrome.runtime.lastError) {
          console.warn("LunaTools: 컨텍스트 메뉴 생성 실패", chrome.runtime.lastError.message);
        }
      });
    });
  } catch (error) {
    console.warn("LunaTools: 컨텍스트 메뉴 초기화 실패", error);
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
  ensureMergeTabsContextMenu();
  updateTabCountBadge();
});

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    ensureMergeTabsContextMenu();
    updateTabCountBadge();
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID_MERGE_TABS) {
    await tabManager.mergeAllWindows(tab?.windowId);
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
    this.duplicateOperationQueues = new Map();

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

  async sortTabsInCurrentWindow(preferredWindowId = null) {
    try {
      const targetWindowId = await this._resolveTargetWindowId(preferredWindowId);
      if (targetWindowId == null) return;

      await this._sortAndMoveTabsInWindow(targetWindowId);
    } catch (error) {
    }
  }

  async _sortAndMoveTabsInWindow(windowId) {
    try {
      const allTabsInWindow = await chrome.tabs.query({ windowId });
      const pinnedTabs = allTabsInWindow.filter(tab => tab.pinned);
      const unpinnedTabs = allTabsInWindow.filter(tab => !tab.pinned);

      if (unpinnedTabs.length <= 1) {
        return; // 정렬할 일반 탭이 없거나 하나뿐이면 종료
      }

      const tabsWithParsedUrls = unpinnedTabs.map(tab => {
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

      tabsWithParsedUrls.sort((a, b) => this._compareTabUrls(a.parsedUrl, b.parsedUrl));
      
      const sortedTabIds = tabsWithParsedUrls.map(tab => tab.id);

      // 최적화: 이미 정렬된 상태인지 확인 (일반 탭 기준)
      const currentUnpinnedSortableTabIds = unpinnedTabs
        .map(tab => tab.id)
        .filter(id => sortedTabIds.includes(id));
      
      if (JSON.stringify(sortedTabIds) === JSON.stringify(currentUnpinnedSortableTabIds)) {
        return;
      }

      // 고정된 탭 바로 뒤로 이동
      const targetIndex = pinnedTabs.length;
      await chrome.tabs.move(sortedTabIds, { index: targetIndex });

    } catch (error) {
      // 오류 처리는 기존과 동일하게 유지
    }
  }

  _compareTabUrls(urlA, urlB) {
    if (!urlA && !urlB) return 0;
    if (!urlA) return 1;
    if (!urlB) return -1;
  
    // 먼저 전체 호스트 이름(서브도메인 포함)을 기준으로 비교합니다.
    const hostCompare = urlA.hostname.localeCompare(urlB.hostname);
    if (hostCompare !== 0) {
      return hostCompare;
    }
  
    // 호스트 이름이 같다면, 나머지 전체 경로를 기준으로 비교합니다.
    const pathA = urlA.pathname + urlA.search + urlA.hash;
    const pathB = urlB.pathname + urlB.search + urlB.hash;
    return pathA.localeCompare(pathB);
  }

  async checkForDuplicateAndFocusExisting(tab) {
    if (!this._isValidTabForProcessing(tab)) return;

    const tabUrlString = this._getTabUrlString(tab);
    const parsedUrl = this._tryParseUrl(tabUrlString);
    if (!parsedUrl) return;

    const cachedInfo = this.urlCache.get(tab.id);
    if (!cachedInfo || cachedInfo.url.href !== parsedUrl.href || cachedInfo.windowId !== tab.windowId) {
      if (cachedInfo?.url) {
        this._removeUrlFromCache(tab.id, cachedInfo.url);
      }
      this._addUrlToCache(tab.id, parsedUrl, tab.windowId);
    }

    await this._findAndHandleDuplicates(tab, parsedUrl);
  }

  async _runDuplicateOperationSerially(lockKey, operation) {
    const previousOperation = this.duplicateOperationQueues.get(lockKey) || Promise.resolve();
    const currentOperation = previousOperation
      .catch(() => {})
      .then(operation);

    this.duplicateOperationQueues.set(lockKey, currentOperation);

    try {
      return await currentOperation;
    } finally {
      if (this.duplicateOperationQueues.get(lockKey) === currentOperation) {
        this.duplicateOperationQueues.delete(lockKey);
      }
    }
  }

  async _findAndHandleDuplicates(currentTab, parsedUrl) {
    const lockKey = `${currentTab.windowId}\u0000${parsedUrl.href}`;

    return this._runDuplicateOperationSerially(lockKey, async () => {
      try {
        const potentialDuplicatesInWindow = (this.reverseUrlLookup.get(parsedUrl.href) || [])
          .filter(entry => entry.tabId !== currentTab.id && entry.windowId === currentTab.windowId);

        if (potentialDuplicatesInWindow.length === 0) return;

        const existingDuplicateTabIds = [];
        for (const { tabId } of potentialDuplicatesInWindow) {
          try {
            const liveTab = await chrome.tabs.get(tabId);
            const liveUrl = this._tryParseUrl(this._getTabUrlString(liveTab));
            if (liveTab.windowId === currentTab.windowId && liveUrl?.href === parsedUrl.href) {
              existingDuplicateTabIds.push(tabId);
            } else {
              this._removeUrlFromCache(tabId, parsedUrl);
              if (liveUrl && this._isValidTabForProcessing(liveTab)) {
                this._addUrlToCache(liveTab.id, liveUrl, liveTab.windowId);
              }
            }
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
    });
  }

  async _handleVerifiedDuplicate(newlyOpenedTab, existingDuplicateId, parsedUrl) {
    let liveNewTab;
    try {
      liveNewTab = await chrome.tabs.get(newlyOpenedTab.id);
    } catch (e) {
      if (this._isTabNotFoundError(e)) {
        this._removeUrlFromCache(newlyOpenedTab.id, parsedUrl);
        return; 
      }
      return; 
    }

    let liveExistingTab;
    try {
      liveExistingTab = await chrome.tabs.get(existingDuplicateId);
    } catch (e) {
      if (this._isTabNotFoundError(e)) {
        this._removeUrlFromCache(existingDuplicateId, parsedUrl);
        return;
      }
      return;
    }

    const liveNewUrl = this._tryParseUrl(this._getTabUrlString(liveNewTab));
    const liveExistingUrl = this._tryParseUrl(this._getTabUrlString(liveExistingTab));
    const tabsStillMatch = liveNewTab.windowId === liveExistingTab.windowId &&
      liveNewUrl?.href === parsedUrl.href &&
      liveExistingUrl?.href === parsedUrl.href;

    if (!tabsStillMatch) {
      for (const liveTab of [liveNewTab, liveExistingTab]) {
        const cachedInfo = this.urlCache.get(liveTab.id);
        if (cachedInfo) this._removeUrlFromCache(liveTab.id, cachedInfo.url);

        const liveUrl = this._tryParseUrl(this._getTabUrlString(liveTab));
        if (liveUrl && this._isValidTabForProcessing(liveTab)) {
          this._addUrlToCache(liveTab.id, liveUrl, liveTab.windowId);
        }
      }
      return;
    }
    
    const allTabsWithUrlInWindow = (this.reverseUrlLookup.get(parsedUrl.href) || [])
                                  .filter(t => t.windowId === newlyOpenedTab.windowId);
    if (allTabsWithUrlInWindow.length <= 1) {
        return;
    }

    try {
      if (liveNewTab.active) {
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

  async _resolveTargetWindowId(preferredWindowId = null) {
    if (typeof preferredWindowId === 'number') {
      try {
        const preferredWindow = await chrome.windows.get(preferredWindowId, { populate: false });
        if (preferredWindow?.id != null && preferredWindow.type === 'normal') {
          return preferredWindow.id;
        }
      } catch (error) {
        if (!isWindowAccessError(error)) {
          console.warn("LunaTools: 대상 창 확인 중 오류 발생", error);
        }
      }
    }

    try {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (typeof activeTab?.windowId === 'number') {
        return activeTab.windowId;
      }
    } catch (error) {
    }

    try {
      const [firstWindow] = await chrome.windows.getAll({ populate: false, windowTypes: ['normal'] });
      return typeof firstWindow?.id === 'number' ? firstWindow.id : null;
    } catch (error) {
      return null;
    }
  }

  async mergeAllWindows(preferredTargetWindowId = null) {
    try {
      const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      if (allWindows.length <= 1) {
        if (allWindows.length === 1 && typeof allWindows[0]?.id === 'number') {
          await this._sortAndMoveTabsInWindow(allWindows[0].id);
        }
        return;
      }

      const targetWindowId = await this._resolveTargetWindowId(preferredTargetWindowId);
      if (targetWindowId == null) {
        return;
      }

      const tabsToMoveDetails = allWindows.flatMap(win =>
        (win.id !== targetWindowId && win.tabs)
          ? win.tabs
              .filter(tab => typeof tab.id === 'number')
              .map(tab => ({
                id: tab.id,
                windowId: win.id,
                pinned: !!tab.pinned,
                index: typeof tab.index === 'number' ? tab.index : 0
              }))
          : []
      );
      
      if (tabsToMoveDetails.length > 0) {
          const processMovedTabForCache = (movedTab) => {
              if (movedTab && this._isValidTabForProcessing(movedTab)) {
                  const urlString = this._getTabUrlString(movedTab);
                  const parsedUrl = this._tryParseUrl(urlString);
                  if (parsedUrl) {
                      const oldCacheEntry = this.urlCache.get(movedTab.id);
                      if (oldCacheEntry) this._removeUrlFromCache(movedTab.id, oldCacheEntry.url);
                      this._addUrlToCache(movedTab.id, parsedUrl, movedTab.windowId);
                  }
              }
          };

          const sortBySourceWindowAndIndex = (a, b) => {
              if (a.windowId !== b.windowId) return a.windowId - b.windowId;
              return a.index - b.index;
          };

          const pinnedTabsToMove = tabsToMoveDetails.filter(tab => tab.pinned).sort(sortBySourceWindowAndIndex);
          const unpinnedTabsToMove = tabsToMoveDetails.filter(tab => !tab.pinned).sort(sortBySourceWindowAndIndex);

          const targetTabsBeforeMove = await chrome.tabs.query({ windowId: targetWindowId });
          let nextPinnedInsertIndex = targetTabsBeforeMove.filter(tab => tab.pinned).length;

          for (const tabDetail of pinnedTabsToMove) {
              try {
                  const movedTab = await chrome.tabs.move(tabDetail.id, { windowId: targetWindowId, index: nextPinnedInsertIndex });
                  nextPinnedInsertIndex += 1;
                  processMovedTabForCache(movedTab);
              } catch (err) {
                  const cachedInfo = this.urlCache.get(tabDetail.id);
                  if (cachedInfo) this._removeUrlFromCache(tabDetail.id, cachedInfo.url);
              }
          }

          for (const tabDetail of unpinnedTabsToMove) {
              try {
                  const movedTab = await chrome.tabs.move(tabDetail.id, { windowId: targetWindowId, index: -1 });
                  processMovedTabForCache(movedTab);
              } catch (err) {
                  const cachedInfo = this.urlCache.get(tabDetail.id);
                  if (cachedInfo) this._removeUrlFromCache(tabDetail.id, cachedInfo.url);
              }
          }
      }

      const remainingWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      const windowsToClose = remainingWindows.filter(win => {
        if (win.id === targetWindowId) return false;
        return !win.tabs || win.tabs.length === 0;
      });

      if (windowsToClose.length > 0) {
          const closePromises = windowsToClose.map(win =>
            chrome.windows.remove(win.id).catch(err => {
              if (!isWindowAccessError(err)) {
                console.warn("LunaTools: 빈 창 닫기 실패", err);
              }
            })
          );
          await Promise.all(closePromises);
      }

      await this._focusWindow(targetWindowId);
      await this._sortAndMoveTabsInWindow(targetWindowId);

    } catch (error) {
        console.error("LunaTools: 창 병합 중 치명적 오류 발생", error);
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
    await tabManager.sortTabsInCurrentWindow(tab?.windowId);
  } else if (command === "toggle-mute-current") {
    const [currentTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (typeof currentTab?.id === 'number') {
      const isMuted = !!currentTab.mutedInfo?.muted;
      await chrome.tabs.update(currentTab.id, { muted: !isMuted });
    }
  } else if (command === "toggle-mute-all") {
    const allTabs = await chrome.tabs.query({});
    const anyUnmuted = allTabs.some(t => !t.mutedInfo?.muted);
    const targetMuteState = anyUnmuted;
    for (const t of allTabs) {
      if (typeof t.id !== 'number') continue;
      try {
        await chrome.tabs.update(t.id, { muted: targetMuteState });
      } catch (error) {
        if (!isTabAccessError(error)) {
          console.warn("LunaTools: 탭 음소거 상태 변경 실패", error);
        }
      }
    }
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
    const fromCurrency = String(message.from).trim().toUpperCase();
    const toCurrency = String(message.to).trim().toUpperCase();

    if (!CURRENCY_CODE_REGEX.test(fromCurrency) || !CURRENCY_CODE_REGEX.test(toCurrency)) {
      sendResponse({ error: 'Invalid currency code.' });
      return false;
    }

    const apiUrl = `https://api.frankfurter.app/latest?from=${encodeURIComponent(fromCurrency)}&to=${encodeURIComponent(toCurrency)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS_EXCHANGE_RATE);
    
    fetch(apiUrl, { signal: controller.signal })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Network error (status: ${response.status})`);
        }
        return response.json();
      })
      .then(data => {
        if (data.rates && typeof data.rates[toCurrency] === 'number' && data.date) {
          sendResponse({ data: { rate: data.rates[toCurrency], date: data.date } });
        } else {
          sendResponse({ error: `API response error: Could not find rate for ${toCurrency}` });
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
      })
      .finally(() => clearTimeout(timeoutId));
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

if (chrome.tabs.onReplaced) {
  chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
    const cachedInfo = tabManager.urlCache.get(removedTabId);
    if (cachedInfo) {
      tabManager._removeUrlFromCache(removedTabId, cachedInfo.url);
    }

    try {
      const addedTab = await chrome.tabs.get(addedTabId);
      await tabManager.handleTabUpdate(addedTab);
    } catch (error) {
      if (!tabManager._isTabNotFoundError(error)) {
        console.warn("LunaTools: 교체된 탭 캐시 갱신 실패", error);
      }
    }
  });
}

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
