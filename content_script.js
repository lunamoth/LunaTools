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
      // Options must be identical for addEventListener and removeEventListener
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
      // If mouseup is not the right button (e.g., another button was pressed while right was held),
      // reset state but don't process as a gesture.
      if (event.button !== MouseGestureHandler.RIGHT_MOUSE_BUTTON) {
        this._resetState();
        return;
      }

      const gestureDirection = this._determineGestureDirection(event.clientX, event.clientY);

      if (gestureDirection) {
        this._sendGestureMessage(gestureDirection);
      }
      // Note: ContextMenu event will handle final _resetState if didMove is true
      // If didMove is false, context menu appears, and state resets there too.
      // If gestureDirection is null (not enough movement), context menu also resets.
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
          // Context invalidated, usually means extension was updated/reloaded. Silently ignore.
        } else {
          console.error(`${SCRIPT_NAME}: Gesture: Failed to send message to background.`, error);
        }
      }
    }

    handleContextMenu(event) {
      if (this.didMove) {
        event.preventDefault();
      }
      this._resetState(); // Always reset state on contextmenu event, which follows right mouse up.
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

  // Initialize MouseGestureHandler only if not in Microsoft Edge
  const userAgent = navigator.userAgent;
  // Modern Chromium-based Edge uses "Edg/" in its user agent string.
  // Older EdgeHTML-based Edge used "Edge/", but this extension targets manifest v3,
  // so users are likely on Chromium-based browsers.
  const isMicrosoftEdge = userAgent.includes("Edg/");

  if (!isMicrosoftEdge) {
    new MouseGestureHandler();
  } else {
    // Optional: Log to console if gestures are disabled. Useful for debugging.
    // console.log(`${SCRIPT_NAME}: Mouse gestures are disabled in Microsoft Edge.`);
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

    const KB_NAV_Logger = {
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
        // Move to end to mark as recently used
        this.cache.delete(key);
        this.cache.set(key, item);
        return item.value;
      }

      set(key, value) {
        if (this.cache.has(key)) {
          this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
          // Evict least recently used (first item in map iteration)
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
        this.urlPatternCache.set(url, null); // Cache negative result
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
        this.observerTarget = null; // Set in _initializeObserver
        this.isObserving = false;
        this.stopLifecycleTimer = null;
        this.reactivationInterval = null;
        this.throttledReactivateObserver = null;
        this.eventListeners = []; // To keep track of listeners for reactivation

        this._debouncedInvalidateCache = KB_NAV_Utils.debounce(() => {
            this.cachedLinks = null;
        }, KB_NAV_CONFIG.observer.DEBOUNCE_DELAY_MS);

        this._initializeObserver();
      }

      _initializeObserver() {
        this._findObserverTarget(); // This will set this.observerTarget
        this.observer = new MutationObserver(() => {
          if (this.isObserving) this._debouncedInvalidateCache();
        });
        this.startObserving(); // Start observing immediately
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
        this.observerTarget = document.body; // Fallback if no specific selectors match
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
            this.isObserving = false; // Ensure state is correct on error
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
        this._clearReactivationTriggers(); // Ensure no old triggers remain
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
        const type = element.type?.toLowerCase(); // Optional chaining for type

        switch (tagName) {
          case 'INPUT':
            // Exclude non-textual or non-editable input types
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
          // Ensure link is valid, visible, and not pointing to the current page
          if (!link.href || link.href === window.location.href || !link.offsetParent) continue;

          if (link.rel === 'next' && !nextLink) nextLink = link;
          if (link.rel === 'prev' && !prevLink) prevLink = link;
          if (nextLink && prevLink) break; // Found both, no need to continue
        }
        this.cachedLinks = { nextLink, prevLink };
        return this.cachedLinks;
      }

      destroy() {
        this.stopObserving(); // Also cancels debouncedInvalidateCache
        this._clearReactivationTriggers();
        this.cachedLinks = null;
        // No need to explicitly nullify this.observer or this.observerTarget,
        // they will be garbage collected if this instance is no longer referenced.
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
        this.isNavigating = false; // Prevents multiple navigations from rapid key presses

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
        // Reset state if page is shown from back/forward cache (bfcache)
        if (event.persisted) {
          this.isNavigating = false;
          this.urlPageFinder.clearCache(); // URL might have changed parameters not visible to script
          // Re-initialize DOM dependent parts as DOM might be stale
          this.domLinkFinder.destroy();
          this.domLinkFinder = new KB_NAV_DomLinkFinder();
        }
      }

      _handlePageHide(event) {
          // If page is not being persisted in bfcache, it's likely being unloaded.
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
        // Ignore if modifier keys are pressed, or if focus is on an input field
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
          // isNavigating will be reset by pageshow if navigation is successful,
          // or by _resetNavigationFlagAfterDelay if it fails or is very fast.
        } else {
          // If no target URL, or target is same as current, reset flag after a short delay
          this._resetNavigationFlagAfterDelay();
        }
      }

      _determineTargetUrl(currentUrl, direction) {
        // Prioritize URL-based navigation
        const urlPatternInfo = this.urlPageFinder.findPagePattern(currentUrl);
        if (urlPatternInfo) {
          return this.urlPageFinder.generateNewUrl(currentUrl, urlPatternInfo, direction);
        }

        // Fallback to DOM-based link finding
        const domLinks = this.domLinkFinder.findNavigationLinks();
        if (direction > 0 && domLinks.nextLink) return domLinks.nextLink.href;
        if (direction < 0 && domLinks.prevLink) return domLinks.prevLink.href;

        return null; // No navigation target found
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

    // Initialize only if not already initialized (e.g., script re-injection scenario)
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
      document.addEventListener('keydown', this._boundHandleKeyDown, true); // Use capture phase
    }

    _findBestVideoCandidate() {
      const videos = Array.from(document.querySelectorAll('video'));
      if (videos.length === 0) return null;

      const isPlayableAndVisible = (v) =>
        v.readyState > 2 && // HAVE_CURRENT_DATA or more
        v.hasAttribute('src') && v.currentSrc && // Has a source
        v.offsetHeight > 0 && v.offsetWidth > 0; // Is visible

      const scoreVideo = (v) => {
        let score = 0;
        if (isPlayableAndVisible(v)) score += 100;
        if (!v.paused) score += 50; // Prefer playing videos
        if (!v.muted) score += 20;  // Prefer unmuted videos
        // Prefer larger videos, cap score contribution
        score += Math.min(v.offsetWidth * v.offsetHeight, 1000000) / 10000;
        return score;
      };

      videos.sort((a, b) => scoreVideo(b) - scoreVideo(a)); // Sort descending by score

      return (videos.length > 0 && isPlayableAndVisible(videos[0])) ? videos[0] : null;
    }

    _removePiPRestrictions(videoElement) {
        PictureInPictureHandler.PIP_RESTRICTED_ATTRIBUTES.forEach(attr => {
            if (videoElement.hasAttribute(attr)) {
                try {
                    videoElement.removeAttribute(attr);
                } catch (e) {
                    // Silently ignore if an attribute can't be removed (e.g., non-configurable by website)
                }
            }
        });
    }

    async _attemptEnterPiPWithOverrides(targetVideo) {
        // This method is called if the initial PiP request failed,
        // likely due to 'disablePictureInPicture' still being effective.
        if (targetVideo.disablePictureInPicture) { // Check if attribute is still effectively true
            try {
                // Attempt to make disablePictureInPicture configurable and writable, then set to false.
                Object.defineProperty(targetVideo, 'disablePictureInPicture', {
                    configurable: true, writable: true, value: false
                });
                // If defineProperty didn't throw but the value is still true (e.g., non-configurable getter),
                // try direct assignment as a fallback.
                if (targetVideo.disablePictureInPicture) {
                    targetVideo.disablePictureInPicture = false;
                }
            } catch (eDefineProp) {
                // If defineProperty fails (e.g., property is not configurable), try direct assignment.
                try {
                    targetVideo.disablePictureInPicture = false;
                } catch (eDirectAssign) {
                    // Both defineProperty and direct assignment failed.
                    // The final PiP request attempt below will likely fail and be logged.
                }
            }
        }
        // Attempt PiP one last time after explicit modifications
        await targetVideo.requestPictureInPicture();
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
        // No suitable video found, do nothing.
        return;
      }

      this._removePiPRestrictions(targetVideo);

      try {
        // First attempt to enter PiP after basic restriction removal
        await targetVideo.requestPictureInPicture();
        this._addLeavePiPListener(targetVideo);
      } catch (initialError) {
        // If the initial attempt failed, check if it's related to PiP being disabled.
        // Error messages can vary, check for common indicators.
        const isPipDisabledError = initialError.name === 'InvalidStateError' &&
                                   (initialError.message.includes('disablePictureInPicture') ||
                                    initialError.message.toLowerCase().includes('picture-in-picture is disabled'));
        
        if (isPipDisabledError) {
            try {
                // Try more aggressive overrides if the specific error was caught
                await this._attemptEnterPiPWithOverrides(targetVideo);
                this._addLeavePiPListener(targetVideo);
            } catch (finalAttemptError) {
                // Log only if all attempts, including overrides, fail.
                console.error(`${SCRIPT_NAME}: PiP: All attempts to enter PiP mode failed. Final Error:`, finalAttemptError.name, finalAttemptError.message);
            }
        } else {
            // Log other types of errors from the initial attempt.
            console.error(`${SCRIPT_NAME}: PiP: Error entering PiP mode. Initial Error:`, initialError.name, initialError.message);
        }
      }
    }

    _addLeavePiPListener(videoElement) {
        // Listener for when PiP mode is exited (e.g., by user closing PiP window)
        videoElement.addEventListener('leavepictureinpicture', () => {
            // No specific action needed here for now, but listener is good practice.
            // console.log(`${SCRIPT_NAME}: PiP: Video left PiP mode.`); // Example log, removed for release
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
        // Don't interfere with typing in input fields
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
