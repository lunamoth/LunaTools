/**
 * LunaTools Background Script
 * Handles tab organization, deduplication, and gesture actions.
 */

// Constants
const NEW_TAB_URL = "chrome://newtab/";
const PERFORM_GESTURE_ACTION = 'perform-gesture'; // Action name for gesture messages

/**
 * Handles tab actions based on gesture messages received from the content script.
 * @param {string} gesture - The gesture direction ('U', 'D', 'L', 'R').
 * @param {number} tabId - The ID of the tab where the gesture originated.
 */
const handleGestureAction = (gesture, tabId) => {
  console.log(`LunaTools: Handling gesture '${gesture}' for tab ${tabId}`);
  let actionPromise;
  const activeTabOptions = { active: true };

  switch (gesture) {
    case 'U': // Up - New Tab
      actionPromise = chrome.tabs.get(tabId)
        .then(
          tab => chrome.tabs.create({
            index: (tab?.index != null) ? tab.index + 1 : undefined,
            openerTabId: tabId,
            ...activeTabOptions
          }),
          () => chrome.tabs.create(activeTabOptions) // Fallback
        );
      break;
    case 'D': // Down - Close Tab
      actionPromise = chrome.tabs.remove(tabId);
      break;
    case 'R': // Right - Go Forward
      actionPromise = chrome.tabs.goForward(tabId);
      break;
    case 'L': // Left - Go Back
      actionPromise = chrome.tabs.goBack(tabId);
      break;
    default:
      console.warn(`LunaTools: Unknown gesture received: ${gesture}`);
      actionPromise = Promise.resolve();
  }

  actionPromise.catch(error => {
    if (error && error.message && !(error.message.includes("No tab with id") || error.message.includes("Invalid tab ID") || error.message.includes("Cannot go back") || error.message.includes("Cannot go forward"))) {
       console.warn(`LunaTools: Error performing gesture action '${gesture}' on tab ${tabId}:`, error.message);
    }
    // Avoid logging common, expected errors like 'cannot go back/forward'
  });
};


// --- TabManager Class ---
// Manages tab state, sorting, merging, and deduplication logic.
class TabManager {
  constructor() {
    this.urlCache = new Map();
    this.reverseUrlLookup = new Map();
    this.handleTabRemoved = this.handleTabRemoved.bind(this);
    this.compareUrls = this.compareUrls.bind(this);
    this.handleTabUpdate = this.handleTabUpdate.bind(this);
    this.isTabNotFoundError = this.isTabNotFoundError.bind(this);
  }

  isTabNotFoundError(error) {
    return error?.message?.includes("No tab with id") || error?.message?.includes("Invalid tab ID");
  }

  async sortTabs() {
    console.log("LunaTools: Sorting tabs in current window...");
    try {
      const currentWindow = await chrome.windows.getCurrent({ populate: false, windowTypes: ['normal'] });
      if (!currentWindow?.id) {
           console.error("LunaTools: Could not get current window ID.");
           return;
      }
      await this.sortAndMoveTabsInWindow(currentWindow.id);
    } catch (error) {
      console.error("LunaTools: Error sorting tabs:", error);
    }
  }

  async sortAndMoveTabsInWindow(windowId) {
    try {
        console.log(`LunaTools: Sorting tabs in window ${windowId}...`);
        const tabs = await chrome.tabs.query({ windowId: windowId });
        const tabsWithParsedUrls = this.getTabsWithParsedUrls(tabs);
        const sortableTabs = tabsWithParsedUrls.filter(tab => tab.parsedUrl);

        // Need original indices before sorting conceptually
        const originalIndices = new Map(tabs.map(tab => [tab.id, tab.index]));

        // Sort based on URL
        sortableTabs.sort(this.compareUrls);

        const moveOperations = this.createMoveOperations(sortableTabs, originalIndices, windowId);
        if (moveOperations.length > 0) {
            await Promise.all(moveOperations);
            console.log(`LunaTools: Moved ${moveOperations.length} tabs for sorting in window ${windowId}.`);
        } else {
            console.log(`LunaTools: Tabs in window ${windowId} are already sorted.`);
        }
    } catch (error) {
        if (error?.message?.includes("No window with id")) {
            console.warn(`LunaTools: Window ${windowId} not found during sorting, likely closed.`);
        } else {
            console.error(`LunaTools: Error sorting tabs in window ${windowId}:`, error);
        }
    }
  }

