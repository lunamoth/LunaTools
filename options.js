// LunaTools 는 여러 창/탭에서 옵션 페이지를 열고 동시에 작업을 진행하는 것 자체를 지원하지 않고, 가정하지도 않습니다.

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    // --- DOM Elements ---
    const lockedSitesTextarea = document.getElementById('lockedSites');
    const blockedSitesTextarea = document.getElementById('blockedSites');
    const disabledDragSitesTextarea = document.getElementById('disabledDragSites');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');
    const backupButton = document.getElementById('backupButton');
    const restoreButton = document.getElementById('restoreButton');
    const restoreFileInput = document.getElementById('restoreFileInput');
    
    // Tab Elements
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    // Select all elements for the glass effect (including the new guide cards)
    const elementsWithHighlight = document.querySelectorAll('.liquid-glass, .btn--primary');

    // --- Storage Keys ---
    const STORAGE_KEYS = {
        // Sync storage
        LOCKED: 'lockedSites',
        BLOCKED: 'blockedSites',
        DISABLED_DRAG: 'disabledDragSites',
        // Local storage
        MULTI_URL_OPTIONS: 'multiOpenUrlOptions',
        SAVED_URL_LISTS: 'savedUrlLists',
        SESSIONS: 'sessions'
    };
    const SYNC_KEYS = [STORAGE_KEYS.LOCKED, STORAGE_KEYS.BLOCKED, STORAGE_KEYS.DISABLED_DRAG];
    const LOCAL_KEYS = [STORAGE_KEYS.MULTI_URL_OPTIONS, STORAGE_KEYS.SAVED_URL_LISTS, STORAGE_KEYS.SESSIONS];
    const LOCAL_DATA_STORAGE_LOCK = 'lunatools-local-data-storage';
    const SESSION_RESTORE_PENDING_KEY = 'lunatools-session-restore-pending';

    const runWithLocalDataStorageLock = async (operation, { requireLock = false } = {}) => {
        const lockManager = globalThis.navigator?.locks;
        if (!lockManager || typeof lockManager.request !== 'function') {
            if (requireLock) throw new Error('데이터 보호 잠금을 사용할 수 없어 작업을 중단했습니다.');
            return operation();
        }

        let operationStarted = false;
        try {
            return await lockManager.request(
                LOCAL_DATA_STORAGE_LOCK,
                { mode: 'exclusive' },
                () => {
                    operationStarted = true;
                    return operation();
                }
            );
        } catch (error) {
            // 일부 제한된 문맥에서 잠금 획득 자체가 거부되더라도 기존 저장 기능은 유지한다.
            // 콜백이 시작된 뒤의 오류는 작업 오류이므로 절대 재실행하지 않는다.
            if (operationStarted) throw error;
            if (requireLock) throw new Error('데이터 보호 잠금을 얻지 못해 작업을 중단했습니다.');
            return operation();
        }
    };
    
    const STATUS_VISIBLE_DURATION = 3000;
    const MAX_RESTORE_FILE_SIZE = 32 * 1024 * 1024;
    const BACKUP_FORMAT_VERSION = 2;
    const BACKUP_SNAPSHOT_MODE = 'known-keys-full';
    const MAX_SESSION_URL_LENGTH = 2048;
    const MAX_SESSION_ID_LENGTH = 256;
    const MAX_LIST_NAME_LENGTH = 200;
    const MAX_MULTI_URL_INTERVAL_SECONDS = Math.floor(0x7FFFFFFF / 1000);
    const MAX_BACKUP_SESSION_COUNT = 250000;
    const MAX_BACKUP_TABS_PER_SESSION = 300;
    const MAX_BACKUP_WINDOWS_PER_SESSION = 100;
    const MAX_BACKUP_TOTAL_SESSION_TABS = 550000;
    const SUPPORTED_TAB_GROUP_COLORS = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
    const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    const HOSTNAME_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
    const IPV4_HOSTNAME_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
    const IPV6_HOSTNAME_REGEX = /^\[[0-9a-f:.]+\]$/i;
    const CONTROL_CHARACTER_REGEX = /[\u0000-\u001F\u007F]/u;
    const SESSION_URL_CONTROL_CHARACTER_REGEX = CONTROL_CHARACTER_REGEX;
    let statusHideTimer = null;
    let dataOperationInProgress = false;
    let loadedSiteSettings = null;
    const siteFields = {
        [STORAGE_KEYS.LOCKED]: lockedSitesTextarea,
        [STORAGE_KEYS.BLOCKED]: blockedSitesTextarea,
        [STORAGE_KEYS.DISABLED_DRAG]: disabledDragSitesTextarea
    };

    // --- Helper Functions ---

    const createDownloadInterruptedError = (reason) => new Error(
        reason
            ? `다운로드가 중단되었습니다. (${reason})`
            : '다운로드가 완료되기 전에 중단되었습니다.'
    );

    const createDownloadErasedError = () => new Error(
        '다운로드가 완료되기 전에 다운로드 기록이 삭제되었습니다.'
    );

    const downloadAndWaitForCompletion = (options) => new Promise((resolve, reject) => {
        let downloadId = null;
        let settled = false;
        const terminalStates = new Map();
        const interruptionReasons = new Map();
        const erasedDownloadIds = new Set();

        const cleanup = () => {
            try {
                chrome.downloads.onChanged.removeListener(handleDownloadChanged);
            } catch (_) {
            }
            try {
                chrome.downloads.onErased.removeListener(handleDownloadErased);
            } catch (_) {
            }
            terminalStates.clear();
            interruptionReasons.clear();
            erasedDownloadIds.clear();
        };

        const settle = (handler, value) => {
            if (settled) return;
            settled = true;
            cleanup();
            handler(value);
        };

        const handleTerminalState = ({ state, reason = '' }) => {
            if (state === 'complete') {
                settle(resolve);
            } else if (state === 'interrupted') {
                settle(reject, createDownloadInterruptedError(reason));
            }
        };

        function handleDownloadChanged(delta) {
            if (!Number.isInteger(delta?.id)) return;

            if (delta.error?.current) {
                interruptionReasons.set(delta.id, String(delta.error.current));
            }

            const state = delta.state?.current;
            if (state !== 'complete' && state !== 'interrupted') return;

            const terminalState = {
                state,
                reason: interruptionReasons.get(delta.id) || String(delta.error?.current || '')
            };
            if (downloadId === null) {
                terminalStates.set(delta.id, terminalState);
            } else if (delta.id === downloadId) {
                handleTerminalState(terminalState);
            }
        }

        function handleDownloadErased(erasedDownloadId) {
            if (!Number.isInteger(erasedDownloadId)) return;

            if (downloadId === null) {
                erasedDownloadIds.add(erasedDownloadId);
            } else if (erasedDownloadId === downloadId) {
                settle(reject, createDownloadErasedError());
            }
        }

        try {
            chrome.downloads.onChanged.addListener(handleDownloadChanged);
            chrome.downloads.onErased.addListener(handleDownloadErased);
            chrome.downloads.download(options, (createdDownloadId) => {
                const downloadError = chrome.runtime.lastError;
                if (!Number.isInteger(createdDownloadId) || downloadError) {
                    settle(reject, new Error(downloadError?.message || '다운로드를 시작할 수 없습니다.'));
                    return;
                }

                downloadId = createdDownloadId;
                const earlyTerminalState = terminalStates.get(downloadId);
                if (earlyTerminalState) {
                    handleTerminalState(earlyTerminalState);
                    return;
                }
                if (erasedDownloadIds.has(downloadId)) {
                    settle(reject, createDownloadErasedError());
                    return;
                }

                // Very small Blob downloads can finish before the start callback
                // is delivered. Keep the listener above, and also inspect the
                // current item once so an already-terminal state is not missed.
                try {
                    chrome.downloads.search({ id: downloadId }, (items) => {
                        const searchError = chrome.runtime.lastError;
                        if (settled || searchError) return;
                        const item = Array.isArray(items) ? items[0] : null;
                        if (item?.state === 'complete' || item?.state === 'interrupted') {
                            handleTerminalState({
                                state: item.state,
                                reason: String(item.error || interruptionReasons.get(downloadId) || '')
                            });
                        }
                    });
                } catch (_) {
                    // onChanged remains authoritative if the one-time state
                    // inspection is unavailable.
                }
            });
        } catch (error) {
            settle(reject, error instanceof Error ? error : new Error(String(error)));
        }
    });

    const setDataControlsDisabled = (disabled) => {
        if (saveButton) saveButton.disabled = disabled || !loadedSiteSettings;
        if (backupButton) backupButton.disabled = disabled;
        if (restoreButton) restoreButton.disabled = disabled;
    };

    const beginDataOperation = () => {
        if (dataOperationInProgress) return false;
        dataOperationInProgress = true;
        setDataControlsDisabled(true);
        return true;
    };

    const finishDataOperation = () => {
        dataOperationInProgress = false;
        setDataControlsDisabled(false);
    };

    const showStatus = (message, isError = false) => {
        if (!statusDiv) return;
        if (statusHideTimer) clearTimeout(statusHideTimer);
        statusDiv.textContent = message;
        statusDiv.className = `status-toast liquid-glass ${isError ? 'error' : 'success'} show`;
        statusHideTimer = setTimeout(() => {
            statusDiv.classList.remove('show');
            statusHideTimer = null;
        }, STATUS_VISIBLE_DURATION);
    };

    const initializeDynamicHighlight = () => {
        elementsWithHighlight.forEach(element => {
            element.addEventListener('mousemove', (e) => {
                const rect = element.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                element.style.setProperty('--mouse-x', `${x}px`);
                element.style.setProperty('--mouse-y', `${y}px`);
            });
        });
    };

    const initializeTabs = () => {
        tabButtons.forEach(tab => {
            tab.addEventListener('click', () => {
                // Remove active class from all
                tabButtons.forEach(t => t.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));

                // Add active class to clicked tab and target content
                tab.classList.add('active');
                const targetId = tab.getAttribute('data-tab');
                const targetContent = document.getElementById(targetId);
                if (targetContent) {
                    targetContent.classList.add('active');
                }
            });
        });
    };

    const getValuesFromTextarea = (textarea) => {
        if (!textarea) return [];
        return textarea.value
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean);
    };

    const normalizeStringArray = (value) => {
        if (value === undefined) return [];
        if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
            throw new Error('사이트 설정 목록 데이터의 형식이 올바르지 않습니다.');
        }
        return value
            .map(item => item.trim())
            .filter(Boolean);
    };

    const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    const normalizeListName = (name) => String(name ?? '').trim().replace(/\s+/g, ' ');
    const isValidSessionId = (id) => {
        if (typeof id === 'number') return Number.isFinite(id);
        if (typeof id !== 'string') return false;
        return id.trim().length > 0 && id.length <= MAX_SESSION_ID_LENGTH && !CONTROL_CHARACTER_REGEX.test(id);
    };
    const isValidListName = (name) => {
        const normalizedName = normalizeListName(name);
        return Boolean(normalizedName) &&
            normalizedName.length <= MAX_LIST_NAME_LENGTH &&
            !CONTROL_CHARACTER_REGEX.test(normalizedName) &&
            !RESERVED_OBJECT_KEYS.has(normalizedName);
    };


    const normalizeMultiUrlOptions = (value) => {
        if (!isRecord(value)) {
            throw new Error('여러 URL 열기 옵션 데이터의 형식이 올바르지 않습니다.');
        }

        const normalized = {};
        if (hasOwn(value, 'interval')) {
            const interval = Number(value.interval);
            if (!Number.isFinite(interval) || interval < 0.1 || interval > MAX_MULTI_URL_INTERVAL_SECONDS) {
                throw new Error('URL 열기 간격 옵션이 올바르지 않습니다.');
            }
            normalized.interval = interval;
        }

        for (const key of ['removeDuplicates', 'focusLock', 'delayLoading', 'sortUrlsBeforeRun', 'playSound']) {
            if (!hasOwn(value, key)) continue;
            if (typeof value[key] !== 'boolean') {
                throw new Error(`여러 URL 열기 옵션 '${key}'의 값이 올바르지 않습니다.`);
            }
            normalized[key] = value[key];
        }

        return normalized;
    };

    const normalizeSavedUrlLists = (value) => {
        if (!isRecord(value)) {
            throw new Error('저장된 URL 목록 데이터의 형식이 올바르지 않습니다.');
        }

        const normalized = Object.create(null);
        for (const [name, list] of Object.entries(value)) {
            const normalizedName = normalizeListName(name);
            if (!isValidListName(normalizedName) || !isRecord(list) || typeof list.urls !== 'string') {
                throw new Error(`URL 목록 '${name}'의 데이터가 올바르지 않습니다.`);
            }
            if (hasOwn(normalized, normalizedName)) {
                throw new Error(`URL 목록 '${name}'의 이름이 다른 목록과 충돌합니다.`);
            }
            if (hasOwn(list, 'createdAt') && typeof list.createdAt !== 'string') {
                throw new Error(`URL 목록 '${name}'의 생성 시각 데이터가 올바르지 않습니다.`);
            }
            normalized[normalizedName] = {
                urls: list.urls,
                createdAt: typeof list.createdAt === 'string' ? list.createdAt : new Date().toISOString()
            };
        }
        return Object.fromEntries(Object.entries(normalized));
    };

    const isValidBackupHostname = (hostname) => {
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
    };

    const normalizeSafeSessionUrl = (url) => {
        if (typeof url !== 'string') return null;
        const trimmedUrl = url.trim();
        if (!trimmedUrl || trimmedUrl.length > MAX_SESSION_URL_LENGTH || SESSION_URL_CONTROL_CHARACTER_REGEX.test(trimmedUrl)) return null;
        if (/^[\\/]/.test(trimmedUrl)) return null;
        try {
            const parsed = new URL(trimmedUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
            if (parsed.href.length > MAX_SESSION_URL_LENGTH) return null;
            if (parsed.username || parsed.password) return null;
            if (!isValidBackupHostname(parsed.hostname)) return null;
            return parsed.href;
        } catch (_) {
            return null;
        }
    };

    const normalizeSessionGroupInfo = (value, contextMessage, { requireComplete = false } = {}) => {
        if (value === null || value === undefined) {
            if (requireComplete) {
                throw new Error(`${contextMessage}의 탭 그룹 데이터가 누락되었습니다.`);
            }
            return null;
        }
        if (!isRecord(value)) {
            throw new Error(`${contextMessage}의 탭 그룹 데이터가 올바르지 않습니다.`);
        }

        const normalized = {};
        if (hasOwn(value, 'title')) {
            if (typeof value.title !== 'string') {
                throw new Error(`${contextMessage}의 탭 그룹 제목 데이터가 올바르지 않습니다.`);
            }
            // The 200-character session-name limit does not apply to Chrome
            // tab group titles. A backup must preserve the entire title.
            normalized.title = value.title;
        }
        if (hasOwn(value, 'color')) {
            if (typeof value.color !== 'string') {
                throw new Error(`${contextMessage}의 탭 그룹 색상 데이터가 올바르지 않습니다.`);
            }
            if (!SUPPORTED_TAB_GROUP_COLORS.has(value.color)) {
                throw new Error(`${contextMessage}의 탭 그룹 색상 데이터가 올바르지 않습니다.`);
            }
            normalized.color = value.color;
        }
        if (hasOwn(value, 'collapsed')) {
            if (typeof value.collapsed !== 'boolean') {
                throw new Error(`${contextMessage}의 탭 그룹 접힘 상태 데이터가 올바르지 않습니다.`);
            }
            normalized.collapsed = value.collapsed;
        }

        if (requireComplete && (!hasOwn(normalized, 'color') || !hasOwn(normalized, 'collapsed'))) {
            throw new Error(`${contextMessage}의 탭 그룹 데이터가 불완전합니다.`);
        }

        return Object.keys(normalized).length > 0 ? normalized : null;
    };

    const getSessionRestoreWindowCount = (tabs) => {
        const windowKeys = new Set();
        for (const tab of tabs) {
            const windowKey = tab.windowId === undefined || tab.windowId === null
                ? 'single-window'
                : String(tab.windowId);
            windowKeys.add(windowKey);
        }
        return windowKeys.size;
    };

    const validateSessionMetadata = (tabs, contextMessage) => {
        const groupMetadataByKey = new Map();
        const windowPrivacyByKey = new Map();

        for (const tab of tabs) {
            const windowKey = tab.windowId === undefined || tab.windowId === null
                ? 'single-window'
                : String(tab.windowId);
            const incognito = tab.incognito === true;
            if (windowPrivacyByKey.has(windowKey) && windowPrivacyByKey.get(windowKey) !== incognito) {
                throw new Error(`${contextMessage}의 같은 창에 서로 다른 시크릿 모드 정보가 들어 있습니다.`);
            }
            windowPrivacyByKey.set(windowKey, incognito);

            if (!Number.isSafeInteger(tab.groupId) || tab.groupId < 0) continue;

            const groupKey = `${windowKey}:${tab.groupId}`;
            const groupInfo = tab.groupInfo;
            const signature = JSON.stringify([
                typeof groupInfo?.title === 'string' ? groupInfo.title : '',
                groupInfo?.color,
                groupInfo?.collapsed
            ]);

            if (groupMetadataByKey.has(groupKey) && groupMetadataByKey.get(groupKey) !== signature) {
                throw new Error(`${contextMessage}의 같은 탭 그룹에 서로 다른 그룹 정보가 들어 있습니다.`);
            }
            groupMetadataByKey.set(groupKey, signature);
        }
    };

    const normalizeSessions = (value) => {
        if (!Array.isArray(value)) {
            throw new Error('세션 데이터의 형식이 올바르지 않습니다.');
        }
        if (value.length > MAX_BACKUP_SESSION_COUNT) {
            throw new Error(`세션 데이터가 너무 큽니다. 세션은 최대 ${MAX_BACKUP_SESSION_COUNT}개까지 복원할 수 있습니다.`);
        }

        let totalTabCount = 0;
        const seenSessionIds = new Set();
        return value.map((session, sessionIndex) => {
            const sessionName = typeof session?.name === 'string' ? session.name.trim() : '';
            const validSession = isRecord(session) &&
                isValidSessionId(session.id) &&
                sessionName.length > 0 &&
                sessionName.length <= 200 &&
                Array.isArray(session.tabs) &&
                session.tabs.length > 0;

            if (validSession && session.tabs.length > MAX_BACKUP_TABS_PER_SESSION) {
                throw new Error(`${sessionIndex + 1}번째 세션의 탭 수가 너무 많습니다. 세션당 최대 ${MAX_BACKUP_TABS_PER_SESSION}개까지 복원할 수 있습니다.`);
            }
            if (validSession) {
                totalTabCount += session.tabs.length;
                if (totalTabCount > MAX_BACKUP_TOTAL_SESSION_TABS) {
                    throw new Error(`세션 탭 데이터가 너무 큽니다. 전체 탭은 최대 ${MAX_BACKUP_TOTAL_SESSION_TABS}개까지 복원할 수 있습니다.`);
                }
            }

            if (!validSession) {
                throw new Error(`${sessionIndex + 1}번째 세션의 형식이 올바르지 않습니다.`);
            }

            const sessionIdKey = String(session.id);
            if (seenSessionIds.has(sessionIdKey)) {
                throw new Error(`${sessionIndex + 1}번째 세션의 ID가 다른 세션과 충돌합니다.`);
            }
            seenSessionIds.add(sessionIdKey);

            const normalizedTabs = session.tabs.map((tab, tabIndex) => {
                if (!isRecord(tab)) {
                    throw new Error(`${sessionIndex + 1}번째 세션의 ${tabIndex + 1}번째 탭 데이터가 올바르지 않습니다.`);
                }

                const normalizedUrl = normalizeSafeSessionUrl(tab.url);
                const validTab = normalizedUrl &&
                    (!hasOwn(tab, 'title') || typeof tab.title === 'string') &&
                    (!hasOwn(tab, 'pinned') || typeof tab.pinned === 'boolean') &&
                    (!hasOwn(tab, 'incognito') || typeof tab.incognito === 'boolean') &&
                    (!hasOwn(tab, 'groupId') || (Number.isSafeInteger(tab.groupId) && tab.groupId >= -1)) &&
                    (!hasOwn(tab, 'windowId') || Number.isInteger(tab.windowId));

                if (!validTab) {
                    throw new Error(`${sessionIndex + 1}번째 세션의 ${tabIndex + 1}번째 탭 데이터가 올바르지 않습니다.`);
                }

                const normalizedTab = { url: normalizedUrl };
                if (hasOwn(tab, 'title')) normalizedTab.title = tab.title;
                if (hasOwn(tab, 'pinned')) normalizedTab.pinned = tab.pinned;
                if (hasOwn(tab, 'incognito')) normalizedTab.incognito = tab.incognito;
                if (hasOwn(tab, 'groupId')) normalizedTab.groupId = tab.groupId;
                if (hasOwn(tab, 'windowId')) normalizedTab.windowId = tab.windowId;
                const tabContext = `${sessionIndex + 1}번째 세션의 ${tabIndex + 1}번째 탭`;
                const groupId = hasOwn(tab, 'groupId') ? tab.groupId : -1;
                if (groupId >= 0) {
                    if (tab.pinned === true) {
                        throw new Error(`${tabContext}은 고정 탭과 탭 그룹 상태를 동시에 가질 수 없습니다.`);
                    }
                    normalizedTab.groupInfo = normalizeSessionGroupInfo(
                        tab.groupInfo,
                        tabContext,
                        { requireComplete: true }
                    );
                } else if (hasOwn(tab, 'groupInfo')) {
                    if (tab.groupInfo !== null && tab.groupInfo !== undefined) {
                        throw new Error(`${tabContext}의 탭 그룹 데이터가 그룹 ID와 일치하지 않습니다.`);
                    }
                    normalizedTab.groupInfo = null;
                }
                return normalizedTab;
            });

            validateSessionMetadata(normalizedTabs, `${sessionIndex + 1}번째 세션`);

            if (getSessionRestoreWindowCount(normalizedTabs) > MAX_BACKUP_WINDOWS_PER_SESSION) {
                throw new Error(`${sessionIndex + 1}번째 세션의 창 수가 너무 많습니다. 세션당 최대 ${MAX_BACKUP_WINDOWS_PER_SESSION}개까지 복원할 수 있습니다.`);
            }

            if (hasOwn(session, 'isPinned') && typeof session.isPinned !== 'boolean') {
                throw new Error(`${sessionIndex + 1}번째 세션의 고정 상태가 올바르지 않습니다.`);
            }

            const normalizedSession = {
                id: session.id,
                name: sessionName,
                tabs: normalizedTabs
            };
            if (hasOwn(session, 'isPinned')) normalizedSession.isPinned = session.isPinned;
            return normalizedSession;
        });
    };

    const getBackupEnvelopeMode = (rawBackupData) => {
        const hasFormatVersion = hasOwn(rawBackupData, 'formatVersion');

        // Backups created before the v2 envelope are restored with the original
        // partial-key semantics. Keep that compatibility, but never guess the
        // semantics of a declared current/future format: a wrong guess can
        // silently delete or retain unrelated user data.
        if (!hasFormatVersion) return 'legacy-partial';

        const formatVersion = Number(rawBackupData.formatVersion);
        if (!Number.isSafeInteger(formatVersion) || formatVersion < 1) {
            throw new Error('유효하지 않은 백업 파일 버전입니다.');
        }
        if (formatVersion > BACKUP_FORMAT_VERSION) {
            throw new Error(`이 백업은 더 새로운 형식(v${formatVersion})입니다. LunaTools를 업데이트한 뒤 다시 복원해주세요.`);
        }

        if (formatVersion === BACKUP_FORMAT_VERSION) {
            if (rawBackupData.snapshotMode !== BACKUP_SNAPSHOT_MODE) {
                throw new Error('현재 백업 형식의 스냅샷 정보가 올바르지 않습니다.');
            }
            return 'full-known-keys';
        }

        return 'legacy-partial';
    };

    const getRestoreKeyScope = (backupEnvelopeMode, rawArea, knownKeys) => {
        if (backupEnvelopeMode === 'full-known-keys') return [...knownKeys];
        return knownKeys.filter(key => hasOwn(rawArea, key));
    };

    const normalizeBackupData = (rawBackupData) => {
        if (!rawBackupData || typeof rawBackupData !== 'object' || Array.isArray(rawBackupData)) {
            throw new Error('유효하지 않은 백업 파일 형식입니다.');
        }

        const backupEnvelopeMode = getBackupEnvelopeMode(rawBackupData);
        const syncRaw = rawBackupData.sync;
        const localRaw = rawBackupData.local;

        if (!syncRaw || typeof syncRaw !== 'object' || Array.isArray(syncRaw)) {
            throw new Error('유효하지 않은 백업 파일 형식입니다.');
        }
        if (!localRaw || typeof localRaw !== 'object' || Array.isArray(localRaw)) {
            throw new Error('유효하지 않은 백업 파일 형식입니다.');
        }

        const syncKeysToReplace = getRestoreKeyScope(backupEnvelopeMode, syncRaw, SYNC_KEYS);
        const localKeysToReplace = getRestoreKeyScope(backupEnvelopeMode, localRaw, LOCAL_KEYS);

        const normalizedSync = {};
        if (hasOwn(syncRaw, STORAGE_KEYS.LOCKED)) {
            normalizedSync[STORAGE_KEYS.LOCKED] = normalizeStringArray(syncRaw[STORAGE_KEYS.LOCKED]);
        }
        if (hasOwn(syncRaw, STORAGE_KEYS.BLOCKED)) {
            normalizedSync[STORAGE_KEYS.BLOCKED] = normalizeStringArray(syncRaw[STORAGE_KEYS.BLOCKED]);
        }
        if (hasOwn(syncRaw, STORAGE_KEYS.DISABLED_DRAG)) {
            normalizedSync[STORAGE_KEYS.DISABLED_DRAG] = normalizeStringArray(syncRaw[STORAGE_KEYS.DISABLED_DRAG]);
        }

        const normalizedLocal = {};
        if (hasOwn(localRaw, STORAGE_KEYS.MULTI_URL_OPTIONS)) {
            normalizedLocal[STORAGE_KEYS.MULTI_URL_OPTIONS] = normalizeMultiUrlOptions(localRaw[STORAGE_KEYS.MULTI_URL_OPTIONS]);
        }
        if (hasOwn(localRaw, STORAGE_KEYS.SAVED_URL_LISTS)) {
            normalizedLocal[STORAGE_KEYS.SAVED_URL_LISTS] = normalizeSavedUrlLists(localRaw[STORAGE_KEYS.SAVED_URL_LISTS]);
        }
        if (hasOwn(localRaw, STORAGE_KEYS.SESSIONS)) {
            normalizedLocal[STORAGE_KEYS.SESSIONS] = normalizeSessions(localRaw[STORAGE_KEYS.SESSIONS]);
        }

        return {
            sync: normalizedSync,
            local: normalizedLocal,
            syncKeysToReplace,
            localKeysToReplace
        };
    };

    const replaceKnownStorageKeys = async (storageArea, knownKeys, desiredData, previousData) => {
        const changes = {};
        const removals = [];
        for (const key of knownKeys) {
            if (hasOwn(desiredData, key)) {
                if (JSON.stringify(desiredData[key]) !== JSON.stringify(previousData[key])) {
                    changes[key] = desiredData[key];
                }
            } else if (hasOwn(previousData, key)) {
                removals.push(key);
            }
        }

        if (!Object.keys(changes).length) {
            if (removals.length) await storageArea.remove(removals);
            return { changed: removals.length > 0, retainedDefaults: false };
        }

        // Commit replacements and resets in one write. If the write is rejected,
        // earlier sessions and settings are still intact, even at the quota limit.
        for (const key of removals) {
            changes[key] = SYNC_KEYS.includes(key) || key === STORAGE_KEYS.SESSIONS ? [] : {};
        }
        await storageArea.set(changes);
        let preservedSyncUpdate = false;
        let retainedDefaults = false;
        if (removals.length) {
            try {
                let keysToRemove = removals;
                if (storageArea === chrome.storage.sync) {
                    // Device sync can replace a just-written default before cleanup.
                    const latest = await storageArea.get(removals);
                    keysToRemove = removals.filter(key => {
                        if (!hasOwn(latest, key)) return false;
                        if (Array.isArray(latest[key]) && latest[key].length === 0) return true;
                        preservedSyncUpdate = true;
                        return false;
                    });
                }
                if (keysToRemove.length) await storageArea.remove(keysToRemove);
            } catch (error) {
                // All consumers treat these empty lists/maps as the missing-key
                // default. The requested data is already in place.
                console.warn('LunaTools: 비어 있는 기본값의 키를 삭제하지 못했습니다.', error);
                retainedDefaults = true;
            }
        }
        return { changed: true, retainedDefaults, preservedSyncUpdate };
    };

    // --- Actions ---

    const saveOptions = async () => {
        if (!loadedSiteSettings || !beginDataOperation()) return;

        // Keep the raw draft so an edit made during an asynchronous write stays visible.
        const draft = Object.fromEntries(SYNC_KEYS.map(key => [key, siteFields[key].value]));
        const formValues = Object.fromEntries(SYNC_KEYS.map(key => [key, getValuesFromTextarea(siteFields[key])]));
        try {
            const saved = await runWithLocalDataStorageLock(async () => {
                const stored = await chrome.storage.sync.get(SYNC_KEYS);
                const current = Object.fromEntries(SYNC_KEYS.map(key => [key, normalizeStringArray(stored[key])]));
                const changes = {};
                for (const key of SYNC_KEYS) {
                    const baseline = JSON.stringify(loadedSiteSettings[key]);
                    if (JSON.stringify(formValues[key]) === baseline) continue;
                    const requested = key === STORAGE_KEYS.BLOCKED ? formValues[key] : formValues[key].map(s => s.toLowerCase());
                    const latest = JSON.stringify(current[key]);
                    if (latest === JSON.stringify(requested)) continue;
                    if (latest !== baseline) {
                        throw new Error('편집한 사이트 목록이 동기화 중에 변경되었습니다. 입력 내용을 복사한 뒤 설정을 다시 열어 비교해주세요.');
                    }
                    changes[key] = requested;
                }
                if (Object.keys(changes).length) await chrome.storage.sync.set(changes);
                return { ...current, ...changes };
            });
            loadedSiteSettings = saved;
            for (const key of SYNC_KEYS) {
                if (siteFields[key].value === draft[key]) siteFields[key].value = saved[key].join('\n');
            }
            showStatus('설정이 저장되었습니다.');
        } catch (error) {
            showStatus(`저장 실패: ${error.message}`, true);
        } finally {
            finishDataOperation();
        }
    };

    const restoreOptions = () => {
        loadedSiteSettings = null;
        setDataControlsDisabled(true);

        if (chrome && chrome.storage && chrome.storage.sync) {
            try {
                chrome.storage.sync.get(SYNC_KEYS, (items) => {
                    if (chrome.runtime.lastError) {
                        setDataControlsDisabled(false);
                        showStatus('설정 불러오기 실패! 페이지를 새로고침해 주세요.', true);
                        return;
                    }

                    try {
                        if (!items || typeof items !== 'object' || Array.isArray(items)) {
                            throw new Error('동기화 설정 데이터의 형식이 올바르지 않습니다.');
                        }

                        // Validate every value before touching the form. A partial update
                        // could otherwise be saved back over settings that failed to load.
                        loadedSiteSettings = Object.fromEntries(
                            SYNC_KEYS.map(key => [key, normalizeStringArray(items[key])])
                        );
                        for (const key of SYNC_KEYS) siteFields[key].value = loadedSiteSettings[key].join('\n');
                        setDataControlsDisabled(false);
                    } catch (error) {
                        console.error('Failed to restore options:', error);
                        setDataControlsDisabled(false);
                        showStatus(`설정 불러오기 실패: ${error.message}`, true);
                    }
                });
            } catch (error) {
                console.error('Failed to access synchronized options:', error);
                setDataControlsDisabled(false);
                showStatus('설정 불러오기 실패! 페이지를 새로고침해 주세요.', true);
            }
        } else {
            console.error('Chrome Storage API is not available.');
            setDataControlsDisabled(false);
            showStatus('설정 불러오기 기능을 사용할 수 없습니다.', true);
        }
    };

    const handleBackup = async () => {
        if (!beginDataOperation()) {
            showStatus('다른 데이터 작업이 진행 중입니다.', true);
            return;
        }

        try {
            const { syncData, localData } = await runWithLocalDataStorageLock(async () => ({
                syncData: await chrome.storage.sync.get(SYNC_KEYS),
                localData: await chrome.storage.local.get(LOCAL_KEYS)
            }));

            const backupData = {
                formatVersion: BACKUP_FORMAT_VERSION,
                snapshotMode: BACKUP_SNAPSHOT_MODE,
                extensionVersion: chrome.runtime.getManifest().version,
                exportedAt: new Date().toISOString(),
                sync: syncData,
                local: localData
            };

            const jsonString = JSON.stringify(backupData);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const now = new Date();
            const dateString = now.getFullYear().toString().slice(-2) +
                               ('0' + (now.getMonth() + 1)).slice(-2) +
                               ('0' + now.getDate()).slice(-2);
            const filename = `${dateString}_LunaTools_Backup.json`;

            try {
                await downloadAndWaitForCompletion({ url, filename });
                showStatus('데이터를 성공적으로 백업했습니다.');
            } catch (downloadError) {
                throw downloadError;
            } finally {
                URL.revokeObjectURL(url);
            }
        } catch (error) {
            console.error('Backup failed:', error);
            showStatus(`백업 실패: ${error.message}`, true);
        } finally {
            finishDataOperation();
        }
    };

    const handleRestoreFileSelect = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.size > MAX_RESTORE_FILE_SIZE) {
            showStatus('복원 실패: 백업 파일이 너무 큽니다. (최대 32MiB)', true);
            if (restoreFileInput) restoreFileInput.value = '';
            return;
        }

        if (!beginDataOperation()) {
            showStatus('다른 데이터 작업이 진행 중입니다.', true);
            if (restoreFileInput) restoreFileInput.value = '';
            return;
        }

        const finishRestoreAttempt = () => {
            finishDataOperation();
            if (restoreFileInput) restoreFileInput.value = '';
        };

        const reader = new FileReader();
        reader.onerror = () => {
            showStatus('복원 실패: 백업 파일을 읽을 수 없습니다.', true);
            finishRestoreAttempt();
        };
        reader.onload = async (e) => {
            let reloadScheduled = false;
            let rollbackAttempted = false;
            let rollbackSucceeded = false;
            try {
                const backupData = normalizeBackupData(JSON.parse(e.target.result));

                // Confirm against a coherent snapshot. A session saved while
                // this dialog is open must not be silently replaced afterward.
                const confirmedSnapshot = await runWithLocalDataStorageLock(async () => ({
                    sync: await chrome.storage.sync.get(SYNC_KEYS),
                    local: await chrome.storage.local.get(LOCAL_KEYS)
                }), { requireLock: true });

                if (!confirm('경고: 현재 LunaTools 설정과 데이터(URL 목록, 세션 포함)가 백업 파일의 내용으로 대체됩니다. 계속하시겠습니까?')) {
                    if (restoreFileInput) restoreFileInput.value = ''; // Reset file input
                    return;
                }

                const restoreResult = await runWithLocalDataStorageLock(async () => {
                    const syncSnapshot = await chrome.storage.sync.get(SYNC_KEYS);
                    const localSnapshot = await chrome.storage.local.get(LOCAL_KEYS);

                    if (JSON.stringify(syncSnapshot) !== JSON.stringify(confirmedSnapshot.sync) ||
                        JSON.stringify(localSnapshot) !== JSON.stringify(confirmedSnapshot.local)) {
                        throw new Error('확인하는 동안 설정 또는 데이터가 변경되어 복원을 중단했습니다. 현재 상태를 확인한 뒤 다시 시도해주세요.');
                    }

                    // Commit sync last. A sync rate/size rejection cannot leave
                    // changed remote settings that would need another quota-limited write.
                    const localKeys = backupData.localKeysToReplace;
                    const restoresSessions = localKeys.includes(STORAGE_KEYS.SESSIONS);
                    let previouslyPending = false;
                    if (restoresSessions) {
                        // Shared across extension pages. If rollback itself fails,
                        // session export must not treat provisional data as committed.
                        const pending = await chrome.storage.session.get(SESSION_RESTORE_PENDING_KEY);
                        previouslyPending = Boolean(pending[SESSION_RESTORE_PENDING_KEY]);
                        await chrome.storage.session.set({ [SESSION_RESTORE_PENDING_KEY]: true });
                    }
                    let localResult;
                    let committed = false;
                    try {
                        localResult = await replaceKnownStorageKeys(
                            chrome.storage.local, localKeys, backupData.local, localSnapshot
                        );
                        const syncKeys = backupData.syncKeysToReplace;
                        if (localResult.changed && syncKeys.length) {
                            // Device sync can update these keys while local data is being written.
                            const latestSync = await chrome.storage.sync.get(syncKeys);
                            if (syncKeys.some(key => JSON.stringify(latestSync[key]) !== JSON.stringify(syncSnapshot[key]))) {
                                throw new Error('로컬 데이터를 복원하는 동안 동기화 설정이 변경되었습니다. 현재 상태를 확인한 뒤 다시 시도해주세요.');
                            }
                        }
                        const syncResult = await replaceKnownStorageKeys(
                            chrome.storage.sync, syncKeys, backupData.sync, syncSnapshot
                        );
                        committed = true;
                        return {
                            retainedDefaults: localResult.retainedDefaults || syncResult.retainedDefaults,
                            preservedSyncUpdate: syncResult.preservedSyncUpdate
                        };
                    } catch (restoreWriteError) {
                        if (localResult?.changed) {
                            rollbackAttempted = true;
                            try {
                                const localAfterWrite = await chrome.storage.local.get(localKeys);
                                const result = await replaceKnownStorageKeys(
                                    chrome.storage.local, localKeys, localSnapshot, localAfterWrite
                                );
                                rollbackSucceeded = !result.retainedDefaults;
                            } catch (rollbackError) {
                                console.error('LunaTools: 복원 전 로컬 데이터 복구 실패', rollbackError);
                            }
                        }
                        throw restoreWriteError;
                    } finally {
                        // A rejected initial atomic write leaves old data intact.
                        // An earlier unresolved restore is cleared only by a new
                        // successful session restore, not by another failed attempt.
                        if (restoresSessions && (committed ||
                            (!previouslyPending && (!localResult?.changed || rollbackSucceeded)))) {
                            await chrome.storage.session.remove(SESSION_RESTORE_PENDING_KEY);
                        }
                    }
                }, { requireLock: true });

                const messages = ['데이터를 복원했습니다.'];
                if (restoreResult.preservedSyncUpdate) messages.push('복원 중 새로 동기화된 사이트 목록을 유지했습니다.');
                if (restoreResult.retainedDefaults) messages.push('일부 빈 항목은 기본값으로 저장되었습니다.');
                messages.push('페이지가 새로고침됩니다.');
                showStatus(messages.join(' '));

                // 페이지를 새로고침하여 모든 변경사항을 완전히 적용
                setTimeout(() => {
                    location.reload();
                }, 1500);
                reloadScheduled = true;

            } catch (error) {
                console.error('Restore failed:', error);
                if (rollbackAttempted) {
                    if (rollbackSucceeded) {
                        showStatus(`복원 실패: ${error.message} 기존 데이터는 복구되었습니다.`, true);
                    } else {
                        showStatus(`복원 실패 및 자동 복구 실패: ${error.message} 백업 파일과 현재 저장소를 확인해주세요.`, true);
                    }
                } else {
                    showStatus(`복원 실패: ${error.message}`, true);
                }
            } finally {
                if (!reloadScheduled) finishRestoreAttempt();
            }
        };
        try {
            reader.readAsText(file);
        } catch (error) {
            console.error('Restore file read failed:', error);
            showStatus('복원 실패: 백업 파일을 읽을 수 없습니다.', true);
            finishRestoreAttempt();
        }
    };

    const init = () => {
        if (saveButton) {
            saveButton.addEventListener('click', saveOptions);
        }
        if (backupButton) {
            backupButton.addEventListener('click', handleBackup);
        }
        if (restoreButton) {
            restoreButton.addEventListener('click', () => {
                if (restoreFileInput) restoreFileInput.click();
            });
        }
        if (restoreFileInput) {
            restoreFileInput.addEventListener('change', handleRestoreFileSelect);
        }

        restoreOptions();
        initializeDynamicHighlight();
        initializeTabs();
    };

    init();
});
