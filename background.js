const NEW_TAB_URL = "chrome://newtab/";
const PERFORM_GESTURE_ACTION = 'perform-gesture';
const FETCH_EXCHANGE_RATE_ACTION = "fetchLunaToolsExchangeRate";
const REFRESH_EXCHANGE_RATE_TABLE_ACTION = "refreshLunaToolsExchangeRateTable";
const API_TIMEOUT_MS_EXCHANGE_RATE = 7000;
const EXCHANGE_RATE_STORAGE_KEY = "lunaToolsExchangeRateTableV1";
const EXCHANGE_RATE_SCHEMA_VERSION = 1;
const EXCHANGE_RATE_BASE_CURRENCY = "EUR";
const EXCHANGE_RATE_CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
const EXCHANGE_RATE_STALE_RETRY_INTERVAL_MS = 15 * 60 * 1000;
const EXCHANGE_RATE_PUBLICATION_TIME_ZONE = 'Europe/Berlin';
// ECB/Frankfurter는 유럽 현지 시각 약 16:00에 갱신됩니다. 전파 지연을 고려해 30분의 유예를 둡니다.
const EXCHANGE_RATE_PUBLICATION_CUTOFF_MINUTES = (16 * 60) + 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const EXCHANGE_RATE_API_URL = `https://api.frankfurter.dev/v1/latest?base=${EXCHANGE_RATE_BASE_CURRENCY}`;
const FIXED_EURO_CONVERSION_RATES = Object.freeze({
  // 불가리아는 2026-01-01부터 EUR을 도입했으며 공식 고정 환산율은 EUR 1 = BGN 1.95583입니다.
  BGN: 1.95583
});
const CONTEXT_MENU_ID_MERGE_TABS = "lunaToolsMergeTabsContextMenu";
const BADGE_ALERT_THRESHOLD = 100;
const CURRENCY_CODE_REGEX = /^[A-Z]{3}$/;
const MAX_OPEN_TABS_PER_MESSAGE = 100;
const MAX_OPEN_TABS_REQUEST_URLS = 1000;
const MAX_OPEN_TABS_REQUEST_PAYLOAD_CHARS = 200000;
const MAX_OPEN_TAB_URL_LENGTH = 2048;
const SAFE_WEB_PROTOCOLS = new Set(['http:', 'https:']);
const URL_CONTROL_CHARACTER_REGEX = /[\u0000-\u001F\u007F]/u;
const HOSTNAME_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4_HOSTNAME_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_HOSTNAME_REGEX = /^\[[0-9a-f:.]+\]$/i;

let exchangeRateRefreshPromise = null;
let tabCountBadgeUpdatePromise = null;
let tabCountBadgeUpdateRequested = false;

function normalizeCurrencyCode(value) {
  return String(value || '').trim().toUpperCase();
}

function isValidOpenTabHostname(hostname) {
  const normalizedHostname = String(hostname || '').trim().toLowerCase().replace(/\.+$/, '');
  if (!normalizedHostname || normalizedHostname.length > 253) return false;
  if (normalizedHostname === 'localhost') return true;
  if (IPV6_HOSTNAME_REGEX.test(normalizedHostname)) return true;

  if (IPV4_HOSTNAME_REGEX.test(normalizedHostname)) {
    return normalizedHostname.split('.').every(part => {
      if (!/^\d+$/.test(part)) return false;
      const numericPart = Number(part);
      return Number.isInteger(numericPart) && numericPart >= 0 && numericPart <= 255;
    });
  }

  const labels = normalizedHostname.split('.');
  return labels.every(label => HOSTNAME_LABEL_REGEX.test(label));
}

function normalizeOpenTabUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return null;

  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > MAX_OPEN_TAB_URL_LENGTH || URL_CONTROL_CHARACTER_REGEX.test(trimmed)) return null;
  // Relative paths and protocol-relative URLs must not be reinterpreted as external domains.
  if (/^[\\/]/.test(trimmed)) return null;

  const hasHttpScheme = /^https?:\/\//i.test(trimmed);
  const protocolMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);

  // Bare host:port values such as example.com:8443 are valid user input.
  // Other explicit non-web schemes (javascript:, data:, chrome:, file:, ...) must never be opened here.
  if (protocolMatch && !hasHttpScheme) {
    const candidateScheme = protocolMatch[1].toLowerCase();
    const valueAfterColon = trimmed.slice(protocolMatch[0].length);
    const looksLikeBareHostWithPort =
      (candidateScheme.includes('.') || candidateScheme === 'localhost') && /^\d+(?:[/?#]|$)/.test(valueAfterColon);
    if (!looksLikeBareHostWithPort) return null;
  }

  const candidate = hasHttpScheme ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!SAFE_WEB_PROTOCOLS.has(parsed.protocol) || !isValidOpenTabHostname(parsed.hostname)) return null;
    if (parsed.href.length > MAX_OPEN_TAB_URL_LENGTH) return null;
    // Avoid misleading URLs such as https://trusted.example@evil.example/.
    if (parsed.username || parsed.password) return null;
    return parsed.href;
  } catch (_) {
    return null;
  }
}

function normalizeOpenTabsRequestUrls(rawUrls) {
  const urls = [];
  const seenUrls = new Set();
  const stats = { invalid: 0, duplicate: 0, overLimit: 0 };

  if (!Array.isArray(rawUrls)) {
    return {
      urls,
      invalid: 1,
      duplicate: 0,
      overLimit: 0,
      skipped: 1,
      requested: 0,
      requestLimit: MAX_OPEN_TABS_REQUEST_URLS,
      payloadCharLimit: MAX_OPEN_TABS_REQUEST_PAYLOAD_CHARS
    };
  }

  const requested = rawUrls.length;
  const inputCount = Math.min(requested, MAX_OPEN_TABS_REQUEST_URLS);
  stats.overLimit += Math.max(0, requested - inputCount);

  let payloadChars = 0;
  for (let index = 0; index < inputCount; index += 1) {
    const rawUrl = rawUrls[index];
    const rawLength = typeof rawUrl === 'string' ? rawUrl.length : 0;
    if (payloadChars + rawLength > MAX_OPEN_TABS_REQUEST_PAYLOAD_CHARS) {
      stats.overLimit += 1;
      continue;
    }
    payloadChars += rawLength;

    const normalizedUrl = normalizeOpenTabUrl(rawUrl);
    if (!normalizedUrl) {
      stats.invalid += 1;
      continue;
    }

    if (seenUrls.has(normalizedUrl)) {
      stats.duplicate += 1;
      continue;
    }

    if (urls.length >= MAX_OPEN_TABS_PER_MESSAGE) {
      stats.overLimit += 1;
      continue;
    }

    seenUrls.add(normalizedUrl);
    urls.push(normalizedUrl);
  }

  return {
    urls,
    invalid: stats.invalid,
    duplicate: stats.duplicate,
    overLimit: stats.overLimit,
    skipped: stats.invalid + stats.duplicate + stats.overLimit,
    requested,
    requestLimit: MAX_OPEN_TABS_REQUEST_URLS,
    payloadCharLimit: MAX_OPEN_TABS_REQUEST_PAYLOAD_CHARS
  };
}

function isPositiveFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function formatUtcDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getZonedDateTimeParts(now = Date.now(), timeZone = EXCHANGE_RATE_PUBLICATION_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(now))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );

  if (![parts.year, parts.month, parts.day, parts.hour, parts.minute].every(Number.isFinite)) {
    throw new Error('Could not determine exchange-rate publication time.');
  }
  return parts;
}

