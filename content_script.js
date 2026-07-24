(async () => {
  'use strict';

  function normalizeHostname(value) {
    return String(value || '').trim().toLowerCase().replace(/\.+$/, '');
  }

  function isLikelyHostRule(entry) {
    return (
      /^[a-z0-9.-]+(?::\d+)?(?:[/?#].*)?$/i.test(entry) &&
      (
        entry.includes('.') ||
        /^localhost(?::|[/?#]|$)/i.test(entry) ||
        /^\d{1,3}(?:\.\d{1,3}){3}(?::|[/?#]|$)/.test(entry)
      )
    );
  }

  function parseSiteRule(rawRule, { allowPath = false } = {}) {
    const entry = String(rawRule || '').trim();
    if (!entry) return null;

    const hasHttpScheme = /^https?:\/\//i.test(entry);
    if (!hasHttpScheme && !isLikelyHostRule(entry)) return null;

    try {
      const parsed = new URL(hasHttpScheme ? entry : `https://${entry}`);
      const hostname = normalizeHostname(parsed.hostname);
      if (!hostname) return null;

      const pathname = allowPath && parsed.pathname && parsed.pathname !== '/'
        ? parsed.pathname.replace(/\/+$/, '')
        : '';

      return {
        hostname,
        pathname,
        search: allowPath ? parsed.search : '',
        hash: allowPath && parsed.hash ? parsed.hash.replace(/\/+$/, '') : ''
      };
    } catch (_) {
      return null;
    }
  }

  function matchesHostnameRule(currentHostname, ruleHostname) {
    const hostname = normalizeHostname(currentHostname);
    const rule = normalizeHostname(ruleHostname);
    return Boolean(rule) && (hostname === rule || hostname.endsWith(`.${rule}`));
  }

  function matchesLockedSiteRule(currentUrl, rawRule) {
    const rule = parseSiteRule(rawRule);
    return Boolean(rule && matchesHostnameRule(currentUrl.hostname, rule.hostname));
  }

  function includesSearchParameters(currentSearch, expectedSearch) {
    const currentParams = new URLSearchParams(currentSearch);
    const expectedParams = new URLSearchParams(expectedSearch);

    for (const key of new Set(expectedParams.keys())) {
      const unmatchedCurrentValues = currentParams.getAll(key);
      for (const expectedValue of expectedParams.getAll(key)) {
        // A rule such as "?v=" is commonly used as a URL-prefix rule and
        // means that the parameter must exist, regardless of its value.
        // Consume one occurrence so duplicate-key rules still retain their
        // multiplicity semantics.
        if (expectedValue === '') {
          if (unmatchedCurrentValues.length === 0) return false;
          unmatchedCurrentValues.shift();
          continue;
        }
        const matchingIndex = unmatchedCurrentValues.indexOf(expectedValue);
        if (matchingIndex === -1) return false;
        unmatchedCurrentValues.splice(matchingIndex, 1);
      }
    }
    return true;
  }

  function matchesBlockedSiteRule(currentUrl, rawRule) {
    const ruleText = String(rawRule || '').trim();
    if (!ruleText) return false;

    const structuredRule = parseSiteRule(ruleText, { allowPath: true });
    if (!structuredRule) {
      // Backward compatibility: non-host entries still work as URL keywords.
      return currentUrl.href.includes(ruleText);
    }

    if (!matchesHostnameRule(currentUrl.hostname, structuredRule.hostname)) {
      return false;
    }

    if (structuredRule.pathname) {
      const currentPath = (currentUrl.pathname.replace(/\/+$/, '') || '/');
      const expectedPath = structuredRule.pathname;
      if (currentPath !== expectedPath && !currentPath.startsWith(`${expectedPath}/`)) {
        return false;
      }
    }

    // A blocked URL rule describes a URL prefix/keyword. Extra query
    // parameters (including a different order) must not bypass the rule.
    if (structuredRule.search && !includesSearchParameters(currentUrl.search, structuredRule.search)) {
      return false;
    }

    if (structuredRule.hash) {
      const currentHash = currentUrl.hash.replace(/\/+$/, '');
      const expectedHash = structuredRule.hash;
      if (currentHash !== expectedHash && !currentHash.startsWith(`${expectedHash}/`)) {
        return false;
      }
    }

    return true;
  }

  const SITE_SETTINGS_RECHECK_INTERVAL_MS = 1000;
  let siteSettingsUnloadHandler = null;
  let siteSettingsRecheckerInitialized = false;
  let lastSiteSettingsHref = '';
  let siteSettingsCheckGeneration = 0;

  function isCurrentSiteSettingsCheck(checkGeneration, checkedHref) {
    return checkGeneration === siteSettingsCheckGeneration && window.location.href === checkedHref;
  }

  function setSiteLockEnabled(isEnabled) {
    if (isEnabled) {
      if (!siteSettingsUnloadHandler) {
        siteSettingsUnloadHandler = (event) => {
          event.preventDefault();
          event.returnValue = '';
        };
        window.addEventListener('beforeunload', siteSettingsUnloadHandler);
      }
      return;
    }

    if (siteSettingsUnloadHandler) {
      window.removeEventListener('beforeunload', siteSettingsUnloadHandler);
      siteSettingsUnloadHandler = null;
    }
  }

  async function applySiteSettingsAndCheckIfBlocked() {
    if (window.self !== window.top) {
      return false;
    }

    const checkGeneration = ++siteSettingsCheckGeneration;
    let currentUrl;
    try {
      currentUrl = new URL(window.location.href);
      lastSiteSettingsHref = currentUrl.href;
    } catch (_) {
      if (checkGeneration === siteSettingsCheckGeneration) {
        setSiteLockEnabled(false);
      }
      return false;
    }

    const checkedHref = currentUrl.href;

    try {
      const { lockedSites = [], blockedSites = [] } = await chrome.storage.sync.get(['lockedSites', 'blockedSites']);

      // A storage read can finish after an SPA navigation or a newer settings check.
      // Never apply a result that was calculated for an earlier URL/state.
      if (!isCurrentSiteSettingsCheck(checkGeneration, checkedHref)) {
        return false;
      }

      if (Array.isArray(blockedSites) && blockedSites.some(rule => matchesBlockedSiteRule(currentUrl, rule))) {
        setSiteLockEnabled(false);
        window.location.replace('about:blank');
        return true;
      }

      const shouldLock = Array.isArray(lockedSites) && lockedSites.some(rule => matchesLockedSiteRule(currentUrl, rule));
      setSiteLockEnabled(shouldLock);
    } catch (e) {
    }

    return false;
  }

  function initializeSiteSettingsRechecks() {
    if (siteSettingsRecheckerInitialized || window.self !== window.top) {
      return;
    }
    siteSettingsRecheckerInitialized = true;
    lastSiteSettingsHref = window.location.href;

    const recheckSiteSettings = () => {
      void applySiteSettingsAndCheckIfBlocked();
    };

    const recheckIfUrlChanged = () => {
      const currentHref = window.location.href;
      if (currentHref !== lastSiteSettingsHref) {
        lastSiteSettingsHref = currentHref;
        recheckSiteSettings();
      }
    };

    window.addEventListener('pageshow', recheckSiteSettings, true);
    window.addEventListener('popstate', recheckSiteSettings, true);
    window.addEventListener('hashchange', recheckSiteSettings, true);
    document.addEventListener('visibilitychange', recheckIfUrlChanged, true);
    setInterval(recheckIfUrlChanged, SITE_SETTINGS_RECHECK_INTERVAL_MS);

    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'sync') return;
        if (changes.lockedSites || changes.blockedSites) {
          recheckSiteSettings();
        }
      });
    } catch (_) {
    }

    // The URL may have changed while the document-start storage read was pending,
    // before the SPA listeners above existed. Revalidate the current URL once now.
    recheckSiteSettings();
  }

  const isBlocked = await applySiteSettingsAndCheckIfBlocked();
  
  if (isBlocked) {
    return;
  }

  initializeSiteSettingsRechecks();

  class MouseGestureHandler {
    static MIN_DRAG_DISTANCE_SQ = 100;
    static MIN_FINAL_DISTANCE_SQ = 625;
    static MESSAGE_ACTION = 'perform-gesture';
    static RIGHT_MOUSE_BUTTON = 2;

    constructor() {
      this.isMouseDown = false;
      this.startX = 0;
      this.startY = 0;
      this.didMove = false;
      this.isTrustedSequence = false;
      this.suppressNextContextMenu = false;

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

    _resetPointerState() {
      this.isMouseDown = false;
      this.didMove = false;
      this.isTrustedSequence = false;
    }

    _resetState() {
      this._resetPointerState();
      this.suppressNextContextMenu = false;
    }

    handleMouseDown(event) {
      if (!event.isTrusted) return;
      if (event.button !== MouseGestureHandler.RIGHT_MOUSE_BUTTON) return;

      this.isMouseDown = true;
      this.isTrustedSequence = true;
      this.startX = event.clientX;
      this.startY = event.clientY;
      this.didMove = false;
      this.suppressNextContextMenu = false;
    }

    handleMouseMove(event) {
      if (!event.isTrusted || !this.isTrustedSequence) return;
      if (!this.isMouseDown || this.didMove) return;

      const deltaX = event.clientX - this.startX;
      const deltaY = event.clientY - this.startY;
      if ((deltaX ** 2 + deltaY ** 2) > MouseGestureHandler.MIN_DRAG_DISTANCE_SQ) {
        this.didMove = true;
      }
    }

    handleMouseUp(event) {
      if (!event.isTrusted || !this.isTrustedSequence) return;
      if (!this.isMouseDown) return;
      if (event.button !== MouseGestureHandler.RIGHT_MOUSE_BUTTON) {
        this._resetState();
        return;
      }

      const hadGestureLikeDrag = this.didMove;
      const gestureDirection = this._determineGestureDirection(event.clientX, event.clientY);

      if (gestureDirection) {
        this.suppressNextContextMenu = true;
        this._sendGestureMessage(gestureDirection);
      } else if (hadGestureLikeDrag) {
        this.suppressNextContextMenu = true;
      }

      this._resetPointerState();
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
      }
    }

    handleContextMenu(event) {
      if (!event.isTrusted) return;
      if (this.didMove || this.suppressNextContextMenu) {
        event.preventDefault();
      }
      this._resetState();
    }

    handleBlur(event) {
      if (!event.isTrusted) return;
      if (this.isMouseDown || this.suppressNextContextMenu) {
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

  if (window.self === window.top) {
    const KB_NAV_CONFIG = Object.freeze({
      cache: { MAX_SIZE: 100, MAX_AGE_MS: 30 * 60 * 1000 },
      navigation: {
        RESET_DELAY_MS: 150,
        NAVIGATION_FALLBACK_RESET_MS: 2000,
        MIN_PAGE: 1,
        MAX_PAGE: 9999,
        DEBOUNCE_DELAY_MS: 100,
        ALLOWED_PROTOCOLS: new Set(['http:', 'https:'])
      },
      observer: {
        TARGET_SELECTORS: ['nav[aria-label="pagination"]', '.pagination', '#pagination'],
        FALLBACK_TARGET_SELECTORS: ['main', '#main', '#content', 'article', 'body'],
        DEBOUNCE_DELAY_MS: 100,
        MAX_OBSERVE_TIME_MS: 30 * 1000,
        REACTIVATION_INTERVAL_MS: 5 * 60 * 1000,
        REACTIVATION_THROTTLE_MS: 1000
      },
      patterns: {
        pageQueryKeys: ['page', 'po', 'p'],
        pagePath: /(?:^|\/)page\/(\d{1,4})(?=[/?#]|$)/i,
        datePath: /\/(\d{4})\/(\d{1,2})\/(\d{1,2})(\/?)(?=[?#]|$)/,
        datePathPrefix: /\/\d{4}\/\d{1,2}\/\d{1,2}(?=\/|[?#]|$)/,
        // Intentional: nested numeric path segments (for example, /products/42/reviews)
        // are valid navigation targets for this feature. Do not restrict this to root paths.
        numericPath: /\/(\d{1,4})(?:[/?#]|$)/i,
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
      },
      normalizeNavigationUrl(candidateUrl) {
        if (!candidateUrl) return null;

        try {
          const parsed = new URL(String(candidateUrl), window.location.href);
          if (!KB_NAV_CONFIG.navigation.ALLOWED_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) return null;
          if (parsed.username || parsed.password) return null;
          return parsed.href;
        } catch (_) {
          return null;
        }
      },
      isSafeNavigableUrl(candidateUrl) {
        return this.normalizeNavigationUrl(candidateUrl) !== null;
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
      _createPagePatternInfo(url, pattern) {
        const match = pattern.exec(url);
        if (!match || !match[1]) return null;

        const pageNumber = parseInt(match[1], 10);
        if (isNaN(pageNumber) || pageNumber < KB_NAV_CONFIG.navigation.MIN_PAGE || pageNumber > KB_NAV_CONFIG.navigation.MAX_PAGE) {
          return null;
        }

        return { kind: 'page', regex: pattern, currentPage: pageNumber, originalMatch: match[0] };
      }
      _createDatePatternInfo(url) {
        const match = KB_NAV_CONFIG.patterns.datePath.exec(url);
        if (!match) return undefined;

        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);
        const day = parseInt(match[3], 10);
        if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
          return null;
        }

        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
          return null;
        }

        return {
          kind: 'date',
          year,
          month,
          day,
          monthWidth: match[2].length,
          dayWidth: match[3].length,
          trailingSlash: match[4],
          originalMatch: match[0]
        };
      }
      findPagePattern(url) {
        const cachedResult = this.urlPatternCache.get(url);
        if (cachedResult !== undefined) return cachedResult;

        let parsedUrl;
        try {
          parsedUrl = new URL(url);
        } catch (_) {
          this.urlPatternCache.set(url, null);
          return null;
        }

        // Read only top-level query parameters. A nested URL such as
        // ?redirect=https://example.com/?page=2 must not become pagination.
        const queryEntries = Array.from(parsedUrl.searchParams.entries());
        for (const expectedKey of KB_NAV_CONFIG.patterns.pageQueryKeys) {
          const queryEntry = queryEntries.find(([key]) => key.toLowerCase() === expectedKey);
          if (!queryEntry) continue;

          const [queryKey, rawPageNumber] = queryEntry;
          if (!/^\d{1,4}$/.test(rawPageNumber)) continue;
          const currentPage = parseInt(rawPageNumber, 10);
          if (currentPage < KB_NAV_CONFIG.navigation.MIN_PAGE || currentPage > KB_NAV_CONFIG.navigation.MAX_PAGE) continue;

          const patternInfo = {
            kind: 'query',
            queryKey,
            currentPage,
            pageWidth: rawPageNumber.length
          };
          this.urlPatternCache.set(url, patternInfo);
          return patternInfo;
        }

        const pathname = parsedUrl.pathname;

        // Path patterns must only inspect the pathname. Otherwise a URL placed
        // inside an unrelated query value (for example ?redirect=/page/2)
        // can be mistaken for the current page's own pagination route.
        const pathPagePatternInfo = this._createPagePatternInfo(pathname, KB_NAV_CONFIG.patterns.pagePath);
        if (pathPagePatternInfo) {
          this.urlPatternCache.set(url, pathPagePatternInfo);
          return pathPagePatternInfo;
        }

        // 연/월/일 경로는 가장 앞의 연도를 일반 페이지 번호로 오인하지 않고
        // 실제 달력 날짜로 처리합니다. 잘못된 날짜도 숫자 경로로 재해석하지 않습니다.
        const datePatternInfo = this._createDatePatternInfo(pathname);
        if (datePatternInfo !== undefined) {
          this.urlPatternCache.set(url, datePatternInfo);
          return datePatternInfo;
        }

        // A common article URL such as /2026/07/02/post-name contains a date
        // but is not itself a day-by-day archive URL. Never reinterpret its
        // leading year as a generic page number; allow rel=next/prev discovery
        // to handle the page instead.
        if (KB_NAV_CONFIG.patterns.datePathPrefix.test(pathname)) {
          this.urlPatternCache.set(url, null);
          return null;
        }

        const numericPatternInfo = this._createPagePatternInfo(pathname, KB_NAV_CONFIG.patterns.numericPath);
        if (numericPatternInfo) {
          this.urlPatternCache.set(url, numericPatternInfo);
          return numericPatternInfo;
        }

        this.urlPatternCache.set(url, null);
        return null;
      }
      generateNewUrl(currentUrl, patternInfo, direction) {
        if (patternInfo.kind === 'date') {
          const { year, month, day, monthWidth, dayWidth, trailingSlash, originalMatch } = patternInfo;
          const nextDate = new Date(Date.UTC(year, month - 1, day));
          nextDate.setUTCDate(nextDate.getUTCDate() + direction);

          const nextYear = nextDate.getUTCFullYear();
          if (nextYear < 1000 || nextYear > 9999) return currentUrl;

          const nextMonth = String(nextDate.getUTCMonth() + 1).padStart(monthWidth, '0');
          const nextDay = String(nextDate.getUTCDate()).padStart(dayWidth, '0');
          const nextDatePath = `/${String(nextYear).padStart(4, '0')}/${nextMonth}/${nextDay}${trailingSlash}`;
          return currentUrl.replace(originalMatch, nextDatePath);
        }

        if (patternInfo.kind === 'query') {
          const { currentPage, queryKey, pageWidth } = patternInfo;
          const newPage = Math.min(
            KB_NAV_CONFIG.navigation.MAX_PAGE,
            Math.max(KB_NAV_CONFIG.navigation.MIN_PAGE, currentPage + direction)
          );
          if (newPage === currentPage) return currentUrl;

          try {
            const parsedUrl = new URL(currentUrl);
            parsedUrl.searchParams.set(queryKey, String(newPage).padStart(pageWidth, '0'));
            return parsedUrl.href;
          } catch (_) {
            return currentUrl;
          }
        }

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
        this.observer = new MutationObserver((mutations) => {
          if (!this.isObserving) return;
          if (mutations.some(mutation => mutation.type === 'attributes')) {
            this._debouncedInvalidateCache.cancel();
            this.cachedLinks = null;
            return;
          }
          this._debouncedInvalidateCache();
        });
        this.startObserving();
      }
      _findObserverTarget() {
        // A pagination element can be replaced wholesale by an SPA. Observe a
        // stable document root so removal and replacement both invalidate links.
        this.observerTarget = document.documentElement || document.body;
      }
      startObserving() {
        if (!this.observerTarget?.isConnected) {
          this._findObserverTarget();
        }
        if (this.observer && this.observerTarget && !this.isObserving) {
          try {
            // Mutations may have happened while the lifecycle observer was off.
            this.cachedLinks = null;
            this.observer.observe(this.observerTarget, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['href', 'rel', 'hidden']
            });
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
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        if (element.isContentEditable) return true;

        const tagName = String(element.tagName || '').toUpperCase();
        if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tagName)) {
          return !element.disabled;
        }
        if (['VIDEO', 'AUDIO', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT'].includes(tagName)) {
          return true;
        }

        const role = String(element.getAttribute?.('role') || '').toLowerCase();
        const arrowKeyRoles = new Set([
          'application', 'combobox', 'grid', 'gridcell', 'listbox', 'menu', 'menubar',
          'menuitem', 'option', 'radio', 'searchbox', 'slider', 'spinbutton', 'tab',
          'tablist', 'textbox', 'tree', 'treegrid', 'treeitem'
        ]);
        if (arrowKeyRoles.has(role)) return true;

        return Boolean(element.matches?.('.CodeMirror, .monaco-editor, .ace_editor'));
      }
      findNavigationLinks() {
        if (this.cachedLinks) return this.cachedLinks;
        const links = Array.from(document.querySelectorAll('a[rel][href], link[rel][href]'));
        let nextUrl = null;
        let prevUrl = null;

        const isUsableRelElement = (element) => {
          if (element.tagName === 'LINK') return true;
          if (element.offsetParent) return true;
          return element.getClientRects?.().length > 0;
        };

        for (const link of links) {
          const safeHref = KB_NAV_Utils.normalizeNavigationUrl(link.getAttribute('href') || link.href);
          if (!safeHref || safeHref === window.location.href || !isUsableRelElement(link)) continue;

          const relTokens = new Set(String(link.rel || link.getAttribute('rel') || '')
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean));
          if (relTokens.has('next') && !nextUrl) nextUrl = safeHref;
          if (relTokens.has('prev') && !prevUrl) prevUrl = safeHref;
          if (nextUrl && prevUrl) break;
        }

        this.cachedLinks = { nextUrl, prevUrl };
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
        this.navigationResetTimer = null;
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
          this._handleNavigationSettled = this._handleNavigationSettled.bind(this);
      }
      _initializeEventListeners() {
        document.addEventListener('keydown', this._handleKeyDown);
        window.addEventListener('pageshow', this._handlePageShow);
        window.addEventListener('pagehide', this._handlePageHide);
        window.addEventListener('hashchange', this._handleNavigationSettled);
        window.addEventListener('popstate', this._handleNavigationSettled);
      }
      _handlePageShow(event) {
        if (event.persisted) {
          this._handleNavigationSettled();
        }
      }
      _handleNavigationSettled() {
        this._clearNavigationResetTimer();
        this.isNavigating = false;
        this.urlPageFinder.clearCache();
        this.domLinkFinder.destroy();
        this.domLinkFinder = new KB_NAV_DomLinkFinder();
      }
      _handlePageHide(event) {
          if (!event.persisted) {
              this.destroy();
          }
      }
      _handleKeyDown(event) {
        if (!event.isTrusted) return;
        if (!KeyboardPageNavigator.NAV_KEYS_SET.has(event.key)) return;
        if (this._shouldIgnoreKeyEvent(event)) return;
        const direction = event.key === KeyboardPageNavigator.KEY_ARROW_RIGHT ? 1 : -1;

        const currentUrl = window.location.href;
        if (this.urlPageFinder.shouldIgnoreUrl(currentUrl)) return;

        const targetUrl = this._determineTargetUrl(currentUrl, direction);
        const safeTargetUrl = KB_NAV_Utils.normalizeNavigationUrl(targetUrl);
        if (!safeTargetUrl || safeTargetUrl === currentUrl) return;

        event.preventDefault();
        event.stopPropagation();
        this._debouncedProcessKey(direction);
      }
      _shouldIgnoreKeyEvent(event) {
        // Shift+Arrow is a native text-selection command even when focus is
        // outside a form control. Only unmodified arrow keys navigate pages.
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented || event.isComposing) return true;

        const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : [];
        const candidates = [...eventPath, event.target, document.activeElement];
        return candidates.some(candidate => this.domLinkFinder.isElementFocusableInput(candidate));
      }
      _processNavigationKey(direction) {
        if (this.isNavigating) return;
        const currentUrl = window.location.href;
        if (this.urlPageFinder.shouldIgnoreUrl(currentUrl)) {
          return;
        }
        const targetUrl = this._determineTargetUrl(currentUrl, direction);
        const safeTargetUrl = KB_NAV_Utils.normalizeNavigationUrl(targetUrl);
        if (safeTargetUrl && safeTargetUrl !== currentUrl) {
          this.isNavigating = true;
          try {
            window.location.assign(safeTargetUrl);
            // Full-document navigation destroys this context. Same-document
            // navigation fires hashchange/popstate. If navigation is cancelled,
            // this fallback prevents a permanent keyboard-navigation lock.
            this._resetNavigationFlagAfterDelay(KB_NAV_CONFIG.navigation.NAVIGATION_FALLBACK_RESET_MS);
          } catch (_) {
            this._resetNavigationFlagAfterDelay();
          }
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
        if (direction > 0 && domLinks.nextUrl) return domLinks.nextUrl;
        if (direction < 0 && domLinks.prevUrl) return domLinks.prevUrl;
        return null;
      }
      _clearNavigationResetTimer() {
        if (this.navigationResetTimer !== null) {
          clearTimeout(this.navigationResetTimer);
          this.navigationResetTimer = null;
        }
      }
      _resetNavigationFlagAfterDelay(delayMs = KB_NAV_CONFIG.navigation.RESET_DELAY_MS) {
        this._clearNavigationResetTimer();
        this.navigationResetTimer = setTimeout(() => {
          this.navigationResetTimer = null;
          this.isNavigating = false;
        }, delayMs);
      }
      destroy() {
        document.removeEventListener('keydown', this._handleKeyDown);
        window.removeEventListener('pageshow', this._handlePageShow);
        window.removeEventListener('pagehide', this._handlePageHide);
        window.removeEventListener('hashchange', this._handleNavigationSettled);
        window.removeEventListener('popstate', this._handleNavigationSettled);
        this._clearNavigationResetTimer();
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

  class PictureInPictureHandler {
    static PIP_RESTRICTED_ATTRIBUTES = ['disablePictureInPicture'];
    static PIP_KEY = 'P';
    static EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

    constructor() {
      this._overrideStates = new WeakMap();
      this._isToggling = false;
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

    _captureVideoState(videoElement) {
      const attributeStates = new Map();
      PictureInPictureHandler.PIP_RESTRICTED_ATTRIBUTES.forEach(attr => {
        attributeStates.set(attr, {
          present: videoElement.hasAttribute(attr),
          value: videoElement.getAttribute(attr)
        });
      });

      return {
        attributeStates,
        hadOwnDisablePictureInPicture: Object.prototype.hasOwnProperty.call(videoElement, 'disablePictureInPicture'),
        ownDisablePictureInPictureDescriptor: Object.getOwnPropertyDescriptor(videoElement, 'disablePictureInPicture'),
        disablePictureInPictureValue: Boolean(videoElement.disablePictureInPicture),
        muted: videoElement.muted,
        paused: videoElement.paused,
        playbackChanged: false,
        restored: false
      };
    }

    _removePiPRestrictions(videoElement) {
        PictureInPictureHandler.PIP_RESTRICTED_ATTRIBUTES.forEach(attr => {
            if (videoElement.hasAttribute(attr)) {
                try {
                    videoElement.removeAttribute(attr);
                } catch (e) {
                }
            }
        });
    }

    _restoreVideoState(videoElement, state) {
      if (!state || state.restored) return;
      state.restored = true;

      for (const [attr, attrState] of state.attributeStates) {
        try {
          if (attrState.present) {
            videoElement.setAttribute(attr, attrState.value ?? '');
          } else {
            videoElement.removeAttribute(attr);
          }
        } catch (_) {
        }
      }

      try {
        if (state.hadOwnDisablePictureInPicture && state.ownDisablePictureInPictureDescriptor) {
          Object.defineProperty(videoElement, 'disablePictureInPicture', state.ownDisablePictureInPictureDescriptor);
        } else {
          delete videoElement.disablePictureInPicture;
        }
      } catch (_) {
        try {
          videoElement.disablePictureInPicture = state.disablePictureInPictureValue;
        } catch (_) {
        }
      }

      if (state.playbackChanged) {
        try {
          videoElement.muted = state.muted;
        } catch (_) {
        }
        if (state.paused && !videoElement.paused) {
          try {
            videoElement.pause();
          } catch (_) {
          }
        }
      }

      this._overrideStates.delete(videoElement);
    }

    async _ensureVideoReady(videoElement) {
      if (!videoElement) {
        return;
      }
      if (videoElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
        return;
      }
      if (videoElement.readyState < HTMLMediaElement.HAVE_METADATA) {
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
                }
            }
        }
        await targetVideo.requestPictureInPicture();
    }

    async toggle() {
      if (this._isToggling) return;
      this._isToggling = true;

      try {
        if (document.pictureInPictureElement) {
          const activeVideo = document.pictureInPictureElement;
          try {
            await document.exitPictureInPicture();
          } catch (error) {
          }
          if (document.pictureInPictureElement !== activeVideo) {
            this._restoreVideoState(activeVideo, this._overrideStates.get(activeVideo));
          }
          return;
        }

        const targetVideo = this._findBestVideoCandidate();
        if (!targetVideo) {
          return;
        }

        await this._ensureVideoReady(targetVideo);
        const overrideState = this._captureVideoState(targetVideo);
        this._overrideStates.set(targetVideo, overrideState);
        this._removePiPRestrictions(targetVideo);
        let enteredPictureInPicture = false;

        try {
          if (targetVideo.paused && (targetVideo.videoWidth < 100 || targetVideo.videoHeight < 100)) {
              try {
                  overrideState.playbackChanged = true;
                  targetVideo.muted = true;
                  await targetVideo.play();
              } catch(playError) {
              }
          }

          await targetVideo.requestPictureInPicture();
          enteredPictureInPicture = true;
          this._addLeavePiPListener(targetVideo, overrideState);
        } catch (initialError) {
          const isPipDisabledError = initialError.name === 'InvalidStateError' &&
                                     (initialError.message.includes('disablePictureInPicture') ||
                                      initialError.message.toLowerCase().includes('picture-in-picture is disabled'));

          if (isPipDisabledError) {
              try {
                  await this._attemptEnterPiPWithOverrides(targetVideo);
                  enteredPictureInPicture = true;
                  this._addLeavePiPListener(targetVideo, overrideState);
              } catch (finalAttemptError) {
              }
          } else {
          }
        } finally {
          if (!enteredPictureInPicture) {
            this._restoreVideoState(targetVideo, overrideState);
          }
        }
      } finally {
        this._isToggling = false;
      }
    }

    _addLeavePiPListener(videoElement, overrideState) {
        videoElement.addEventListener('leavepictureinpicture', () => {
          this._restoreVideoState(videoElement, overrideState);
        }, { once: true });
    }

    _isEditableEventTarget(target) {
      if (!(target instanceof Element)) return false;

      const editableElement = target.closest('input, textarea, select, [contenteditable], [role="textbox"]');
      if (!editableElement) return false;

      const tagName = editableElement.tagName?.toUpperCase();
      if (PictureInPictureHandler.EDITABLE_TAGS.has(tagName)) return true;
      if (editableElement.getAttribute('role') === 'textbox') return true;

      const contentEditableValue = editableElement.getAttribute('contenteditable');
      return editableElement.isContentEditable ||
        (contentEditableValue !== null && contentEditableValue.toLowerCase() !== 'false');
    }

    _handleKeyDown(event) {
      if (!event.isTrusted || event.repeat) return;
      if (!(event.ctrlKey && event.shiftKey && event.key.toUpperCase() === PictureInPictureHandler.PIP_KEY)) {
        return;
      }
      if (this._isEditableEventTarget(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void this.toggle().catch(error => console.warn('LunaTools: PiP 전환 실패', error));
    }

    destroy() {
      document.removeEventListener('keydown', this._boundHandleKeyDown, true);
    }
  }

  new PictureInPictureHandler();


  (() => {
    'use strict';

    const Config = {
        EXCHANGE_RATE_CACHE_DURATION_MS: 24 * 60 * 60 * 1000,
        EXCHANGE_RATE_STORAGE_KEY: 'lunaToolsExchangeRateTableV1',
        EXCHANGE_RATE_BASE_CURRENCY: 'EUR',
        EXCHANGE_RATE_FETCH_ACTION: 'fetchLunaToolsExchangeRate',
        EXCHANGE_RATE_REFRESH_ACTION: 'refreshLunaToolsExchangeRateTable',
        FIXED_EURO_CONVERSION_RATES: Object.freeze({ BGN: 1.95583 }),
        POPUP_OFFSET_X: 10,
        POPUP_OFFSET_Y: 10,
        POPUP_SCREEN_MARGIN: 10,
        DEFAULT_TARGET_CURRENCY: 'KRW',
        KOREAN_NUMERALS_MAP: { '일': '1', '이': '2', '삼': '3', '사': '4', '오': '5', '육': '6', '칠': '7', '팔': '8', '구': '9' },
        KOREAN_MAJOR_UNITS: [
            { name: '조', value: 1000000000000 },
            { name: '억', value: 100000000 },
            { name: '만', value: 10000 }
        ],
        KOREAN_SUB_UNITS: [{ name: '천', value: 1000 }, { name: '백', value: 100 }],
        // [수정됨] finance/press style suffixes(bn/bln/mn/mln/tn/tln) 추가
        MAGNITUDE_WORDS_EN: {
            'thousand': 1000, 'million': 1000000, 'billion': 1000000000, 'trillion': 1000000000000,
            'mn': 1000000, 'mln': 1000000,
            'bn': 1000000000, 'bln': 1000000000,
            'tn': 1000000000000, 'tln': 1000000000000
        },
        CURRENCY_FLAGS: {
            'USD': '🇺🇸', 'EUR': '🇪🇺', 'JPY': '🇯🇵', 'GBP': '🇬🇧', 'AUD': '🇦🇺', 'CAD': '🇨🇦', 'CHF': '🇨🇭', 'CNY': '🇨🇳', 'HKD': '🇭🇰', 'NZD': '🇳🇿', 'SEK': '🇸🇪', 'KRW': '🇰🇷', 'SGD': '🇸🇬', 'NOK': '🇳🇴', 'MXN': '🇲🇽', 'INR': '🇮🇳', 'ZAR': '🇿🇦', 'TRY': '🇹🇷', 'BRL': '🇧🇷', 'DKK': '🇩🇰', 'PLN': '🇵🇱', 'THB': '🇹🇭', 'IDR': '🇮🇩', 'HUF': '🇭🇺', 'CZK': '🇨🇿', 'ILS': '🇮🇱', 'PHP': '🇵🇭', 'MYR': '🇲🇾', 'RON': '🇷🇴', 'BGN': '🇧🇬', 'ISK': '🇮🇸',
        },
        UNIT_CATEGORY_ICONS: {
            length: '📏', mass: '⚖️', volume: '💧', temperature: '🌡️', time: '🕒',
            area: '📐', digital_storage: '💾', data_rate: '⚡️', speed: '🚗', pressure: '💨'
        },
        CATEGORY_BASE_UNITS: { length: 'm', mass: 'kg', volume: 'L', area: 'm²' },
        CURRENCY_PATTERNS: [
            { code: 'CAD', regex: /캐나다\s*달러|캐나다달러|C\$|CAD/giu }, { code: 'AUD', regex: /호주\s*달러|호주달러|A\$|AUD/giu }, { code: 'CHF', regex: /스위스\s*프랑|스위스프랑|CHF|SFr\./giu }, { code: 'SGD', regex: /싱가포르\s*달러|싱가포르달러|S\$|SGD/giu }, { code: 'HKD', regex: /홍콩\s*달러|홍콩달러|HK\$|HKD/giu }, { code: 'NZD', regex: /뉴질랜드\s*달러|뉴질랜드달러|NZ\$|NZD/giu }, { code: 'MXN', regex: /멕시코\s*페소|멕시코페소|Mex\$|MXN/giu }, { code: 'BRL', regex: /브라질\s*헤알|헤알|R\$|BRL/giu }, { code: 'PHP', regex: /필리핀\s*페소|필리핀페소|₱|PHP/giu }, { code: 'MYR', regex: /말레이시아\s*링깃|링깃|RM|MYR/giu }, { code: 'GBP', regex: /파운드\s*스털링|영국\s*파운드|GBP\s*[£￡]|[£￡]\s*GBP/giu }, { code: 'JPY', regex: /엔|엔화|円|[¥￥]|JPY|일본\s*엔|일본\s*엔화/giu }, { code: 'EUR', regex: /유로|€|EUR/giu }, { code: 'CNY', regex: /위안|위안화|元|CNY|중국\s*위안|인민폐|런민비/giu }, { code: 'KRW', regex: /원|₩|KRW|한국\s*원|대한민국\s*원/giu }, { code: 'INR', regex: /인도\s*루피|인도루피|루피(?!아)|₹|Rs\.?|INR/giu }, { code: 'TRY', regex: /터키\s*리라|튀르키예\s*리라|리라|₺|TRY/giu }, { code: 'IDR', regex: /인도네시아\s*루피아|루피아|Rp|IDR/giu }, { code: 'PLN', regex: /폴란드\s*즐로티|즐로티|zł|PLN/giu }, { code: 'ILS', regex: /이스라엘\s*셰켈|셰켈|₪|ILS/giu }, { code: 'THB', regex: /태국\s*바트|바트|밧|฿|THB/giu }, { code: 'SEK', regex: /스웨덴\s*크로나|스웨덴크로나|SEK(?:kr)?|(?:krSEK)/giu }, { code: 'NOK', regex: /노르웨이\s*크로나|노르웨이크로나|NOK(?:kr)?|(?:krNOK)/giu }, { code: 'DKK', regex: /덴마크\s*크로나|덴마크크로나|DKK(?:kr)?|(?:krDKK)/giu }, { code: 'ISK', regex: /아이슬란드\s*크로나|아이슬란드크로나|ISK(?:kr)?|(?:krISK)/giu }, 
            // [수정됨] ZAR의 R을 단어 경계(\b)로 감쌈
            { code: 'ZAR', regex: /남아프리카\s*공화국\s*랜드|남아공\s*랜드|랜드|\bR\b|ZAR/giu }, 
            { code: 'RON', regex: /루마니아\s*레우|레우|lei|RON/giu }, { code: 'CZK', regex: /체코\s*코루나|코루나|Kč|CZK/giu }, { code: 'HUF', regex: /헝가리\s*포린트|포린트|Ft|HUF/giu }, { code: 'BGN', regex: /불가리아\s*레프|레프|лв|BGN/giu }, { code: 'GBP', regex: /파운드|[£￡]|GBP/giu }, { code: 'USD', regex: /달러|[\$＄]|USD|불|미국\s*달러/giu },
        ],
        UNIT_CONVERSION_CONFIG: {
            length: [
                { names: ['inch', 'inches', 'in', '"', '인치'], target_unit_code: 'cm', factor: 2.54, to_base_unit_factor: 0.0254, regex: /([\d\.,]+)\s*(inch(?:es)?|in|"|인치)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:²|\^\s*2))/giu, additional_outputs: [{ unit: 'ft', from_base_unit_factor: 1/0.3048, precision: 3 }, { unit: 'm', from_base_unit_factor: 1, precision: 3 }], category: 'length' },
                { names: ['foot', 'feet', 'ft', "'", '피트'], target_unit_code: 'm', factor: 0.3048, to_base_unit_factor: 0.3048, regex: /([\d\.,]+)\s*(foot|feet|ft|'|피트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:²|\^\s*2))/giu, additional_outputs: [{ unit: 'cm', from_base_unit_factor: 100, precision: 1 }, { unit: 'inch', from_base_unit_factor: 1/0.0254, precision: 2 }], category: 'length' },
                { names: ['yard', 'yards', 'yd', '야드'], target_unit_code: 'm', factor: 0.9144, to_base_unit_factor: 0.9144, regex: /([\d\.,]+)\s*(yard(?:s)?|yd|야드)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:²|\^\s*2))/giu, category: 'length' },
                { names: ['mile', 'miles', 'mi', '마일'], target_unit_code: 'km', factor: 1.60934, to_base_unit_factor: 1609.34, regex: /([\d\.,]+)\s*(mile(?:s)?|mi|마일)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:²|\^\s*2|\/\s*h\b|per\s+hour\b))/giu, category: 'length' },
                { names: ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres', '밀리미터'], target_unit_code: 'inch', factor: 1/25.4, to_base_unit_factor: 0.001, regex: /([\d\.,]+)\s*(mm|millimet(?:er|re)s?|밀리미터)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:²|\^\s*2|\/\s*s\b|per\s+second\b))/giu, is_metric: true, target_unit_name: '인치', category: 'length', target_precision: 2 },
                { names: ['cm', '센티미터', '센치'], target_unit_code: 'inch', factor: 1/2.54, to_base_unit_factor: 0.01, regex: /([\d\.,]+)\s*(cm|센티미터|센치)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, is_metric: true, target_unit_name: '인치', additional_outputs: [{unit: 'm', from_base_unit_factor: 1, precision: 3}], category: 'length' },
                { names: ['m', '미터'], target_unit_code: 'ft', factor: 1/0.3048, to_base_unit_factor: 1, regex: /([\d\.,]+)\s*(m|미터)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:²|\^\s*2|\/\s*s\b|per\s+second\b))(?!i)(?!l)(?!o)(?!y)(?!a)(?!k)/giu, is_metric: true, target_unit_name: '피트', additional_outputs: [{unit: 'km', from_base_unit_factor: 0.001, precision:4}, {unit: 'inch', from_base_unit_factor: 1/0.0254, precision:1}], category: 'length' },
                { names: ['km', '킬로미터'], target_unit_code: 'mile', factor: 1/1.60934, to_base_unit_factor: 1000, regex: /([\d\.,]+)\s*(km|킬로미터)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:²|\^\s*2|\/\s*(?:h|s)\b|per\s+(?:hour|second)\b))/giu, is_metric: true, target_unit_name: '마일', additional_outputs: [{unit: 'm', from_base_unit_factor: 1, precision:0}], category: 'length' },
            ],
            mass: [
                { names: ['ounce', 'ounces', 'oz', '온스'], target_unit_code: 'g', factor: 28.3495, to_base_unit_factor: 0.0283495, regex: /([\d\.,]+)\s*(ounce(?:s)?|oz|온스)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, category: 'mass', target_precision: 0 },
                { names: ['lb', 'lbs'], target_unit_code: 'kg', factor: 0.453592, to_base_unit_factor: 0.453592, regex: /([\d\.,]+)\s*(lb(?:s)?)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, id: 'lb', category: 'mass' },
                { names: ['pound', 'pounds', '파운드'], target_unit_code: 'kg', factor: 0.453592, to_base_unit_factor: 0.453592, regex: /([\d\.,]+)\s*(파운드|pound(?:s)?)(?!\s*스털링)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, id: 'pound_mass_word', category: 'mass' },
                { names: ['g', '그램'], target_unit_code: 'oz', factor: 1/28.3495, to_base_unit_factor: 0.001, regex: /([\d\.,]+)\s*(g|그램)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!a)(?!p)/giu, is_metric: true, target_unit_name: '온스', category: 'mass' },
                { names: ['kg', '킬로그램'], target_unit_code: 'lb', factor: 1/0.453592, to_base_unit_factor: 1, regex: /([\d\.,]+)\s*(kg|킬로그램)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, is_metric: true, target_unit_name: '파운드', category: 'mass' },
            ],
            volume: [
                { names: ['fluid ounce', '액량온스', 'fl oz'], target_unit_code: 'mL', factor: 29.5735, to_base_unit_factor: 0.0295735, regex: /([\d\.,]+)\s*(fl(?:uid)?\s*oz\.?|액량온스|플루이드온스)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, category: 'volume', target_precision: 0 },
                { names: ['pint', 'pints', 'pt', '파인트'], target_unit_code: 'L', factor: 0.473176, to_base_unit_factor: 0.473176, regex: /([\d\.,]+)\s*(pint(?:s)?|pt|파인트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, category: 'volume' },
                { names: ['quart', 'quarts', 'qt', '쿼트'], target_unit_code: 'L', factor: 0.946353, to_base_unit_factor: 0.946353, regex: /([\d\.,]+)\s*(quart(?:s)?|qt|쿼트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, category: 'volume' },
                { names: ['gallon', 'gallons', 'gal', '갤런'], target_unit_code: 'L', factor: 3.78541, to_base_unit_factor: 3.78541, regex: /([\d\.,]+)\s*(gallon(?:s)?|gal|갤런)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, category: 'volume' },
                { names: ['mL', '밀리리터'], target_unit_code: 'fl oz', factor: 1/29.5735, to_base_unit_factor: 0.001, regex: /([\d\.,]+)\s*(ml|밀리리터)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, is_metric: true, target_unit_name: '액량온스', category: 'volume' },
                { names: ['L', '리터'], target_unit_code: 'gallon', factor: 1/3.78541, to_base_unit_factor: 1, regex: /([\d\.,]+)\s*(L|l|리터)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!b)(?!k)(?!s)/giu, is_metric: true, target_unit_name: '갤런', category: 'volume' },
            ],
            temperature: [
                { names: ['Fahrenheit', 'F', '화씨'], target_unit_code: '°C', regex: /(-?[\d\.,]+)\s*(°F\b|F\b(?!t|l\b|r\b|o\b)|화씨(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣]))/giu, convert_func: (val) => (val - 32) * 5 / 9, target_unit_name: '섭씨', category: 'temperature' },
                { names: ['Celsius', 'C', '섭씨'], target_unit_code: '°F', regex: /(-?[\d\.,]+)\s*(°C\b|\bC\b(?![a-zA-Z])|섭씨(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣]))/giu, convert_func: (val) => (val * 9 / 5) + 32, target_unit_name: '화씨', category: 'temperature' }
            ],
            area: [
                { names: ['m²', 'm2', '㎡', 'sq m', 'sqm', '제곱미터'], target_unit_code: '평', factor: 0.3025, to_base_unit_factor: 1, regex: /([\d\.,]+)\s*(㎡|m(?:²|2|\^\s*2)|sq\.?\s*m|sqm|square\s+met(?:er|re)s?|제곱미터)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, additional_outputs: [{ unit: 'ft²', from_base_unit_factor: 1/0.09290304, precision: 2 }], category: 'area', target_precision: 2 },
                { names: ['평'], target_unit_code: 'm²', factor: 400/121, to_base_unit_factor: 400/121, regex: /([\d\.,]+)\s*(평)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, additional_outputs: [{ unit: 'ft²', from_base_unit_factor: 1/0.09290304, precision: 2 }], category: 'area', target_precision: 2 },
                { names: ['ft²', 'ft2', 'sq ft', 'sqft', 'square foot', 'square feet', '제곱피트'], target_unit_code: 'm²', factor: 0.09290304, to_base_unit_factor: 0.09290304, regex: /([\d\.,]+)\s*(ft(?:²|2|\^\s*2)|sq\.?\s*ft|sqft|square\s+(?:foot|feet)|제곱피트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, additional_outputs: [{ unit: '평', from_base_unit_factor: 0.3025, precision: 2 }], category: 'area', target_precision: 2 }
            ],
            digital_storage: [
                { names: ['KB', 'kilobyte', 'kilobytes', '킬로바이트'], target_unit_code: 'KiB', factor: 1000/1024, regex: /([\d\.,]+)\s*(KB|[Kk]ilobytes?|킬로바이트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:\/\s*(?:(?:s|sec(?:ond)?s?)\b|초)|p(?:s)?\b|per\s+sec(?:ond)?s?\b|초당))/gu, category: 'digital_storage', target_precision: 2 },
                { names: ['MB', 'megabyte', 'megabytes', '메가바이트'], target_unit_code: 'MiB', factor: 1000000/1048576, regex: /([\d\.,]+)\s*(MB|[Mm]egabytes?|메가바이트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:\/\s*(?:(?:s|sec(?:ond)?s?)\b|초)|p(?:s)?\b|per\s+sec(?:ond)?s?\b|초당))/gu, category: 'digital_storage', target_precision: 2 },
                { names: ['GB', 'gigabyte', 'gigabytes', '기가바이트'], target_unit_code: 'GiB', factor: 1000000000/1073741824, regex: /([\d\.,]+)\s*(GB|[Gg]igabytes?|기가바이트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:\/\s*(?:(?:s|sec(?:ond)?s?)\b|초)|p(?:s)?\b|per\s+sec(?:ond)?s?\b|초당))/gu, category: 'digital_storage', target_precision: 2 },
                { names: ['TB', 'terabyte', 'terabytes', '테라바이트'], target_unit_code: 'TiB', factor: 1000000000000/1099511627776, regex: /([\d\.,]+)\s*(TB|[Tt]erabytes?|테라바이트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:\/\s*(?:(?:s|sec(?:ond)?s?)\b|초)|p(?:s)?\b|per\s+sec(?:ond)?s?\b|초당))/gu, category: 'digital_storage', target_precision: 2 },
                { names: ['PB', 'petabyte', 'petabytes', '페타바이트'], target_unit_code: 'PiB', factor: 1000000000000000/1125899906842624, regex: /([\d\.,]+)\s*(PB|[Pp]etabytes?|페타바이트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:\/\s*(?:(?:s|sec(?:ond)?s?)\b|초)|p(?:s)?\b|per\s+sec(?:ond)?s?\b|초당))/gu, category: 'digital_storage', target_precision: 2 },
                { names: ['KiB', 'kibibyte', 'kibibytes', '키비바이트'], target_unit_code: 'KB', factor: 1024/1000, regex: /([\d\.,]+)\s*(KiB|[Kk]ibibytes?|키비바이트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:\/\s*(?:(?:s|sec(?:ond)?s?)\b|초)|p(?:s)?\b|per\s+sec(?:ond)?s?\b|초당))/gu, category: 'digital_storage', target_precision: 2 },
                { names: ['MiB', 'mebibyte', 'mebibytes', '메비바이트'], target_unit_code: 'MB', factor: 1048576/1000000, regex: /([\d\.,]+)\s*(MiB|[Mm]ebibytes?|메비바이트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:\/\s*(?:(?:s|sec(?:ond)?s?)\b|초)|p(?:s)?\b|per\s+sec(?:ond)?s?\b|초당))/gu, category: 'digital_storage', target_precision: 2 },
                { names: ['GiB', 'gibibyte', 'gibibytes', '기비바이트'], target_unit_code: 'GB', factor: 1073741824/1000000000, regex: /([\d\.,]+)\s*(GiB|[Gg]ibibytes?|기비바이트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:\/\s*(?:(?:s|sec(?:ond)?s?)\b|초)|p(?:s)?\b|per\s+sec(?:ond)?s?\b|초당))/gu, category: 'digital_storage', target_precision: 2 },
                { names: ['TiB', 'tebibyte', 'tebibytes', '테비바이트'], target_unit_code: 'GB', factor: 1099511627776/1000000000, regex: /([\d\.,]+)\s*(TiB|[Tt]ebibytes?|테비바이트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:\/\s*(?:(?:s|sec(?:ond)?s?)\b|초)|p(?:s)?\b|per\s+sec(?:ond)?s?\b|초당))/gu, category: 'digital_storage', target_precision: 2 },
                { names: ['PiB', 'pebibyte', 'pebibytes', '페비바이트'], target_unit_code: 'TB', factor: 1125899906842624/1000000000000, regex: /([\d\.,]+)\s*(PiB|[Pp]ebibytes?|페비바이트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])(?!\s*(?:\/\s*(?:(?:s|sec(?:ond)?s?)\b|초)|p(?:s)?\b|per\s+sec(?:ond)?s?\b|초당))/gu, category: 'digital_storage', target_precision: 2 }
            ],
            data_rate: [
                { names: ['Kbps', 'kbps', 'kb/s', 'Kbit/s', '킬로비트/초'], target_unit_code: 'KB/s', factor: 0.125, regex: /([\d\.,]+)\s*(Kbps|kbps|kb\/s|[Kk]bits?\/s|[Kk]ilobits?\s+per\s+second|킬로비트(?:\/초)?|킬로bps)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/gu, category: 'data_rate', target_precision: 2 },
                { names: ['Mbps', 'mbps', 'Mb/s', 'Mbit/s', '메가비트/초'], target_unit_code: 'MB/s', factor: 0.125, regex: /([\d\.,]+)\s*(Mbps|mbps|Mb\/s|[Mm]bits?\/s|[Mm]egabits?\s+per\s+second|메가비트(?:\/초)?|메가bps)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/gu, category: 'data_rate', target_precision: 2 },
                { names: ['Gbps', 'gbps', 'Gb/s', 'Gbit/s', '기가비트/초'], target_unit_code: 'MB/s', factor: 125, regex: /([\d\.,]+)\s*(Gbps|gbps|Gb\/s|[Gg]bits?\/s|[Gg]igabits?\s+per\s+second|기가비트(?:\/초)?|기가bps)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/gu, category: 'data_rate', target_precision: 2 },
                { names: ['Tbps', 'tbps', 'Tb/s', 'Tbit/s', '테라비트/초'], target_unit_code: 'GB/s', factor: 125, regex: /([\d\.,]+)\s*(Tbps|tbps|Tb\/s|[Tt]bits?\/s|[Tt]erabits?\s+per\s+second|테라비트(?:\/초)?|테라bps)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/gu, category: 'data_rate', target_precision: 2 },
                { names: ['KB/s', 'KBps', '킬로바이트/초'], target_unit_code: 'Kbps', factor: 8, regex: /([\d\.,]+)\s*(KB\/s|KBps|[Kk]ilobytes?\s+per\s+second|킬로바이트(?:\/초|초당))(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/gu, category: 'data_rate', target_precision: 2 },
                { names: ['MB/s', 'MBps', '메가바이트/초'], target_unit_code: 'Mbps', factor: 8, regex: /([\d\.,]+)\s*(MB\/s|MBps|[Mm]egabytes?\s+per\s+second|메가바이트(?:\/초|초당))(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/gu, category: 'data_rate', target_precision: 2 },
                { names: ['GB/s', 'GBps', '기가바이트/초'], target_unit_code: 'Gbps', factor: 8, regex: /([\d\.,]+)\s*(GB\/s|GBps|[Gg]igabytes?\s+per\s+second|기가바이트(?:\/초|초당))(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/gu, category: 'data_rate', target_precision: 2 },
                { names: ['TB/s', 'TBps', '테라바이트/초'], target_unit_code: 'Tbps', factor: 8, regex: /([\d\.,]+)\s*(TB\/s|TBps|[Tt]erabytes?\s+per\s+second|테라바이트(?:\/초|초당))(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/gu, category: 'data_rate', target_precision: 2 }
            ],
            speed: [
                { names: ['mph', 'mi/h', 'mile per hour', 'miles per hour', '마일/시'], target_unit_code: 'km/h', factor: 1.609344, regex: /([\d\.,]+)\s*(mph|mi\/h|miles?\s+per\s+hour|마일(?:\/시|시속))(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, category: 'speed', target_precision: 2 },
                { names: ['km/h', 'kmh', 'kph', '킬로미터/시'], target_unit_code: 'mph', factor: 1/1.609344, regex: /([\d\.,]+)\s*(km\/?h|kph|kilomet(?:er|re)s?\s+per\s+hour|킬로미터(?:\/시|시속))(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, category: 'speed', target_precision: 2 },
                { names: ['m/s', 'mps', 'meter per second', 'metre per second', '미터/초'], target_unit_code: 'km/h', factor: 3.6, regex: /([\d\.,]+)\s*(m\/s|mps|met(?:er|re)s?\s+per\s+second|미터(?:\/초|초속))(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, category: 'speed', target_precision: 2 },
                { names: ['knot', 'knots', 'kt', 'kts', '노트'], target_unit_code: 'km/h', factor: 1.852, regex: /([\d\.,]+)\s*(knots?|kts?|노트)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, category: 'speed', target_precision: 2 }
            ],
            pressure: [
                { names: ['psi'], target_unit_code: 'kPa', factor: 6.894757293168, to_base_unit_factor: 6.894757293168, regex: /(-?[\d\.,]+)\s*(psi)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, additional_outputs: [{ unit: 'bar', from_base_unit_factor: 0.01, precision: 2 }], category: 'pressure', target_precision: 1 },
                { names: ['kPa'], target_unit_code: 'psi', factor: 1/6.894757293168, to_base_unit_factor: 1, regex: /(-?[\d\.,]+)\s*(kPa)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, additional_outputs: [{ unit: 'bar', from_base_unit_factor: 0.01, precision: 2 }], category: 'pressure', target_precision: 2 },
                { names: ['MPa'], target_unit_code: 'bar', factor: 10, to_base_unit_factor: 1000, regex: /(-?[\d\.,]+)\s*(MPa)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/gu, additional_outputs: [{ unit: 'psi', from_base_unit_factor: 1/6.894757293168, precision: 2 }], category: 'pressure', target_precision: 2 },
                { names: ['bar'], target_unit_code: 'kPa', factor: 100, to_base_unit_factor: 100, regex: /(-?[\d\.,]+)\s*(bar)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, additional_outputs: [{ unit: 'psi', from_base_unit_factor: 1/6.894757293168, precision: 2 }], category: 'pressure', target_precision: 2 },
                { names: ['atm'], target_unit_code: 'kPa', factor: 101.325, to_base_unit_factor: 101.325, regex: /(-?[\d\.,]+)\s*(atm)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, additional_outputs: [{ unit: 'bar', from_base_unit_factor: 0.01, precision: 3 }], category: 'pressure', target_precision: 3 },
                { names: ['hPa', 'mbar'], target_unit_code: 'kPa', factor: 0.1, to_base_unit_factor: 0.1, regex: /(-?[\d\.,]+)\s*(hPa|mbar)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, additional_outputs: [{ unit: 'bar', from_base_unit_factor: 0.01, precision: 3 }], category: 'pressure', target_precision: 2 },
                { names: ['mmHg'], target_unit_code: 'kPa', factor: 0.133322387415, to_base_unit_factor: 0.133322387415, regex: /(-?[\d\.,]+)\s*(mmHg)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/giu, additional_outputs: [{ unit: 'atm', from_base_unit_factor: 1/101.325, precision: 3 }], category: 'pressure', target_precision: 2 }
            ],
        },
        KST_IANA_TIMEZONE: 'Asia/Seoul',
        MONTH_NAMES_EN_FULL: ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
        MONTH_NAMES_EN_SHORT: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
        TIMEZONE_FIXED_OFFSETS: Object.freeze({
            'UTC': 'GMT+00:00', 'GMT': 'GMT+00:00',
            'WET': 'GMT+00:00', 'WEST': 'GMT+01:00',
            'BST': 'GMT+01:00',
            'CET': 'GMT+01:00', 'CEST': 'GMT+02:00',
            'PST': 'GMT-08:00', 'PDT': 'GMT-07:00',
            'MST': 'GMT-07:00', 'MDT': 'GMT-06:00',
            'CST': 'GMT-06:00', 'CDT': 'GMT-05:00',
            'EST': 'GMT-05:00', 'EDT': 'GMT-04:00',
            'AST': 'GMT-04:00', 'ADT': 'GMT-03:00',
            'AKST': 'GMT-09:00', 'AKDT': 'GMT-08:00',
            'HST': 'GMT-10:00', 'HDT': 'GMT-09:00',
            'KST': 'GMT+09:00', 'JST': 'GMT+09:00',
            'AEST': 'GMT+10:00', 'AEDT': 'GMT+11:00',
            'ACST': 'GMT+09:30', 'ACDT': 'GMT+10:30',
            'AWST': 'GMT+08:00',
        }),
        TIMEZONE_LOOKUP: {
            'PT':  'America/Los_Angeles',
            'MT':  'America/Denver',
            'CT':  'America/Chicago',
            'ET':  'America/New_York',
        },
    };

    const UI_STRINGS = {
        POPUP_LAYER_ID: 'smart-converter-popup-layer-v42',
        POPUP_ERROR_CLASS: 'smart-converter-popup-error',
        POPUP_LOADING_CLASS: 'smart-converter-popup-loading',
        POPUP_DEFAULT_CLASS: 'smart-converter-popup-default',
        POPUP_VISIBLE_CLASS: 'visible',
        GENERAL_CURRENCY_ICON: '💵',
        CLOSE_BUTTON_TEXT: '×',
        CLOSE_BUTTON_TITLE: '닫기',
        COPY_BUTTON_TEXT: '복사',
        COPY_BUTTON_TITLE: '결과 복사',
        COPY_SUCCESS_TEXT: '복사됨!',
        COPY_FAIL_TEXT: '실패',
        CONVERTING_MESSAGE_PREFIX: "'",
        CONVERTING_MESSAGE_SUFFIX: "' 변환 중입니다...",
        PREVIEW_TEXT_ELLIPSIS: "...",
        PREVIEW_TEXT_MAX_LENGTH: 27,
        ERROR_ICON: '⚠️',
        ERROR_NO_VALID_CONVERSION: (text) => `⚠️ '${Utils.escapeHTML(text)}'에 대한 유효한 변환 결과를 찾지 못했습니다. 입력 형식을 확인해 주세요.`,
        ERROR_CANNOT_FIND_CONVERTIBLE: (text) => `⚠️ '${Utils.escapeHTML(text)}'에서 변환 가능한 내용을 찾지 못했습니다.`,
        ERROR_UNIT_CONVERSION: "⚠️ 단위 변환 오류",
        ERROR_FETCH_RATE_INVALID_CURRENCY: (currency) => `⚠️ '${Utils.escapeHTML(String(currency)) || '알 수 없는 통화'}'는 유효한 기준 통화 코드가 아닙니다.`,
        ERROR_FETCH_RATE_API_RESPONSE_CURRENCY: (currency) => `⚠️ 환율 API 응답에서 '${currency}' 통화 정보를 찾을 수 없거나 형식이 유효하지 않습니다.`,
        ERROR_FETCH_RATE_API_PROCESSING: (message) => `⚠️ 환율 API 응답 처리 중 오류가 발생했습니다: ${Utils.escapeHTML(message)}`,
        ERROR_FETCH_RATE_NETWORK: (status) => `⚠️ 환율 정보 요청 중 네트워크 오류가 발생했습니다. (상태: ${status || '알 수 없음'})`,
        ERROR_FETCH_RATE_TIMEOUT: '⚠️ 환율 정보 요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.',
        RESULT_UNIT_SUFFIX_MASS: "(단위, 질량)",
        RESULT_UNIT_SUFFIX_VOLUME: "(단위, 부피)",
        RESULT_UNIT_SUFFIX_DEFAULT: "(단위)",
        RESULT_UNIT_SUFFIX_BY_CATEGORY: Object.freeze({
            area: "(넓이·평수)",
            digital_storage: "(저장 용량)",
            data_rate: "(데이터 속도)",
            speed: "(속도)",
            pressure: "(압력)"
        }),
        RESULT_CURRENCY_SUFFIX: "(환율)",
        RESULT_CURRENCY_ERROR_SUFFIX: "(환율 오류)",
        KOREAN_WON_UNIT: "원",
        KOREAN_APPROX_PREFIX: "약 ",
        ORIGINAL_TEXT_LABEL: "원본: ",
        ECB_TEXT: "유럽중앙은행",
        CACHED_RATE_TEXT: "캐시된 환율",
        REFRESHING_RATE_TEXT: "최신 환율 확인 중",
        TIME_KST_PREFIX: "한국 시각: ",
        TIME_KST_DATE_MONTH_SUFFIX: "월 ",
        TIME_KST_DATE_DAY_SUFFIX: "일 ",
        TIME_KST_AM: "오전",
        TIME_KST_PM: "오후",
        TIME_KST_HOUR_SUFFIX: "시",
        TIME_KST_MINUTE_SUFFIX: "분",
        TIME_CATEGORY_ICON: Config.UNIT_CATEGORY_ICONS.time,
        ERROR_TIME_PARSE: "⚠️ 시간 정보를 올바르게 분석하지 못했습니다.",
        ERROR_TIME_CONVERSION: "⚠️ 시간 변환 중 오류가 발생했습니다.",
        RESULT_TIME_SUFFIX: "(시간 변환)",
    };

    const REGEXES = {
        KOREAN_NUMERALS_REGEX_G: new RegExp(Object.keys(Config.KOREAN_NUMERALS_MAP).join('|'), 'gu'),
        KOREAN_NUMERIC_CLEANUP_REGEX_GI: /[^0-9\.\s천백십]/giu,
        NON_NUMERIC_RELATED_CHARS_REGEX_GI: /[0-9억만천백십조일이삼사오육칠팔구영BMKbmk\.,\s]/giu,
        AMOUNT_ABBREVIATION_REGEX_I: /^([\d\.,]+)\s*(BLN|MLN|TLN|BN|MN|TN|[BMKT])(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])/iu,
        ENGLISH_MAGNITUDE_REGEX_I: new RegExp(`^([\\d\.,]+)\\s*(${Object.keys(Config.MAGNITUDE_WORDS_EN).sort((a, b) => b.length - a.length).join('|')})(?:s)?(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])`, 'iu'),
        PLAIN_OZ_REGEX: /^([\d\.,]+)\s*(oz|온스)(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])$/iu,
        PURE_NUMBER_REGEX: /^(?:\d+(?:\.\d*)?|\.\d+)$/u,
        TIME_EXTRACTION_PATTERN: new RegExp(
            '(?:' +
                '(?:(' + Config.MONTH_NAMES_EN_FULL.join('|') + '|' + Config.MONTH_NAMES_EN_SHORT.join('|') + ')\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*(\\d{4}|\\d{2}))?)' +
                '|' +
                '(\\d{4})[-./](\\d{1,2})[-./](\\d{1,2})' +
                '|' +
                '(\\d{1,2})[-./](\\d{1,2})[-./](\\d{4}|\\d{2})' +
            ')?\\s*' +
            '(?:at\\s+)?' +
            '(\\d{1,2})(?::(\\d{2}))?(?::(\\d{2}))?' +
            '\\s*(a\\.?m\\.?|p\\.?m\\.?)?' +
            '\\s+((?:P[SDMCE]?T|E[SDC]?T|C[SDMCE]?T|M[SD]?T|A[KDEH]?ST|WET|WEST|CET|CEST|BST|GMT|UTC)(?:[+-]\\d{1,2}(?::?\\d{2})?)?|(?:\\b(?:Pacific|Mountain|Central|Eastern|Atlantic|Alaska|Hawaii|Greenwich Mean|Coordinated Universal)(?: Standard| Daylight| European)? Time\\b)|[A-Z]{3,5})' +
            '(?:\\s+Time)?',
            'giu'
        ),
        TZ_OFFSET_REGEX: /^(?:GMT|UTC)([+-])(\d{1,2})(?:(:)?(\d{2}))?$/i,
    };

    const AppState = {
        exchangeRateCache: new Map(),
        exchangeRateRequests: new Map(),
        exchangeRateStorageListenerRegistered: false,
        lastMouseX: 0,
        lastMouseY: 0,
        currentPopupElement: null,
        popupContentContainer: null,
        lastSelectionRect: null,
        closePopupTimeout: null,
        conversionGeneration: 0,
        popupDisplayGeneration: 0,
    };

    const Utils = {
        debounce: function(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const context = this;
                const later = () => {
                    timeout = null;
                    func.apply(context, args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },
        escapeHTML: function(str) {
            if (typeof str !== 'string') return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },
        parseHtmlFragmentWithNativeSanitizer: function(html, sanitizerConfig) {
            const source = String(html ?? '');
            const container = document.createElement('div');

            if (typeof container.setHTML === 'function') {
                const attempts = [];
                const SanitizerCtor = globalThis.Sanitizer;
                if (typeof SanitizerCtor === 'function') {
                    attempts.push(() => {
                        const sanitizer = new SanitizerCtor(sanitizerConfig);
                        container.setHTML(source, { sanitizer });
                    });
                    attempts.push(() => {
                        // Transitional implementations may accept a Sanitizer instance directly.
                        const sanitizer = new SanitizerCtor(sanitizerConfig);
                        container.setHTML(source, sanitizer);
                    });
                }
                attempts.push(() => {
                    container.setHTML(source, { sanitizer: sanitizerConfig });
                });
                attempts.push(() => {
                    container.setHTML(source, { sanitizer: 'default' });
                });
                attempts.push(() => {
                    container.setHTML(source);
                });

                for (const applyNativeSanitizer of attempts) {
                    try {
                        container.replaceChildren();
                        applyNativeSanitizer();

                        const nativeFragment = document.createDocumentFragment();
                        while (container.firstChild) {
                            nativeFragment.appendChild(container.firstChild);
                        }
                        return nativeFragment;
                    } catch (_) {
                        // Keep LunaTools' app-level allowlist sanitizer as the reliable fallback
                        // for unsupported or incompatible Sanitizer API implementations.
                    }
                }
            }

            const template = document.createElement('template');
            template.innerHTML = source;
            return template.content;
        },
        createSafeHtmlFragment: function(html) {
            const fragment = document.createDocumentFragment();
            const sourceFragment = Utils.parseHtmlFragmentWithNativeSanitizer(html, {
                elements: ['div', 'span', 'b', 'br', 'small'],
                attributes: ['class'],
                comments: false,
                dataAttributes: false
            });

            const allowedTags = new Set(['DIV', 'SPAN', 'B', 'BR', 'SMALL']);
            const allowedClasses = new Set(['converted-value', 'original-value', 'category-icon', 'title-suffix', 'error-detail']);

            const sanitizeNode = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    return document.createTextNode(node.textContent || '');
                }
                if (node.nodeType !== Node.ELEMENT_NODE) {
                    return document.createDocumentFragment();
                }

                const tagName = node.tagName;
                const childFragment = document.createDocumentFragment();
                Array.from(node.childNodes).forEach(child => {
                    const safeChild = sanitizeNode(child);
                    if (safeChild) childFragment.appendChild(safeChild);
                });

                if (!allowedTags.has(tagName)) {
                    return childFragment;
                }

                const clone = document.createElement(tagName.toLowerCase());
                if (node.classList) {
                    const safeClasses = Array.from(node.classList).filter(className => allowedClasses.has(className));
                    if (safeClasses.length > 0) clone.className = safeClasses.join(' ');
                }
                clone.appendChild(childFragment);
                return clone;
            };

            Array.from(sourceFragment.childNodes).forEach(child => {
                const safeChild = sanitizeNode(child);
                if (safeChild) fragment.appendChild(safeChild);
            });
            return fragment;
        },
        writeTextToClipboard: async function(text) {
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(String(text));
                    return true;
                }
            } catch (_) {
            }

            const textArea = document.createElement('textarea');
            textArea.value = String(text);
            textArea.setAttribute('readonly', '');
            textArea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
            document.documentElement.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                return document.execCommand('copy');
            } catch (_) {
                return false;
            } finally {
                textArea.remove();
            }
        },
        parseFloatLenient: function(inputStr) {
            if (inputStr === null || typeof inputStr === 'undefined') return null;
            const str = String(inputStr).trim();
            if (str === "") return null;

            const plainNumberPattern = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?$/iu;
            const groupedNumberPattern = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u;
            const numericPattern = str.includes(',') ? groupedNumberPattern : plainNumberPattern;
            if (!numericPattern.test(str)) return null;

            const val = Number(str.replace(/,/g, ''));
            return Number.isFinite(val) ? val : null;
        },
        hasInvalidCommaGrouping: function(inputStr) {
            if (inputStr === null || typeof inputStr === 'undefined') return false;
            const numericSegments = String(inputStr).match(/\d[\d,]*(?:\.\d+)?/gu) || [];
            return numericSegments.some(segment =>
                segment.includes(',') && !/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u.test(segment)
            );
        },
        isInvalidString: function(str) {
            return typeof str !== 'string' || str.trim() === "";
        },
        getSafeNumber: function(value, defaultValue = null) {
            const num = Utils.parseFloatLenient(value);
            return num === null ? defaultValue : num;
        },
        getPreviewText: function(text, maxLength = UI_STRINGS.PREVIEW_TEXT_MAX_LENGTH, ellipsis = UI_STRINGS.PREVIEW_TEXT_ELLIPSIS) {
            if (Utils.isInvalidString(text)) return "";
            return text.length > maxLength ? text.substring(0, maxLength - ellipsis.length) + ellipsis : text;
        }
    };

    const NumberParser = {
        replaceKoreanNumerals: function(inputText) {
            if (Utils.isInvalidString(inputText)) return "";
            return inputText.replace(REGEXES.KOREAN_NUMERALS_REGEX_G, match => Config.KOREAN_NUMERALS_MAP[match]);
        },
        parseNumberWithTens: function(inputStr) {
            if (Utils.isInvalidString(inputStr)) return null;
            const str = inputStr.trim();
            const parts = str.split('십');
            if (parts.length > 2 || (parts.length === 2 && parts[1].includes('십'))) return null;

            if (parts.length === 1) return Utils.parseFloatLenient(str);

            let total = 0;
            let beforeTens = 1;
            if (parts[0] !== "") {
                const parsedBeforeTens = Utils.parseFloatLenient(parts[0]);
                if (parsedBeforeTens === null) return null;
                beforeTens = parsedBeforeTens;
            }
            total += beforeTens * 10;

            if (parts[1] !== "") {
                const afterTens = Utils.parseFloatLenient(parts[1]);
                if (afterTens === null) return null;
                total += afterTens;
            }
            return total;
        },
        parseSegmentWithSubUnitsAndTens: function(inputSegment) {
            if (Utils.isInvalidString(inputSegment)) return 0;
            const segment = inputSegment.trim();
            let textForUnitProcessing = segment.replace(REGEXES.KOREAN_NUMERIC_CLEANUP_REGEX_GI, '').replace(/\s+/g, '').trim();

            if (textForUnitProcessing === "" && segment !== "") return NumberParser.parseNumberWithTens(segment);

            let amount = 0;
            let segmentContainedMajorSubUnit = false;
            let remainingTextAfterUnits = textForUnitProcessing;

            for (const unit of Config.KOREAN_SUB_UNITS) {
                const parts = remainingTextAfterUnits.split(unit.name);
                if (parts.length > 1) {
                    segmentContainedMajorSubUnit = true;
                    let valuePartStr = parts[0].trim();
                    let valueForUnit = 1;

                    if (valuePartStr !== "") {
                        const parsedValuePart = NumberParser.parseNumberWithTens(valuePartStr);
                        if (parsedValuePart === null) return null;
                        valueForUnit = parsedValuePart;
                    }
                    amount += valueForUnit * unit.value;
                    remainingTextAfterUnits = parts.slice(1).join(unit.name).trim();
                }
            }

            if (remainingTextAfterUnits.length > 0) {
                const tailValue = NumberParser.parseNumberWithTens(remainingTextAfterUnits);
                if (tailValue === null) return segmentContainedMajorSubUnit ? amount : null;
                amount += tailValue;
            } else if (!segmentContainedMajorSubUnit && amount === 0 && segment.length > 0) {
                return NumberParser.parseNumberWithTens(segment);
            }
            return amount;
        },
        parseKoreanMajorUnitSegmentValue: function(segmentText) {
            if (segmentText === "") return 1;
            return NumberParser.parseSegmentWithSubUnitsAndTens(segmentText);
        },
        _parseMajorUnitSegments: function(text) {
            let totalAmount = 0;
            let remainingTextToParse = text;
            let parsedSomethingSignificant = false;

            for (const unit of Config.KOREAN_MAJOR_UNITS) {
                const parts = remainingTextToParse.split(unit.name);
                if (parts.length > 1) {
                    const valueForUnit = NumberParser.parseKoreanMajorUnitSegmentValue(parts[0].trim());
                    if (valueForUnit === null) return { error: true };
                    totalAmount += valueForUnit * unit.value;
                    remainingTextToParse = parts.slice(1).join(unit.name).trim();
                    parsedSomethingSignificant = true;
                }
            }
            return { totalAmount, remainingTextToParse, parsedSomethingSignificant };
        },
        parseKoreanNumericText: function(originalInputText) {
            if (Utils.isInvalidString(originalInputText)) return null;
            const trimmedInputText = originalInputText.trim();
            if (Utils.hasInvalidCommaGrouping(trimmedInputText)) return null;
            const text = trimmedInputText.replace(/,/g, '').trim();
            if (text === "영") return 0;

            if (REGEXES.PURE_NUMBER_REGEX.test(text)) {
                const val = Utils.parseFloatLenient(text);
                if (val !== null) return val;
            }

            const numeralReplacedText = NumberParser.replaceKoreanNumerals(text);

            const majorUnitResult = NumberParser._parseMajorUnitSegments(numeralReplacedText);
            if (majorUnitResult.error) return null;

            let { totalAmount, remainingTextToParse, parsedSomethingSignificant } = majorUnitResult;

            if (remainingTextToParse.length > 0) {
                const remainingValue = NumberParser.parseSegmentWithSubUnitsAndTens(remainingTextToParse);
                if (remainingValue === null) {
                    return parsedSomethingSignificant ? totalAmount : null;
                }
                totalAmount += remainingValue;
                parsedSomethingSignificant = true;
            }

            if (parsedSomethingSignificant) return totalAmount;

            return NumberParser.parseSegmentWithSubUnitsAndTens(numeralReplacedText);
        },
        parseAmountWithMagnitudeSuffixes: function(text) {
            if (Utils.isInvalidString(text)) return null;
            const cleanText = text.trim();
            if (Utils.hasInvalidCommaGrouping(cleanText)) return null;

            const abbreviationMatch = cleanText.match(REGEXES.AMOUNT_ABBREVIATION_REGEX_I);
            if (abbreviationMatch) {
                const numVal = Utils.parseFloatLenient(abbreviationMatch[1]);
                const suffix = abbreviationMatch[2].toUpperCase();

                // [수정됨] 남은 문자열이 없거나 문장 부호만 있는 경우 허용
                const remainder = cleanText.substring(abbreviationMatch[0].length).trim();
                const isValidRemainder = remainder === "" || /^[\.,;!?)]+$/.test(remainder);

                if (numVal !== null && isValidRemainder) {
                    let multiplier = 1;
                    if (suffix === 'T' || suffix === 'TN' || suffix === 'TLN') multiplier = 1e12;
                    else if (suffix === 'B' || suffix === 'BN' || suffix === 'BLN') multiplier = 1e9;
                    else if (suffix === 'M' || suffix === 'MN' || suffix === 'MLN') multiplier = 1e6;
                    else if (suffix === 'K') multiplier = 1e3;
                    return numVal * multiplier;
                }
            }

            const magnitudeMatch = cleanText.match(REGEXES.ENGLISH_MAGNITUDE_REGEX_I);
            if (magnitudeMatch) {
                const numVal = Utils.parseFloatLenient(magnitudeMatch[1]);
                const word = magnitudeMatch[2].toLowerCase();

                // [수정됨] 남은 문자열이 없거나 문장 부호만 있는 경우 허용
                const remainder = cleanText.substring(magnitudeMatch[0].length).trim();
                const isValidRemainder = remainder === "" || /^[\.,;!?)]+$/.test(remainder);

                if (numVal !== null && Config.MAGNITUDE_WORDS_EN[word] && isValidRemainder) {
                    return numVal * Config.MAGNITUDE_WORDS_EN[word];
                }
            }
            return null;
        },
        parseGenericNumericText: function(text) {
            if (Utils.isInvalidString(text)) return null;
            let amount = NumberParser.parseAmountWithMagnitudeSuffixes(text);
            if (amount !== null) return amount;
            return NumberParser.parseKoreanNumericText(text);
        }
    };

    const TimeDateParser = {
        _parseGmtOffsetMinutes(offsetString) {
            const match = String(offsetString || '').match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
            if (!match) return null;
            const hours = parseInt(match[2], 10);
            const minutes = match[3] ? parseInt(match[3], 10) : 0;
            if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 14 || minutes > 59) return null;
            const sign = match[1] === '-' ? -1 : 1;
            return sign * ((hours * 60) + minutes);
        },

        _formatGmtOffsetMinutes(offsetMinutes) {
            if (!Number.isFinite(offsetMinutes)) return null;
            const sign = offsetMinutes < 0 ? '-' : '+';
            const absoluteMinutes = Math.abs(offsetMinutes);
            const hours = Math.floor(absoluteMinutes / 60);
            const minutes = absoluteMinutes % 60;
            return `GMT${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        },

        _getOffsetStringForInstant(ianaTimeZone, instant) {
            try {
                const formatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: ianaTimeZone,
                    timeZoneName: 'longOffset',
                });
                const parts = formatter.formatToParts(instant);
                const offsetPart = parts.find(p => p.type === 'timeZoneName');
                return offsetPart ? offsetPart.value : null;
            } catch (e) {  }
            return null;
        },

        _getOffsetStringForIANA(ianaTimeZone, year, monthIndex, day, hour, minute) {
            const localWallClockAsUtcMs = Date.UTC(year, monthIndex, day, hour, minute);
            let candidateInstantMs = localWallClockAsUtcMs;
            let offsetString = null;

            // Resolve the offset for the intended local wall-clock time, not merely for
            // the same numeric fields interpreted as UTC. This avoids one-hour errors
            // around daylight-saving transitions for dynamic aliases such as PT/ET.
            for (let attempt = 0; attempt < 4; attempt += 1) {
                offsetString = this._getOffsetStringForInstant(ianaTimeZone, new Date(candidateInstantMs));
                const offsetMinutes = this._parseGmtOffsetMinutes(offsetString);
                if (offsetMinutes === null) return offsetString;

                const nextCandidateInstantMs = localWallClockAsUtcMs - (offsetMinutes * 60 * 1000);
                if (Math.abs(nextCandidateInstantMs - candidateInstantMs) < 1000) {
                    return this._formatGmtOffsetMinutes(offsetMinutes);
                }
                candidateInstantMs = nextCandidateInstantMs;
            }

            // A non-converging offset means that the requested wall-clock time falls
            // inside a daylight-saving gap and therefore has no valid instant.
            return null;
        },

        _isValidDate(year, monthIndex, day) {
            const d = new Date(year, monthIndex, day);
            return d.getFullYear() === year && d.getMonth() === monthIndex && d.getDate() === day;
        },

        parse: function(inputText) {
            const results = [];
            let match;
            REGEXES.TIME_EXTRACTION_PATTERN.lastIndex = 0;

            while ((match = REGEXES.TIME_EXTRACTION_PATTERN.exec(inputText)) !== null) {
                const originalMatch = match[0];
                let [
                    ,
                    monthNameStr, dayNameStr, yearNameStr,
                    yearYMDStr, monthYMDStr, dayYMDStr,
                    part1MDYStr, part2MDYStr, yearMDYStr,
                    hourStr, minuteStr, secondStr,
                    ampmStr,
                    tzStr
                ] = match;

                let year, monthIndex, day;
                let parsedDateSuccessfully = false;
                const hasExplicitDate = Boolean(monthNameStr || yearYMDStr || part1MDYStr);

                const today = new Date();
                if (monthNameStr) {
                    year = yearNameStr ? parseInt(yearNameStr, 10) : today.getFullYear();
                    if (yearNameStr && yearNameStr.length === 2) year += (year < 70 ? 2000 : 1900);

                    monthNameStr = monthNameStr.toLowerCase();
                    monthIndex = Config.MONTH_NAMES_EN_FULL.indexOf(monthNameStr);
                    if (monthIndex === -1) monthIndex = Config.MONTH_NAMES_EN_SHORT.indexOf(monthNameStr);

                    day = dayNameStr ? parseInt(dayNameStr, 10) : today.getDate();
                    parsedDateSuccessfully = monthIndex !== -1 && this._isValidDate(year, monthIndex, day);

                } else if (yearYMDStr) {
                    year = parseInt(yearYMDStr, 10);
                    monthIndex = parseInt(monthYMDStr, 10) - 1;
                    day = parseInt(dayYMDStr, 10);
                    parsedDateSuccessfully = this._isValidDate(year, monthIndex, day);

                } else if (part1MDYStr) {
                    year = yearMDYStr ? parseInt(yearMDYStr, 10) : today.getFullYear();
                    if (yearMDYStr && yearMDYStr.length === 2) year += (year < 70 ? 2000 : 1900);

                    const p1 = parseInt(part1MDYStr, 10);
                    const p2 = parseInt(part2MDYStr, 10);

                    if (this._isValidDate(year, p1 - 1, p2)) {
                        monthIndex = p1 - 1;
                        day = p2;
                        parsedDateSuccessfully = true;
                    }
                    else if (this._isValidDate(year, p2 - 1, p1)) {
                        monthIndex = p2 - 1;
                        day = p1;
                        parsedDateSuccessfully = true;
                    }
                } else {
                    year = today.getFullYear();
                    monthIndex = today.getMonth();
                    day = today.getDate();
                    parsedDateSuccessfully = true;
                }

                if (!parsedDateSuccessfully) continue;


                let hour = parseInt(hourStr, 10);
                const minute = minuteStr ? parseInt(minuteStr, 10) : 0;
                const second = secondStr ? parseInt(secondStr, 10) : 0;

                if (!Number.isInteger(hour) || hour < 0 || hour > 24 ||
                    !Number.isInteger(minute) || minute < 0 || minute > 59 ||
                    !Number.isInteger(second) || second < 0 || second > 59) {
                    continue;
                }

                if (ampmStr) {
                    if (hour < 1 || hour > 12) continue;
                    ampmStr = ampmStr.toLowerCase().replace(/\./g, '');
                    if (ampmStr === 'pm' && hour < 12) hour += 12;
                    else if (ampmStr === 'am' && hour === 12) hour = 0;
                } else if (hour === 24 && (minute !== 0 || second !== 0)) {
                    continue;
                }

                const rollsToNextDay = hour === 24;
                if (rollsToNextDay) hour = 0;


                let resolvedTzOffsetString = null;
                let resolvedIanaTimeZone = null;
                const upperTzStr = tzStr.toUpperCase().replace(/\s+/gu, ' ').trim();

                if (Config.TIMEZONE_FIXED_OFFSETS[upperTzStr]) {
                    resolvedTzOffsetString = Config.TIMEZONE_FIXED_OFFSETS[upperTzStr];
                } else if (Config.TIMEZONE_LOOKUP[upperTzStr]) {
                    const ianaZone = Config.TIMEZONE_LOOKUP[upperTzStr];
                    resolvedIanaTimeZone = ianaZone;
                    resolvedTzOffsetString = this._getOffsetStringForIANA(ianaZone, year, monthIndex, day, hour, minute);
                } else {
                    const offsetMatch = REGEXES.TZ_OFFSET_REGEX.exec(upperTzStr);
                    if (offsetMatch) {
                        const sign = offsetMatch[1];
                        const hOff = parseInt(offsetMatch[2], 10);
                        const mOffStr = offsetMatch[4];
                        const mOff = mOffStr ? parseInt(mOffStr, 10) : 0;

                        if (hOff <= 14 && mOff <= 59) {
                            resolvedTzOffsetString = `GMT${sign}${String(hOff).padStart(2, '0')}:${String(mOff).padStart(2, '0')}`;
                        }
                    } else if (upperTzStr.match(/^(?:PACIFIC|MOUNTAIN|CENTRAL|EASTERN|ATLANTIC|ALASKA|HAWAII)(?:\s(?:STANDARD|DAYLIGHT))?(?:\sTIME)?$|^(?:GREENWICH MEAN|COORDINATED UNIVERSAL)(?:\sTIME)?$/)) {
                        const fixedFullTimeZoneLookup = {
                            'PACIFIC STANDARD TIME': Config.TIMEZONE_FIXED_OFFSETS.PST,
                            'PACIFIC DAYLIGHT TIME': Config.TIMEZONE_FIXED_OFFSETS.PDT,
                            'MOUNTAIN STANDARD TIME': Config.TIMEZONE_FIXED_OFFSETS.MST,
                            'MOUNTAIN DAYLIGHT TIME': Config.TIMEZONE_FIXED_OFFSETS.MDT,
                            'CENTRAL STANDARD TIME': Config.TIMEZONE_FIXED_OFFSETS.CST,
                            'CENTRAL DAYLIGHT TIME': Config.TIMEZONE_FIXED_OFFSETS.CDT,
                            'EASTERN STANDARD TIME': Config.TIMEZONE_FIXED_OFFSETS.EST,
                            'EASTERN DAYLIGHT TIME': Config.TIMEZONE_FIXED_OFFSETS.EDT,
                            'ATLANTIC STANDARD TIME': Config.TIMEZONE_FIXED_OFFSETS.AST,
                            'ATLANTIC DAYLIGHT TIME': Config.TIMEZONE_FIXED_OFFSETS.ADT,
                            'ALASKA STANDARD TIME': Config.TIMEZONE_FIXED_OFFSETS.AKST,
                            'ALASKA DAYLIGHT TIME': Config.TIMEZONE_FIXED_OFFSETS.AKDT,
                            'HAWAII STANDARD TIME': Config.TIMEZONE_FIXED_OFFSETS.HST,
                            'HAWAII DAYLIGHT TIME': Config.TIMEZONE_FIXED_OFFSETS.HDT,
                            'GREENWICH MEAN TIME': Config.TIMEZONE_FIXED_OFFSETS.GMT,
                            'COORDINATED UNIVERSAL TIME': Config.TIMEZONE_FIXED_OFFSETS.UTC,
                        };

                        if (fixedFullTimeZoneLookup[upperTzStr]) {
                            resolvedTzOffsetString = fixedFullTimeZoneLookup[upperTzStr];
                        } else {
                            const fullTimeZoneLookup = [
                                ['PACIFIC', 'America/Los_Angeles'],
                                ['MOUNTAIN', 'America/Denver'],
                                ['CENTRAL', 'America/Chicago'],
                                ['EASTERN', 'America/New_York'],
                                ['ATLANTIC', 'America/Halifax'],
                                ['ALASKA', 'America/Anchorage'],
                                ['HAWAII', 'Pacific/Honolulu'],
                                ['GREENWICH MEAN', 'Etc/GMT'],
                                ['COORDINATED UNIVERSAL', 'Etc/UTC'],
                            ];
                            const normalizedFullName = upperTzStr
                                .replace(/\s+(STANDARD|DAYLIGHT|EUROPEAN)?\s*TIME$/u, '')
                                .trim();
                            const matchedFullTimeZone = fullTimeZoneLookup.find(([label]) =>
                                normalizedFullName === label || upperTzStr.startsWith(`${label} `)
                            );
                            if (matchedFullTimeZone) {
                                resolvedIanaTimeZone = matchedFullTimeZone[1];
                                resolvedTzOffsetString = this._getOffsetStringForIANA(resolvedIanaTimeZone, year, monthIndex, day, hour, minute);
                            }
                        }
                    }
                }

                if (!resolvedTzOffsetString) continue;

                // A time without a date belongs to "today" in its source timezone,
                // not necessarily to the browser's local calendar day.
                if (!hasExplicitDate) {
                    const currentSourceOffsetString = resolvedIanaTimeZone
                        ? this._getOffsetStringForInstant(resolvedIanaTimeZone, today)
                        : resolvedTzOffsetString;
                    const currentSourceOffsetMinutes = this._parseGmtOffsetMinutes(currentSourceOffsetString);
                    if (currentSourceOffsetMinutes === null) continue;

                    const currentSourceCalendar = new Date(today.getTime() + (currentSourceOffsetMinutes * 60 * 1000));
                    year = currentSourceCalendar.getUTCFullYear();
                    monthIndex = currentSourceCalendar.getUTCMonth();
                    day = currentSourceCalendar.getUTCDate();
                }

                if (rollsToNextDay) {
                    const nextDate = new Date(Date.UTC(year, monthIndex, day));
                    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
                    year = nextDate.getUTCFullYear();
                    monthIndex = nextDate.getUTCMonth();
                    day = nextDate.getUTCDate();
                }

                if (resolvedIanaTimeZone) {
                    resolvedTzOffsetString = this._getOffsetStringForIANA(resolvedIanaTimeZone, year, monthIndex, day, hour, minute);
                    if (!resolvedTzOffsetString) continue;
                }

                try {
                    const monthNameForParse = Config.MONTH_NAMES_EN_FULL[monthIndex];
                    const dateStringForParsing = `${monthNameForParse} ${day}, ${year} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')} ${resolvedTzOffsetString}`;
                    const sourceDate = new Date(dateStringForParsing);

                    if (isNaN(sourceDate.getTime())) continue;
                    results.push({ date: sourceDate, originalText: originalMatch.trim() });
                } catch (e) {  }
            }
            return results;
        }
    };

    const TextExtractor = {
        _getCurrencyAmountPatternSource: function() {
            const numeric = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
            const magnitudeSuffix = String.raw`(?:trillions?|billions?|millions?|thousands?|bln|mln|tln|bn|mn|tn|[BMKT])`;
            const numericWithMagnitude = `${numeric}\\s*${magnitudeSuffix}`;
            const koreanOrPlainNumber = String.raw`[\d,\.\s천백십조억만일이삼사오육칠팔구영]+`;
            return `(?:${numericWithMagnitude}|${koreanOrPlainNumber})`;
        },
        _isStrictCurrencyAmountText: function(amountText) {
            if (Utils.isInvalidString(amountText)) return false;
            const source = TextExtractor._getCurrencyAmountPatternSource();
            return new RegExp(`^(?:${source})$`, 'iu').test(amountText.trim());
        },
        _isValidCurrencyTokenMatch: function(originalText, currencyCode, match) {
            if (!match || Utils.isInvalidString(match[0]) || !Number.isInteger(match.index)) return false;

            const token = match[0];
            const tokenStart = match.index;
            const tokenEnd = tokenStart + token.length;
            const previousCharacter = tokenStart > 0 ? originalText[tokenStart - 1] : '';
            const nextCharacter = tokenEnd < originalText.length ? originalText[tokenEnd] : '';
            const isUnicodeWordContinuation = character => /[\p{L}\p{M}\p{Pc}]/u.test(character);

            // Alphabetic codes/symbols may be adjacent to a number, but must not
            // be extracted from inside ordinary words (fraud/AUD, country/TRY).
            if (/^[A-Za-z]/u.test(token) && isUnicodeWordContinuation(previousCharacter)) return false;
            if (/[A-Za-z]$/u.test(token) && isUnicodeWordContinuation(nextCharacter)) return false;

            // Short alphabetic currency symbols are case-sensitive. In
            // particular, lowercase "ft" is the common feet unit.
            const caseSensitiveSymbols = { HUF: 'Ft', MYR: 'RM', IDR: 'Rp' };
            const expectedSymbol = caseSensitiveSymbols[currencyCode];
            if (expectedSymbol && token.toLowerCase() === expectedSymbol.toLowerCase() && token !== expectedSymbol) {
                return false;
            }

            return true;
        },
        _parseAmountCandidateText: function(amountText) {
            if (Utils.isInvalidString(amountText)) return null;

            const normalizedAmountText = amountText.trim();
            const parsedWithMagnitude = NumberParser.parseAmountWithMagnitudeSuffixes(normalizedAmountText);
            if (parsedWithMagnitude !== null) {
                return { amount: parsedWithMagnitude, magnitudeAmountText: normalizedAmountText };
            }

            const parsedKoreanOrPlain = NumberParser.parseKoreanNumericText(normalizedAmountText);
            if (parsedKoreanOrPlain !== null) {
                return { amount: parsedKoreanOrPlain, magnitudeAmountText: null };
            }

            return null;
        },
        _normalizeCapturedAmountSpan: function(matchText, capturedText, baseOffset = 0, amountTextOverride = capturedText) {
            const captureOffsetInMatch = matchText.indexOf(capturedText);
            if (captureOffsetInMatch < 0) return null;

            const leadingWhitespaceLength = capturedText.length - capturedText.trimStart().length;
            const trailingWhitespaceLength = capturedText.length - capturedText.trimEnd().length;
            const spanText = capturedText.trim();
            const amountText = String(amountTextOverride ?? '').trim();
            if (!spanText || !amountText) return null;

            return {
                amountText,
                startOffset: baseOffset + captureOffsetInMatch + leadingWhitespaceLength,
                endOffset: baseOffset + captureOffsetInMatch + capturedText.length - trailingWhitespaceLength
            };
        },
        _trimEmbeddedKoreanContextPrefix: function(text, candidate) {
            if (!candidate) return null;

            const candidateText = text.slice(candidate.startOffset, candidate.endOffset);
            const previousCharacter = candidate.startOffset > 0 ? text[candidate.startOffset - 1] : '';
            const startsWithKoreanNumericCharacter = /^[천백십조억만일이삼사오육칠팔구영]/u.test(candidateText);
            const hasKoreanContextBeforeCandidate = /[ㄱ-ㅎㅏ-ㅣ가-힣]/u.test(previousCharacter);
            const startsWithSeparatedArabicAmount =
                /^[천백십조억만일이삼사오육칠팔구영]\s+(?=[\d.])/u.test(candidateText);

            // 문장 속 조사·명사의 마지막 글자(금액이, 금액만, 구매일 등)가 한글 숫자와
            // 같더라도 숫자 표현의 시작으로 포함하지 않습니다. 선택 영역이 조사처럼
            // 보이는 글자에서 바로 시작한 "이 100달러"도 공백 뒤의 아라비아 금액만
            // 사용합니다. 공백 없는 "이십 달러", "백이십 달러"는 그대로 보존합니다.
            if (
                !startsWithKoreanNumericCharacter ||
                (!hasKoreanContextBeforeCandidate && !startsWithSeparatedArabicAmount)
            ) {
                return candidate;
            }

            const separatedAmountMatch = /\s+([^\s].*)$/u.exec(candidateText);
            const adjacentArabicAmountMatch = /^[천백십조억만일이삼사오육칠팔구영](\d.*)$/u.exec(candidateText);
            const amountMatch = separatedAmountMatch || adjacentArabicAmountMatch;
            if (!amountMatch) return null;

            const actualAmountText = amountMatch[1].trim();
            if (!TextExtractor._isStrictCurrencyAmountText(actualAmountText)) return null;

            const actualAmountStart = candidateText.indexOf(amountMatch[1], amountMatch.index);
            return {
                amountText: actualAmountText,
                startOffset: candidate.startOffset + actualAmountStart,
                endOffset: candidate.endOffset
            };
        },
        _getOptionalCurrencySymbolAmountPrefixSource: function() {
            return String.raw`(?:US\s*)?[\$＄]|C\$|A\$|HK\$|NZ\$|S\$|Mex\$|R\$|SFr\.?|RM|Rs\.?|Rp|[£￡¥￥₩€₹₺₱₪฿]|zł|Kč|Ft|лв`;
        },
        _extractLeadingAmountCandidate: function(text, { allowLeadingCurrencySymbol = false } = {}) {
            const source = TextExtractor._getCurrencyAmountPatternSource();
            const optionalSymbolPrefix = allowLeadingCurrencySymbol
                ? `(?:(?:${TextExtractor._getOptionalCurrencySymbolAmountPrefixSource()})\\s*)?`
                : '';
            const leadingRegex = new RegExp(`^\\s*(${optionalSymbolPrefix}(${source}))(?![a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣])`, 'iu');
            const match = leadingRegex.exec(text);
            if (!match) return null;

            return TextExtractor._normalizeCapturedAmountSpan(match[0], match[1], 0, match[2]);
        },
        _extractTrailingAmountCandidate: function(text, { allowLeadingCurrencySymbol = false } = {}) {
            const source = TextExtractor._getCurrencyAmountPatternSource();
            const optionalSymbolPrefix = allowLeadingCurrencySymbol
                ? `(?:(?:${TextExtractor._getOptionalCurrencySymbolAmountPrefixSource()})\\s*)?`
                : '';
            const trailingRegex = new RegExp(`(${optionalSymbolPrefix}(${source}))\\s*$`, 'iu');
            const match = trailingRegex.exec(text);
            if (!match) return null;

            const candidate = TextExtractor._normalizeCapturedAmountSpan(match[0], match[1], match.index, match[2]);
            return TextExtractor._trimEmbeddedKoreanContextPrefix(text, candidate);
        },
        _getCurrencyExpressionStart: function(originalText, currencyStart, matchedCurrencyText) {
            if (!/^[\$＄]$/u.test(matchedCurrencyText)) return currencyStart;

            const beforeCurrency = originalText.slice(0, currencyStart);
            const usdPrefixMatch = beforeCurrency.match(/(?:\bU\.?S\.?|\bUS)\s*$/iu);
            return usdPrefixMatch ? currencyStart - usdPrefixMatch[0].length : currencyStart;
        },
        _getCurrencyTokenStrength: function(originalText, currencyStart, matchedCurrencyText) {
            const token = String(matchedCurrencyText || '').trim();
            if (!token) return 0;

            if (TextExtractor._getCurrencyExpressionStart(originalText, currencyStart, token) < currencyStart) {
                return 4;
            }
            if (/[A-Za-z가-힣]/u.test(token)) return 4;
            if (token.length > 1) return 3;
            return 1;
        },
        _doCurrencyCandidatesOverlap: function(a, b) {
            return a.expressionStart < b.expressionEnd && b.expressionStart < a.expressionEnd;
        },
        _compareCurrencyCandidates: function(a, b) {
            if (TextExtractor._doCurrencyCandidatesOverlap(a, b)) {
                return b.tokenStrength - a.tokenStrength ||
                    (b.expressionEnd - b.expressionStart) - (a.expressionEnd - a.expressionStart) ||
                    b.matchedCurrencyLength - a.matchedCurrencyLength ||
                    a.patternIndex - b.patternIndex;
            }

            return a.expressionStart - b.expressionStart ||
                b.tokenStrength - a.tokenStrength ||
                b.matchedCurrencyLength - a.matchedCurrencyLength ||
                a.patternIndex - b.patternIndex;
        },
        _buildCurrencyAmountCandidate: function(originalText, currencyCode, match, patternIndex) {
            if (!TextExtractor._isValidCurrencyTokenMatch(originalText, currencyCode, match)) return null;

            const matchedCurrencyText = match[0];
            const currencyStart = match.index;
            const currencyEnd = currencyStart + matchedCurrencyText.length;
            const tokenStrength = TextExtractor._getCurrencyTokenStrength(originalText, currencyStart, matchedCurrencyText);
            const allowLeadingCurrencySymbol = tokenStrength >= 3;

            const leadingAmountCandidate = TextExtractor._extractLeadingAmountCandidate(
                originalText.slice(currencyEnd),
                { allowLeadingCurrencySymbol }
            );
            if (leadingAmountCandidate) {
                const parsedLeading = TextExtractor._parseAmountCandidateText(leadingAmountCandidate.amountText);
                if (parsedLeading) {
                    const expressionStart = TextExtractor._getCurrencyExpressionStart(originalText, currencyStart, matchedCurrencyText);
                    const expressionEnd = currencyEnd + leadingAmountCandidate.endOffset;
                    return {
                        amount: parsedLeading.amount,
                        currencyCode,
                        originalText: originalText.slice(expressionStart, expressionEnd).trim(),
                        matchedCurrencyText,
                        magnitudeAmountText: parsedLeading.magnitudeAmountText,
                        expressionStart,
                        expressionEnd,
                        tokenStrength,
                        matchedCurrencyLength: matchedCurrencyText.length,
                        patternIndex
                    };
                }
            }

            const trailingAmountCandidate = TextExtractor._extractTrailingAmountCandidate(
                originalText.slice(0, currencyStart),
                { allowLeadingCurrencySymbol }
            );
            if (trailingAmountCandidate) {
                const parsedTrailing = TextExtractor._parseAmountCandidateText(trailingAmountCandidate.amountText);
                if (parsedTrailing) {
                    const expressionStart = trailingAmountCandidate.startOffset;
                    const expressionEnd = currencyEnd;
                    return {
                        amount: parsedTrailing.amount,
                        currencyCode,
                        originalText: originalText.slice(expressionStart, expressionEnd).trim(),
                        matchedCurrencyText,
                        magnitudeAmountText: parsedTrailing.magnitudeAmountText,
                        expressionStart,
                        expressionEnd,
                        tokenStrength,
                        matchedCurrencyLength: matchedCurrencyText.length,
                        patternIndex
                    };
                }
            }

            return null;
        },
        _extractCurrencyAmountFromContext: function(originalText) {
            const candidates = [];

            Config.CURRENCY_PATTERNS.forEach((pattern, patternIndex) => {
                pattern.regex.lastIndex = 0;
                let match;
                while ((match = pattern.regex.exec(originalText)) !== null) {
                    const candidate = TextExtractor._buildCurrencyAmountCandidate(originalText, pattern.code, match, patternIndex);
                    if (candidate) candidates.push(candidate);
                    if (match[0] === "") pattern.regex.lastIndex += 1;
                }
            });

            if (candidates.length === 0) return null;

            candidates.sort(TextExtractor._compareCurrencyCandidates);

            return candidates[0];
        },
        extractCurrencyDetails: function(inputText) {
            if (Utils.isInvalidString(inputText)) {
                return { amount: null, currencyCode: null, originalText: "", matchedCurrencyText: "", magnitudeAmountText: null };
            }
            const originalText = inputText.trim();
            const contextualCurrencyAmount = TextExtractor._extractCurrencyAmountFromContext(originalText);
            if (contextualCurrencyAmount) {
                return {
                    amount: contextualCurrencyAmount.amount,
                    currencyCode: contextualCurrencyAmount.currencyCode,
                    originalText: contextualCurrencyAmount.originalText,
                    matchedCurrencyText: contextualCurrencyAmount.matchedCurrencyText,
                    magnitudeAmountText: contextualCurrencyAmount.magnitudeAmountText
                };
            }

            let amountTextToParse = originalText;
            let currencyCode = null;
            let matchedCurrencyText = "";

            for (const pattern of Config.CURRENCY_PATTERNS) {
                pattern.regex.lastIndex = 0;
                let match;
                while ((match = pattern.regex.exec(originalText)) !== null) {
                    if (!TextExtractor._isValidCurrencyTokenMatch(originalText, pattern.code, match)) {
                        if (match[0] === '') pattern.regex.lastIndex += 1;
                        continue;
                    }
                    currencyCode = pattern.code;
                    matchedCurrencyText = match[0];
                    const firstOccurrenceIndex = match.index;
                    amountTextToParse = (originalText.substring(0, firstOccurrenceIndex) + originalText.substring(firstOccurrenceIndex + matchedCurrencyText.length)).trim();
                    break;
                }
                if (currencyCode) break;
            }

            let amount = null;
            let magnitudeAmountText = null;

            const textForNumericParse = (currencyCode && amountTextToParse === "" && matchedCurrencyText !== "") ?
                originalText.replace(matchedCurrencyText, '').trim() :
                amountTextToParse;

            if (TextExtractor._isStrictCurrencyAmountText(textForNumericParse)) {
                const parsedWithMagnitude = NumberParser.parseAmountWithMagnitudeSuffixes(textForNumericParse);
                if (parsedWithMagnitude !== null) {
                    amount = parsedWithMagnitude;
                    magnitudeAmountText = textForNumericParse;
                } else {
                    amount = NumberParser.parseKoreanNumericText(textForNumericParse);
                }
            }

            return { amount, currencyCode, originalText, matchedCurrencyText, magnitudeAmountText };
        },
        extractPhysicalUnitDetails: function(inputText, ignoredText = null) {
            if (Utils.isInvalidString(inputText)) return [];
            const foundMatches = [];
            const trimmedText = inputText.trim();
            const normalizedIgnoredText = typeof ignoredText === 'string'
                ? ignoredText.trim().toLowerCase()
                : '';
            const shouldIgnoreCurrencyOverlap = (matchedText) => {
                const normalizedMatchedText = String(matchedText || '').trim().toLowerCase();
                return Boolean(
                    normalizedIgnoredText &&
                    normalizedMatchedText &&
                    normalizedIgnoredText.includes(normalizedMatchedText)
                );
            };

            for (const categoryKey in Config.UNIT_CONVERSION_CONFIG) {
                for (const unit of Config.UNIT_CONVERSION_CONFIG[categoryKey]) {
                    unit.regex.lastIndex = 0;
                    let match;
                    while ((match = unit.regex.exec(trimmedText)) !== null) {
                        const valueStr = match[1];
                        const originalMatchedSegment = match[0].trim();

                        if (shouldIgnoreCurrencyOverlap(originalMatchedSegment)) {
                            continue;
                        }

                        const unitStr = match[2];
                        const value = Utils.parseFloatLenient(valueStr);
                        if (value !== null && typeof unitStr === 'string') {
                             foundMatches.push({ value, unitInfo: unit, originalText: originalMatchedSegment, originalUnit: unitStr.trim() });
                        }
                    }
                }
            }

            const plainOzInputMatch = REGEXES.PLAIN_OZ_REGEX.exec(trimmedText);
            if (plainOzInputMatch) {
                 if (!shouldIgnoreCurrencyOverlap(plainOzInputMatch[0])) {
                    const valueFromPlainOz = Utils.parseFloatLenient(plainOzInputMatch[1]);
                    const matchedMassOz = foundMatches.find(m =>
                        m.value === valueFromPlainOz && m.unitInfo.category === 'mass' &&
                        (m.unitInfo.names.includes('oz') || m.unitInfo.names.includes('온스')) &&
                        (m.originalUnit.toLowerCase() === 'oz' || m.originalUnit.toLowerCase() === '온스') &&
                        m.originalText.toLowerCase() === plainOzInputMatch[0].toLowerCase().trim()
                    );
                    if (matchedMassOz) {
                        const alreadyHasFluidOz = foundMatches.some(m =>
                            m.value === valueFromPlainOz && m.unitInfo.category === 'volume' &&
                            m.unitInfo.names.includes('fl oz') &&
                            m.originalText.toLowerCase() === plainOzInputMatch[0].toLowerCase().trim()
                        );
                        if (!alreadyHasFluidOz) {
                            const fluidOunceUnitInfo = Config.UNIT_CONVERSION_CONFIG.volume.find(u => u.names.includes('fl oz'));
                            if (fluidOunceUnitInfo && !foundMatches.some(fm => fm.unitInfo === fluidOunceUnitInfo && fm.value === valueFromPlainOz && fm.originalText.toLowerCase() === plainOzInputMatch[0].toLowerCase().trim())) {
                                foundMatches.push({ value: valueFromPlainOz, unitInfo: fluidOunceUnitInfo, originalText: plainOzInputMatch[0].trim(), originalUnit: plainOzInputMatch[2].trim() });
                            }
                        }
                    }
                }
            }

            const uniqueResults = [];
            const seen = new Set();
            foundMatches.forEach(res => {
                const key = `${res.value}-${res.unitInfo.category}-${res.unitInfo.target_unit_code}-${res.originalUnit}-${res.originalText}`;
                if (!seen.has(key)) {
                    uniqueResults.push(res);
                    seen.add(key);
                }
            });
            return uniqueResults;
        }
    };

    const Formatter = {
        prepareNumberForKoreanFormatting: function(number) {
            if (number === null || isNaN(number)) return null;
            const numAbs = Math.abs(number);
            if (numAbs >= 10000) return Math.round(numAbs);
            if (numAbs < 0.01 && numAbs !== 0) return 0;
            if (numAbs < 1) return Utils.parseFloatLenient(numAbs.toPrecision(2));
            return Math.round(numAbs * 100) / 100;
        },
        determineFormattingDetails: function(value) {
            let decimalPlaces = 0;
            if (value < 1) decimalPlaces = 2;
            else if (value < 10) decimalPlaces = 2;
            else if (value < 100) decimalPlaces = 1;
            const roundedValue = Utils.parseFloatLenient(value.toFixed(decimalPlaces));
            const minFractionDigits = (Number.isInteger(roundedValue) && roundedValue !== 0 && value === roundedValue) ? 0 : decimalPlaces;
            return { roundedValue, decimalPlaces, minFractionDigits };
        },
        formatNumberToKoreanUnits: function(number, forceWonSuffix = false) {
            if (number === null || isNaN(number)) return "";
            if (number === 0) return forceWonSuffix ? "0" + UI_STRINGS.KOREAN_WON_UNIT : "0";

            const preparedNum = Formatter.prepareNumberForKoreanFormatting(number);
            if (preparedNum === null) return "";
            if (preparedNum === 0 && number !== 0) {
                const prefix = number > 0 ? UI_STRINGS.KOREAN_APPROX_PREFIX : "-" + UI_STRINGS.KOREAN_APPROX_PREFIX;
                return prefix + (forceWonSuffix ? "0" + UI_STRINGS.KOREAN_WON_UNIT : "0");
            }

            const sign = number < 0 ? "-" : "";
            const numAbsForCalc = Math.abs(preparedNum);
            let parts = [];
            let remainingVal = numAbsForCalc;

            for (const unit of Config.KOREAN_MAJOR_UNITS) {
                if (remainingVal >= unit.value) {
                    const unitAmount = Math.floor(remainingVal / unit.value);
                    if (unitAmount > 0) {
                        parts.push(`${unitAmount.toLocaleString()}${unit.name}`);
                        remainingVal %= unit.value;
                    }
                }
            }

            if (remainingVal > 0 || (parts.length === 0 && numAbsForCalc > 0)) {
                const valToFormat = (parts.length === 0 && numAbsForCalc > 0) ? numAbsForCalc : remainingVal;
                const { roundedValue, decimalPlaces, minFractionDigits } = Formatter.determineFormattingDetails(valToFormat);
                const remainingStr = roundedValue.toLocaleString(undefined, { minimumFractionDigits: minFractionDigits, maximumFractionDigits: decimalPlaces });
                if (remainingStr !== "0" || parts.length === 0) parts.push(remainingStr);
            }

            if (parts.length === 0) return sign + (forceWonSuffix ? "0" + UI_STRINGS.KOREAN_WON_UNIT : "0");

            let resultStr = sign + parts.join(" ");
            const lastPart = parts.length > 0 ? parts[parts.length - 1] : "";
            const lastPartIsNumericOnly = REGEXES.PURE_NUMBER_REGEX.test(lastPart.replace(/,/g, ''));
            const endsWithMajorUnit = Config.KOREAN_MAJOR_UNITS.some(u => resultStr.trim().endsWith(u.name));
            const manUnitValue = Config.KOREAN_MAJOR_UNITS.find(u => u.name === '만').value;

            const shouldAddWonSuffix = forceWonSuffix || (lastPartIsNumericOnly && !endsWithMajorUnit) ||
                (parts.length === 1 && lastPartIsNumericOnly && numAbsForCalc < manUnitValue && numAbsForCalc > 0);

            if (shouldAddWonSuffix && !resultStr.endsWith(UI_STRINGS.KOREAN_WON_UNIT)) {
                resultStr += UI_STRINGS.KOREAN_WON_UNIT;
            }
            return resultStr;
        },
        formatPhysicalUnitResult: function(originalValue, originalUnitText, convertedValue, targetUnitCode, unitInfo, defaultPrecision = 2) {
            if (originalValue === null || convertedValue === null || !unitInfo) return { html: UI_STRINGS.ERROR_UNIT_CONVERSION, plainText: UI_STRINGS.ERROR_UNIT_CONVERSION };

            const categoryIcon = Config.UNIT_CATEGORY_ICONS[unitInfo.category] || '';
            let displayPrecisionTarget = typeof unitInfo.target_precision === 'number' ? unitInfo.target_precision :
                (targetUnitCode === '°C' || targetUnitCode === '°F' ? 1 : defaultPrecision);

            let displayOriginalUnit = originalUnitText;
            if (originalUnitText === '"') displayOriginalUnit = 'inch';
            else if (originalUnitText === "'") displayOriginalUnit = 'ft';
            if (originalUnitText.toUpperCase() === 'F' && !originalUnitText.startsWith('°') && targetUnitCode === '°C') displayOriginalUnit = '°F';
            if (originalUnitText.toUpperCase() === 'C' && !originalUnitText.startsWith('°') && targetUnitCode === '°F') displayOriginalUnit = '°C';

            const targetUnitDisplayName = unitInfo.target_unit_name || targetUnitCode;
            const valStr = originalValue.toLocaleString(undefined, { maximumFractionDigits: 2 });
            const convertedValStrTarget = convertedValue.toLocaleString(undefined, {
                minimumFractionDigits: (Number.isInteger(Utils.parseFloatLenient(convertedValue.toFixed(displayPrecisionTarget))) && displayPrecisionTarget > 0 && convertedValue !== 0) ? 0 : displayPrecisionTarget,
                maximumFractionDigits: displayPrecisionTarget
            });

            let primaryResultHtml = `<span class="converted-value">${convertedValStrTarget} ${Utils.escapeHTML(targetUnitDisplayName)}</span>`;
            let primaryResultPlain = `${convertedValStrTarget} ${targetUnitDisplayName}`;
            let additionalResultsHtmlParts = [];
            let additionalResultsPlainParts = [];

            if (unitInfo.additional_outputs && unitInfo.to_base_unit_factor && unitInfo.category !== 'temperature') {
                const baseValue = originalValue * unitInfo.to_base_unit_factor;
                unitInfo.additional_outputs.forEach(addOut => {
                    if (typeof addOut.from_base_unit_factor === 'number') {
                        const addVal = baseValue * addOut.from_base_unit_factor;
                        if (typeof addVal === 'number' && !isNaN(addVal)) {
                            const addPrecision = addOut.precision || defaultPrecision;
                            const formattedAddVal = addVal.toLocaleString(undefined, {
                                minimumFractionDigits: (Number.isInteger(Utils.parseFloatLenient(addVal.toFixed(addPrecision))) && addPrecision > 0 && addVal !== 0) ? 0 : addPrecision,
                                maximumFractionDigits: addPrecision
                            });
                            additionalResultsHtmlParts.push(`${formattedAddVal} ${Utils.escapeHTML(addOut.unit)}`);
                            additionalResultsPlainParts.push(`${formattedAddVal} ${addOut.unit}`);
                        }
                    }
                });
            }
            const fullResultHtml = primaryResultHtml + (additionalResultsHtmlParts.length > 0 ? ` (${additionalResultsHtmlParts.join(', ')})` : '');
            const fullResultPlain = primaryResultPlain + (additionalResultsPlainParts.length > 0 ? ` (${additionalResultsPlainParts.join(', ')})` : '');

            return {
                html: `<span class="original-value">${valStr} ${Utils.escapeHTML(displayOriginalUnit)}</span> <span class="category-icon">${categoryIcon}</span> ≈ ${fullResultHtml}`,
                plainText: `${valStr} ${displayOriginalUnit} ${categoryIcon} = ${fullResultPlain}`
            };
        },
        formatKSTResult: function(sourceDate, originalText) {
            if (!(sourceDate instanceof Date) || isNaN(sourceDate.getTime())) {
                return {
                    titleHtml: `${UI_STRINGS.TIME_CATEGORY_ICON} <b>${Utils.escapeHTML(originalText)}</b> <span class="title-suffix">${UI_STRINGS.RESULT_TIME_SUFFIX}</span>`,
                    contentHtml: UI_STRINGS.ERROR_TIME_CONVERSION,
                    copyText: `${originalText} - ${UI_STRINGS.ERROR_TIME_CONVERSION}`,
                    isError: true
                };
            }

            try {
                const kstFormatter = new Intl.DateTimeFormat('ko-KR', {
                    timeZone: Config.KST_IANA_TIMEZONE,
                    month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true,
                });
                const parts = kstFormatter.formatToParts(sourceDate);
                let kstMonth, kstDay, kstAmPm, kstHour, kstMinute;
                parts.forEach(part => {
                    switch (part.type) {
                        case 'month': kstMonth = part.value; break;
                        case 'day': kstDay = part.value; break;
                        case 'dayPeriod': kstAmPm = part.value; break;
                        case 'hour': kstHour = part.value; break;
                        case 'minute': kstMinute = part.value; break;
                    }
                });
                const ampmKorean = (kstAmPm === '오전' || kstAmPm?.toUpperCase() === 'AM') ? UI_STRINGS.TIME_KST_AM : UI_STRINGS.TIME_KST_PM;
                const kstString = `${UI_STRINGS.TIME_KST_PREFIX}${kstMonth}${UI_STRINGS.TIME_KST_DATE_MONTH_SUFFIX}${kstDay}${UI_STRINGS.TIME_KST_DATE_DAY_SUFFIX}${ampmKorean} ${kstHour}${UI_STRINGS.TIME_KST_HOUR_SUFFIX} ${kstMinute}${UI_STRINGS.TIME_KST_MINUTE_SUFFIX}`;
                const titleHtml = `${UI_STRINGS.TIME_CATEGORY_ICON} <b>${Utils.escapeHTML(Utils.getPreviewText(originalText, 40))}</b> <span class="title-suffix">${UI_STRINGS.RESULT_TIME_SUFFIX}</span>`;
                const contentHtml = `<span class="original-value">${Utils.escapeHTML(originalText)}</span> ≈ <b class="converted-value">${kstString}</b>`;
                const copyText = `${originalText} ≈ ${kstString}`;
                return { titleHtml, contentHtml, copyText, isError: false };
            } catch (e) {
                return {
                    titleHtml: `${UI_STRINGS.TIME_CATEGORY_ICON} <b>${Utils.escapeHTML(originalText)}</b> <span class="title-suffix">${UI_STRINGS.RESULT_TIME_SUFFIX}</span>`,
                    contentHtml: UI_STRINGS.ERROR_TIME_CONVERSION,
                    copyText: `${originalText} - ${UI_STRINGS.ERROR_TIME_CONVERSION}`,
                    isError: true
                };
            }
        }
    };

    const ApiService = {
        _normalizeCurrencyCode: function(value) {
            return String(value || '').trim().toUpperCase();
        },
        _isPositiveFiniteNumber: function(value) {
            return typeof value === 'number' && Number.isFinite(value) && value > 0;
        },
        _isFreshTimestamp: function(timestamp, now = Date.now()) {
            if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
            const age = Math.max(0, now - timestamp);
            return age < Config.EXCHANGE_RATE_CACHE_DURATION_MS;
        },
        _normalizeExchangeRateTable: function(candidate) {
            if (!candidate || typeof candidate !== 'object') return null;

            const base = ApiService._normalizeCurrencyCode(candidate.base);
            const date = typeof candidate.date === 'string' ? candidate.date.trim() : '';
            const timestamp = Number(candidate.timestamp);
            if (
                base !== Config.EXCHANGE_RATE_BASE_CURRENCY ||
                !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
                !Number.isFinite(timestamp) ||
                timestamp <= 0 ||
                !candidate.rates ||
                typeof candidate.rates !== 'object'
            ) {
                return null;
            }

            const rates = { [Config.EXCHANGE_RATE_BASE_CURRENCY]: 1 };
            for (const [rawCode, rawRate] of Object.entries(candidate.rates)) {
                const code = ApiService._normalizeCurrencyCode(rawCode);
                const rate = Number(rawRate);
                if (/^[A-Z]{3}$/.test(code) && Number.isFinite(rate) && rate > 0) {
                    rates[code] = rate;
                }
            }
            Object.assign(rates, Config.FIXED_EURO_CONVERSION_RATES);
            if (Object.keys(rates).length < 2) return null;

            return {
                base: Config.EXCHANGE_RATE_BASE_CURRENCY,
                date,
                rates,
                timestamp
            };
        },
        _calculateRateFromTable: function(table, fromCurrency, toCurrency) {
            const fromRate = table.rates[fromCurrency];
            const toRate = table.rates[toCurrency];
            if (!ApiService._isPositiveFiniteNumber(fromRate) || !ApiService._isPositiveFiniteNumber(toRate)) {
                return null;
            }
            const rate = toRate / fromRate;
            return ApiService._isPositiveFiniteNumber(rate) ? rate : null;
        },
        _normalizeCachedResult: function(candidate, sourceType = 'table') {
            if (!candidate || typeof candidate !== 'object') return null;
            const rate = Number(candidate.rate);
            const timestamp = Number(candidate.timestamp);
            const date = typeof candidate.date === 'string' ? candidate.date.trim() : '';
            if (
                !ApiService._isPositiveFiniteNumber(rate) ||
                !Number.isFinite(timestamp) ||
                timestamp <= 0 ||
                !/^\d{4}-\d{2}-\d{2}$/.test(date)
            ) {
                return null;
            }
            return { rate, date, timestamp, sourceType };
        },
        _cacheRateResult: function(cacheKey, candidate, sourceType = 'table') {
            const normalized = ApiService._normalizeCachedResult(candidate, sourceType);
            if (!normalized) return null;
            AppState.exchangeRateCache.set(cacheKey, normalized);
            return normalized;
        },
        _formatRateResult: function(cached, { refreshing = false } = {}) {
            const stale = !ApiService._isFreshTimestamp(cached.timestamp);
            return {
                rate: cached.rate,
                date: cached.date,
                stale,
                refreshing: refreshing || stale
            };
        },
        _createBackgroundError: function(errorMessage, toCurrency) {
            const message = String(errorMessage || 'Unknown error');
            if (message.includes('timed out')) {
                return new Error(UI_STRINGS.ERROR_FETCH_RATE_TIMEOUT);
            }
            if (message.includes('Invalid currency code')) {
                return new Error(UI_STRINGS.ERROR_FETCH_RATE_INVALID_CURRENCY(toCurrency));
            }
            if (message.includes('Network error')) {
                const status = message.match(/\(status:\s*([^\)]+)\)/i)?.[1] || 'unknown';
                return new Error(UI_STRINGS.ERROR_FETCH_RATE_NETWORK(status));
            }
            if (message.includes('API response error')) {
                return new Error(UI_STRINGS.ERROR_FETCH_RATE_API_RESPONSE_CURRENCY(toCurrency));
            }
            return new Error(UI_STRINGS.ERROR_FETCH_RATE_API_PROCESSING(message));
        },
        _sendRuntimeMessage: function(message) {
            return new Promise((resolve, reject) => {
                try {
                    chrome.runtime.sendMessage(message, (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(UI_STRINGS.ERROR_FETCH_RATE_NETWORK(chrome.runtime.lastError.message || 'extension_error')));
                            return;
                        }
                        resolve(response);
                    });
                } catch (error) {
                    reject(new Error(UI_STRINGS.ERROR_FETCH_RATE_NETWORK('sendMessage_failed')));
                }
            });
        },
        refreshExchangeRateTable: function() {
            const refreshKey = '__exchange_rate_table_refresh__';
            const existingRequest = AppState.exchangeRateRequests.get(refreshKey);
            if (existingRequest) return existingRequest;

            const refreshRequest = ApiService._sendRuntimeMessage({
                action: Config.EXCHANGE_RATE_REFRESH_ACTION
            }).then((response) => {
                if (response?.error) {
                    throw ApiService._createBackgroundError(response.error, Config.DEFAULT_TARGET_CURRENCY);
                }
                const table = ApiService._normalizeExchangeRateTable(response?.data?.table);
                if (!table) {
                    throw new Error(UI_STRINGS.ERROR_FETCH_RATE_API_PROCESSING('Invalid or incomplete exchange-rate table from background.'));
                }

                // background.js가 chrome.storage.local.set() 완료 후 응답하므로 메모리 캐시만 비웁니다.
                AppState.exchangeRateCache.clear();
                return table;
            }).finally(() => {
                AppState.exchangeRateRequests.delete(refreshKey);
            });

            AppState.exchangeRateRequests.set(refreshKey, refreshRequest);
            return refreshRequest;
        },
        _refreshExchangeRateTableSilently: function() {
            void ApiService.refreshExchangeRateTable().catch((error) => {
                console.warn('LunaTools: 환율표 백그라운드 갱신 실패', error);
            });
        },
        _requestRateFromBackground: async function(fromCurrency, toCurrency, forceRefresh = false) {
            const response = await ApiService._sendRuntimeMessage({
                action: Config.EXCHANGE_RATE_FETCH_ACTION,
                from: fromCurrency,
                to: toCurrency,
                forceRefresh
            });

            if (response?.error) {
                throw ApiService._createBackgroundError(response.error, toCurrency);
            }
            if (!response?.data || !ApiService._isPositiveFiniteNumber(response.data.rate) || !response.data.date) {
                throw new Error(UI_STRINGS.ERROR_FETCH_RATE_API_PROCESSING('Invalid or incomplete data from background.'));
            }

            const cacheKey = `${fromCurrency}_${toCurrency}`;
            const cached = ApiService._cacheRateResult(cacheKey, {
                rate: response.data.rate,
                date: response.data.date,
                timestamp: Number(response.data.timestamp) || Date.now()
            }, 'background');
            if (!cached) {
                throw new Error(UI_STRINGS.ERROR_FETCH_RATE_API_PROCESSING('Invalid exchange-rate values from background.'));
            }

            const stale = response.data.stale === true || !ApiService._isFreshTimestamp(cached.timestamp);
            return {
                rate: cached.rate,
                date: cached.date,
                stale,
                refreshing: response.data.refreshing === true || stale
            };
        },
        _loadRateFromStorageOrBackground: async function(fromCurrency, toCurrency) {
            const cacheKey = `${fromCurrency}_${toCurrency}`;
            const legacyCacheKey = `rate_${fromCurrency}_${toCurrency}`;
            let stored = null;

            try {
                stored = await chrome.storage.local.get([
                    Config.EXCHANGE_RATE_STORAGE_KEY,
                    legacyCacheKey
                ]);
            } catch (error) {
                console.warn('LunaTools: 저장된 환율 캐시 읽기 실패', error);
            }

            let tableMissingRequestedCurrency = false;
            const table = ApiService._normalizeExchangeRateTable(stored?.[Config.EXCHANGE_RATE_STORAGE_KEY]);
            if (table) {
                const rate = ApiService._calculateRateFromTable(table, fromCurrency, toCurrency);
                if (rate !== null) {
                    const cached = ApiService._cacheRateResult(cacheKey, {
                        rate,
                        date: table.date,
                        timestamp: table.timestamp
                    }, 'table');
                    const result = ApiService._formatRateResult(cached);
                    if (result.stale) ApiService._refreshExchangeRateTableSilently();
                    return result;
                }
                tableMissingRequestedCurrency = true;
            }

            // 15.4 이하 버전의 통화쌍 캐시가 있으면 업데이트 직후에도 즉시 표시합니다.
            const legacyCached = ApiService._normalizeCachedResult(stored?.[legacyCacheKey], 'legacy');
            if (legacyCached) {
                AppState.exchangeRateCache.set(cacheKey, legacyCached);
                const result = ApiService._formatRateResult(legacyCached, { refreshing: true });
                ApiService._refreshExchangeRateTableSilently();
                return result;
            }

            return ApiService._requestRateFromBackground(
                fromCurrency,
                toCurrency,
                tableMissingRequestedCurrency
            );
        },
        fetchExchangeRate: async function(fromCurrency, toCurrency = Config.DEFAULT_TARGET_CURRENCY) {
            fromCurrency = ApiService._normalizeCurrencyCode(fromCurrency);
            toCurrency = ApiService._normalizeCurrencyCode(toCurrency || Config.DEFAULT_TARGET_CURRENCY);

            if (!/^[A-Z]{3}$/.test(fromCurrency)) {
                throw new Error(UI_STRINGS.ERROR_FETCH_RATE_INVALID_CURRENCY(fromCurrency));
            }
            if (!/^[A-Z]{3}$/.test(toCurrency)) {
                throw new Error(UI_STRINGS.ERROR_FETCH_RATE_INVALID_CURRENCY(toCurrency));
            }
            if (fromCurrency === toCurrency) {
                return {
                    rate: 1,
                    date: new Date().toISOString().split('T')[0],
                    stale: false,
                    refreshing: false
                };
            }

            const cacheKey = `${fromCurrency}_${toCurrency}`;
            const existingRequest = AppState.exchangeRateRequests.get(cacheKey);
            if (existingRequest) return existingRequest;

            // 최신성 판단은 ECB 게시 시각·TARGET 영업일을 아는 background.js 한 곳에서 수행합니다.
            // 콘텐츠 스크립트의 24시간 로컬 캐시를 먼저 반환하면 게시일이 바뀐 뒤에도 전일 이전 환율이
            // 표시될 수 있으므로, Alt+Z 실행 시 항상 백그라운드 판정을 거칩니다.
            const request = ApiService._requestRateFromBackground(fromCurrency, toCurrency, false)
                .finally(() => {
                    AppState.exchangeRateRequests.delete(cacheKey);
                });
            AppState.exchangeRateRequests.set(cacheKey, request);
            return request;
        },
        initializeStorageListener: function() {
            if (AppState.exchangeRateStorageListenerRegistered || !chrome.storage?.onChanged) return;
            chrome.storage.onChanged.addListener((changes, areaName) => {
                if (areaName === 'local' && changes[Config.EXCHANGE_RATE_STORAGE_KEY]) {
                    AppState.exchangeRateCache.clear();
                }
            });
            AppState.exchangeRateStorageListenerRegistered = true;
        }
    };

    const Converter = {
        convertPhysicalUnit: function(value, unitInfo) {
            if (value === null || !unitInfo) return null;
            if (unitInfo.convert_func) return unitInfo.convert_func(value);
            if (typeof unitInfo.factor === 'number') return value * unitInfo.factor;
            return null;
        },
        processUnitConversion: function(selectedText, currencyUnitTextToIgnore = null) {
            const unitDetailItems = TextExtractor.extractPhysicalUnitDetails(selectedText, currencyUnitTextToIgnore);
            if (!unitDetailItems || unitDetailItems.length === 0) return null;
            const conversionDataObjects = [];
            for (const unitDetails of unitDetailItems) {
                if (unitDetails.value !== null && unitDetails.unitInfo) {
                    const convertedUnitValue = Converter.convertPhysicalUnit(unitDetails.value, unitDetails.unitInfo);
                    if (convertedUnitValue !== null) {
                        const unitResult = Formatter.formatPhysicalUnitResult(unitDetails.value, unitDetails.originalUnit, convertedUnitValue, unitDetails.unitInfo.target_unit_code, unitDetails.unitInfo);
                        const categoryIcon = Config.UNIT_CATEGORY_ICONS[unitDetails.unitInfo.category] || '';
                        let processedOriginalTextForTitle = Utils.escapeHTML(unitDetails.originalText);
                        const originalUnitLower = unitDetails.originalUnit.toLowerCase();
                        const isOzUnit = originalUnitLower === 'oz' || originalUnitLower === '온스';
                        if (isOzUnit) {
                            if (unitDetails.unitInfo.category === 'mass') processedOriginalTextForTitle += ' (질량)';
                            else if (unitDetails.unitInfo.category === 'volume') processedOriginalTextForTitle += ' (부피)';
                        }
                        let titleSuffix = UI_STRINGS.RESULT_UNIT_SUFFIX_BY_CATEGORY[unitDetails.unitInfo.category] || UI_STRINGS.RESULT_UNIT_SUFFIX_DEFAULT;
                        if (unitDetailItems.length > 1 && isOzUnit) {
                            if (unitDetails.unitInfo.category === 'mass') titleSuffix = UI_STRINGS.RESULT_UNIT_SUFFIX_MASS;
                            else if (unitDetails.unitInfo.category === 'volume') titleSuffix = UI_STRINGS.RESULT_UNIT_SUFFIX_VOLUME;
                        }
                        conversionDataObjects.push({
                            titleHtml: `<span class="category-icon">${categoryIcon}</span> <b>${processedOriginalTextForTitle}</b> <span class="title-suffix">${titleSuffix}</span>`,
                            contentHtml: unitResult.html, copyText: unitResult.plainText, isError: false
                        });
                    }
                }
            }
            return conversionDataObjects.length > 0 ? { results: conversionDataObjects } : null;
        },
        processCurrencyConversion: async function(selectedText) {
            const currencyDetails = TextExtractor.extractCurrencyDetails(selectedText);

            if (currencyDetails.amount === null || currencyDetails.amount < 0 || !currencyDetails.currencyCode) {
                return null;
            }

            const matchedCurrencyToken = String(currencyDetails.matchedCurrencyText || '').trim();
            // C$ ends with the Celsius token "C", while the case-insensitive feet
            // pattern also accepts the HUF symbol "Ft". Suppress only these proven
            // currency/unit collisions so genuinely ambiguous inputs such as
            // "100 파운드" can continue to show both supported interpretations.
            const overlappingCurrencyUnitText = (
                (currencyDetails.currencyCode === 'CAD' && /^C\$$/iu.test(matchedCurrencyToken)) ||
                (currencyDetails.currencyCode === 'HUF' && matchedCurrencyToken === 'Ft')
            ) ? currencyDetails.originalText : null;
            const physicalUnitTextToIgnore = currencyDetails.magnitudeAmountText || overlappingCurrencyUnitText;

            try {
                const {
                    rate,
                    date: rateDate,
                    stale: isStaleRate = false,
                    refreshing: isRateRefreshing = false
                } = await ApiService.fetchExchangeRate(currencyDetails.currencyCode, Config.DEFAULT_TARGET_CURRENCY);
                const convertedValue = currencyDetails.amount * rate;
                const formattedKrwText = Formatter.formatNumberToKoreanUnits(convertedValue, true);
                const formattedRateText = Formatter.formatNumberToKoreanUnits(rate, true);
                const formattedOriginalAmount = currencyDetails.amount.toLocaleString(undefined, { maximumFractionDigits: (currencyDetails.amount % 1 === 0 && currencyDetails.amount < 1e15 && currencyDetails.amount > -1e15) ? 0 : 2 });
                const currencyFlag = Config.CURRENCY_FLAGS[currencyDetails.currencyCode] || '';
                let displayOriginalTextForHTML, plainOriginalTextForCopy;
                if (currencyDetails.currencyCode === Config.DEFAULT_TARGET_CURRENCY) {
                    const krwFormatted = Formatter.formatNumberToKoreanUnits(currencyDetails.amount, true);
                    displayOriginalTextForHTML = krwFormatted.replace(/\s+/g, "") === currencyDetails.originalText.replace(/\s+/g, "") ? `${krwFormatted} ${currencyFlag}` : `${krwFormatted} ${currencyFlag} (${UI_STRINGS.ORIGINAL_TEXT_LABEL}${Utils.escapeHTML(currencyDetails.originalText)})`;
                    plainOriginalTextForCopy = `${Formatter.formatNumberToKoreanUnits(currencyDetails.amount, false)} ${currencyFlag}` + (displayOriginalTextForHTML.includes(UI_STRINGS.ORIGINAL_TEXT_LABEL) ? ` (${UI_STRINGS.ORIGINAL_TEXT_LABEL}${currencyDetails.originalText})` : '');
                } else {
                    const canonicalForms = [(formattedOriginalAmount + " " + currencyDetails.currencyCode).toLowerCase(), (formattedOriginalAmount + currencyDetails.currencyCode).toLowerCase(), (currencyDetails.currencyCode + " " + formattedOriginalAmount).toLowerCase(), (currencyDetails.currencyCode + formattedOriginalAmount).toLowerCase()];
                    const currencyMatchContainedNumber = currencyDetails.matchedCurrencyText.includes(formattedOriginalAmount);
                    displayOriginalTextForHTML = (canonicalForms.includes(currencyDetails.originalText.toLowerCase().replace(/\s+/g, '')) || currencyMatchContainedNumber) ? `${formattedOriginalAmount} ${currencyDetails.currencyCode} ${currencyFlag}` : `${formattedOriginalAmount} ${currencyDetails.currencyCode} ${currencyFlag} (${UI_STRINGS.ORIGINAL_TEXT_LABEL}${Utils.escapeHTML(currencyDetails.originalText)})`;
                    plainOriginalTextForCopy = `${formattedOriginalAmount} ${currencyDetails.currencyCode} ${currencyFlag}` + (displayOriginalTextForHTML.includes(UI_STRINGS.ORIGINAL_TEXT_LABEL) ? ` (${UI_STRINGS.ORIGINAL_TEXT_LABEL}${currencyDetails.originalText})` : '');
                }
                const safeRateDate = Utils.escapeHTML(rateDate);
                const freshnessSuffix = isStaleRate
                    ? `, ${UI_STRINGS.CACHED_RATE_TEXT}${isRateRefreshing ? ` · ${UI_STRINGS.REFRESHING_RATE_TEXT}` : ''}`
                    : '';
                const titleHtml = `<span class="category-icon">${UI_STRINGS.GENERAL_CURRENCY_ICON}</span> <b>${displayOriginalTextForHTML}</b> <span class="title-suffix">${UI_STRINGS.RESULT_CURRENCY_SUFFIX}</span>`;
                const contentHtml = `≈ <b class="converted-value">${formattedKrwText}</b><br><small>(1 ${currencyDetails.currencyCode} ${currencyFlag} ≈ ${formattedRateText}, ${UI_STRINGS.ECB_TEXT}, 기준일: ${safeRateDate}${freshnessSuffix})</small>`;
                const copyText = `${plainOriginalTextForCopy} ${UI_STRINGS.RESULT_CURRENCY_SUFFIX}\n≈ ${Formatter.formatNumberToKoreanUnits(convertedValue, false)}\n(1 ${currencyDetails.currencyCode} ${currencyFlag} ≈ ${Formatter.formatNumberToKoreanUnits(rate, false)}, ${UI_STRINGS.ECB_TEXT}, 기준일: ${safeRateDate}${freshnessSuffix})`;

                return { titleHtml, contentHtml, copyText, isError: false, physicalUnitTextToIgnore };
            } catch (error) {
                const errMsgBase = `${UI_STRINGS.ERROR_ICON} 환율 변환 실패 (${Utils.escapeHTML(currencyDetails.currencyCode || "?")} → ${Config.DEFAULT_TARGET_CURRENCY}).`;
                const errMsgDetail = (error && error.message) ? error.message : '알 수 없는 오류입니다.';

                return {
                    titleHtml: `<span class="category-icon">${UI_STRINGS.GENERAL_CURRENCY_ICON}</span> <b>${Utils.escapeHTML(currencyDetails.originalText)}</b> <span class="title-suffix">${UI_STRINGS.RESULT_CURRENCY_ERROR_SUFFIX}</span>`,
                    contentHtml: `${errMsgBase}<br><small class="error-detail">${UI_STRINGS.ERROR_ICON} ${Utils.escapeHTML(errMsgDetail)}</small>`,
                    copyText: `${currencyDetails.originalText} ${UI_STRINGS.RESULT_CURRENCY_ERROR_SUFFIX}\n${errMsgBase}\n${UI_STRINGS.ERROR_ICON} ${Utils.escapeHTML(errMsgDetail)}`,
                    isError: true,
                    physicalUnitTextToIgnore
                };
            }
        },
        processTimeConversion: function(selectedText) {
            const parsedTimes = TimeDateParser.parse(selectedText);
            if (!parsedTimes || parsedTimes.length === 0) return null;
            const conversionDataObjects = [];
            for (const timeInfo of parsedTimes) {
                if (timeInfo.date instanceof Date && !isNaN(timeInfo.date.getTime())) {
                    const formattedResult = Formatter.formatKSTResult(timeInfo.date, timeInfo.originalText);
                    conversionDataObjects.push(formattedResult);
                }
            }
            return conversionDataObjects.length > 0 ? { results: conversionDataObjects } : null;
        },
        fetchAndProcessConversions: async function(selectedText) {
            let resultsArray = [];
            let conversionAttempted = false;
            let currencyUnitTextToIgnore = null;

            const currencyResultObject = await Converter.processCurrencyConversion(selectedText);
            if (currencyResultObject) {
                conversionAttempted = true;
                resultsArray.push(currencyResultObject);
                if (currencyResultObject.physicalUnitTextToIgnore) {
                    currencyUnitTextToIgnore = currencyResultObject.physicalUnitTextToIgnore;
                }
            }

            const unitConversionOutcome = Converter.processUnitConversion(selectedText, currencyUnitTextToIgnore);
            if (unitConversionOutcome && unitConversionOutcome.results && unitConversionOutcome.results.length > 0) {
                conversionAttempted = true;
                resultsArray.push(...unitConversionOutcome.results);
            }

            const timeConversionOutcome = Converter.processTimeConversion(selectedText);
            if (timeConversionOutcome && timeConversionOutcome.results && timeConversionOutcome.results.length > 0) {
                conversionAttempted = true;
                resultsArray.push(...timeConversionOutcome.results);
            }

            resultsArray = resultsArray.filter(r => r);
            return { resultsArray, conversionAttempted };
        }
    };

    const _POPUP_STYLES = `
        #${UI_STRINGS.POPUP_LAYER_ID} {
            --toast-success-bg-cs: rgba(52, 199, 89, 0.65);
            --toast-error-bg-cs: rgba(255, 59, 48, 0.65);
            --glass-bg-cs: rgba(252, 252, 254, 0.75);
            --glass-border-cs: rgba(0, 0, 0, 0.1);
            --glass-highlight-cs: rgba(255, 255, 255, 0.7);
            --glass-shadow-cs: rgba(0, 0, 0, 0.1);
            --font-family-cs: "Lato", "나눔바른고딕", "Malgun Gothic", sans-serif;
            position: fixed;
            z-index: 2147483647 !important;
            cursor: default;
            padding: 0;
            transition: opacity .25s cubic-bezier(.4,0,.2,1), transform .25s cubic-bezier(.4,0,.2,1);
            transform: scale(.95) translateY(15px);
            opacity: 0;
            max-height: 80vh;
            border-radius: 14px;
            background-color: var(--glass-bg-cs);
            box-shadow: 0 8px 32px var(--glass-shadow-cs);
            border: 1px solid var(--glass-border-cs);
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            max-width: 580px;
            min-width: 300px;
            overflow: hidden;
            color: #1d1d1f;
        }
        @media (prefers-color-scheme: dark) {
            #${UI_STRINGS.POPUP_LAYER_ID} {
                --toast-success-bg-cs: rgba(52, 199, 89, 0.7);
                --toast-error-bg-cs: rgba(255, 69, 58, 0.7);
                --glass-bg-cs: rgba(28, 28, 30, 0.7);
                --glass-border-cs: rgba(255, 255, 255, 0.15);
                --glass-highlight-cs: rgba(255, 255, 255, 0.12);
                --glass-shadow-cs: rgba(0, 0, 0, 0.3);
                color: #f2f2f7;
            }
        }
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_VISIBLE_CLASS} { transform: scale(1) translateY(0); opacity: 1; }
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-window-title-bar { position: absolute; top: 0; left: 0; width: 100%; height: 40px; cursor: grab; user-select: none; }
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-window-title-bar:active { cursor: grabbing; }
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-close-btn { position: absolute; top: 10px; right: 12px; width: 22px; height: 22px; background: rgba(0,0,0,.08); border: none; color: rgba(0,0,0,.55); font-size: 17px; font-weight: 400; border-radius: 50%; cursor: pointer; padding: 0; user-select: none; transition: all .2s ease; display: flex; align-items: center; justify-content: center; line-height: 1; }
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-close-btn:hover { background: rgba(0,0,0,.13); color: rgba(0,0,0,.7); box-shadow: 0 1px 3px rgba(0,0,0,.07); }
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-close-btn:active { background: rgba(0,0,0,.17); color: rgba(0,0,0,.8); transform: scale(.93); }
        @media (prefers-color-scheme: dark) {
            #${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-close-btn { background:rgba(255,255,255,.1); color:rgba(255,255,255,.6); }
            #${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-close-btn:hover { background:rgba(255,255,255,.15); color:#fff; }
        }
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-content-container { font-family: var(--font-family-cs); padding: 12px 18px 18px; margin-top: 40px; line-height: 1.65; text-align: left; overflow-y: auto; max-height: calc(80vh - 58px); word-break: break-word; }
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-item { padding-bottom: 14px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-start; }
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-item:last-child { margin-bottom: 0; padding-bottom: 0; }
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-item:not(:last-child) { border-bottom: 1px solid rgba(0,0,0,.1); }
		@media (prefers-color-scheme: dark) { #${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-item:not(:last-child) { border-bottom-color: rgba(255,255,255,.15); } }
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-item-text-content { flex-grow: 1; padding-right: 12px; line-height: 1.5; font-size: 18px; }
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-item-text-content div { margin-bottom: 2px; }
		#${UI_STRINGS.POPUP_LAYER_ID} b { font-weight: 600; color: inherit; }
		#${UI_STRINGS.POPUP_LAYER_ID} .converted-value { font-size: 1.2em; font-weight: 700; color: #0071e3; }
		#${UI_STRINGS.POPUP_LAYER_ID} .original-value { font-weight: 400; color: #333; }
		#${UI_STRINGS.POPUP_LAYER_ID} small { font-size: .8em; color: #585858; display: block; margin-top: 4px; }
		#${UI_STRINGS.POPUP_LAYER_ID} small.error-detail { color: #c0392b; }
        @media (prefers-color-scheme: dark) { #${UI_STRINGS.POPUP_LAYER_ID} .converted-value { color: #0a84ff; } #${UI_STRINGS.POPUP_LAYER_ID} .original-value { color: #ccc; } #${UI_STRINGS.POPUP_LAYER_ID} small { color: #8e8e93; } #${UI_STRINGS.POPUP_LAYER_ID} small.error-detail { color: #ff6b6b; } }
		#${UI_STRINGS.POPUP_LAYER_ID} .category-icon { display: inline-block; margin-right: 6px; font-size: .95em; opacity: .8; }
		#${UI_STRINGS.POPUP_LAYER_ID} .title-suffix { font-size: .85em; font-weight: 500; color: #6e6e73; }
		@media (prefers-color-scheme: dark) { #${UI_STRINGS.POPUP_LAYER_ID} .title-suffix { color: #8e8e93; } }
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-copy-btn { background-color: #007aff; border: none; color: #fff; padding: 7px 15px; font-size: .75em; font-weight: 500; border-radius: 9px; cursor: pointer; margin-left: 10px; margin-top: 3px; transition: all .15s ease; white-space: nowrap; flex-shrink: 0; box-shadow: 0 1px 2px rgba(0,122,255,.2); }
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-copy-btn:hover { background-color: #0071e3; box-shadow: 0 2px 4px rgba(0,122,255,.25); }
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-copy-btn:active { background-color: #0066cc; transform: scale(.95); }
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-copy-btn.success { background-color: #34c759; }
		#${UI_STRINGS.POPUP_LAYER_ID} .smart-converter-copy-btn.fail { background-color: #ff3b30; }
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_ERROR_CLASS} { background-color: rgba(255,238,238,.75); border-color: rgba(200,70,60,.6); }
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_ERROR_CLASS} .smart-converter-item-text-content div { color: #a6160a !important; }
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_ERROR_CLASS} b { color: #800 !important; }
		@media (prefers-color-scheme: dark) { #${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_ERROR_CLASS} { background-color: rgba(60,28,30,.7); border-color: rgba(255,80,70,.3); } #${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_ERROR_CLASS} .smart-converter-item-text-content div, #${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_ERROR_CLASS} b { color: #ffcdd2 !important; } }
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_LOADING_CLASS} .smart-converter-item-text-content { min-height: 2.5em; display: flex; align-items: center; }
		#${UI_STRINGS.POPUP_LAYER_ID}.${UI_STRINGS.POPUP_LOADING_CLASS} .smart-converter-item-text-content div::after { content: ""; display: inline-block; width: .9em; height: .9em; margin-left: 10px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: smart-converter-spinner .8s linear infinite; vertical-align: middle; opacity: 0.7; }
		@keyframes smart-converter-spinner { to { transform: rotate(360deg); } }
    `;

    const PopupUI = {
        create: function() {
            if (document.getElementById(UI_STRINGS.POPUP_LAYER_ID)) return;
            const popup = document.createElement('div');
            popup.id = UI_STRINGS.POPUP_LAYER_ID;
            popup.style.display = 'none';
            popup.setAttribute('role', 'dialog');
            popup.setAttribute('aria-modal', 'true');
            const titleBarElement = document.createElement('div');
            titleBarElement.className = 'smart-converter-window-title-bar';
            popup.appendChild(titleBarElement);
            const closeButton = document.createElement('span');
            closeButton.textContent = UI_STRINGS.CLOSE_BUTTON_TEXT;
            closeButton.className = 'smart-converter-close-btn';
            closeButton.title = UI_STRINGS.CLOSE_BUTTON_TITLE;
            
            closeButton.addEventListener('click', (e) => { e.stopPropagation(); PopupUI.close(); });
            
            popup.appendChild(closeButton);
            AppState.popupContentContainer = document.createElement('div');
            AppState.popupContentContainer.className = 'smart-converter-content-container';
            popup.appendChild(AppState.popupContentContainer);
            document.body.appendChild(popup);
            AppState.currentPopupElement = popup;
            PopupUI.enableDrag(popup, titleBarElement, closeButton);
        },
        enableDrag: function(popupEl, dragHandleEl, closeButtonEl) {
            let isDragging = false, dragOffsetX, dragOffsetY;

            const onDrag = (e) => {
                if (!isDragging) return;
                let newLeft = e.clientX - dragOffsetX, newTop = e.clientY - dragOffsetY;
                const vpWidth = window.innerWidth, vpHeight = window.innerHeight;
                newLeft = Math.max(Config.POPUP_SCREEN_MARGIN, Math.min(newLeft, vpWidth - popupEl.offsetWidth - Config.POPUP_SCREEN_MARGIN));
                newTop = Math.max(Config.POPUP_SCREEN_MARGIN, Math.min(newTop, vpHeight - popupEl.offsetHeight - Config.POPUP_SCREEN_MARGIN));
                popupEl.style.left = newLeft + 'px';
                popupEl.style.top = newTop + 'px';
            };

            const onDragEnd = () => {
                isDragging = false;
                popupEl.style.willChange = 'auto';
                document.removeEventListener('mousemove', onDrag);
                document.removeEventListener('mouseup', onDragEnd);
            };
            
            dragHandleEl.addEventListener('mousedown', (e) => {
                if (closeButtonEl && e.target === closeButtonEl) return;
                isDragging = true;
                const rect = popupEl.getBoundingClientRect();
                dragOffsetX = e.clientX - rect.left;
                dragOffsetY = e.clientY - rect.top;
                popupEl.style.willChange = 'transform';
                document.addEventListener('mousemove', onDrag);
                document.addEventListener('mouseup', onDragEnd);
                e.preventDefault();
            });
        },
        close: function() {
            // 닫기 이후 완료되는 느린 환율 요청이 팝업을 다시 열지 못하게 무효화합니다.
            AppState.conversionGeneration += 1;
            AppState.popupDisplayGeneration += 1;
            if (AppState.currentPopupElement) {
                AppState.currentPopupElement.classList.remove(UI_STRINGS.POPUP_VISIBLE_CLASS);
                clearTimeout(AppState.closePopupTimeout);
                AppState.closePopupTimeout = setTimeout(() => {
                    if (AppState.currentPopupElement && !AppState.currentPopupElement.classList.contains(UI_STRINGS.POPUP_VISIBLE_CLASS)) {
                        AppState.currentPopupElement.style.display = 'none';
                    }
                }, 250);
            }
        },
        calculatePosition: function(popupEl) {
            let top, left;
            const selection = window.getSelection();
            let currentSelRect = null;
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                currentSelRect = (range.collapsed && AppState.lastSelectionRect && (AppState.lastSelectionRect.width > 0 || AppState.lastSelectionRect.height > 0)) ? AppState.lastSelectionRect : range.getBoundingClientRect();
                if ((currentSelRect.width === 0 && currentSelRect.height === 0) && AppState.lastSelectionRect && (AppState.lastSelectionRect.width > 0 || AppState.lastSelectionRect.height > 0)) currentSelRect = AppState.lastSelectionRect;
            } else if (AppState.lastSelectionRect && (AppState.lastSelectionRect.width > 0 || AppState.lastSelectionRect.height > 0)) {
                currentSelRect = AppState.lastSelectionRect;
            }
            const popupWidth = popupEl.offsetWidth, popupHeight = popupEl.offsetHeight;
            if (currentSelRect && (currentSelRect.width > 0 || currentSelRect.height > 0)) {
                top = currentSelRect.bottom + Config.POPUP_OFFSET_Y;
                left = currentSelRect.left + Config.POPUP_OFFSET_X;
                if (top + popupHeight > window.innerHeight - Config.POPUP_SCREEN_MARGIN) top = currentSelRect.top - popupHeight - Config.POPUP_OFFSET_Y;
            } else {
                top = AppState.lastMouseY + Config.POPUP_OFFSET_Y;
                left = AppState.lastMouseX + Config.POPUP_OFFSET_X;
            }
            left = Math.max(Config.POPUP_SCREEN_MARGIN, Math.min(left, window.innerWidth - popupWidth - Config.POPUP_SCREEN_MARGIN));
            top = Math.max(Config.POPUP_SCREEN_MARGIN, Math.min(top, window.innerHeight - popupHeight - Config.POPUP_SCREEN_MARGIN));
            return { top, left };
        },
        display: function(messagesArray, isErrorState = false, isLoadingState = false) {
            if (!AppState.currentPopupElement) PopupUI.create();
            if (!AppState.currentPopupElement || !AppState.popupContentContainer) return;
            const popupDisplayGeneration = ++AppState.popupDisplayGeneration;
            clearTimeout(AppState.closePopupTimeout);
            const fragment = document.createDocumentFragment();
            messagesArray.forEach((msgData) => {
                const itemDiv = document.createElement('div'); itemDiv.className = 'smart-converter-item';
                const textContentDiv = document.createElement('div'); textContentDiv.className = 'smart-converter-item-text-content';
                if (typeof msgData === 'object' && msgData !== null) {
                    if (msgData.titleHtml) { const titleEl = document.createElement('div'); titleEl.appendChild(Utils.createSafeHtmlFragment(msgData.titleHtml)); textContentDiv.appendChild(titleEl); }
                    if (msgData.contentHtml) { const contentEl = document.createElement('div'); contentEl.appendChild(Utils.createSafeHtmlFragment(msgData.contentHtml)); if (msgData.titleHtml && contentEl.childNodes.length > 0) contentEl.style.marginTop = '4px'; textContentDiv.appendChild(contentEl); }
                    itemDiv.appendChild(textContentDiv);
                    if (!isLoadingState && !isErrorState && !Utils.isInvalidString(msgData.copyText) && !msgData.isError) {
                        const copyBtn = document.createElement('button'); copyBtn.textContent = UI_STRINGS.COPY_BUTTON_TEXT; copyBtn.className = 'smart-converter-copy-btn'; copyBtn.title = UI_STRINGS.COPY_BUTTON_TITLE;
                        
                        copyBtn.addEventListener('click', (e) => {
                            if (!e.isTrusted) return;
                            e.stopPropagation();
                            Utils.writeTextToClipboard(msgData.copyText)
                                .then((copied) => {
                                    if (!copied) throw new Error('clipboard_copy_failed');
                                    copyBtn.textContent = UI_STRINGS.COPY_SUCCESS_TEXT; copyBtn.classList.add('success'); setTimeout(() => { copyBtn.textContent = UI_STRINGS.COPY_BUTTON_TEXT; copyBtn.classList.remove('success'); }, 1500);
                                })
                                .catch(() => { copyBtn.textContent = UI_STRINGS.COPY_FAIL_TEXT; copyBtn.classList.add('fail'); setTimeout(() => { copyBtn.textContent = UI_STRINGS.COPY_BUTTON_TEXT; copyBtn.classList.remove('fail'); }, 1500); });
                        });

                        itemDiv.appendChild(copyBtn);
                    }
                } else { const plainTextDiv = document.createElement('div'); plainTextDiv.textContent = String(msgData); textContentDiv.appendChild(plainTextDiv); itemDiv.appendChild(textContentDiv); }
                fragment.appendChild(itemDiv);
            });
            while (AppState.popupContentContainer.firstChild) AppState.popupContentContainer.removeChild(AppState.popupContentContainer.firstChild);
            AppState.popupContentContainer.appendChild(fragment);
            AppState.currentPopupElement.classList.remove(UI_STRINGS.POPUP_DEFAULT_CLASS, UI_STRINGS.POPUP_ERROR_CLASS, UI_STRINGS.POPUP_LOADING_CLASS);
            if (isErrorState) AppState.currentPopupElement.classList.add(UI_STRINGS.POPUP_ERROR_CLASS);
            else if (isLoadingState) AppState.currentPopupElement.classList.add(UI_STRINGS.POPUP_LOADING_CLASS);
            else AppState.currentPopupElement.classList.add(UI_STRINGS.POPUP_DEFAULT_CLASS);
            AppState.currentPopupElement.style.display = 'block'; AppState.currentPopupElement.style.visibility = 'hidden';
            requestAnimationFrame(() => {
                if (popupDisplayGeneration !== AppState.popupDisplayGeneration ||
                    !AppState.currentPopupElement ||
                    AppState.currentPopupElement.style.display === 'none') {
                    return;
                }
                const { top, left } = PopupUI.calculatePosition(AppState.currentPopupElement);
                AppState.currentPopupElement.style.top = `${top}px`; AppState.currentPopupElement.style.left = `${left}px`;
                AppState.currentPopupElement.style.visibility = 'visible'; AppState.currentPopupElement.classList.add(UI_STRINGS.POPUP_VISIBLE_CLASS);
            });
        },
        addGlobalStyle: function(css) {
            const head = document.head || document.getElementsByTagName('head')[0];
            if (head) { const style = document.createElement('style'); style.type = 'text/css'; style.appendChild(document.createTextNode(css)); head.appendChild(style); }
        },
        injectStyles: function() { PopupUI.addGlobalStyle(_POPUP_STYLES); }
    };
	
    const EventHandlers = {
        isEditableKeyEvent: function(event) {
            if (document.designMode === 'on') return true;

            const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : [];
            const candidates = [...eventPath, event.target, document.activeElement];
            const editableSelector = 'input, textarea, select, [contenteditable], [role="textbox"], [role="searchbox"], [role="combobox"], .CodeMirror, .monaco-editor, .ace_editor';

            return candidates.some(candidate => {
                if (!(candidate instanceof Element)) return false;
                const editableElement = candidate.closest(editableSelector);
                if (!editableElement) return false;

                const tagName = String(editableElement.tagName || '').toUpperCase();
                if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName)) return true;
                if (editableElement.matches('.CodeMirror, .monaco-editor, .ace_editor')) return true;

                const role = String(editableElement.getAttribute('role') || '').toLowerCase();
                if (['textbox', 'searchbox', 'combobox'].includes(role)) return true;

                const contentEditableValue = editableElement.getAttribute('contenteditable');
                return editableElement.isContentEditable ||
                    (contentEditableValue !== null && contentEditableValue.toLowerCase() !== 'false');
            });
        },
        handleUnifiedConvertAction: async function() {
            const conversionGeneration = ++AppState.conversionGeneration;
            const selection = window.getSelection();
            const selectedText = selection ? selection.toString().trim() : "";
            if (Utils.isInvalidString(selectedText)) { if (AppState.currentPopupElement && AppState.currentPopupElement.style.display !== 'none') PopupUI.close(); return; }
            const previewText = Utils.getPreviewText(selectedText);
            PopupUI.display([{ contentHtml: `<div>${UI_STRINGS.CONVERTING_MESSAGE_PREFIX}${Utils.escapeHTML(previewText)}${UI_STRINGS.CONVERTING_MESSAGE_SUFFIX}</div>` }], false, true);
            const { resultsArray, conversionAttempted } = await Converter.fetchAndProcessConversions(selectedText);
            if (conversionGeneration !== AppState.conversionGeneration) return;
            if (resultsArray.length > 0) { const hasError = resultsArray.some(res => res.isError); PopupUI.display(resultsArray, hasError, false); }
            else if (conversionAttempted) { PopupUI.display([{ contentHtml: `<div>${UI_STRINGS.ERROR_NO_VALID_CONVERSION(previewText)}</div>` }], true, false); }
            else { PopupUI.display([{ contentHtml: `<div>${UI_STRINGS.ERROR_CANNOT_FIND_CONVERTIBLE(previewText)}</div>` }], true, false); }
        },
        updateMousePositionAndSelectionRect: function(event) {
            AppState.lastMouseX = event.clientX; AppState.lastMouseY = event.clientY;
            const selection = window.getSelection();
            if (selection && selection.toString().trim() !== "" && selection.rangeCount > 0) { const rect = selection.getRangeAt(0).getBoundingClientRect(); if (rect.width > 0 || rect.height > 0) AppState.lastSelectionRect = rect; }
        },
        handleSelectionChange: function() {
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0 && selection.toString().trim() !== "") { const rect = selection.getRangeAt(0).getBoundingClientRect(); if (rect.width > 0 || rect.height > 0) AppState.lastSelectionRect = rect; }
        },
        initEventListeners: function() {
            document.addEventListener('mouseup', EventHandlers.updateMousePositionAndSelectionRect);
            document.addEventListener('contextmenu', (e) => EventHandlers.updateMousePositionAndSelectionRect(e), true);
            document.addEventListener('selectionchange', Utils.debounce(EventHandlers.handleSelectionChange, 250));
            document.addEventListener('keydown', function(event) {
                if (!event.isTrusted) return;
                const isConvertShortcut = event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey &&
                    (event.key === 'z' || event.key === 'Z' || event.code === 'KeyZ');
                if (isConvertShortcut && !event.repeat && !event.isComposing && !EventHandlers.isEditableKeyEvent(event)) {
                    event.preventDefault();
                    event.stopPropagation();
                    void EventHandlers.handleUnifiedConvertAction();
                }
                if (event.key === 'Escape' || event.code === 'Escape') { if (AppState.currentPopupElement && AppState.currentPopupElement.style.display !== 'none') PopupUI.close(); }
            });
            window.addEventListener('scroll', () => { if (AppState.currentPopupElement && AppState.currentPopupElement.style.display !== 'none' && AppState.currentPopupElement.classList.contains(UI_STRINGS.POPUP_VISIBLE_CLASS)) PopupUI.close(); }, true);
            window.addEventListener('resize', Utils.debounce(() => { if (AppState.currentPopupElement && AppState.currentPopupElement.style.display !== 'none' && AppState.currentPopupElement.classList.contains(UI_STRINGS.POPUP_VISIBLE_CLASS)) { const { top, left } = PopupUI.calculatePosition(AppState.currentPopupElement); AppState.currentPopupElement.style.top = `${top}px`; AppState.currentPopupElement.style.left = `${left}px`; } }, 250));
        }
    };

    function textConverterMain() {
        ApiService.initializeStorageListener();
        PopupUI.injectStyles();
        EventHandlers.initEventListeners();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', textConverterMain);
    } else {
        textConverterMain();
    }

  })();

  (() => {
    'use strict';

    class VideoRotator {
        static #CONFIG = {
            ROTATION_STEPS: 4,
            ROTATION_ANGLE_DEGREES: 90,
            SHORTCUT_KEY: 'KeyR',
            EDITABLE_TAGS: new Set(['INPUT', 'TEXTAREA', 'SELECT']),
        };

        #rotationState = new WeakMap();

        constructor() {
            document.addEventListener('keydown', this.#handleKeyDown.bind(this), true);
        }

        #isShortcutPressed(e) {
            return e.code === VideoRotator.#CONFIG.SHORTCUT_KEY && e.ctrlKey && e.shiftKey && e.altKey;
        }

        #isTargetEditable(target) {
            if (!(target instanceof Element)) return false;
            const editableElement = target.closest('input, textarea, select, [contenteditable]');
            return Boolean(editableElement && (
                VideoRotator.#CONFIG.EDITABLE_TAGS.has(editableElement.tagName) ||
                editableElement.isContentEditable ||
                editableElement.getAttribute('contenteditable') === ''
            ));
        }

        #isVideoVisible(video) {
            if (!(video instanceof HTMLVideoElement)) return false;
            const style = window.getComputedStyle(video);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            const rect = video.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }

        #isVideoInViewport(video) {
            const rect = video.getBoundingClientRect();
            return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
        }

        #scoreVideo(video) {
            const rect = video.getBoundingClientRect();
            let score = 0;
            if (video.matches(':hover')) score += 1000;
            if (!video.paused && !video.ended) score += 500;
            if (this.#isVideoInViewport(video)) score += 200;
            if (video.readyState > 0 || video.currentSrc) score += 100;
            score += Math.min(rect.width * rect.height, 1_000_000) / 10_000;
            return score;
        }

        #findPrioritizedVideo() {
            const videos = Array.from(document.querySelectorAll('video'))
                .filter(video => this.#isVideoVisible(video));
            if (videos.length === 0) return null;

            videos.sort((a, b) => this.#scoreVideo(b) - this.#scoreVideo(a));
            return videos[0];
        }

        #calculateTransform(step, video) {
            if (step === 0) return '';

            const angle = step * VideoRotator.#CONFIG.ROTATION_ANGLE_DEGREES;
            let transform = `rotate(${angle}deg)`;

            const isPortrait = step % 2 !== 0;
            if (isPortrait) {
                const { clientWidth, clientHeight } = video;
                if (clientWidth > 0 && clientHeight > 0) {
                    const scale = Math.min(clientWidth / clientHeight, clientHeight / clientWidth);
                    transform += ` scale(${scale})`;
                }
            }
            return transform;
        }

        #captureOriginalStyle(video) {
            const computedStyle = window.getComputedStyle(video);
            const computedTransform = computedStyle.transform;
            const computedWillChange = computedStyle.willChange;

            return {
                step: 0,
                baseTransform: computedTransform && computedTransform !== 'none' ? computedTransform : '',
                activeWillChange: computedWillChange && computedWillChange !== 'auto'
                    ? [...new Set(computedWillChange.split(',').map(value => value.trim()).filter(Boolean).concat('transform'))].join(', ')
                    : 'transform',
                originalTransform: video.style.getPropertyValue('transform'),
                originalTransformPriority: video.style.getPropertyPriority('transform'),
                originalWillChange: video.style.getPropertyValue('will-change'),
                originalWillChangePriority: video.style.getPropertyPriority('will-change')
            };
        }

        #restoreOriginalStyle(video, state) {
            if (state.originalTransform) {
                video.style.setProperty('transform', state.originalTransform, state.originalTransformPriority);
            } else {
                video.style.removeProperty('transform');
            }

            if (state.originalWillChange) {
                video.style.setProperty('will-change', state.originalWillChange, state.originalWillChangePriority);
            } else {
                video.style.removeProperty('will-change');
            }
        }

        #applyRotation(video) {
            const state = this.#rotationState.get(video) ?? this.#captureOriginalStyle(video);
            const nextStep = (state.step + 1) % VideoRotator.#CONFIG.ROTATION_STEPS;

            if (nextStep === 0) {
                this.#restoreOriginalStyle(video, state);
                this.#rotationState.delete(video);
                return;
            }

            const rotationTransform = this.#calculateTransform(nextStep, video);
            const transformStyle = [state.baseTransform, rotationTransform].filter(Boolean).join(' ');

            // Use a temporary important declaration so author styles cannot suppress the requested rotation.
            // The exact pre-existing inline declarations and priorities are restored after the fourth step.
            video.style.setProperty('transform', transformStyle, 'important');
            video.style.setProperty('will-change', state.activeWillChange, 'important');
            state.step = nextStep;
            this.#rotationState.set(video, state);
        }

        #handleKeyDown(event) {
            if (!event.isTrusted || event.repeat || !this.#isShortcutPressed(event) || this.#isTargetEditable(event.target)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const targetVideo = this.#findPrioritizedVideo();
            if (targetVideo) {
                this.#applyRotation(targetVideo);
            }
        }
    }

    new VideoRotator();

  })();
  
})();