  createMoveOperations(sortedTabsWithParsedUrls, originalIndices, windowId) {
    return sortedTabsWithParsedUrls.reduce((movePromises, tab, desiredIndex) => {
      const currentIndex = originalIndices.get(tab.id);
      // Only move if the tab's original index doesn't match the target sorted index
      if (typeof currentIndex === 'number' && currentIndex !== desiredIndex) {
        const movePromise = (async () => {
          try {
            // console.log(`LunaTools: Moving tab ${tab.id} from index ${currentIndex} to ${desiredIndex} in window ${windowId}`);
            return await chrome.tabs.move(tab.id, { index: desiredIndex });
          } catch (error) {
            if (this.isTabNotFoundError(error)) {
               console.warn(`LunaTools: Tab ${tab.id} likely closed before moving (in window ${windowId}), skipping.`);
            } else {
               console.error(`LunaTools: Error moving tab ${tab.id} in window ${windowId}:`, error);
            }
            return undefined; // Indicate failure
          }
        })();
        movePromises.push(movePromise);
      }
      return movePromises;
    }, []);
  }


  async checkForDuplicateAndFocusExisting(tab) {
    if (!tab?.id || typeof tab.windowId === 'undefined') return;

    const tabUrl = this.getTabUrl(tab);
    // Ignore non-http URLs and new tab page for duplicate checks
    if (!tabUrl || tabUrl === NEW_TAB_URL || !(tabUrl.startsWith('http:') || tabUrl.startsWith('https:'))) {
        return;
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(tabUrl);
    } catch (e) {
        // If the current URL is invalid, we can't check for duplicates based on it.
        // We might still need to remove any old cache entry if the tab navigated *to* an invalid URL.
        const oldCachedInfo = this.urlCache.get(tab.id);
        if (oldCachedInfo) {
            this.removeUrlFromCache(tab.id, oldCachedInfo.url);
        }
        console.warn(`LunaTools: Invalid URL encountered for duplicate check on tab ${tab.id}: ${tabUrl}`);
        return;
    }

    // Ensure the URL is cached before checking for duplicates
    if (!this.urlCache.has(tab.id) || this.urlCache.get(tab.id)?.url.href !== parsedUrl.href) {
        this.addUrlToCache(tab.id, parsedUrl, tab.windowId);
    }

    await this.findAndHandleDuplicates(tab, parsedUrl);
  }

  async findAndHandleDuplicates(tab, parsedUrl) {
      try {
          const duplicateTabIds = await this.findDuplicateTabsInCurrentWindow(tab, parsedUrl);

          if (duplicateTabIds.length > 0) {
            console.log(`LunaTools: Found ${duplicateTabIds.length} duplicate(s) for tab ${tab.id} (${parsedUrl.href}) in window ${tab.windowId}`);
            // Pass the array of duplicates, not just the first one
            await this.handleDuplicateTab(tab, duplicateTabIds, parsedUrl);
          }
      } catch (error) {
          console.error(`LunaTools: Error checking/handling duplicates for tab ${tab.id}:`, error);
      }
  }

  getTabUrl(tab) {
     // Prefer loaded URL, fallback to pending URL if loaded one isn't useful (e.g., about:blank during load)
     return (tab && tab.url && tab.url !== 'about:blank' && !tab.url.startsWith('chrome://')) ? tab.url : (tab?.pendingUrl || tab?.url || null);
  }

  async findDuplicateTabsInCurrentWindow(tab, parsedUrl) {
    const urlKey = parsedUrl.href;
    const potentialDuplicates = this.reverseUrlLookup.get(urlKey) || [];
    const duplicateTabIdsInWindow = [];

    for (const potential of potentialDuplicates) {
      if (potential.tabId === tab.id) continue; // Skip self

      // Check if the potential duplicate is in the same window using cached windowId
      if (potential.windowId === tab.windowId) {
          try {
              // Verify the potential duplicate tab still exists
              await chrome.tabs.get(potential.tabId);
              duplicateTabIdsInWindow.push(potential.tabId);
          } catch (error) {
              if (this.isTabNotFoundError(error)) {
                  // console.warn(`LunaTools: Potential duplicate tab ${potential.tabId} (cached for window ${potential.windowId}) not found, removing from cache.`);
                  // Use the *original* parsedUrl (which corresponds to the urlKey) for removal
                  this.removeUrlFromCache(potential.tabId, parsedUrl);
              } else {
                  console.error(`LunaTools: Error verifying potential duplicate tab ${potential.tabId}:`, error);
              }
          }
      }
    }
    return duplicateTabIdsInWindow;
  }

