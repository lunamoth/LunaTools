(() => {
  'use strict'; // Use strict mode for the entire script

  // =======================================================================
  // === LunaTools: MOUSE GESTURE LOGIC                                  ===
  // =======================================================================

  // Constants for Gestures
  const GESTURE_MIN_DRAG_DISTANCE_SQ = 100; // Min squared distance to trigger gesture (10px)
  const GESTURE_MIN_FINAL_DISTANCE_SQ = 625; // Min squared distance for gesture recognition (25px)
  const GESTURE_PERFORM_ACTION = 'perform-gesture'; // Action name for sending message

  // State variables for Gestures
  let gesture_isMouseDown = false;
  let gesture_startX = 0;
  let gesture_startY = 0;
  let gesture_didMove = false;
  const gesture_currentWindow = window; // Use specific variable name

  // Reset state function for Gestures
  const gesture_resetState = () => {
    gesture_isMouseDown = false;
    gesture_didMove = false;
  };

  // Event listener options for Gestures
  const gesture_passiveOptions = { capture: true, passive: true };
  const gesture_captureOptions = { capture: true };

  // --- Gesture Event Listeners ---

  gesture_currentWindow.addEventListener('mousedown', (event) => {
    if (event.button === 2) { // Right-click
      gesture_isMouseDown = true;
      gesture_startX = event.clientX;
      gesture_startY = event.clientY;
      gesture_didMove = false;
      // console.log("LunaTools Gesture: Mouse down");
    }
  }, gesture_captureOptions);

  gesture_currentWindow.addEventListener('mousemove', (event) => {
    if (gesture_isMouseDown && !gesture_didMove) {
      const deltaX = event.clientX - gesture_startX;
      const deltaY = event.clientY - gesture_startY;
      if ((deltaX ** 2 + deltaY ** 2) > GESTURE_MIN_DRAG_DISTANCE_SQ) {
        gesture_didMove = true;
        // console.log("LunaTools Gesture: Moved significantly");
      }
    }
  }, gesture_passiveOptions);

  gesture_currentWindow.addEventListener('mouseup', (event) => {
    if (gesture_isMouseDown && event.button !== 2) { // Cancelled gesture
      // console.log("LunaTools Gesture: Cancelled (wrong button mouseup)");
      gesture_resetState();
      return;
    }
    if (!gesture_isMouseDown || event.button !== 2) { // Not a right-click release we tracked
      return;
    }

    const deltaX = event.clientX - gesture_startX;
    const deltaY = event.clientY - gesture_startY;
    const distanceSq = deltaX ** 2 + deltaY ** 2;
    let gesture = null;

    if (distanceSq >= GESTURE_MIN_FINAL_DISTANCE_SQ) {
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        gesture = deltaY < 0 ? 'U' : 'D';
      } else {
        gesture = deltaX > 0 ? 'R' : 'L';
      }
      // console.log(`LunaTools Gesture: Recognized gesture: ${gesture}`);
    } else {
       // console.log("LunaTools Gesture: Mouse up, but distance too short");
    }

    if (gesture) {
      try {
        // Send the recognized gesture to the background script
        chrome.runtime.sendMessage({ action: GESTURE_PERFORM_ACTION, gesture: gesture });
      } catch (error) {
        console.warn('LunaTools Gesture: Failed to send message to background.', error);
      }
    }
    // State reset is handled by contextmenu listener
  }, gesture_captureOptions);

  gesture_currentWindow.addEventListener('contextmenu', (event) => {
    // Prevent context menu only if a gesture was performed
    if (gesture_didMove) {
      // console.log("LunaTools Gesture: Preventing context menu");
      event.preventDefault();
    }
    // Always reset gesture state after a right-click interaction finishes
    gesture_resetState();
  }, gesture_captureOptions);

  gesture_currentWindow.addEventListener('blur', () => {
    // Reset gesture state if the window loses focus during a potential gesture
    if (gesture_isMouseDown) {
      // console.log("LunaTools Gesture: Cancelled (window blur)");
      gesture_resetState();
    }
  }, gesture_passiveOptions);

  console.log("LunaTools: Mouse Gesture logic initialized.");

  // =======================================================================
  // === LunaTools: KEYBOARD NAVIGATION LOGIC (from User Script)         ===
  // =======================================================================

  // Only run Keyboard Navigation logic in the top-level frame
  if (window.self === window.top) {

    /**
     * Configuration object
     */
    const KB_NAV_CONFIG = Object.freeze({
      cache: {
        MAX_SIZE: 100,
        MAX_AGE_MS: 30 * 60 * 1000,
      },
      navigation: {
        RESET_DELAY: 150,
        MIN_PAGE: 1,
        MAX_PAGE: 9999,
        DEBOUNCE_DELAY: 100
      },
      observer: {
        TARGET_SELECTORS: ['nav[aria-label="pagination"]', '.pagination', '#pagination'],
        FALLBACK_TARGET_SELECTORS: ['main', '#main', '#content', 'article'],
        DEBOUNCE_DELAY: 100,
        MAX_OBSERVE_TIME: 30 * 1000,
        REACTIVATION_INTERVAL: 5 * 60 * 1000,
        REACTIVATION_THROTTLE: 1000
      },
      patterns: {
        url: [
          /[?&]page=(\d{1,4})/i,
          /[?&]po=(\d{1,4})/i,
          /[?&]p=(\d{1,4})/i,
          /page\/(\d{1,4})/i,
          /\/(\d{1,4})$/i // Matches /<number> at the end of the path (before query string or hash)
        ],
        ignore: [
          /\/status\/\d{10,}/i,
          /\/\d{10,}/i
        ]
      }
    });

    /**
     * Utility functions
     */
    const KB_NAV_Utils = {
      debounce(func, wait) {
        let timeoutId;
        const debounced = function (...args) {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            func.apply(this, args);
          }, wait);
        };
        debounced.cancel = () => { clearTimeout(timeoutId); };
        return debounced;
      },
      throttle(func, wait) {
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
               if (lastArgs) { throttled.apply(this, lastArgs); }
             }, wait);
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

    /**
     * Simple LRU Cache with Max Age.
     */
    class KB_NAV_Cache {
      constructor(maxSize) {
        this.maxSize = maxSize;
        this.cache = new Map();
      }
      get(key) {
        if (!this.cache.has(key)) return undefined;
        const item = this.cache.get(key);
        const now = Date.now();
        if (now - item.timestamp > KB_NAV_CONFIG.cache.MAX_AGE_MS) {
          this.cache.delete(key);
          // console.log(`LunaTools KB Nav Cache: Item expired: ${key}`);
          return undefined;
        }
        const value = item.value;
        this.cache.delete(key); // LRU: Remove
        this.set(key, value);   // LRU: Re-insert at end
        // console.log(`LunaTools KB Nav Cache: Item retrieved: ${key}`);
        return value;
      }
      set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.maxSize) {
            const leastUsedKey = this.cache.keys().next().value;
            this.cache.delete(leastUsedKey);
            // console.log(`LunaTools KB Nav Cache: Cache full. Removed: ${leastUsedKey}`);
        }
        this.cache.set(key, { value, timestamp: Date.now() });
        // console.log(`LunaTools KB Nav Cache: Item set: ${key}`);
      }
      clear() {
        this.cache.clear();
        // console.log("LunaTools KB Nav Cache: Cleared.");
      }
      removeExpired() {
        const now = Date.now();
        let removedCount = 0;
        for (const [key, item] of this.cache.entries()) {
          if (now - item.timestamp > KB_NAV_CONFIG.cache.MAX_AGE_MS) {
            this.cache.delete(key);
            removedCount++;
          }
        }
        // if (removedCount > 0) console.log(`LunaTools KB Nav Cache: Removed ${removedCount} expired items.`);
      }
    }

    /**
     * Handles URL pattern matching and page number extraction.
     */
    class KB_NAV_UrlManager {
      constructor() {
        this.urlCache = new KB_NAV_Cache(KB_NAV_CONFIG.cache.MAX_SIZE);
        this.setupCacheCleanup();
      }
      setupCacheCleanup() {
        this.cleanupInterval = setInterval(() => {
          this.urlCache.removeExpired();
        }, KB_NAV_CONFIG.observer.REACTIVATION_INTERVAL);
      }
      findPagePattern(url) {
        const cachedResult = this.urlCache.get(url);
        if (cachedResult !== undefined) return cachedResult;

        for (const pattern of KB_NAV_CONFIG.patterns.url) {
          const match = pattern.exec(url);
          if (!match || !match[1]) continue;
          const pageNumber = parseInt(match[1], 10);
          if (isNaN(pageNumber) || pageNumber < KB_NAV_CONFIG.navigation.MIN_PAGE || pageNumber > KB_NAV_CONFIG.navigation.MAX_PAGE) {
              continue;
          }
          const patternInfo = { pattern: pattern, currentPage: pageNumber };
          this.urlCache.set(url, patternInfo);
          return patternInfo;
        }
        this.urlCache.set(url, null); // Cache null if no match
        return null;
      }
      updatePageInUrl(url, patternInfo, direction) {
        const { pattern, currentPage } = patternInfo;
        const newPage = Math.max(
          KB_NAV_CONFIG.navigation.MIN_PAGE,
          Math.min(KB_NAV_CONFIG.navigation.MAX_PAGE, currentPage + direction)
        );
        if (newPage === currentPage) return url; // No change needed

         // Ensure replacement happens correctly even if number is at the end ($)
         // Use a function to reconstruct the replacement string carefully
         return url.replace(pattern, (match, ...args) => {
             // The captured number is usually the first argument after the full match
             const capturedPageNumber = args[0];
             // If the pattern matches more than just the number (e.g., 'page='),
             // we need to replace only the number part within the match.
             return match.replace(capturedPageNumber, newPage.toString());
         });
      }
      shouldIgnore(url) {
        return KB_NAV_CONFIG.patterns.ignore.some(pattern => pattern.test(url));
      }
      cleanup() {
          clearInterval(this.cleanupInterval);
          this.urlCache.clear();
      }
    }

    /**
     * Handles DOM operations: finding navigation links and observing DOM changes.
     */
    class KB_NAV_DomMonitor {
      constructor() {
        this.cachedLinks = null;
        this.invalidateCacheDebounced = KB_NAV_Utils.debounce(() => {
            this.cachedLinks = null;
            // console.log("LunaTools KB Nav DOM: Invalidated cached nav links.");
        }, KB_NAV_CONFIG.observer.DEBOUNCE_DELAY);
        this.isObserving = false;
        this.observer = null;
        this.observerTarget = null;
        this.eventListeners = [];
        this.reactivationInterval = null;
        this.stopLifecycleTimer = null;
        this.throttledReactivate = null;
        this.initializeObserver();
        this.setupObserverLifecycle();
      }
      initializeObserver() {
        this.findObserverTarget();
        const observerCallback = (mutationsList) => {
          if (!this.isObserving) return;
          this.invalidateCacheDebounced();
        };
        this.observer = new MutationObserver(observerCallback);
        this.startObserver(); // Start initially
      }
      findObserverTarget() {
        for (const selector of KB_NAV_CONFIG.observer.TARGET_SELECTORS) {
          this.observerTarget = document.querySelector(selector);
          if (this.observerTarget) return;
        }
        for (const selector of KB_NAV_CONFIG.observer.FALLBACK_TARGET_SELECTORS) {
          this.observerTarget = document.querySelector(selector);
          if (this.observerTarget) return;
        }
        this.observerTarget = document.body;
      }
      startObserver() {
        if (this.observer && this.observerTarget && !this.isObserving) {
          try {
              this.observer.observe(this.observerTarget, { childList: true, subtree: true });
              this.isObserving = true;
              // console.log("LunaTools KB Nav DOM: Observer started.");
              if (this.stopLifecycleTimer) { this.stopLifecycleTimer(); this.stopLifecycleTimer = null; }
              this.setupObserverLifecycle(); // Restart lifecycle timer
          } catch (error) { console.error("LunaTools KB Nav: Error starting Observer:", error); this.isObserving = false; }
        }
      }
      stopObserver() {
        if (this.observer && this.isObserving) {
          if (this.invalidateCacheDebounced?.cancel) this.invalidateCacheDebounced.cancel();
          this.observer.disconnect();
          this.isObserving = false;
          // console.log("LunaTools KB Nav DOM: Observer stopped.");
          if (this.stopLifecycleTimer) { this.stopLifecycleTimer(); this.stopLifecycleTimer = null; }
        }
      }
      setupObserverLifecycle() {
         if (this.stopLifecycleTimer) this.stopLifecycleTimer();
         const timerId = setTimeout(() => {
           // console.log(`LunaTools KB Nav DOM: Stopping observer due to MAX_OBSERVE_TIME.`);
           this.stopObserver();
           this.setupReactivationEvents();
         }, KB_NAV_CONFIG.observer.MAX_OBSERVE_TIME);
         this.stopLifecycleTimer = () => clearTimeout(timerId);
      }
      setupReactivationEvents() {
         this.clearReactivationEvents();
         const reactivateObserver = () => {
           if (!this.isObserving) {
             // console.log("LunaTools KB Nav DOM: Reactivating observer.");
             this.startObserver();
           }
         };
         this.throttledReactivate = KB_NAV_Utils.throttle(reactivateObserver, KB_NAV_CONFIG.observer.REACTIVATION_THROTTLE);
         const events = ['scroll', 'click', 'keydown'];
         this.eventListeners = [];
         events.forEach(eventType => {
           const listener = this.throttledReactivate;
           window.addEventListener(eventType, listener, { passive: true });
           this.eventListeners.push({ type: eventType, listener });
         });
         this.reactivationInterval = setInterval(() => {
           if (!this.isObserving) { reactivateObserver(); }
         }, KB_NAV_CONFIG.observer.REACTIVATION_INTERVAL);
      }
      clearReactivationEvents() {
          clearInterval(this.reactivationInterval); this.reactivationInterval = null;
          if (this.throttledReactivate?.cancel) this.throttledReactivate.cancel();
          this.eventListeners.forEach(({ type, listener }) => window.removeEventListener(type, listener));
          this.eventListeners = [];
      }
      cleanup() {
        // console.log("LunaTools KB Nav DOM: Cleaning up...");
        this.stopObserver();
        if (this.stopLifecycleTimer) { this.stopLifecycleTimer(); this.stopLifecycleTimer = null; }
        if (this.invalidateCacheDebounced?.cancel) this.invalidateCacheDebounced.cancel();
        this.clearReactivationEvents();
        this.cachedLinks = null;
      }
      isFocusable(element) {
        if (!element) return false;
        const tagName = element.tagName;
        // Added SELECT and contentEditable check
        return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || element.isContentEditable;
      }
      findNavigationLinks() {
        if (this.cachedLinks) return this.cachedLinks;
        const links = document.querySelectorAll('a[rel="next"], a[rel="prev"]');
        let nextLink = null;
        let prevLink = null;
        for (const link of links) {
          if (!link.href) continue; // Basic validity check
          if (link.rel === 'next' && !nextLink) nextLink = link;
          if (link.rel === 'prev' && !prevLink) prevLink = link;
          if (nextLink && prevLink) break;
        }
        this.cachedLinks = { nextLink, prevLink };
        // console.log("LunaTools KB Nav DOM: Found nav links:", this.cachedLinks);
        return this.cachedLinks;
      }
    }

    /**
     * Main class orchestrating the keyboard navigation functionality.
     */
    class KB_NAV_KeyboardNavigator {
      constructor() {
        // Check if already initialized in this frame to prevent multiple instances
        if (window.lunaToolsKbNavInitialized) {
            console.log("LunaTools KB Nav: Already initialized in this frame.");
            return;
        }
        window.lunaToolsKbNavInitialized = true; // Set flag

        this.urlManager = new KB_NAV_UrlManager();
        this.domMonitor = new KB_NAV_DomMonitor();
        this.isNavigating = false;
        this.processKeyDebounced = KB_NAV_Utils.debounce(this.processKey.bind(this), KB_NAV_CONFIG.navigation.DEBOUNCE_DELAY);
        this.handleKeydown = this.handleKeydown.bind(this);
        this.handlePageShow = this.handlePageShow.bind(this);
        this.handlePageHide = this.handlePageHide.bind(this); // Added pagehide handler
        this.initialize();
      }
      initialize() {
        document.addEventListener('keydown', this.handleKeydown);
        window.addEventListener('pageshow', this.handlePageShow);
        window.addEventListener('pagehide', this.handlePageHide); // Listen for pagehide
        console.log("LunaTools KB Nav: Initialized.");
      }
      handlePageShow(event) {
        if (event.persisted) {
          // console.log("LunaTools KB Nav: Page restored from bfcache. Resetting.");
          this.isNavigating = false;
          this.urlManager.urlCache.clear();
          this.domMonitor.cachedLinks = null;
          // Re-create DomMonitor after bfcache restore
          this.domMonitor.cleanup(); // Clean up old instance first
          this.domMonitor = new KB_NAV_DomMonitor(); // Create new instance
        }
      }
       handlePageHide(event) {
         // Perform full cleanup only if the page is *not* going into bfcache
         if (!event.persisted) {
             // console.log("LunaTools KB Nav: Page unloading. Cleaning up.");
             this.cleanup();
         }
       }
      handleKeydown(event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        if (this.shouldIgnoreKeyEvent(event)) return;
        event.preventDefault();
        this.processKeyDebounced(event);
      }
      shouldIgnoreKeyEvent(event) {
        // Ignore if modifier keys (except Shift for potential future use) are pressed
        if (event.altKey || event.ctrlKey || event.metaKey) {
            return true;
        }
        const activeEl = document.activeElement;
        return activeEl && this.domMonitor.isFocusable(activeEl);
      }
      processKey(event) {
        if (this.isNavigating) return;
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        // console.log(`LunaTools KB Nav: Processing key: ${event.key}`);
        this.navigate(direction);
      }
      navigate(direction) {
        if (this.isNavigating) return;
        const currentUrl = window.location.href;
        if (this.urlManager.shouldIgnore(currentUrl)) {
          // console.log(`LunaTools KB Nav: Ignoring URL: ${currentUrl}`);
          return;
        }
        this.isNavigating = true;
        const targetUrl = this.getTargetUrl(currentUrl, direction);
        if (targetUrl && targetUrl !== currentUrl) {
          // console.log(`LunaTools KB Nav: Navigating to: ${targetUrl}`);
          window.location.href = targetUrl;
          // State reset handled by pageshow/pagehide
        } else {
          // console.log("LunaTools KB Nav: Navigation failed.");
          this.resetNavigationState(); // Reset only if navigation doesn't proceed
        }
      }
      getTargetUrl(currentUrl, direction) {
        const patternInfo = this.urlManager.findPagePattern(currentUrl);
        if (patternInfo) {
          const updatedUrl = this.urlManager.updatePageInUrl(currentUrl, patternInfo, direction);
          return updatedUrl !== currentUrl ? updatedUrl : null;
        }
        const links = this.domMonitor.findNavigationLinks();
        if (direction > 0 && links.nextLink) return links.nextLink.href;
        if (direction < 0 && links.prevLink) return links.prevLink.href;
        return null;
      }
      resetNavigationState() {
         setTimeout(() => {
            this.isNavigating = false;
            // console.log("LunaTools KB Nav: Navigation state reset.");
         }, KB_NAV_CONFIG.navigation.RESET_DELAY);
      }
      cleanup() {
        console.log("LunaTools KB Nav: Cleaning up...");
        document.removeEventListener('keydown', this.handleKeydown);
        window.removeEventListener('pageshow', this.handlePageShow);
        window.removeEventListener('pagehide', this.handlePageHide); // Remove pagehide listener
        this.domMonitor.cleanup();
        this.urlManager.cleanup();
        if (this.processKeyDebounced?.cancel) this.processKeyDebounced.cancel();
        window.lunaToolsKbNavInitialized = false; // Reset initialization flag
      }
    }

    // === Initialize Keyboard Navigation ===
    new KB_NAV_KeyboardNavigator();

  } else {
      // Optional: Log if script is in an iframe and KB nav is skipped
      // console.log("LunaTools KB Nav: Skipping initialization in non-top frame.");
  }

  // =======================================================================
  // === LunaTools: PICTURE-IN-PICTURE (PiP) LOGIC (from User Script)    ===
  // =======================================================================
  console.log("LunaTools PiP: Helper (Ctrl+Shift+P, 강제 활성화 시도) 스크립트 로드됨.");

  // PiP 토글 함수
  async function togglePictureInPicture() {
      console.log("LunaTools PiP: Ctrl+Shift+P 감지됨. PiP 토글 시도...");

      // 현재 PiP 모드인 요소가 있는지 확인
      const currentPipElement = document.pictureInPictureElement;

      // 페이지 내의 모든 비디오 요소 찾기
      const videos = Array.from(document.querySelectorAll('video'));

      // 재생 중이고, 화면에 보이며, 소리가 꺼져있지 않은 비디오 필터링 (우선순위)
      let potentialVideos = videos.filter(video =>
          !video.paused && // 재생 중
          video.readyState > 2 && // 재생 준비 완료 (데이터 충분)
          video.offsetHeight > 0 && // 화면에 보임 (높이 존재)
          video.offsetWidth > 0 && // 화면에 보임 (너비 존재)
          !video.muted // 소리 켜짐 (광고 등이 아닐 확률 높음)
      );

      // 위 조건에 맞는 비디오가 없다면, 재생 중이고 화면에 보이는 비디오로 재시도
      if (potentialVideos.length === 0) {
          console.log("LunaTools PiP: 소리 켜진 재생 중인 비디오 없음. 보이는 재생 중 비디오 검색...");
          potentialVideos = videos.filter(video =>
              !video.paused &&
              video.readyState > 2 &&
              video.offsetHeight > 0 &&
              video.offsetWidth > 0
          );
      }

      // 그래도 없다면, 화면에 보이는 가장 큰 비디오 시도 (일시정지 상태일 수도 있음)
       if (potentialVideos.length === 0) {
           console.log("LunaTools PiP: 재생 중인 비디오 없음. 보이는 가장 큰 비디오 검색...");
           potentialVideos = videos.filter(video => video.offsetHeight > 0 && video.offsetWidth > 0)
                                   .sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
       }


      if (potentialVideos.length === 0 && !currentPipElement) {
          console.log("LunaTools PiP: PiP를 실행할 비디오를 찾을 수 없습니다.");
          // alert("PiP를 실행할 비디오를 찾을 수 없습니다. 비디오가 재생 중인지 확인해주세요."); // 사용자 요청에 따라 제거 가능
          return;
      }

      // 대상 비디오 선정 (가장 크기가 큰 비디오 우선)
      let targetVideo = potentialVideos.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight))[0];

      try {
          if (currentPipElement) {
              // 현재 PiP 모드 실행 중
              console.log("LunaTools PiP: 이미 PiP 모드 실행 중. 종료 시도:", currentPipElement);
              await document.exitPictureInPicture();
              console.log("LunaTools PiP: PiP 모드 종료됨.");
          } else if (targetVideo) {
               // PiP 모드 시작

               // PiP가 비활성화 되어 있다면 강제로 disablePictureInPicture 속성을 false로 변경 시도
               if (targetVideo.disablePictureInPicture) {
                   console.warn(`LunaTools PiP: 선택된 비디오(src: ${targetVideo.currentSrc || 'N/A'})에서 PiP가 비활성화되어 있었으나, 강제 활성화를 시도합니다.`);
                   try {
                       // 이 속성은 일반적으로 getter만 있고 setter가 없을 수 있습니다.
                       // 직접 할당하는 것이 효과가 없을 수 있지만, 시도는 해봅니다.
                       // 보다 확실한 방법은 Object.defineProperty를 사용하는 것이지만,
                       // 이는 웹페이지의 원래 JavaScript와 충돌할 가능성이 더 높습니다.
                       // 여기서는 간단하게 직접 할당을 시도합니다.
                       targetVideo.disablePictureInPicture = false;
                       console.log("LunaTools PiP: disablePictureInPicture 속성을 false로 변경 시도했습니다.");
                   } catch (e) {
                       console.error("LunaTools PiP: disablePictureInPicture 속성 변경 중 오류 발생 (예상 가능):", e.message);
                       // 속성 변경이 실패하더라도 PiP 요청은 계속 진행합니다.
                   }
               }

               console.log("LunaTools PiP: PiP 모드 시작 시도:", targetVideo);
               await targetVideo.requestPictureInPicture();
               console.log("LunaTools PiP: PiP 모드 시작됨.");

               // PiP 창이 닫힐 때 콘솔 로그 (선택사항)
               targetVideo.addEventListener('leavepictureinpicture', () => {
                  console.log('LunaTools PiP: PiP 모드가 사용자에 의해 닫혔습니다.');
               }, { once: true });

          } else {
               console.log("LunaTools PiP: PiP를 시작할 대상 비디오를 확정할 수 없습니다.");
          }
      } catch (error) {
          console.error("LunaTools PiP: PiP 작업 중 오류 발생:", error);
          if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
              alert(`PiP 실행이 차단되었습니다. 웹사이트 또는 브라우저 설정에 의해 PiP가 허용되지 않을 수 있습니다.\n오류: ${error.message}`);
          } else if (error.name === 'NotFoundError') {
               alert(`PiP를 실행할 비디오를 찾을 수 없거나, 비디오가 PiP를 지원하지 않는 상태입니다.\n오류: ${error.message}`);
          }
          else {
              alert(`PiP 작업 중 오류가 발생했습니다: ${error.message}`);
          }
      }
  }

  // 키보드 이벤트 리스너 추가
  document.addEventListener('keydown', function(event) {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') {
          // Check if the event target is an input, textarea, or contenteditable element
          const target = event.target;
          if (target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
              // console.log("LunaTools PiP: Ctrl+Shift+P ignored in input field.");
              return; // Don't trigger PiP if in an input field
          }
          event.preventDefault();
          togglePictureInPicture();
      }
  });

  console.log("LunaTools: PiP logic initialized.");


  console.log("LunaTools: Content script fully initialized (Gestures, Keyboard Nav & PiP).");

})(); // End of the main IIFE