// Meeus/Jones/Butcher 알고리즘: TARGET 휴무일인 성금요일·부활절 월요일 계산에 사용합니다.
function getGregorianEasterSundayUtc(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function isTargetBusinessDayUtc(date) {
  const dayOfWeek = date.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const isFixedTargetClosingDay =
    (month === 1 && day === 1) ||
    (month === 5 && day === 1) ||
    (month === 12 && (day === 25 || day === 26));
  if (isFixedTargetClosingDay) return false;

  const easterSunday = getGregorianEasterSundayUtc(date.getUTCFullYear());
  const daysFromEaster = Math.round((date.getTime() - easterSunday.getTime()) / ONE_DAY_MS);
  return daysFromEaster !== -2 && daysFromEaster !== 1;
}

function getExpectedLatestExchangeRateDate(now = Date.now()) {
  const parts = getZonedDateTimeParts(now);
  const minutesSinceMidnight = (parts.hour * 60) + parts.minute;
  const candidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

  // 당일 게시 시각 전에는 직전 TARGET 영업일의 고시 환율이 최신입니다.
  if (minutesSinceMidnight < EXCHANGE_RATE_PUBLICATION_CUTOFF_MINUTES) {
    candidate.setUTCDate(candidate.getUTCDate() - 1);
  }
  while (!isTargetBusinessDayUtc(candidate)) {
    candidate.setUTCDate(candidate.getUTCDate() - 1);
  }
  return formatUtcDate(candidate);
}

function isExchangeRateDataCurrent(table, now = Date.now()) {
  if (!table || typeof table.date !== 'string') return false;
  return table.date >= getExpectedLatestExchangeRateDate(now);
}

function wasExchangeRateTableCheckedRecently(table, now = Date.now()) {
  if (!table || !Number.isFinite(table.timestamp)) return false;
  const age = Math.max(0, now - table.timestamp);
  return age < EXCHANGE_RATE_STALE_RETRY_INTERVAL_MS;
}

function normalizeExchangeRateTable(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;

  const base = normalizeCurrencyCode(candidate.base);
  const date = typeof candidate.date === 'string' ? candidate.date.trim() : '';
  const timestamp = Number(candidate.timestamp);

  if (base !== EXCHANGE_RATE_BASE_CURRENCY || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !candidate.rates || typeof candidate.rates !== 'object') {
    return null;
  }

  const rates = { [EXCHANGE_RATE_BASE_CURRENCY]: 1 };
  for (const [rawCode, rawRate] of Object.entries(candidate.rates)) {
    const code = normalizeCurrencyCode(rawCode);
    const rate = Number(rawRate);
    if (CURRENCY_CODE_REGEX.test(code) && Number.isFinite(rate) && rate > 0) {
      rates[code] = rate;
    }
  }

  Object.assign(rates, FIXED_EURO_CONVERSION_RATES);

  if (Object.keys(rates).length < 2) return null;

  return {
    schemaVersion: EXCHANGE_RATE_SCHEMA_VERSION,
    base: EXCHANGE_RATE_BASE_CURRENCY,
    date,
    rates,
    timestamp,
    source: 'Frankfurter v1'
  };
}

function isExchangeRateTableFresh(table, now = Date.now()) {
  if (!table || !Number.isFinite(table.timestamp)) return false;
  const age = Math.max(0, now - table.timestamp);
  return age < EXCHANGE_RATE_CACHE_DURATION_MS && isExchangeRateDataCurrent(table, now);
}

function calculateExchangeRate(table, fromCurrency, toCurrency) {
  const normalizedTable = normalizeExchangeRateTable(table);
  if (!normalizedTable) {
    throw new Error('API response error: Invalid exchange-rate table.');
  }

  const from = normalizeCurrencyCode(fromCurrency);
  const to = normalizeCurrencyCode(toCurrency);

  if (!CURRENCY_CODE_REGEX.test(from) || !CURRENCY_CODE_REGEX.test(to)) {
    throw new Error('Invalid currency code.');
  }
  if (from === to) return 1;

  const fromRate = normalizedTable.rates[from];
  const toRate = normalizedTable.rates[to];
  if (!isPositiveFiniteNumber(fromRate)) {
    throw new Error(`API response error: Could not find rate for ${from}`);
  }
  if (!isPositiveFiniteNumber(toRate)) {
    throw new Error(`API response error: Could not find rate for ${to}`);
  }

  const crossRate = toRate / fromRate;
  if (!isPositiveFiniteNumber(crossRate)) {
    throw new Error(`API response error: Could not calculate ${from}/${to}`);
  }
  return crossRate;
}

async function getStoredExchangeRateTable() {
  const stored = await chrome.storage.local.get([EXCHANGE_RATE_STORAGE_KEY]);
  return normalizeExchangeRateTable(stored[EXCHANGE_RATE_STORAGE_KEY]);
}

function normalizeExchangeRateError(error) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return new Error('Request timed out.');
  }

  const message = error?.message || String(error || 'Unknown error');
  if (
    message.startsWith('Network error') ||
    message.startsWith('API response error') ||
    message.startsWith('API processing error') ||
    message === 'Request timed out.' ||
    message === 'Invalid currency code.'
  ) {
    return new Error(message);
  }
  return new Error(`API processing error: ${message}`);
}