  async handleDuplicateTab(tab, duplicateTabIds, parsedUrl) {
     // Check if the tab being considered for removal is active.
     const isActiveTab = tab.active;
     // Choose the first existing duplicate as the target to keep/focus.
     const existingTabId = duplicateTabIds[0];

     // Sanity check: ensure the tab to remove still exists before trying to remove it.
     try {
         await chrome.tabs.get(tab.id);
     } catch (e) {
         if (this.isTabNotFoundError(e)) {
             console.warn(`LunaTools: Tab ${tab.id} intended for removal as duplicate was already closed.`);
             // Attempt cache cleanup for the already closed tab
             this.removeUrlFromCache(tab.id, parsedUrl);
             return; // Nothing more to do
         }
         // Rethrow other errors
         throw e;
     }

     // Safety check: Don't remove the tab if it's the *only* one left with this URL in this window (cache might be lagging).
     const tabsWithUrlInWindow = (this.reverseUrlLookup.get(parsedUrl.href) || []).filter(t => t.windowId === tab.windowId);
     if (tabsWithUrlInWindow.length <= 1) {
         console.warn(`LunaTools: Skipping duplicate removal for tab ${tab.id}, seems it's the last one with URL ${parsedUrl.href} in window ${tab.windowId}.`);
         return;
     }


     try {
         // Verify the target existing tab still exists before focusing/removing the new one
         await chrome.tabs.get(existingTabId);

         const focusPromise = isActiveTab
             ? chrome.tabs.update(existingTabId, { active: true }).catch(err => {
                 if (this.isTabNotFoundError(err)) console.warn(`LunaTools: Failed to focus existing tab ${existingTabId} - likely closed.`);
                 else console.error(`LunaTools: Error focusing existing tab ${existingTabId}:`, err);
             })
             : Promise.resolve(); // No need to focus if the duplicate wasn't active

         const removePromise = chrome.tabs.remove(tab.id).catch(err => {
             // Don't log error if it was already closed (caught above or race condition)
             if (!this.isTabNotFoundError(err)) {
                 console.error(`LunaTools: Error removing duplicate tab ${tab.id}:`, err);
             }
         });

         await Promise.all([focusPromise, removePromise]);
         console.log(`LunaTools: Closed duplicate tab ${tab.id} and attempted to focus existing tab ${existingTabId}`);

         // Clean up cache for the removed tab *after* removal attempt.
         this.removeUrlFromCache(tab.id, parsedUrl);

     } catch (error) {
         if (this.isTabNotFoundError(error)) {
             console.warn(`LunaTools: Existing duplicate tab ${existingTabId} not found when handling duplicate for tab ${tab.id}. It was likely closed.`);
             // Proactively clean up cache for the non-existent existingTabId
             this.removeTabIdFromReverseLookup(existingTabId, parsedUrl.href);
             // Since the 'existing' one is gone, we might not want to remove the 'new' one (tab.id).
             // However, the logic currently proceeds to remove tab.id if it exists. Revisit if this causes issues.
             // For now, we'll still attempt to remove tab.id as planned, assuming the user opened a duplicate.
             try {
                await chrome.tabs.remove(tab.id);
                console.log(`LunaTools: Removed tab ${tab.id} after finding its intended duplicate ${existingTabId} was already closed.`);
                this.removeUrlFromCache(tab.id, parsedUrl);
             } catch (removeError) {
                 if (!this.isTabNotFoundError(removeError)) {
                    console.error(`LunaTools: Error removing tab ${tab.id} after its duplicate was gone:`, removeError);
                 }
             }
         } else {
             console.error(`LunaTools: Error handling duplicate tab ${tab.id} (checking/acting on existing tab ${existingTabId}):`, error);
         }
     }
 }


