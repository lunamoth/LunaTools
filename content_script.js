(() => {
  'use strict';

  const SCRIPT_NAME = "LunaTools CS"; // For console messages (primarily for errors)

  // =======================================================================
  // === MOUSE GESTURE HANDLER                                           ===
  // =======================================================================
  class MouseGestureHandler {
    static MIN_DRAG_DISTANCE_SQ = 100; // 10px * 10px
    static MIN_FINAL_DISTANCE_SQ = 625; // 25px * 25px
    static MESSAGE_ACTION = 'perform-gesture';

    constructor() {
      this.isMouseDown = false;
      this.startX = 0;
      this.startY = 0;
      this.didMove = false;

      this._bindEventHandlers();
      this._initializeEventListeners();
    }

    _bindEventHandlers() {
      this.handleMouseDown = this.handleMouseDown.bind(this);
      this.handleMouseMove = this.handleMouseMove.bind(this);
      this.handleMouseUp = this.handleMouseUp.bind(this);
      this.handleContextMenu = this.handleContextMenu.bind(this);
      this.handleBlur = this.handleBlur.bind(this);
    }

    _initializeEventListeners() {
      const passiveOptions = { capture: true, passive: true };
      const captureOptions = { capture: true };

      window.addEventListener('mousedown', this.handleMouseDown, captureOptions);
      window.addEventListener('mousemove', this.handleMouseMove, passiveOptions);
      window.addEventListener('mouseup', this.handleMouseUp, captureOptions);
      window.addEventListener('contextmenu', this.handleContextMenu, captureOptions);
      window.addEventListener('blur', this.handleBlur, passiveOptions);
    }

    _resetState() {
      this.isMouseDown = false;
      this.didMove = false;
    }

    handleMouseDown(event) {
      if (event.button !== 2) return;

      this.isMouseDown = true;
      this.startX = event.clientX;
      this.startY = event.clientY;
      this.didMove = false;
    }

    handleMouseMove(event) {
      if (!this.isMouseDown || this.didMove) return;

      const deltaX = event.clientX - this.startX;
      const deltaY = event.clientY - this.startY;
      if ((deltaX ** 2 + deltaY ** 2) > MouseGestureHandler.MIN_DRAG_DISTANCE_SQ) {
        this.didMove = true;
      }
    }

    handleMouseUp(event) {
      if (!this.isMouseDown) return;
      if (event.button !== 2) {
        this._resetState();
        return;
      }

      const gestureDirection = this._determineGestureDirection(event.clientX, event.clientY);

      if (gestureDirection) {
        this._sendGestureMessage(gestureDirection);
      }
    }

    _determineGestureDirection(endX, endY) {
      const deltaX = endX - this.startX;
      const deltaY = endY - this.startY;
      const distanceSq = deltaX ** 2 + deltaY ** 2;

      if (distanceSq < MouseGestureHandler.MIN_FINAL_DISTANCE_SQ) {
        return null;
      }

      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        return deltaY < 0 ? 'U' : 'D';
      }
      return deltaX > 0 ? 'R' : 'L';
    }

    _sendGestureMessage(gesture) {
      try {
        chrome.runtime.sendMessage({ action: MouseGestureHandler.MESSAGE_ACTION, gesture });
      } catch (error) {
        if (error.message?.includes("Extension context invalidated")) {
          // Context invalidated, usually means extension was updated/reloaded.
        } else {
          console.error(`${SCRIPT_NAME}: Gesture: Failed to send message to background.`, error);
        }
      }
    }

    handleContextMenu(event) {
      if (this.didMove) {
        event.preventDefault();
      }
      this._resetState();
    }

    handleBlur() {
      if (this.isMouseDown) {
        this._resetState();
      }
    }
  }

  new MouseGestureHandler();

  // =======================================================================
  // === KEYBOARD PAGE NAVIGATION (Top-level window only)                ===
  // =======================================================================
  if (window.self === window.top) {
    const KB_NAV_CONFIG = Object.freeze({
      cache: { MAX_SIZE: 100, MAX_AGE_MS: 30 * 60 * 1000 },
      navigation: { RESET_DELAY_MS: 150, MIN_PAGE: 1, MAX_PAGE: 9999, DEBOUNCE_DELAY_MS: 100 },
      observer: {
        TARGET_SELECTORS: ['nav[aria-label="pagination"]', '.pagination', '#pagination'],
        FALLBACK_TARGET_SELECTORS: ['main', '#main', '#content', 'article', 'body'],
        DEBOUNCE_DELAY_MS: 100,
        MAX_OBSERVE_TIME_MS: 30 * 1000,
        REACTIVATION_INTERVAL_MS: 5 * 60 * 1000,
        REACTIVATION_THROTTLE_MS: 1000
      },
      patterns: {
        url: [
          /[?&]page=(\d{1,4})/i, /[?&]po=(\d{1,4})/i, /[?&]p=(\d{1,4})/i,
          /page\/(\d{1,4})/i,
          /\/(\d{1,4})(?:[/?#]|$)/i
        ],
        ignore: [
          /\/status\/\d{10,}/i,
          /\/commit\/\w{7,40}/i,
          /\/\d{8,}/i
        ]
      }
    });

    const KB_NAV_Logger = { // Minimal logger for release
      error: (...args) => console.error(`${SCRIPT_NAME}: KB Nav:`, ...args),
    };

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
        let throttling = false;
        let lastArgs = null;
        let timeoutId = null;
        function throttled(...args) {
          lastArgs = args;
          if (!throttling) {
            throttling = true;
            func.apply(this, lastArgs);
            lastArgs = null;
            timeoutId = setTimeout(() => {
              throttling = false;
              if (lastArgs) throttled.apply(this, lastArgs);
            }, waitMs);
          }
        }
        throttled.cancel = () => {
          clearTimeout(timeoutId);
          throttling = false;
          lastArgs = null;
        };
        return throttled;
      }
    };

    class KB_NAV_LRUCache {
      constructor(maxSize, maxAgeMs) {
        this.maxSize = maxSize;
        this.maxAgeMs = maxAgeMs;
        this.cache = new Map();
      }

      get(key) {
        if (!this.cache.has(key)) return undefined;

        const item = this.cache.get(key);
        if (Date.now() - item.timestamp > this.maxAgeMs) {
          this.cache.delete(key);
          return undefined;
        }
        this.cache.delete(key);
        this.cache.set(key, item);
        return item.value;
      }

      set(key, value) {
        if (this.cache.has(key)) {
          this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
          const leastUsedKey = this.cache.keys().next().value;
          this.cache.delete(leastUsedKey);
        }
        this.cache.set(key, { value, timestamp: Date.now() });
      }

      clear() { this.cache.clear(); }

      removeExpired() {
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
          if (now - item.timestamp > this.maxAgeMs) {
            this.cache.delete(key);
          }
        }
      }
    }

    class KB_NAV_UrlPageFinder {
      constructor() {
        this.urlPatternCache = new KB_NAV_LRUCache(KB_NAV_CONFIG.cache.MAX_SIZE, KB_NAV_CONFIG.cache.MAX_AGE_MS);
        this.cleanupInterval = setInterval(() => this.urlPatternCache.removeExpired(), KB_NAV_CONFIG.cache.MAX_AGE_MS / 2);
      }

      findPagePattern(url) {
        const cachedResult = this.urlPatternCache.get(url);
        if (cachedResult !== undefined) return cachedResult;

        for (const pattern of KB_NAV_CONFIG.patterns.url) {
          const match = pattern.exec(url);
          if (!match || !match[1]) continue;

          const pageNumber = parseInt(match[1], 10);
          if (isNaN(pageNumber) || pageNumber < KB_NAV_CONFIG.navigation.MIN_PAGE || pageNumber > KB_NAV_CONFIG.navigation.MAX_PAGE) {
            continue;
          }
          
          const patternInfo = { regex: pattern, currentPage: pageNumber, originalMatch: match[0] };
          this.urlPatternCache.set(url, patternInfo);
          return patternInfo;
        }
        this.urlPatternCache.set(url, null);
        return null;
      }

      generateNewUrl(currentUrl, patternInfo, direction) {
        const { currentPage, originalMatch } = patternInfo;
        let newPage = currentPage + direction;
        newPage = Math.max(KB_NAV_CONFIG.navigation.MIN_PAGE, newPage);
        newPage = Math.min(KB_NAV_CONFIG.navigation.MAX_PAGE, newPage);

        if (newPage === currentPage) return currentUrl;
        
        const newPageStringInMatch = originalMatch.replace(String(currentPage), String(newPage));
        return currentUrl.replace(originalMatch, newPageStringInMatch);
      }

      shouldIgnoreUrl(url) {
        return KB_NAV_CONFIG.patterns.ignore.some(pattern => pattern.test(url));
      }

      clearCache() { this.urlPatternCache.clear(); }
      
      destroy() {
        clearInterval(this.cleanupInterval);
        this.clearCache();
      }
    }

    class KB_NAV_DomLinkFinder {
      constructor() {
        this.cachedLinks = null;
        this.observer = null;
        this.observerTarget = null;
        this.isObserving = false;
        this.stopLifecycleTimer = null;
        this.reactivationInterval = null;
        this.throttledReactivateObserver = null;
        this.eventListeners = [];

        this._debouncedInvalidateCache = KB_NAV_Utils.debounce(() => {
            this.cachedLinks = null;
        }, KB_NAV_CONFIG.observer.DEBOUNCE_DELAY_MS);
        
        this._initializeObserver();
      }

      _initializeObserver() {
        this._findObserverTarget();
        if (!this.observerTarget) {
            this.observerTarget = document.body;
        }
        this.observer = new MutationObserver(() => {
          if (this.isObserving) this._debouncedInvalidateCache();
        });
        this.startObserving();
      }

      _findObserverTarget() {
        const selectors = [...KB_NAV_CONFIG.observer.TARGET_SELECTORS, ...KB_NAV_CONFIG.observer.FALLBACK_TARGET_SELECTORS];
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            this.observerTarget = element;
            return;
          }
        }
        this.observerTarget = document.body;
      }

      startObserving() {
        if (this.observer && this.observerTarget && !this.isObserving) {
          try {
            this.observer.observe(this.observerTarget, { childList: true, subtree: true });
            this.isObserving = true;
            if (this.stopLifecycleTimer) clearTimeout(this.stopLifecycleTimer);
            this._setupObserverDeactivationTimer();
          } catch (error) {
            KB_NAV_Logger.error("Error starting MutationObserver:", error);
            this.isObserving = false;
          }
        }
      }

      stopObserving() {
        if (this.observer && this.isObserving) {
          this._debouncedInvalidateCache.cancel();
          this.observer.disconnect();
          this.isObserving = false;
          if (this.stopLifecycleTimer) clearTimeout(this.stopLifecycleTimer);
          this.stopLifecycleTimer = null;
        }
      }

      _setupObserverDeactivationTimer() {
        this.stopLifecycleTimer = setTimeout(() => {
          this.stopObserving();
          this._setupReactivationTriggers();
        }, KB_NAV_CONFIG.observer.MAX_OBSERVE_TIME_MS);
      }

      _setupReactivationTriggers() {
        this._clearReactivationTriggers();
        const reactivate = () => {
            if (!this.isObserving) {
                this.startObserving();
            }
        };
        this.throttledReactivateObserver = KB_NAV_Utils.throttle(reactivate, KB_NAV_CONFIG.observer.REACTIVATION_THROTTLE_MS);
        
        const eventsToMonitor = ['scroll', 'click', 'keydown'];
        eventsToMonitor.forEach(eventType => {
          const listener = this.throttledReactivateObserver;
          window.addEventListener(eventType, listener, { passive: true, capture: true });
          this.eventListeners.push({ type: eventType, listener, options: { passive: true, capture: true } });
        });
        this.reactivationInterval = setInterval(reactivate, KB_NAV_CONFIG.observer.REACTIVATION_INTERVAL_MS);
      }

      _clearReactivationTriggers() {
        if (this.reactivationInterval) clearInterval(this.reactivationInterval);
        this.reactivationInterval = null;
        
        if (this.throttledReactivateObserver) this.throttledReactivateObserver.cancel();
        this.throttledReactivateObserver = null;

        this.eventListeners.forEach(({ type, listener, options }) => window.removeEventListener(type, listener, options));
        this.eventListeners = [];
      }

      isElementFocusableInput(element) {
        if (!element) return false;
        if (element.isContentEditable) return true;

        const tagName = element.tagName.toUpperCase();
        const type = element.type?.toLowerCase();

        switch (tagName) {
          case 'INPUT':
            return !['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'range', 'color', 'file'].includes(type) &&
                   !(element.disabled || element.readOnly);
          case 'TEXTAREA':
          case 'SELECT':
            return !(element.disabled || element.readOnly);
          default:
            return false;
        }
      }

      findNavigationLinks() {
        if (this.cachedLinks) return this.cachedLinks;

        const links = Array.from(document.querySelectorAll('a[rel="next"], a[rel="prev"]'));
        let nextLink = null;
        let prevLink = null;

        for (const link of links) {
          if (!link.href || link.href === window.location.href || !link.offsetParent) continue;
          
          if (link.rel === 'next' && !nextLink) nextLink = link;
          if (link.rel === 'prev' && !prevLink) prevLink = link;
          if (nextLink && prevLink) break;
        }
        this.cachedLinks = { nextLink, prevLink };
        return this.cachedLinks;
      }
      
      destroy() {
        this.stopObserving();
        this._debouncedInvalidateCache.cancel();
        this._clearReactivationTriggers();
        this.cachedLinks = null;
      }
    }

    class KeyboardPageNavigator {
      static instance = null;

      constructor() {
        if (KeyboardPageNavigator.instance) {
          return KeyboardPageNavigator.instance;
        }
        KeyboardPageNavigator.instance = this;

        this.urlPageFinder = new KB_NAV_UrlPageFinder();
        this.domLinkFinder = new KB_NAV_DomLinkFinder();
        this.isNavigating = false;

        this._debouncedProcessKey = KB_NAV_Utils.debounce(
          this._processNavigationKey.bind(this),
          KB_NAV_CONFIG.navigation.DEBOUNCE_DELAY_MS
        );
        
        this._bindEventHandlers();
        this._initializeEventListeners();
      }

      _bindEventHandlers() {
          this._handleKeyDown = this._handleKeyDown.bind(this);
          this._handlePageShow = this._handlePageShow.bind(this);
          this._handlePageHide = this._handlePageHide.bind(this);
      }

      _initializeEventListeners() {
        document.addEventListener('keydown', this._handleKeyDown);
        window.addEventListener('pageshow', this._handlePageShow);
        window.addEventListener('pagehide', this._handlePageHide);
      }

      _handlePageShow(event) {
        if (event.persisted) {
          this.isNavigating = false;
          this.urlPageFinder.clearCache();
          this.domLinkFinder.destroy();
          this.domLinkFinder = new KB_NAV_DomLinkFinder();
        }
      }

      _handlePageHide(event) {
          if (!event.persisted) {
              this.destroy();
          }
      }

      _handleKeyDown(event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        if (this._shouldIgnoreKeyEvent(event)) return;

        event.preventDefault();
        event.stopPropagation();
        this._debouncedProcessKey(event.key === 'ArrowRight' ? 1 : -1);
      }

      _shouldIgnoreKeyEvent(event) {
        if (event.altKey || event.ctrlKey || event.metaKey) return true;
        return document.activeElement && this.domLinkFinder.isElementFocusableInput(document.activeElement);
      }

      _processNavigationKey(direction) {
        if (this.isNavigating) return;

        const currentUrl = window.location.href;
        if (this.urlPageFinder.shouldIgnoreUrl(currentUrl)) {
          return;
        }
        
        const targetUrl = this._determineTargetUrl(currentUrl, direction);

        if (targetUrl && targetUrl !== currentUrl) {
          this.isNavigating = true;
          window.location.href = targetUrl;
        } else {
          this._resetNavigationFlagAfterDelay(); 
        }
      }

      _determineTargetUrl(currentUrl, direction) {
        const urlPatternInfo = this.urlPageFinder.findPagePattern(currentUrl);
        if (urlPatternInfo) {
          return this.urlPageFinder.generateNewUrl(currentUrl, urlPatternInfo, direction);
        }

        const domLinks = this.domLinkFinder.findNavigationLinks();
        if (direction > 0 && domLinks.nextLink) return domLinks.nextLink.href;
        if (direction < 0 && domLinks.prevLink) return domLinks.prevLink.href;
        
        return null;
      }

      _resetNavigationFlagAfterDelay() {
         setTimeout(() => {
            this.isNavigating = false;
         }, KB_NAV_CONFIG.navigation.RESET_DELAY_MS);
      }
      
      destroy() {
        document.removeEventListener('keydown', this._handleKeyDown);
        window.removeEventListener('pageshow', this._handlePageShow);
        window.removeEventListener('pagehide', this._handlePageHide);
        
        this._debouncedProcessKey.cancel();
        this.urlPageFinder.destroy();
        this.domLinkFinder.destroy();
        KeyboardPageNavigator.instance = null;
      }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new KeyboardPageNavigator());
    } else {
        new KeyboardPageNavigator();
    }
  }


  // =======================================================================
  // === PICTURE-IN-PICTURE (PiP) HANDLER                              ===
  // =======================================================================
  class PictureInPictureHandler {
    // Attributes that might restrict PiP mode
    static PIP_RESTRICTED_ATTRIBUTES = ['disablePictureInPicture', 'disableRemotePlayback', 'playsinline'];

    constructor() {
      this._boundHandleKeyDown = this._handleKeyDown.bind(this);
      this._initializeEventListeners();
    }

    _initializeEventListeners() {
      document.addEventListener('keydown', this._boundHandleKeyDown, true);
    }

    _findBestVideoCandidate() {
      const videos = Array.from(document.querySelectorAll('video'));
      if (videos.length === 0) return null;

      const isPlayableAndVisible = (v) =>
        v.readyState > 2 && 
        v.hasAttribute('src') && v.currentSrc &&
        v.offsetHeight > 0 && v.offsetWidth > 0;

      const scoreVideo = (v) => {
        let score = 0;
        if (isPlayableAndVisible(v)) score += 100;
        if (!v.paused) score += 50;
        if (!v.muted) score += 20;
        score += Math.min(v.offsetWidth * v.offsetHeight, 1000000) / 10000;
        return score;
      };
      
      videos.sort((a, b) => scoreVideo(b) - scoreVideo(a));
      
      return (videos.length > 0 && isPlayableAndVisible(videos[0])) ? videos[0] : null;
    }

    _removePiPRestrictions(videoElement) {
        PictureInPictureHandler.PIP_RESTRICTED_ATTRIBUTES.forEach(attr => {
            if (videoElement.hasAttribute(attr)) {
                try {
                    videoElement.removeAttribute(attr);
                } catch (e) {
                    // Silently ignore if an attribute can't be removed,
                    // as it might be non-configurable by the website.
                }
            }
            // As a fallback or alternative, also try setting to false if removal isn't enough or fails.
            // This part is a bit redundant if removeAttribute works, but can be a safety net.
            // However, for simplicity and focusing on removeAttribute first:
            // if (attr === 'disablePictureInPicture' && videoElement.disablePictureInPicture) {
            //     try { videoElement.disablePictureInPicture = false; } catch (e) {}
            // }
        });
    }

    async toggle() {
      if (document.pictureInPictureElement) {
        try {
          await document.exitPictureInPicture();
        } catch (error) {
          console.error(`${SCRIPT_NAME}: PiP: Error exiting PiP mode:`, error.name, error.message);
        }
        return;
      }
      
      const targetVideo = this._findBestVideoCandidate();
      if (!targetVideo) {
        return;
      }

      // Attempt to remove restrictions before any PiP request
      this._removePiPRestrictions(targetVideo);

      try {
        // Attempt 1: Direct request after trying to remove restrictions
        await targetVideo.requestPictureInPicture();
        this._addLeavePiPListener(targetVideo);
        return;
      } catch (initialError) {
        // If direct request fails even after trying to remove attributes,
        // it's likely a strong restriction or an issue with video state.
        // Further attempts to modify `disablePictureInPicture` via `Object.defineProperty`
        // or direct assignment might be redundant if `removeAttribute` was the primary strategy
        // and it didn't suffice.
        // However, for maximum compatibility, we can still try the old way as a last resort
        // if the error specifically mentions "disablePictureInPicture" attribute.

        if (initialError.name === 'InvalidStateError' && initialError.message.includes('disablePictureInPicture')) {
            // The error indicates 'disablePictureInPicture' is still an issue.
            // Try the older method of setting it to false explicitly as a fallback.
            if (targetVideo.disablePictureInPicture) { // Check if it's still true
                try {
                    Object.defineProperty(targetVideo, 'disablePictureInPicture', {
                        configurable: true, writable: true, value: false
                    });
                    if (targetVideo.disablePictureInPicture) {
                        targetVideo.disablePictureInPicture = false;
                    }
                } catch (eDefProp) {
                    try {
                        targetVideo.disablePictureInPicture = false;
                    } catch (eDirectAssign) { /* Both failed */ }
                }
            }
            // Attempt PiP one last time after this explicit modification
            try {
                await targetVideo.requestPictureInPicture();
                this._addLeavePiPListener(targetVideo);
                return; // Success on final attempt
            } catch (finalAttemptError) {
                console.error(`${SCRIPT_NAME}: PiP: All attempts to enter PiP mode failed. Final Error:`, finalAttemptError.name, finalAttemptError.message);
            }
        } else {
            // For other errors, or if 'disablePictureInPicture' wasn't the specific cause mentioned in initialError
            console.error(`${SCRIPT_NAME}: PiP: Error entering PiP mode after restriction removal. Initial Error:`, initialError.name, initialError.message);
        }
      }
    }
    
    _addLeavePiPListener(videoElement) {
        videoElement.addEventListener('leavepictureinpicture', () => {
            // No log needed for this event in release
        }, { once: true });
    }

    _handleKeyDown(event) {
      if (!(event.ctrlKey && event.shiftKey && (event.key === 'P' || event.key === 'p'))) {
        return;
      }

      const targetElement = event.target;
      const isEditableContext = targetElement && (
        targetElement.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetElement.tagName?.toUpperCase())
      );

      if (isEditableContext) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.toggle();
    }

    destroy() {
      document.removeEventListener('keydown', this._boundHandleKeyDown, true);
    }
  }

  new PictureInPictureHandler();

})();
