(() => {
  'use strict';

  // =======================================================================
  // === MOUSE GESTURE HANDLER                                           ===
  // =======================================================================
  class MouseGestureHandler {
    static MIN_DRAG_DISTANCE_SQ = 100; // 10px * 10px
    static MIN_FINAL_DISTANCE_SQ = 625; // 25px * 25px
    static MESSAGE_ACTION = 'perform-gesture';
    static RIGHT_MOUSE_BUTTON = 2;

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
      this.mouseMoveOptions = { capture: true, passive: true };
      this.blurOptions = { capture: true, passive: true };
      this.captureOptions = { capture: true };

      window.addEventListener('mousedown', this.handleMouseDown, this.captureOptions);
      window.addEventListener('mousemove', this.handleMouseMove, this.mouseMoveOptions);
      window.addEventListener('mouseup', this.handleMouseUp, this.captureOptions);
      window.addEventListener('contextmenu', this.handleContextMenu, this.captureOptions);
      window.addEventListener('blur', this.handleBlur, this.blurOptions);
    }

    _resetState() {
      this.isMouseDown = false;
      this.didMove = false;
    }

    handleMouseDown(event) {
      if (event.button !== MouseGestureHandler.RIGHT_MOUSE_BUTTON) return;

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
      if (event.button !== MouseGestureHandler.RIGHT_MOUSE_BUTTON) {
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
        // Silently ignore "Extension context invalidated" or other errors
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

    destroy() {
      window.removeEventListener('mousedown', this.handleMouseDown, this.captureOptions);
      window.removeEventListener('mousemove', this.handleMouseMove, this.mouseMoveOptions);
      window.removeEventListener('mouseup', this.handleMouseUp, this.captureOptions);
      window.removeEventListener('contextmenu', this.handleContextMenu, this.captureOptions);
      window.removeEventListener('blur', this.handleBlur, this.blurOptions);
    }
  }

  const userAgent = navigator.userAgent;
  const browsersToDisableGesturesFor = [
    "Edg/", "OPR/", "Whale/", "Vivaldi/"
  ];
  const shouldDisableGestures = browsersToDisableGesturesFor.some(browserIdentifier =>
    userAgent.includes(browserIdentifier)
  );
  if (!shouldDisableGestures) {
    new MouseGestureHandler();
  }

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
          const options = { passive: true, capture: true };
          window.addEventListener(eventType, listener, options);
          this.eventListeners.push({ type: eventType, listener, options });
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
        this._clearReactivationTriggers();
        this.cachedLinks = null;
      }
    }

    class KeyboardPageNavigator {
      static instance = null;
      static NAV_KEYS_SET = new Set(['ArrowLeft', 'ArrowRight']);
      static KEY_ARROW_RIGHT = 'ArrowRight';
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
        if (!KeyboardPageNavigator.NAV_KEYS_SET.has(event.key)) return;
        if (this._shouldIgnoreKeyEvent(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === KeyboardPageNavigator.KEY_ARROW_RIGHT ? 1 : -1;
        this._debouncedProcessKey(direction);
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
            if (targetUrl.toLowerCase().startsWith('javascript:')) {
                this._resetNavigationFlagAfterDelay();
                return;
            }
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
        if (this.urlPageFinder) this.urlPageFinder.destroy();
        if (this.domLinkFinder) this.domLinkFinder.destroy();
        KeyboardPageNavigator.instance = null;
      }
    }

    if (!KeyboardPageNavigator.instance) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => new KeyboardPageNavigator());
        } else {
            new KeyboardPageNavigator();
        }
    }
  }

  // =======================================================================
  // === PICTURE-IN-PICTURE (PiP) HANDLER                              ===
  // =======================================================================
  class PictureInPictureHandler {
    static PIP_RESTRICTED_ATTRIBUTES = ['disablePictureInPicture', 'disableRemotePlayback', 'playsinline'];
    static PIP_KEY = 'P';

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

      const isPlayableAndVisible = (v) => {
        const hasSrc = v.hasAttribute('src') || v.querySelector('source');
        const hasCurrentSrc = !!v.currentSrc;
        const isReady = v.readyState > 0;
        const isVisible = v.offsetHeight > 0 && v.offsetWidth > 0 && getComputedStyle(v).visibility !== 'hidden' && getComputedStyle(v).display !== 'none';
        return isReady && (hasSrc || hasCurrentSrc) && isVisible;
      }

      const scoreVideo = (v) => {
        let score = 0;
        if (isPlayableAndVisible(v)) {
            score += 100;
        }
        if (!v.paused) score += 50;
        if (!v.muted) score += 20;
        const area = v.offsetWidth * v.offsetHeight;
        if (area > 0) {
            score += Math.min(area, 1000000) / 10000;
        }
        const rect = v.getBoundingClientRect();
        const isInViewport = rect.top < window.innerHeight && rect.bottom >= 0 &&
                             rect.left < window.innerWidth && rect.right >= 0;
        if (isInViewport) {
            score += 30;
        }
        return score;
      };

      const candidateVideos = videos.filter(v => isPlayableAndVisible(v));
      
      if (candidateVideos.length === 0) {
          const lessStrictVideos = videos.filter(v => (v.hasAttribute('src') || v.querySelector('source')) && (v.offsetWidth > 0 || v.offsetHeight > 0 || v.videoWidth > 0 || v.videoHeight > 0));
          if(lessStrictVideos.length > 0) {
            lessStrictVideos.sort((a,b) => scoreVideo(b) - scoreVideo(a));
            return lessStrictVideos[0];
          }
          return null;
      }
      
      candidateVideos.sort((a, b) => scoreVideo(b) - scoreVideo(a));

      if (candidateVideos.length > 0) {
        return candidateVideos[0];
      }
      
      return null;
    }

    _removePiPRestrictions(videoElement) {
        PictureInPictureHandler.PIP_RESTRICTED_ATTRIBUTES.forEach(attr => {
            if (videoElement.hasAttribute(attr)) {
                try {
                    videoElement.removeAttribute(attr);
                } catch (e) {
                    // Silently ignore
                }
            }
        });
    }

    async _ensureVideoReady(videoElement) {
      if (!videoElement) {
        return;
      }
      if (videoElement.readyState < 3) {
        try {
          await new Promise((resolve, reject) => {
            let timeoutId = null;
            const onLoadedMetadata = () => {
              clearTimeout(timeoutId);
              videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
              videoElement.removeEventListener('error', onError);
              resolve();
            };
            const onError = (event) => {
              clearTimeout(timeoutId);
              videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
              videoElement.removeEventListener('error', onError);
              resolve(); 
            };

            videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
            videoElement.addEventListener('error', onError);

            if (videoElement.readyState === 0 && videoElement.networkState === HTMLMediaElement.NETWORK_EMPTY && (videoElement.src || videoElement.querySelector('source[src]')?.src) ) {
                videoElement.load();
            }

            timeoutId = setTimeout(() => {
              videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
              videoElement.removeEventListener('error', onError);
              resolve();
            }, 3000);
          });
        } catch (loadError) {
          // Silently ignore
        }
      }
    }

    async _attemptEnterPiPWithOverrides(targetVideo) {
        if (targetVideo.disablePictureInPicture) {
            try {
                Object.defineProperty(targetVideo, 'disablePictureInPicture', {
                    configurable: true, writable: true, value: false
                });
                if (targetVideo.disablePictureInPicture) {
                    targetVideo.disablePictureInPicture = false;
                }
            } catch (eDefineProp) {
                try {
                    targetVideo.disablePictureInPicture = false;
                } catch (eDirectAssign) {
                    // Both failed
                }
            }
        }
        await targetVideo.requestPictureInPicture();
    }

    async toggle() {
      if (document.pictureInPictureElement) {
        try {
          await document.exitPictureInPicture();
        } catch (error) {
          // Silently ignore
        }
        return;
      }

      const targetVideo = this._findBestVideoCandidate();
      if (!targetVideo) {
        return;
      }

      await this._ensureVideoReady(targetVideo);
      this._removePiPRestrictions(targetVideo);

      try {
        if (targetVideo.paused && (targetVideo.videoWidth < 100 || targetVideo.videoHeight < 100)) {
            try {
                targetVideo.muted = true;
                await targetVideo.play();
            } catch(playError) {
                // Silently ignore
            }
        }

        await targetVideo.requestPictureInPicture();
        this._addLeavePiPListener(targetVideo);
      } catch (initialError) {
        const isPipDisabledError = initialError.name === 'InvalidStateError' &&
                                   (initialError.message.includes('disablePictureInPicture') ||
                                    initialError.message.toLowerCase().includes('picture-in-picture is disabled'));
        
        if (isPipDisabledError) {
            try {
                await this._attemptEnterPiPWithOverrides(targetVideo);
                this._addLeavePiPListener(targetVideo);
            } catch (finalAttemptError) {
                // Silently ignore
            }
        } else {
            // Silently ignore other errors
        }
      }
    }

    _addLeavePiPListener(videoElement) {
        videoElement.addEventListener('leavepictureinpicture', () => {
            // Action on leave if needed
        }, { once: true });
    }

    _handleKeyDown(event) {
      if (!(event.ctrlKey && event.shiftKey && event.key.toUpperCase() === PictureInPictureHandler.PIP_KEY)) {
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