async function fetchAndStoreExchangeRateTable() {
  if (exchangeRateRefreshPromise) return exchangeRateRefreshPromise;

  exchangeRateRefreshPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS_EXCHANGE_RATE);

    try {
      const response = await fetch(EXCHANGE_RATE_API_URL, {
        signal: controller.signal,
        cache: 'no-store'
      });
      if (!response.ok) {
        throw new Error(`Network error (status: ${response.status})`);
      }

      let data;
      try {
        data = await response.json();
      } catch (error) {
        throw new Error(`API processing error: ${error?.message || 'Invalid JSON response.'}`);
      }

      const table = normalizeExchangeRateTable({
        schemaVersion: EXCHANGE_RATE_SCHEMA_VERSION,
        base: data?.base || EXCHANGE_RATE_BASE_CURRENCY,
        date: data?.date,
        rates: data?.rates,
        timestamp: Date.now(),
        source: 'Frankfurter v1'
      });

      if (!table) {
        throw new Error('API response error: Invalid or incomplete exchange-rate table.');
      }

      // 저장이 끝난 뒤에만 호출자에게 성공을 반환합니다.
      await chrome.storage.local.set({ [EXCHANGE_RATE_STORAGE_KEY]: table });
      return table;
    } catch (error) {
      throw normalizeExchangeRateError(error);
    } finally {
      clearTimeout(timeoutId);
    }
  })().finally(() => {
    exchangeRateRefreshPromise = null;
  });

  return exchangeRateRefreshPromise;
}

async function refreshExchangeRateTableIfNeeded({ force = false } = {}) {
  const storedTable = await getStoredExchangeRateTable();
  if (!force && isExchangeRateTableFresh(storedTable)) {
    return storedTable;
  }
  // 게시 직후 공급처 반영이 늦는 경우, 같은 오래된 기준일을 매번 재요청하지 않도록 잠시 대기합니다.
  if (
    !force &&
    storedTable &&
    !isExchangeRateDataCurrent(storedTable) &&
    wasExchangeRateTableCheckedRecently(storedTable)
  ) {
    return storedTable;
  }
  return fetchAndStoreExchangeRateTable();
}

async function getExchangeRateForResponse(fromCurrency, toCurrency, { forceRefresh = false } = {}) {
  const from = normalizeCurrencyCode(fromCurrency);
  const to = normalizeCurrencyCode(toCurrency);

  if (!CURRENCY_CODE_REGEX.test(from) || !CURRENCY_CODE_REGEX.test(to)) {
    throw new Error('Invalid currency code.');
  }
  if (from === to) {
    return {
      rate: 1,
      date: new Date().toISOString().split('T')[0],
      timestamp: Date.now(),
      stale: false,
      refreshing: false
    };
  }

  let table = await getStoredExchangeRateTable();
  const dataCurrent = !!table && isExchangeRateDataCurrent(table);
  const recentlyChecked = !!table && wasExchangeRateTableCheckedRecently(table);
  let stale = !!table && !isExchangeRateTableFresh(table);
  let refreshing = false;

  // 기준일이 기대 최신일보다 뒤처졌다면 단순 백그라운드 갱신이 아니라 이번 변환에서 갱신을 기다립니다.
  // 단, 방금 확인했는데 공급처가 아직 갱신되지 않은 경우에는 15분 동안 재요청을 억제합니다.
  const shouldAwaitRefresh = forceRefresh || !table || (!dataCurrent && !recentlyChecked);

  if (shouldAwaitRefresh) {
    try {
      table = await fetchAndStoreExchangeRateTable();
      stale = !isExchangeRateTableFresh(table);
    } catch (error) {
      if (!table) throw error;
      stale = true;
    }
  } else if (stale) {
    if (dataCurrent) {
      // 기준일은 최신이지만 장시간 재검증하지 않은 경우에만 기존 값을 즉시 반환하고 뒤에서 확인합니다.
      refreshing = true;
      void fetchAndStoreExchangeRateTable().catch((error) => {
        console.warn('LunaTools: 백그라운드 환율표 갱신 실패', error);
      });
    }
  }

  return {
    rate: calculateExchangeRate(table, from, to),
    date: table.date,
    timestamp: table.timestamp,
    stale,
    refreshing,
    expectedDate: getExpectedLatestExchangeRateDate()
  };
}

function warmExchangeRateCache() {
  void refreshExchangeRateTableIfNeeded().catch((error) => {
    console.warn('LunaTools: 환율표 선행 갱신 실패', error);
  });
}

