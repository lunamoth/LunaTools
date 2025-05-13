(() => {
  'use strict';

  const CS_LOG_PREFIX = "LunaTools CS:";

  // =======================================================================
  // === MOUSE GESTURE LOGIC                                             ===
  // =======================================================================
  const Gestures = {
    MIN_DRAG_DISTANCE_SQ: 100, // Min squared distance to consider it a drag (10px)
    MIN_FINAL_DISTANCE_SQ: 625, // Min squared distance for gesture recognition (25px)
    MESSAGE_ACTION: 'perform-gesture',

    isMouseDown: false,
    startX: 0,
    startY: 0,
    didMove: false,

    resetState() {
      this.isMouseDown = false;
      this.didMove = false;
    },

    handleMouseDown(event) {
      if (event.button === 2) { // Right-click
        this.isMouseDown = true;
        this.startX = event.clientX;
        this.startY = event.clientY;
        this.didMove = false;
        // console.log(`${CS_LOG_PREFIX} Gesture: Mouse down`);
      }
    },

    handleMouseMove(event) {
      if (this.isMouseDown && !this.didMove) {
        const deltaX = event.clientX - this.startX;
        const deltaY = event.clientY - this.startY;
        if ((deltaX ** 2 + deltaY ** 2) > this.MIN_DRAG_DISTANCE_SQ) {
          this.didMove = true;
          // console.log(`${CS_LOG_PREFIX} Gesture: Drag detected`);
        }
      }
    },

    handleMouseUp(event) {
      if (this.isMouseDown && event.button !== 2) { // Gesture cancelled by other mouse button
        // console.log(`${CS_LOG_PREFIX} Gesture: Cancelled (wrong button mouseup)`);
        this.resetState();
        return;
      }
      if (!this.isMouseDown || event.button !== 2) { // Not a right-click release we tracked
        return;
      }

      const deltaX = event.clientX - this.startX;
      const deltaY = event.clientY - this.startY;
      const distanceSq = deltaX ** 2 + deltaY ** 2;
      let gestureDirection = null;

      if (distanceSq >= this.MIN_FINAL_DISTANCE_SQ) {
        if (Math.abs(deltaY) > Math.abs(deltaX)) {
          gestureDirection = deltaY < 0 ? 'U' : 'D'; // Up or Down
        } else {
          gestureDirection = deltaX > 0 ? 'R' : 'L'; // Right or Left
        }
        // console.log(`${CS_LOG_PREFIX} Gesture: Recognized: ${gestureDirection}`);
      } else {
        // console.log(`${CS_LOG_PREFIX} Gesture: Mouse up, but distance too short`);
      }

      if (gestureDirection) {
        try {
          chrome.runtime.sendMessage({ action: this.MESSAGE_ACTION, gesture: gestureDirection });
        } catch (error) {
          // This catch block might not be effective for "Extension context invalidated" errors
          // if the script is detached from the page.
          if (error.message?.includes("Extension context invalidated")) {
            // console.warn(`${CS_LOG_PREFIX} Gesture: Extension context invalidated. Cannot send message.`);
          } else {
            console.warn(`${CS_LOG_PREFIX} Gesture: Failed to send message to background.`, error);
          }
        }
      }
      // State reset is handled by contextmenu listener to allow context menu on simple right click
    },

    handleContextMenu(event) {
      if (this.didMove) { // Prevent context menu only if a gesture was performed
        // console.log(`${CS_LOG_PREFIX} Gesture: Preventing context menu due to gesture.`);
        event.preventDefault();
      }
      this.resetState(); // Always reset after a right-click interaction (gesture or simple click)
    },

    handleBlur() {
      if (this.isMouseDown) { // Reset if window loses focus during a potential gesture
        // console.log(`${CS_LOG_PREFIX} Gesture: Cancelled (window blur)`);
        this.resetState();
      }
    },

    init() {
      const passiveOptions = { capture: true, passive: true };
      const captureOptions = { capture: true }; // For mousedown, mouseup, contextmenu

      window.addEventListener('mousedown', this.handleMouseDown.bind(this), captureOptions);
      window.addEventListener('mousemove', this.handleMouseMove.bind(this), passiveOptions);
      window.addEventListener('mouseup', this.handleMouseUp.bind(this), captureOptions);
      window.addEventListener('contextmenu', this.handleContextMenu.bind(this), captureOptions);
      window.addEventListener('blur', this.handleBlur.bind(this), passiveOptions);
      console.log(`${CS_LOG_PREFIX} Mouse Gesture logic initialized.`);
    }
  };

  Gestures.init();

  // =======================================================================
  // === KEYBOARD NAVIGATION LOGIC                                       ===
  // =======================================================================
  if (window.self === window.top) {
    const KB_NAV_LOG_PREFIX = `${CS_LOG_PREFIX} KB Nav:`;

    const KB_NAV_CONFIG = Object.freeze({
      cache: { MAX_SIZE: 100, MAX_AGE_MS: 30 * 60 * 1000 },
      navigation: { RESET_DELAY_MS: 150, MIN_PAGE: 1, MAX_PAGE: 9999, DEBOUNCE_DELAY_MS: 100 },
      observer: {
        TARGET_SELECTORS: ['nav[aria-label="pagination"]', '.pagination', '#pagination'],
        FALLBACK_TARGET_SELECTORS: ['main', '#main', '#content', 'article', 'body'], // Added body as ultimate fallback
        DEBOUNCE_DELAY_MS: 100,
        MAX_OBSERVE_TIME_MS: 30 * 1000,
        REACTIVATION_INTERVAL_MS: 5 * 60 * 1000,
        REACTIVATION_THROTTLE_MS: 1000
      },
      patterns: {
        url: [/[?&]page=(\d{1,4})/i, /[?&]po=(\d{1,4})/i, /[?&]p=(\d{1,4})/i, /page\/(\d{1,4})/i, /\/(\d{1,4})(?:[/?#]|$)/i], // Ensure number is followed by end, ?, /, or #
        ignore: [/\/status\/\d{10,}/i, /\/commit\/\w{7,40}/i, /\/\d{8,}/i] // Added common commit hash, ignore long numbers likely IDs
      }
    });

    const KB_NAV_Utils = {
      debounce(func, waitMs) {
        let timeoutId;
        const debounced = function (...args) {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => func.apply(this, args), waitMs);
        };
        debounced.cancel = () => clearTimeout(timeoutId);
        return debounced;
      },
      throttle(func, waitMs) {
        let throttling = false; let lastArgs = null; let timeoutId = null;
        function throttled(...args) {
          lastArgs = args;
          if (!throttling) {
            throttling = true; func.apply(this, lastArgs); lastArgs = null;
            timeoutId = setTimeout(() => {
              throttling = false; if (lastArgs) throttled.apply(this, lastArgs);
            }, waitMs);
          }
        }
        throttled.cancel = () => { clearTimeout(timeoutId); throttling = false; lastArgs = null; };
        return throttled;
      }
    };

    class KB_NAV_Cache {
      constructor(maxSize) { this.maxSize = maxSize; this.cache = new Map(); }
      get(key) {
        if (!this.cache.has(key)) return undefined;
        const item = this.cache.get(key);
        if (Date.now() - item.timestamp > KB_NAV_CONFIG.cache.MAX_AGE_MS) {
          this.cache.delete(key); /* console.log(`${KB_NAV_LOG_PREFIX} Cache item expired: ${key}`); */ return undefined;
        }
        // LRU: Refresh timestamp by re-inserting
        this.cache.delete(key);
        this.cache.set(key, item);
        return item.value;
      }
      set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.maxSize) {
            const leastUsedKey = this.cache.keys().next().value;
            this.cache.delete(leastUsedKey);
            /* console.log(`${KB_NAV_LOG_PREFIX} Cache full. Removed: ${leastUsedKey}`); */
        }
        this.cache.set(key, { value, timestamp: Date.now() });
        /* console.log(`${KB_NAV_LOG_PREFIX} Cache item set: ${key}`); */
      }
      clear() { this.cache.clear(); /* console.log(`${KB_NAV_LOG_PREFIX} Cache cleared.`); */ }
      removeExpired() {
        const now = Date.now(); let removedCount = 0;
        for (const [key, item] of this.cache.entries()) {
          if (now - item.timestamp > KB_NAV_CONFIG.cache.MAX_AGE_MS) { this.cache.delete(key); removedCount++; }
        }
        // if (removedCount > 0) console.log(`${KB_NAV_LOG_PREFIX} Cache: Removed ${removedCount} expired items.`);
      }
    }

    class KB_NAV_UrlManager {
      constructor() {
        this.urlCache = new KB_NAV_Cache(KB_NAV_CONFIG.cache.MAX_SIZE);
        this.cleanupInterval = setInterval(() => this.urlCache.removeExpired(), KB_NAV_CONFIG.cache.MAX_AGE_MS / 2); // Clean more frequently
      }
      findPagePattern(url) {
        const cachedResult = this.urlCache.get(url);
        if (cachedResult !== undefined) return cachedResult;

        for (const pattern of KB_NAV_CONFIG.patterns.url) {
          const match = pattern.exec(url);
          if (!match || !match[1]) continue;
          const pageNumber = parseInt(match[1], 10);
          if (isNaN(pageNumber) || pageNumber < KB_NAV_CONFIG.navigation.MIN_PAGE || pageNumber > KB_NAV_CONFIG.navigation.MAX_PAGE) continue;
          
          const patternInfo = { pattern: pattern, currentPage: pageNumber, originalMatch: match[0] };
          this.urlCache.set(url, patternInfo);
          return patternInfo;
        }
        this.urlCache.set(url, null); return null;
      }
      updatePageInUrl(url, patternInfo, direction) {
        const { pattern, currentPage, originalMatch } = patternInfo; // Use pattern only for reference if needed
        const newPage = Math.max(KB_NAV_CONFIG.navigation.MIN_PAGE, Math.min(KB_NAV_CONFIG.navigation.MAX_PAGE, currentPage + direction));
        if (newPage === currentPage) return url;
        
        // Replace the originally matched part containing the page number.
        const newPageStringInMatch = originalMatch.replace(currentPage.toString(), newPage.toString());
        return url.replace(originalMatch, newPageStringInMatch);
      }
      shouldIgnore(url) { return KB_NAV_CONFIG.patterns.ignore.some(pattern => pattern.test(url)); }
      cleanup() { clearInterval(this.cleanupInterval); this.urlCache.clear(); }
    }

    class KB_NAV_DomMonitor {
      constructor() {
        this.cachedLinks = null;
        this.invalidateCacheDebounced = KB_NAV_Utils.debounce(() => {
            this.cachedLinks = null; /* console.log(`${KB_NAV_LOG_PREFIX} DOM: Invalidated cached nav links.`); */
        }, KB_NAV_CONFIG.observer.DEBOUNCE_DELAY_MS);
        
        this.isObserving = false; this.observer = null; this.observerTarget = null;
        this.eventListeners = []; this.reactivationInterval = null; this.stopLifecycleTimer = null;
        this.throttledReactivate = null;
        
        this._initializeObserver();
      }
      _initializeObserver() {
        this._findObserverTarget();
        this.observer = new MutationObserver(() => { if (this.isObserving) this.invalidateCacheDebounced(); });
        this.startObserving();
      }
      _findObserverTarget() {
        const selectors = [...KB_NAV_CONFIG.observer.TARGET_SELECTORS, ...KB_NAV_CONFIG.observer.FALLBACK_TARGET_SELECTORS];
        for (const selector of selectors) {
          this.observerTarget = document.querySelector(selector);
          if (this.observerTarget) {
            // console.log(`${KB_NAV_LOG_PREFIX} DOM: Observer target found:`, this.observerTarget);
            return;
          }
        }
        // Should always find 'body' as the ultimate fallback if nothing else.
        this.observerTarget = document.body;
        // console.log(`${KB_NAV_LOG_PREFIX} DOM: Observer target defaulted to body.`);
      }
      startObserving() {
        if (this.observer && this.observerTarget && !this.isObserving) {
          try {
            this.observer.observe(this.observerTarget, { childList: true, subtree: true });
            this.isObserving = true; /* console.log(`${KB_NAV_LOG_PREFIX} DOM: Observer started on`, this.observerTarget); */
            if (this.stopLifecycleTimer) { this.stopLifecycleTimer(); this.stopLifecycleTimer = null; }
            this._setupObserverLifecycle();
          } catch (error) { console.error(`${KB_NAV_LOG_PREFIX} Error starting Observer:`, error); this.isObserving = false; }
        }
      }
      stopObserving() {
        if (this.observer && this.isObserving) {
          this.invalidateCacheDebounced?.cancel();
          this.observer.disconnect(); this.isObserving = false;
          /* console.log(`${KB_NAV_LOG_PREFIX} DOM: Observer stopped.`); */
          if (this.stopLifecycleTimer) { this.stopLifecycleTimer(); this.stopLifecycleTimer = null; }
        }
      }
      _setupObserverLifecycle() {
        if (this.stopLifecycleTimer) this.stopLifecycleTimer();
        const timerId = setTimeout(() => {
          /* console.log(`${KB_NAV_LOG_PREFIX} DOM: Stopping observer due to MAX_OBSERVE_TIME.`); */
          this.stopObserving(); this._setupReactivationEvents();
        }, KB_NAV_CONFIG.observer.MAX_OBSERVE_TIME_MS);
        this.stopLifecycleTimer = () => clearTimeout(timerId);
      }
      _setupReactivationEvents() {
        this._clearReactivationEvents();
        const reactivateObserver = () => { if (!this.isObserving) { /* console.log(`${KB_NAV_LOG_PREFIX} DOM: Reactivating observer.`); */ this.startObserving(); } };
        this.throttledReactivate = KB_NAV_Utils.throttle(reactivateObserver, KB_NAV_CONFIG.observer.REACTIVATION_THROTTLE_MS);
        
        const events = ['scroll', 'click', 'keydown'];
        events.forEach(eventType => {
          const listener = this.throttledReactivate;
          window.addEventListener(eventType, listener, { passive: true, capture: true }); // Capture phase for broader reach
          this.eventListeners.push({ type: eventType, listener });
        });
        this.reactivationInterval = setInterval(() => { if (!this.isObserving) reactivateObserver(); }, KB_NAV_CONFIG.observer.REACTIVATION_INTERVAL_MS);
      }
      _clearReactivationEvents() {
        clearInterval(this.reactivationInterval); this.reactivationInterval = null;
        this.throttledReactivate?.cancel();
        this.eventListeners.forEach(({ type, listener }) => window.removeEventListener(type, listener, {capture: true}));
        this.eventListeners = [];
      }
      isFocusable(element) {
        if (!element) return false;
        if (element.isContentEditable) return true;
        const tagName = element.tagName.toUpperCase();
        switch (tagName) {
          case 'INPUT':
            // Check for input types that are typically not for text entry where arrows are used for navigation
            const type = element.type?.toLowerCase();
            if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image' || type === 'checkbox' || type === 'radio' || type === 'range' || type === 'color' || type === 'file') {
                return false;
            }
            return !(element.disabled || element.readOnly);
          case 'TEXTAREA': case 'SELECT':
            return !(element.disabled || element.readOnly);
          default: return false;
        }
      }
      findNavigationLinks() {
        if (this.cachedLinks) return this.cachedLinks;
        const links = document.querySelectorAll('a[rel="next"], a[rel="prev"]');
        let nextLink = null; let prevLink = null;
        for (const link of links) {
          if (!link.href || link.href === window.location.href || !link.offsetParent) continue; // Ignore invalid, self, or hidden links
          if (link.rel === 'next' && !nextLink) nextLink = link;
          if (link.rel === 'prev' && !prevLink) prevLink = link;
          if (nextLink && prevLink) break;
        }
        this.cachedLinks = { nextLink, prevLink };
        /* console.log(`${KB_NAV_LOG_PREFIX} DOM: Found nav links:`, this.cachedLinks); */
        return this.cachedLinks;
      }
      cleanup() {
        /* console.log(`${KB_NAV_LOG_PREFIX} DOM: Cleaning up...`); */
        this.stopObserving();
        if (this.stopLifecycleTimer) { this.stopLifecycleTimer(); this.stopLifecycleTimer = null; }
        this.invalidateCacheDebounced?.cancel();
        this._clearReactivationEvents(); this.cachedLinks = null;
      }
    }

    class KB_NAV_KeyboardNavigator {
      constructor() {
        if (window.lunaToolsKbNavInitialized) { /* console.log(`${KB_NAV_LOG_PREFIX} Already initialized.`); */ return; }
        window.lunaToolsKbNavInitialized = true;

        this.urlManager = new KB_NAV_UrlManager();
        this.domMonitor = new KB_NAV_DomMonitor();
        this.isNavigating = false;
        this.processKeyDebounced = KB_NAV_Utils.debounce(this._processKey.bind(this), KB_NAV_CONFIG.navigation.DEBOUNCE_DELAY_MS);
        
        this._boundHandleKeydown = this._handleKeydown.bind(this);
        this._boundHandlePageShow = this._handlePageShow.bind(this);
        this._boundHandlePageHide = this._handlePageHide.bind(this);
        this._initialize();
      }
      _initialize() {
        document.addEventListener('keydown', this._boundHandleKeydown);
        window.addEventListener('pageshow', this._boundHandlePageShow);
        window.addEventListener('pagehide', this._boundHandlePageHide);
        console.log(`${KB_NAV_LOG_PREFIX} Initialized.`);
      }
      _handlePageShow(event) {
        if (event.persisted) { // Page restored from bfcache
          /* console.log(`${KB_NAV_LOG_PREFIX} Page restored from bfcache. Resetting state.`); */
          this.isNavigating = false;
          this.urlManager.urlCache.clear(); // Clear URL pattern cache
          
          // Re-initialize DomMonitor as its internal state (observer, listeners) might be stale
          this.domMonitor.cleanup();
          this.domMonitor = new KB_NAV_DomMonitor();
        }
      }
      _handlePageHide(event) {
        if (!event.persisted) { // Page is being fully unloaded, not put into bfcache
          /* console.log(`${KB_NAV_LOG_PREFIX} Page unloading. Cleaning up all resources.`); */
          this.cleanup();
        }
      }
      _handleKeydown(event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        if (this._shouldIgnoreKeyEvent(event)) return;
        event.preventDefault();
        event.stopPropagation(); // Prevent event from bubbling further if handled.
        this.processKeyDebounced(event.key);
      }
      _shouldIgnoreKeyEvent(event) {
        if (event.altKey || event.ctrlKey || event.metaKey) return true; // Ignore with modifiers
        const activeEl = document.activeElement;
        return activeEl && this.domMonitor.isFocusable(activeEl);
      }
      _processKey(key) {
        if (this.isNavigating) return;
        const direction = key === 'ArrowRight' ? 1 : -1;
        /* console.log(`${KB_NAV_LOG_PREFIX} Processing key: ${key}`); */
        this._navigate(direction);
      }
      _navigate(direction) {
        if (this.isNavigating) return;
        const currentUrl = window.location.href;
        if (this.urlManager.shouldIgnore(currentUrl)) {
          /* console.log(`${KB_NAV_LOG_PREFIX} Ignoring URL for navigation: ${currentUrl}`); */
          return;
        }
        
        const targetUrl = this._getTargetUrl(currentUrl, direction);
        if (targetUrl && targetUrl !== currentUrl) {
          this.isNavigating = true; // Set before navigation to prevent re-entry
          /* console.log(`${KB_NAV_LOG_PREFIX} Navigating to: ${targetUrl}`); */
          window.location.href = targetUrl;
          // `isNavigating` will be reset by `_handlePageShow` if bfcache is used,
          // or implicitly on full page load. A timeout isn't strictly needed here for successful navigation.
        } else {
          /* console.log(`${KB_NAV_LOG_PREFIX} Navigation failed (no target URL or target is current).`); */
          // If navigation doesn't happen, we need to reset isNavigating
          this._resetNavigationStateAfterDelay(); 
        }
      }
      _getTargetUrl(currentUrl, direction) {
        const patternInfo = this.urlManager.findPagePattern(currentUrl);
        if (patternInfo) {
          const updatedUrl = this.urlManager.updatePageInUrl(currentUrl, patternInfo, direction);
          return updatedUrl; // This will be same as currentUrl if no actual page change (e.g., at min/max page)
        }
        const links = this.domMonitor.findNavigationLinks();
        if (direction > 0 && links.nextLink) return links.nextLink.href;
        if (direction < 0 && links.prevLink) return links.prevLink.href;
        return null;
      }
      _resetNavigationStateAfterDelay() {
         // Only reset if navigation didn't occur, to allow next key press.
         // If navigation occurred, pageshow/pagehide will handle state.
         setTimeout(() => {
            this.isNavigating = false;
            /* console.log(`${KB_NAV_LOG_PREFIX} Navigation state reset after delay (likely no nav occurred).`); */
         }, KB_NAV_CONFIG.navigation.RESET_DELAY_MS);
      }
      cleanup() {
        console.log(`${KB_NAV_LOG_PREFIX} Cleaning up keyboard navigator globally...`);
        document.removeEventListener('keydown', this._boundHandleKeydown);
        window.removeEventListener('pageshow', this._boundHandlePageShow);
        window.removeEventListener('pagehide', this._boundHandlePageHide);
        this.domMonitor.cleanup();
        this.urlManager.cleanup();
        this.processKeyDebounced?.cancel();
        window.lunaToolsKbNavInitialized = false;
      }
    }
    // Initialize only if the document is fully loaded or interactive, to ensure body exists for observer.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new KB_NAV_KeyboardNavigator());
    } else {
        new KB_NAV_KeyboardNavigator();
    }

  } else {
    // console.log(`${CS_LOG_PREFIX} KB Nav: Skipping initialization in non-top frame.`);
  }

  // =======================================================================
  // === PICTURE-IN-PICTURE (PiP) LOGIC                                  ===
  // =======================================================================
  const PiP = {
    LOG_PREFIX: `${CS_LOG_PREFIX} PiP:`,

    _findBestVideoForPiP() {
      const videos = Array.from(document.querySelectorAll('video'));
      if (videos.length === 0) return null;

      const isVisibleAndPlayable = (video) => 
          video.offsetHeight > 0 && 
          video.offsetWidth > 0 &&
          video.readyState > 2 && // HAVE_CURRENT_DATA or more
          video.hasAttribute('src') && video.currentSrc; // Ensure it has a source

      // Priority 1: Playing, visible, audible, playable
      let candidates = videos.filter(v => !v.paused && isVisibleAndPlayable(v) && !v.muted);
      if (candidates.length > 0) {
        // console.log(this.LOG_PREFIX, "Found playing, visible, audible, playable videos.");
        return candidates.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight))[0];
      }

      // Priority 2: Playing, visible, playable (muted is OK)
      candidates = videos.filter(v => !v.paused && isVisibleAndPlayable(v));
      if (candidates.length > 0) {
        // console.log(this.LOG_PREFIX, "Found playing, visible, playable videos (any mute state).");
        return candidates.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight))[0];
      }
      
      // Priority 3: Visible, playable (paused is OK)
      candidates = videos.filter(v => isVisibleAndPlayable(v));
      if (candidates.length > 0) {
        // console.log(this.LOG_PREFIX, "Found visible, playable videos (any play/mute state).");
        return candidates.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight))[0];
      }
      
      // Fallback: any video with a source, even if not "visible" by offsetHeight/Width (e.g. in shadow DOM, or CSS hidden)
      // This is a last resort.
      candidates = videos.filter(v => v.hasAttribute('src') && v.currentSrc);
       if (candidates.length > 0) {
        // console.log(this.LOG_PREFIX, "Found any video with a source as fallback.");
        return candidates.sort((a,b) => { // Prefer videos that are at least somewhat loaded
            if (a.readyState !== b.readyState) return b.readyState - a.readyState;
            return (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight);
        })[0];
      }
      
      return null; // No suitable video found
    },

    async toggle() {
      // console.log(this.LOG_PREFIX, "Ctrl+Shift+P detected. Toggling PiP...");

      const currentPipElement = document.pictureInPictureElement;
      
      if (currentPipElement) {
        // console.log(this.LOG_PREFIX, "Exiting PiP mode for element:", currentPipElement);
        try {
          await document.exitPictureInPicture();
          // console.log(this.LOG_PREFIX, "PiP mode exited.");
        } catch (error) {
          console.error(this.LOG_PREFIX, "Error exiting PiP mode:", error);
        }
        return;
      }
      
      const targetVideo = this._findBestVideoForPiP();

      if (!targetVideo) {
        console.warn(this.LOG_PREFIX, "No suitable video found to enter PiP mode.");
        // alert("PiP를 실행할 비디오를 찾을 수 없습니다."); // Consider removing alerts
        return;
      }

      // console.log(this.LOG_PREFIX, "Attempting to enter PiP mode for video:", targetVideo);
      try {
        if (targetVideo.disablePictureInPicture) {
          console.warn(this.LOG_PREFIX, `Video (src: ${targetVideo.currentSrc || 'N/A'}) has disablePictureInPicture=true. Attempting to override.`);
          // This is a best-effort attempt and might not work on all sites or be overridden by browser.
          try { 
            Object.defineProperty(targetVideo, 'disablePictureInPicture', {
                configurable: true,
                writable: true,
                value: false
            });
          } catch (e) { /* Expected to fail sometimes if not configurable */ 
            try { targetVideo.disablePictureInPicture = false; } catch (e2) {/* ignore */}
          }
        }
        await targetVideo.requestPictureInPicture();
        // console.log(this.LOG_PREFIX, "PiP mode entered.");
        targetVideo.addEventListener('leavepictureinpicture', () => {
          // console.log(this.LOG_PREFIX, 'PiP mode was left (e.g., closed by user).');
        }, { once: true });
      } catch (error) {
        console.error(this.LOG_PREFIX, "Error entering PiP mode:", error.name, error.message);
        // if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
        //   alert(`PiP 실행이 차단되었습니다...\n오류: ${error.message}`);
        // } else if (error.name === 'NotFoundError'){
        //    alert(`PiP를 실행할 비디오를 찾을 수 없거나, 비디오가 PiP를 지원하지 않는 상태입니다...\n오류: ${error.message}`);
        // } else if (error.name === 'InvalidStateError'){
        //    alert(`비디오가 PiP를 시작하기에 적절한 상태가 아닙니다 (예: 로드되지 않음)...\n오류: ${error.message}`);
        // }
      }
    },

    _handleKeyDown(event) {
      if (event.ctrlKey && event.shiftKey && (event.key === 'P' || event.key === 'p')) {
        const target = event.target;
        const isEditable = target && (target.isContentEditable || 
                           ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName?.toUpperCase()));
        if (isEditable) {
          // console.log(PiP.LOG_PREFIX, "Ctrl+Shift+P ignored in input field.");
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.toggle();
      }
    },

    init() {
      // Use a bound function for the event listener
      this._boundHandleKeyDown = this._handleKeyDown.bind(this);
      document.addEventListener('keydown', this._boundHandleKeyDown, true); // Use capture phase
      console.log(this.LOG_PREFIX, "Logic initialized (Ctrl+Shift+P).");
    }
  };

  PiP.init();

  console.log(`${CS_LOG_PREFIX} Content script fully initialized (Gestures, Keyboard Nav & PiP).`);
})();