  async mergeAllWindows() {
    console.log("LunaTools: Merging all windows...");
    try {
      const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      if (windows.length <= 1) {
        console.log("LunaTools: No other windows to merge or only one window exists.");
        const currentWindow = windows.length === 1 ? windows[0] : await chrome.windows.getCurrent({ windowTypes: ['normal'] });
        if (currentWindow?.id) await this.sortAndMoveTabsInWindow(currentWindow.id);
        return;
      }

      const currentWindow = await chrome.windows.getCurrent({ windowTypes: ['normal'] });
      if (!currentWindow?.id) {
           console.error("LunaTools: Could not get current window to merge into.");
           return;
      }
      const targetWindowId = currentWindow.id;

      console.log("LunaTools: Moving tabs from other windows...");
      const tabsToMove = this.getTabsFromOtherWindows(windows, targetWindowId);
      let movedCount = 0;
      const movePromises = [];

      for (const tab of tabsToMove) {
          if (tab.pinned) {
              console.log(`LunaTools: Skipping pinned tab ${tab.id} from window ${tab.windowId}.`);
              continue;
          }
          // Check if tab still exists before moving
          try {
              await chrome.tabs.get(tab.id);
              movePromises.push(
                  chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 })
                      .then(() => { movedCount++; })
                      .catch(err => {
                          if (this.isTabNotFoundError(err)) {
                              console.warn(`LunaTools: Tab ${tab.id} likely closed before moving, skipping.`);
                              const cachedInfo = this.urlCache.get(tab.id);
                              if(cachedInfo) this.removeUrlFromCache(tab.id, cachedInfo.url);
                          } else if (err.message?.includes("No window with id")) {
                              console.warn(`LunaTools: Target window ${targetWindowId} closed during merge? Skipping move for tab ${tab.id}.`);
                          } else {
                              console.error(`LunaTools: Error moving tab ${tab.id} to window ${targetWindowId}:`, err);
                          }
                      })
              );
          } catch (getErr) {
               if (this.isTabNotFoundError(getErr)) {
                   console.warn(`LunaTools: Tab ${tab.id} to be moved was already closed, skipping.`);
                   const cachedInfo = this.urlCache.get(tab.id);
                   if(cachedInfo) this.removeUrlFromCache(tab.id, cachedInfo.url);
               } else {
                    console.error(`LunaTools: Error checking tab ${tab.id} before move:`, getErr);
               }
          }
      }
      if (movePromises.length > 0) {
        await Promise.all(movePromises);
        console.log(`LunaTools: Attempted to move ${movePromises.length} non-pinned tabs, successfully moved ${movedCount} to window ${targetWindowId}.`);
      } else {
         console.log("LunaTools: No non-pinned tabs found in other windows to move.");
      }

      // Close other windows that are now empty or only contain pinned tabs
      const remainingWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      await this.closeOtherEmptyWindows(remainingWindows, targetWindowId);

      await this.focusWindow(targetWindowId);
      await this.sortAndMoveTabsInWindow(targetWindowId); // Sort after merging