async function performTabCountBadgeUpdate() {
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

function updateTabCountBadge() {
  tabCountBadgeUpdateRequested = true;

  if (!tabCountBadgeUpdatePromise) {
    tabCountBadgeUpdatePromise = (async () => {
      do {
        // Coalesce every tab event received while the current query/write is
        // pending into one trailing refresh. This also guarantees that an
        // older asynchronous result can never overwrite the newest count.
        tabCountBadgeUpdateRequested = false;
        await performTabCountBadgeUpdate();
      } while (tabCountBadgeUpdateRequested);
    })().finally(() => {
      tabCountBadgeUpdatePromise = null;
      if (tabCountBadgeUpdateRequested) {
        void updateTabCountBadge();
      }
    });
  }

  return tabCountBadgeUpdatePromise;
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

function configureSidePanelBehavior() {
  try {
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      void chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => console.warn('LunaTools: 사이드 패널 동작 설정 실패', error));
    }
  } catch (error) {
    console.warn('LunaTools: 사이드 패널 동작 설정 실패', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureMergeTabsContextMenu();
  configureSidePanelBehavior();
  void updateTabCountBadge();
  warmExchangeRateCache();
});

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    ensureMergeTabsContextMenu();
    configureSidePanelBehavior();
    void updateTabCountBadge();
    warmExchangeRateCache();
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID_MERGE_TABS) return;

  void (async () => {
    try {
      await ensureTabCacheInitialized();
      await tabManager.mergeAllWindows(tab?.windowId);
    } catch (error) {
      console.error('LunaTools: 컨텍스트 메뉴 명령 처리 실패', error);
    }
  })();
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
  return message.includes("no window with id") ||
         message.includes("invalid window id") ||
         message.includes("window not found");
}