      console.log("LunaTools: Window merge and sort complete.");
    } catch (error) {
      console.error("LunaTools: Error merging windows:", error);
    }
  }

  getTabsFromOtherWindows(windows, targetWindowId) {
    return windows.flatMap(window =>
      (window.id !== targetWindowId && window.tabs)
        ? window.tabs.filter(tab => !tab.pinned) // Only non-pinned
        : []
    );
  }

  async closeOtherEmptyWindows(windows, targetWindowId) {
       const windowsToClose = windows.filter(window => {
           if (window.id === targetWindowId) return false;
           if (!window.tabs) return true; // Should have tabs array
           return window.tabs.every(tab => tab.pinned); // Close if only pinned tabs remain
       });

       if (windowsToClose.length === 0) return;

       console.log(`LunaTools: Closing ${windowsToClose.length} other window(s)...`);
       const closePromises = windowsToClose.map(window =>
           chrome.windows.remove(window.id).catch(err => {
               if (err.message?.includes("No window with id")) {
                   console.warn(`LunaTools: Window ${window.id} already closed.`);
               } else {
                   console.error(`LunaTools: Error closing window ${window.id}:`, err);
               }
           })
       );
       await Promise.all(closePromises);
       console.log("LunaTools: Finished closing other windows.");
   }

  async focusWindow(windowId) {
    try {
      await chrome.windows.update(windowId, { focused: true });
    } catch (error) {
        if (error.message?.includes("No window with id")) {
             console.warn(`LunaTools: Window ${windowId} not found for focusing.`);
        } else {
             console.error(`LunaTools: Error focusing window ${windowId}:`, error);
        }
    }
  }

  async handleTabUpdate(tab) {
    if (!tab?.id || typeof tab.windowId === 'undefined') return;

    const newUrlString = this.getTabUrl(tab);
    const oldCachedInfo = this.urlCache.get(tab.id);
    const oldUrl = oldCachedInfo?.url;

    // Handle navigation away from valid URLs or to non-http URLs
    if (!newUrlString || !(newUrlString.startsWith('http:') || newUrlString.startsWith('https:'))) {
        if (oldCachedInfo) {
            // console.log(`LunaTools: Tab ${tab.id} navigated away from ${oldUrl.href}, removing from cache.`);
            this.removeUrlFromCache(tab.id, oldUrl);
        }
        return;
    }

    let newUrl;
    try {
        newUrl = new URL(newUrlString);
    } catch (e) {
        console.warn(`LunaTools: Invalid URL during update for tab ${tab.id}: ${newUrlString}`, e);
        if (oldCachedInfo) this.removeUrlFromCache(tab.id, oldUrl);
        return;
    }

    // Check if URL href changed OR window ID changed
    if (this.isNewOrChangedUrl(oldUrl, newUrl) || (oldCachedInfo && oldCachedInfo.windowId !== tab.windowId)) {
        // console.log(`LunaTools: URL/WindowId changed for tab ${tab.id}: ${oldUrl?.href} (Win ${oldCachedInfo?.windowId}) -> ${newUrl.href} (Win ${tab.windowId})`);
        this.updateUrlCache(tab.id, oldUrl, newUrl, tab.windowId);
        // Check for duplicates immediately after caching the new URL/window
        await this.checkForDuplicateAndFocusExisting(tab);
    }
    // Also check for duplicates when a tab finishes loading, even if URL href didn't change (e.g., page redirected internally)
    else if (tab.status === 'complete' && newUrl) {
         await this.checkForDuplicateAndFocusExisting(tab);
    }
  }

  isNewOrChangedUrl(oldUrl, newUrl) {
    if (!(newUrl instanceof URL)) return false;
    if (!(oldUrl instanceof URL)) return true; // If old doesn't exist, it's new/changed
    return oldUrl.href !== newUrl.href;
  }

  updateUrlCache(tabId, oldUrl, newUrl, windowId) {
    if (oldUrl instanceof URL) {
      this.removeUrlFromCache(tabId, oldUrl);
    }
    if (newUrl instanceof URL) {
       this.addUrlToCache(tabId, newUrl, windowId);
    }
  }

  handleTabRemoved(tabId, removeInfo) {
     if (removeInfo?.isWindowClosing) {
        // console.log(`LunaTools: Window ${removeInfo.windowId} closing, removing its tabs from cache.`);
        this.removeWindowTabsFromCache(removeInfo.windowId);
        return;
     }
    const cachedInfo = this.urlCache.get(tabId);
    if (cachedInfo) {
      // console.log(`LunaTools: Tab ${tabId} removed, removing URL ${cachedInfo.url.href} from cache.`);
      this.removeUrlFromCache(tabId, cachedInfo.url);
    }
  }

  removeWindowTabsFromCache(windowId) {
      let removedCount = 0;
      const tabsToRemove = [];
      for (const [tabId, cachedInfo] of this.urlCache.entries()) {
          if (cachedInfo.windowId === windowId) {
              tabsToRemove.push({ tabId, url: cachedInfo.url });
          }
      }
      for (const { tabId, url } of tabsToRemove) {
          this.removeUrlFromCache(tabId, url);
          removedCount++;
      }
      // console.log(`LunaTools: Removed ${removedCount} tabs associated with closed window ${windowId} from cache.`);
  }

  getTabsWithParsedUrls(tabs) {
    return tabs.map(tab => {
        const cachedInfo = this.urlCache.get(tab.id);
        let parsedUrl = cachedInfo?.url;

        if (!parsedUrl) {
            const urlString = this.getTabUrl(tab);
            if (urlString && urlString !== NEW_TAB_URL && (urlString.startsWith('http:') || urlString.startsWith('https:'))) {
                try {
                    parsedUrl = new URL(urlString);
                    this.addUrlToCache(tab.id, parsedUrl, tab.windowId); // Cache if parsed successfully
                } catch (e) {
                    // console.warn(`LunaTools: Could not parse URL for tab ${tab.id} in getTabsWithParsedUrls: ${urlString}`, e);
                    parsedUrl = null;
                }
            }
        }
        return { ...tab, parsedUrl };
    });
  }

  compareUrls(a, b) {
    const aValid = a.parsedUrl instanceof URL;
    const bValid = b.parsedUrl instanceof URL;

    if (!aValid && !bValid) return 0;
    if (!aValid) return 1; // Invalid URLs go last
    if (!bValid) return -1;

    const hostnameDiff = a.parsedUrl.hostname.localeCompare(b.parsedUrl.hostname);
    if (hostnameDiff !== 0) return hostnameDiff;

    const pathnameDiff = a.parsedUrl.pathname.localeCompare(b.parsedUrl.pathname);
    if (pathnameDiff !== 0) return pathnameDiff;

    const searchDiff = a.parsedUrl.search.localeCompare(b.parsedUrl.search);
    if (searchDiff !== 0) return searchDiff;

    return a.parsedUrl.hash.localeCompare(b.parsedUrl.hash); // Finally compare hash
  }

  addUrlToCache(tabId, url, windowId) {
    if (!(url instanceof URL) || typeof tabId !== 'number' || typeof windowId !== 'number') return;

    this.urlCache.set(tabId, { url, windowId });
    const urlKey = url.href;
    const entries = this.reverseUrlLookup.get(urlKey) || [];
    const existingEntryIndex = entries.findIndex(entry => entry.tabId === tabId);

    if (existingEntryIndex === -1) {
       entries.push({ tabId, windowId });
       if (entries.length === 1) { // Only set if it's the first entry for this key
            this.reverseUrlLookup.set(urlKey, entries);
       }
    } else {
        if (entries[existingEntryIndex].windowId !== windowId) {
             // console.log(`LunaTools: Updating windowId for tab ${tabId} in reverse lookup for ${urlKey}`);
             entries[existingEntryIndex].windowId = windowId;
         }
    }
     // Ensure the map holds the potentially updated array reference if it wasn't the first entry
    if (entries.length > 0 && !this.reverseUrlLookup.has(urlKey)) {
        this.reverseUrlLookup.set(urlKey, entries);
    }
    // console.log(`LunaTools: Added/Updated tab ${tabId} (Win ${windowId}, URL ${urlKey}). Cache sizes: url=${this.urlCache.size}, reverse=${this.reverseUrlLookup.size}`);
  }

  removeUrlFromCache(tabId, url) {
     if (!(url instanceof URL) || typeof tabId !== 'number') return;
     this.urlCache.delete(tabId);
     this.removeTabIdFromReverseLookup(tabId, url.href);
     // console.log(`LunaTools: Removed tab ${tabId} (${url.href}) from cache. Cache sizes: url=${this.urlCache.size}, reverse=${this.reverseUrlLookup.size}`);
  }

  removeTabIdFromReverseLookup(tabId, urlKey) {
      const entries = this.reverseUrlLookup.get(urlKey);
      if (!entries) return;

      const filteredEntries = entries.filter(entry => entry.tabId !== tabId);

      if (filteredEntries.length === 0) {
          this.reverseUrlLookup.delete(urlKey);
          // console.log(`LunaTools: URL ${urlKey} removed from reverse lookup.`);
      } else if (filteredEntries.length < entries.length) {
           // Only update if something was actually removed
           this.reverseUrlLookup.set(urlKey, filteredEntries);
           // console.log(`LunaTools: Removed tab ${tabId} from reverse lookup for URL ${urlKey}.`);
      }
  }

  async initializeCache() {
        console.log("LunaTools: Initializing TabManager cache...");
        this.urlCache.clear();
        this.reverseUrlLookup.clear();
        try {
            const allTabs = await chrome.tabs.query({ windowType: 'normal' });
            console.log(`LunaTools: Found ${allTabs.length} existing tabs to cache.`);
            let cachedCount = 0;
            allTabs.forEach(tab => {
                 const urlString = this.getTabUrl(tab);
                 if (urlString && (urlString.startsWith('http:') || urlString.startsWith('https:'))) {
                     try {
                        const parsedUrl = new URL(urlString);
                        this.addUrlToCache(tab.id, parsedUrl, tab.windowId);
                        cachedCount++;
                     } catch(e) {
                         console.warn(`LunaTools: Could not parse initial URL for tab ${tab.id}: ${urlString}`, e);
                     }
                 }
            });
            console.log(`LunaTools: Cache initialized. Cached ${cachedCount} tabs. urlCache size: ${this.urlCache.size}, reverseUrlLookup size: ${this.reverseUrlLookup.size}`);
        } catch (error) {
            console.error("LunaTools: Error initializing TabManager cache:", error);
        }
    }
} // End of TabManager class