async function createTabsForOpenRequest(urls, sender) {
  const preferredWindowId = Number.isInteger(sender?.tab?.windowId) ? sender.tab.windowId : null;
  let shouldUsePreferredWindow = preferredWindowId !== null;
  let opened = 0;
  let failed = 0;

  for (const url of urls) {
    const createProperties = { url, active: false };
    if (shouldUsePreferredWindow) {
      createProperties.windowId = preferredWindowId;
    }

    try {
      await chrome.tabs.create(createProperties);
      opened += 1;
    } catch (error) {
      if (shouldUsePreferredWindow && isWindowAccessError(error)) {
        shouldUsePreferredWindow = false;
        try {
          await chrome.tabs.create({ url, active: false });
          opened += 1;
        } catch (fallbackError) {
          failed += 1;
          console.warn('LunaTools: URL 새 탭 열기 실패', fallbackError);
        }
      } else {
        failed += 1;
        console.warn('LunaTools: URL 새 탭 열기 실패', error);
      }
    }
  }

  return { opened, failed };
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
    this.tabCreationOrder = new Map();
    this.nextTabCreationOrder = 1;

    this.handleTabRemoved = this.handleTabRemoved.bind(this);
    this.handleTabUpdate = this.handleTabUpdate.bind(this);
  }

  _recordTabCreated(tabId) {
    if (typeof tabId !== 'number' || this.tabCreationOrder.has(tabId)) return;
    this.tabCreationOrder.set(tabId, this.nextTabCreationOrder++);
  }

  _forgetTabCreationOrder(tabId) {
    if (typeof tabId === 'number') {
      this.tabCreationOrder.delete(tabId);
    }
  }

  _transferTabCreationOrder(removedTabId, addedTabId) {
    if (typeof addedTabId !== 'number') return;

    const creationOrder = this.tabCreationOrder.get(removedTabId);
    this.tabCreationOrder.delete(removedTabId);
    if (creationOrder !== undefined) {
      this.tabCreationOrder.set(addedTabId, creationOrder);
    }
  }

  _compareTabAge(tabA, tabB) {
    const orderA = this.tabCreationOrder.get(tabA.id) ?? 0;
    const orderB = this.tabCreationOrder.get(tabB.id) ?? 0;

    // 서비스 워커 시작 전에 이미 존재하던 탭(순서 0)은 새로 생성된 탭보다 오래된 것으로 취급합니다.
    if (orderA !== orderB) {
      if (orderA === 0) return -1;
      if (orderB === 0) return 1;
      return orderA - orderB;
    }

    const indexA = Number.isInteger(tabA.index) ? tabA.index : Number.MAX_SAFE_INTEGER;
    const indexB = Number.isInteger(tabB.index) ? tabB.index : Number.MAX_SAFE_INTEGER;
    if (indexA !== indexB) return indexA - indexB;

    return (tabA.id ?? Number.MAX_SAFE_INTEGER) - (tabB.id ?? Number.MAX_SAFE_INTEGER);
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

    // pendingUrl은 아직 커밋되지 않은 실제 이동 대상이고, url은 마지막으로 커밋된 주소입니다.
    // 로딩 중 탭을 이동할 때 이전 주소를 중복으로 오인해 닫지 않도록 pendingUrl을 우선합니다.
    return pendingUrl || url || null;
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

    const previousCacheEntry = this.urlCache.get(tabId);
    if (previousCacheEntry?.url?.href && previousCacheEntry.url.href !== parsedUrl.href) {
      this._removeTabIdFromReverseLookup(tabId, previousCacheEntry.url.href);
    }

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

    const cachedInfo = this.urlCache.get(tabId);
    this.urlCache.delete(tabId);

    const urlKeysToClean = new Set();
    if (urlInstanceOrString) {
      urlKeysToClean.add((urlInstanceOrString instanceof URL) ? urlInstanceOrString.href : String(urlInstanceOrString));
    }
    if (cachedInfo?.url?.href) {
      urlKeysToClean.add(cachedInfo.url.href);
    }

    if (urlKeysToClean.size > 0) {
      urlKeysToClean.forEach(urlKey => this._removeTabIdFromReverseLookup(tabId, urlKey));
      return;
    }

    // Defensive cleanup for rare navigation/replacement races where the caller no longer knows the cached URL.
    for (const urlKey of Array.from(this.reverseUrlLookup.keys())) {
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
    if (typeof windowId !== 'number') return;

    const entriesToRemove = [];
    for (const [tabId, cachedInfo] of this.urlCache.entries()) {
      if (cachedInfo.windowId === windowId) {
        entriesToRemove.push([tabId, cachedInfo.url]);
      }
    }

    for (const [tabId, cachedUrl] of entriesToRemove) {
      this._removeUrlFromCache(tabId, cachedUrl);
    }
  }

  async initializeCache() {
    try {
      const allTabs = await chrome.tabs.query({ windowType: 'normal' });
      const liveTabIds = new Set(allTabs.map(tab => tab.id).filter(id => typeof id === 'number'));
      for (const tabId of this.tabCreationOrder.keys()) {
        if (!liveTabIds.has(tabId)) this.tabCreationOrder.delete(tabId);
      }

      this.urlCache.clear();
      this.reverseUrlLookup.clear();
      allTabs.forEach(tab => {
        if (!this._isValidTabForProcessing(tab)) return;
        const urlString = this._getTabUrlString(tab);
        const parsedUrl = this._tryParseUrl(urlString);
        if (parsedUrl) {
          this._addUrlToCache(tab.id, parsedUrl, tab.windowId);
        }
      });
      return true;
    } catch (error) {
      console.warn('LunaTools: 탭 캐시 초기화 실패', error);
      return false;
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

  async checkForDuplicateAndFocusExisting(tab, { currentBecameDuplicate = false } = {}) {
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

    await this._findAndHandleDuplicates(tab, parsedUrl, currentBecameDuplicate);
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

  async _findAndHandleDuplicates(currentTab, parsedUrl, currentBecameDuplicate = false) {
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

        for (const existingDuplicateTabId of existingDuplicateTabIds) {
          const result = await this._handleVerifiedDuplicate(
            currentTab,
            existingDuplicateTabId,
            parsedUrl,
            currentBecameDuplicate
          );
          if (result?.currentTabRemoved) break;
        }
      } catch (error) {
      }
    });
  }

  async _handleVerifiedDuplicate(currentTab, existingDuplicateId, parsedUrl, currentBecameDuplicate = false) {
    let liveCurrentTab;
    try {
      liveCurrentTab = await chrome.tabs.get(currentTab.id);
    } catch (e) {
      if (this._isTabNotFoundError(e)) {
        this._removeUrlFromCache(currentTab.id, parsedUrl);
        return { currentTabRemoved: true };
      }
      return { currentTabRemoved: false };
    }

    let liveExistingTab;
    try {
      liveExistingTab = await chrome.tabs.get(existingDuplicateId);
    } catch (e) {
      if (this._isTabNotFoundError(e)) {
        this._removeUrlFromCache(existingDuplicateId, parsedUrl);
        return { currentTabRemoved: false };
      }
      return { currentTabRemoved: false };
    }

    const liveCurrentUrl = this._tryParseUrl(this._getTabUrlString(liveCurrentTab));
    const liveExistingUrl = this._tryParseUrl(this._getTabUrlString(liveExistingTab));
    const tabsStillMatch = liveCurrentTab.windowId === liveExistingTab.windowId &&
      liveCurrentUrl?.href === parsedUrl.href &&
      liveExistingUrl?.href === parsedUrl.href;

    if (!tabsStillMatch) {
      for (const liveTab of [liveCurrentTab, liveExistingTab]) {
        const cachedInfo = this.urlCache.get(liveTab.id);
        if (cachedInfo) this._removeUrlFromCache(liveTab.id, cachedInfo.url);

        const liveUrl = this._tryParseUrl(this._getTabUrlString(liveTab));
        if (liveUrl && this._isValidTabForProcessing(liveTab)) {
          this._addUrlToCache(liveTab.id, liveUrl, liveTab.windowId);
        }
      }
      return { currentTabRemoved: false };
    }

    let tabToKeep = liveExistingTab;
    let tabToRemove = liveCurrentTab;

    // 고정 탭은 사용자가 명시적으로 보존한 작업 공간이므로 일반 탭보다 항상 우선합니다.
    // 두 탭의 고정 상태가 같을 때만 기존의 탐색 시점/생성 순서 규칙을 적용합니다.
    if (Boolean(liveCurrentTab.pinned) !== Boolean(liveExistingTab.pinned)) {
      if (liveCurrentTab.pinned) {
        tabToKeep = liveCurrentTab;
        tabToRemove = liveExistingTab;
      }
    } else if (!currentBecameDuplicate && this._compareTabAge(liveCurrentTab, liveExistingTab) <= 0) {
      tabToKeep = liveCurrentTab;
      tabToRemove = liveExistingTab;
    }

    try {
      if (tabToRemove.active) {
        await chrome.tabs.update(tabToKeep.id, { active: true }).catch(() => {
        });
      }

      await chrome.tabs.remove(tabToRemove.id);
      this._removeUrlFromCache(tabToRemove.id, parsedUrl);
      this._forgetTabCreationOrder(tabToRemove.id);
      return { currentTabRemoved: tabToRemove.id === liveCurrentTab.id };

    } catch (error) {
      if (this._isTabNotFoundError(error)) {
        this._removeUrlFromCache(tabToRemove.id, parsedUrl);
        this._forgetTabCreationOrder(tabToRemove.id);
        return { currentTabRemoved: tabToRemove.id === liveCurrentTab.id };
      }
      return { currentTabRemoved: false };
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
                  let movedTab = await chrome.tabs.move(tabDetail.id, { windowId: targetWindowId, index: nextPinnedInsertIndex });
                  if (movedTab?.pinned === false && typeof movedTab.id === 'number') {
                      const repinnedTab = await chrome.tabs.update(movedTab.id, { pinned: true });
                      if (repinnedTab) movedTab = repinnedTab;
                  }
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
      await this.checkForDuplicateAndFocusExisting(tab, { currentBecameDuplicate: true });
    } else if (tab.status === 'complete' && oldCachedInfo && oldCachedInfo.url.href === newParsedUrl.href) {
      await this.checkForDuplicateAndFocusExisting(tab, { currentBecameDuplicate: false });
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
    this._forgetTabCreationOrder(tabId);
  }
}

const tabManager = new TabManager();
let tabCacheInitialized = false;
let tabCacheInitializationPromise = null;

async function ensureTabCacheInitialized() {
  if (tabCacheInitialized) return true;

  if (!tabCacheInitializationPromise) {
    tabCacheInitializationPromise = tabManager.initializeCache()
      .then((initialized) => {
        tabCacheInitialized = initialized;
        return initialized;
      })
      .finally(() => {
        tabCacheInitializationPromise = null;
      });
  }

  return tabCacheInitializationPromise;
}

async function handleCommand(command, tab) {
  try {
    if (command === "sort-tabs") {
      await ensureTabCacheInitialized();
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
  } catch (error) {
    console.warn(`LunaTools: 단축키 명령 처리 실패 (${command})`, error);
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  void handleCommand(command, tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === 'openTabsInNewTab' && Array.isArray(message.urls)) {
    let request;
    try {
      request = normalizeOpenTabsRequestUrls(message.urls);
    } catch (error) {
      sendResponse({
        ok: false,
        opened: 0,
        failed: 0,
        skipped: 0,
        invalid: 0,
        duplicate: 0,
        overLimit: 0,
        requested: Array.isArray(message.urls) ? message.urls.length : 0,
        limit: MAX_OPEN_TABS_PER_MESSAGE,
        error: error?.message || 'Failed to normalize URL request.'
      });
      return false;
    }
    const { urls, skipped, invalid, duplicate, overLimit, requested } = request;

    if (urls.length === 0) {
      sendResponse({
        ok: false,
        opened: 0,
        failed: 0,
        skipped,
        invalid,
        duplicate,
        overLimit,
        requested,
        limit: MAX_OPEN_TABS_PER_MESSAGE,
        error: 'No valid http/https URLs were provided.'
      });
      return false;
    }

    createTabsForOpenRequest(urls, sender)
      .then(({ opened, failed }) => {
        sendResponse({
          ok: failed === 0 && invalid === 0 && overLimit === 0,
          opened,
          failed,
          skipped,
          invalid,
          duplicate,
          overLimit,
          requested,
          limit: MAX_OPEN_TABS_PER_MESSAGE
        });
      })
      .catch(error => {
        sendResponse({
          ok: false,
          opened: 0,
          failed: urls.length,
          skipped,
          invalid,
          duplicate,
          overLimit,
          requested,
          limit: MAX_OPEN_TABS_PER_MESSAGE,
          error: error?.message || String(error)
        });
      });
    return true;
  }
    
  if (message?.action === PERFORM_GESTURE_ACTION && message.gesture && sender?.tab?.id != null) {
    handleGestureAction(message.gesture, sender.tab.id);
    return false;
  }

  if (message?.action === REFRESH_EXCHANGE_RATE_TABLE_ACTION) {
    fetchAndStoreExchangeRateTable()
      .then((table) => sendResponse({ data: { table } }))
      .catch((error) => sendResponse({ error: normalizeExchangeRateError(error).message }));
    return true;
  }

  if (message?.action === FETCH_EXCHANGE_RATE_ACTION && message.from && message.to) {
    const fromCurrency = normalizeCurrencyCode(message.from);
    const toCurrency = normalizeCurrencyCode(message.to);

    if (!CURRENCY_CODE_REGEX.test(fromCurrency) || !CURRENCY_CODE_REGEX.test(toCurrency)) {
      sendResponse({ error: 'Invalid currency code.' });
      return false;
    }

    getExchangeRateForResponse(fromCurrency, toCurrency, {
      forceRefresh: message.forceRefresh === true
    })
      .then((data) => sendResponse({ data }))
      .catch((error) => sendResponse({ error: normalizeExchangeRateError(error).message }));
    return true;
  }

  
  return false;
});

chrome.action.onClicked.addListener(async (tab) => {
});

chrome.tabs.onCreated.addListener((tab) => {
  void updateTabCountBadge();
  if (!tabManager._isValidTabForProcessing(tab)) return;
  tabManager._recordTabCreated(tab.id);
  
  const urlString = tabManager._getTabUrlString(tab);
  const parsedUrl = tabManager._tryParseUrl(urlString);
  if (parsedUrl) {
    tabManager._addUrlToCache(tab.id, parsedUrl, tab.windowId);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  await ensureTabCacheInitialized();

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
    tabManager._transferTabCreationOrder(removedTabId, addedTabId);
    await ensureTabCacheInitialized();

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
  void updateTabCountBadge();
  tabManager.handleTabRemoved(tabId, removeInfo);
});

chrome.tabs.onAttached.addListener(async (tabId, attachInfo) => {
  await ensureTabCacheInitialized();

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
  const cachedInfo = tabManager.urlCache.get(tabId);

  if (!cachedInfo) return;

  // A tab can be detached before it is attached to a new window. Removing the
  // stale reverse-URL entry prevents duplicate-tab cleanup and window sorting
  // from acting on the tab as if it still belonged to the old window.
  if (!detachInfo || cachedInfo.windowId === detachInfo.oldWindowId) {
    tabManager._removeUrlFromCache(tabId, cachedInfo.url);
  }
});