// --- Initialization and Event Listeners ---
const tabManager = new TabManager();

// Initialize cache on startup
(async () => {
    await tabManager.initializeCache();
})();

// Command Listener (Sort Tabs)
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "sort-tabs") {
    await tabManager.sortTabs();
  }
});

// Message Listener (Gestures)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === PERFORM_GESTURE_ACTION && message.gesture && sender?.tab?.id) {
    handleGestureAction(message.gesture, sender.tab.id);
    // Return true to indicate async handling, although we don't use sendResponse here
    return true;
  }
  return false; // Indicate message not handled by this listener
});

// Action Listener (Merge Windows)
chrome.action.onClicked.addListener(async (tab) => {
  console.log("LunaTools: Browser action clicked.");
  await tabManager.mergeAllWindows();
});

// Tab Event Listeners (Managed by TabManager)
chrome.tabs.onCreated.addListener((tab) => {
    // Initial caching attempt on creation for faster duplicate detection potential
    const urlString = tabManager.getTabUrl(tab);
    if (urlString && (urlString.startsWith('http:') || urlString.startsWith('https:'))) {
        try {
            const parsedUrl = new URL(urlString);
            tabManager.addUrlToCache(tab.id, parsedUrl, tab.windowId);
        } catch (e) { /* Ignore invalid pending URLs */ }
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Need full tab object with windowId. Prioritize event's tab object.
    if (tab && typeof tab.windowId !== 'undefined') {
        // Handle update if URL or status changes, or if it's just completed loading
        if (changeInfo.url || changeInfo.status) {
            await tabManager.handleTabUpdate(tab);
        }
    }
    // If tab object in event is incomplete, but status is complete, fetch full tab info.
    else if (changeInfo.status === 'complete') {
         try {
             const fullTab = await chrome.tabs.get(tabId);
             if (fullTab) await tabManager.handleTabUpdate(fullTab);
         } catch (error) {
              if (!tabManager.isTabNotFoundError(error)) {
                 console.warn(`LunaTools: Error fetching full tab info for updated tab ${tabId}:`, error);
              }
         }
    }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  tabManager.handleTabRemoved(tabId, removeInfo);
});

chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
    // console.log(`LunaTools: Tab ${tabId} attached to window ${attachInfo.newWindowId}`);
    try {
        const tab = await chrome.tabs.get(tabId);
        if (tab) await tabManager.handleTabUpdate(tab); // Treat as update to fix windowId in cache
    } catch (error) {
        if (!tabManager.isTabNotFoundError(error)) {
           console.warn(`LunaTools: Error getting attached tab ${tabId} info:`, error);
        }
    }
});

chrome.tabs.onDetached.addListener(async (tabId, detachInfo) => {
     // console.log(`LunaTools: Tab ${tabId} detached from window ${detachInfo.oldWindowId}`);
     // No immediate action needed, onAttached or onRemoved will handle the final state.
});


console.log("LunaTools: Background script loaded and listeners attached.");
