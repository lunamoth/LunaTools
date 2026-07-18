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
    
    const STATUS_VISIBLE_DURATION = 3000;
    const MAX_RESTORE_FILE_SIZE = 32 * 1024 * 1024;
    const BACKUP_URL_REVOKE_DELAY_MS = 60 * 1000;
    const BACKUP_FORMAT_VERSION = 2;
    const BACKUP_SNAPSHOT_MODE = 'known-keys-full';
    const MAX_SESSION_URL_LENGTH = 2048;
    const MAX_SESSION_ID_LENGTH = 256;
    const MAX_LIST_NAME_LENGTH = 200;
    const MAX_MULTI_URL_INTERVAL_SECONDS = Math.floor(0x7FFFFFFF / 1000);
    const MAX_BACKUP_SESSION_COUNT = 250000;
    const MAX_BACKUP_TABS_PER_SESSION = 300;
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

    // --- Helper Functions ---

    const setDataControlsDisabled = (disabled) => {
        if (saveButton) saveButton.disabled = disabled;
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

    const getValuesFromTextarea = (textarea, { lowercase = false } = {}) => {
        if (!textarea) return [];
        return textarea.value
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean)
            .map(value => lowercase ? value.toLowerCase() : value);
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

    const normalizeSessionGroupInfo = (value, contextMessage) => {
        if (value === null || value === undefined) return null;
        if (!isRecord(value)) {
            throw new Error(`${contextMessage}의 탭 그룹 데이터가 올바르지 않습니다.`);
        }

        const normalized = {};
        if (hasOwn(value, 'title')) {
            if (typeof value.title !== 'string') {
                throw new Error(`${contextMessage}의 탭 그룹 제목 데이터가 올바르지 않습니다.`);
            }
            normalized.title = value.title.slice(0, 200);
        }
        if (hasOwn(value, 'color')) {
            if (typeof value.color !== 'string') {
                throw new Error(`${contextMessage}의 탭 그룹 색상 데이터가 올바르지 않습니다.`);
            }
            if (SUPPORTED_TAB_GROUP_COLORS.has(value.color)) normalized.color = value.color;
        }
        if (hasOwn(value, 'collapsed')) {
            if (typeof value.collapsed !== 'boolean') {
                throw new Error(`${contextMessage}의 탭 그룹 접힘 상태 데이터가 올바르지 않습니다.`);
            }
            normalized.collapsed = value.collapsed;
        }

        return Object.keys(normalized).length > 0 ? normalized : null;
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
                    (!hasOwn(tab, 'groupId') || Number.isInteger(tab.groupId)) &&
                    (!hasOwn(tab, 'windowId') || Number.isInteger(tab.windowId));

                if (!validTab) {
                    throw new Error(`${sessionIndex + 1}번째 세션의 ${tabIndex + 1}번째 탭 데이터가 올바르지 않습니다.`);
                }

                const normalizedTab = { url: normalizedUrl };
                if (hasOwn(tab, 'title')) normalizedTab.title = tab.title;
                if (hasOwn(tab, 'pinned')) normalizedTab.pinned = tab.pinned;
                if (hasOwn(tab, 'groupId')) normalizedTab.groupId = tab.groupId;
                if (hasOwn(tab, 'windowId')) normalizedTab.windowId = tab.windowId;
                if (hasOwn(tab, 'groupInfo')) {
                    normalizedTab.groupInfo = normalizeSessionGroupInfo(tab.groupInfo, `${sessionIndex + 1}번째 세션의 ${tabIndex + 1}번째 탭`);
                }
                return normalizedTab;
            });

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

    const getRestoreKeyScope = (rawBackupData, rawArea, knownKeys) => {
        const isFullKnownKeysSnapshot = Number(rawBackupData.formatVersion) >= BACKUP_FORMAT_VERSION &&
            rawBackupData.snapshotMode === BACKUP_SNAPSHOT_MODE;

        if (isFullKnownKeysSnapshot) return [...knownKeys];
        return knownKeys.filter(key => hasOwn(rawArea, key));
    };

    const normalizeBackupData = (rawBackupData) => {
        if (!rawBackupData || typeof rawBackupData !== 'object') {
            throw new Error('유효하지 않은 백업 파일 형식입니다.');
        }

        const syncRaw = rawBackupData.sync;
        const localRaw = rawBackupData.local;

        if (!syncRaw || typeof syncRaw !== 'object' || Array.isArray(syncRaw)) {
            throw new Error('유효하지 않은 백업 파일 형식입니다.');
        }
        if (!localRaw || typeof localRaw !== 'object' || Array.isArray(localRaw)) {
            throw new Error('유효하지 않은 백업 파일 형식입니다.');
        }

        const syncKeysToReplace = getRestoreKeyScope(rawBackupData, syncRaw, SYNC_KEYS);
        const localKeysToReplace = getRestoreKeyScope(rawBackupData, localRaw, LOCAL_KEYS);

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

    const replaceKnownStorageKeys = async (storageArea, knownKeys, desiredData) => {
        const dataToSet = {};
        for (const key of knownKeys) {
            if (hasOwn(desiredData, key)) dataToSet[key] = desiredData[key];
        }

        if (Object.keys(dataToSet).length > 0) {
            await storageArea.set(dataToSet);
        }

        const keysToRemove = knownKeys.filter(key => !hasOwn(desiredData, key));
        if (keysToRemove.length > 0) {
            await storageArea.remove(keysToRemove);
        }
    };

    const restoreStorageSnapshots = async (syncSnapshot, localSnapshot) => {
        const rollbackResults = await Promise.allSettled([
            replaceKnownStorageKeys(chrome.storage.sync, SYNC_KEYS, syncSnapshot),
            replaceKnownStorageKeys(chrome.storage.local, LOCAL_KEYS, localSnapshot)
        ]);
        return rollbackResults.every(result => result.status === 'fulfilled');
    };

    // --- Actions ---

    const saveOptions = () => {
        if (!beginDataOperation()) {
            showStatus('다른 데이터 작업이 진행 중입니다.', true);
            return;
        }

        const settingsToSave = {
            [STORAGE_KEYS.LOCKED]: getValuesFromTextarea(lockedSitesTextarea, { lowercase: true }),
            [STORAGE_KEYS.BLOCKED]: getValuesFromTextarea(blockedSitesTextarea),
            [STORAGE_KEYS.DISABLED_DRAG]: getValuesFromTextarea(disabledDragSitesTextarea, { lowercase: true })
        };

        if (chrome && chrome.storage && chrome.storage.sync) {
            try {
                chrome.storage.sync.set(settingsToSave, () => {
                    if (chrome.runtime.lastError) {
                        showStatus(`저장 실패: ${chrome.runtime.lastError.message}`, true);
                    } else {
                        showStatus('설정이 저장되었습니다.');
                    }
                    finishDataOperation();
                });
            } catch (error) {
                showStatus(`저장 실패: ${error.message}`, true);
                finishDataOperation();
            }
        } else {
            console.error('Chrome Storage API is not available.');
            showStatus('저장 기능을 사용할 수 없습니다.', true);
            finishDataOperation();
        }
    };

    const restoreOptions = () => {
        if (chrome && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.get(SYNC_KEYS, (items) => {
                if (chrome.runtime.lastError) {
                    showStatus('설정 불러오기 실패!', true);
                } else {
                    if (lockedSitesTextarea) {
                        lockedSitesTextarea.value = (items[STORAGE_KEYS.LOCKED] || []).join('\n');
                    }
                    if (blockedSitesTextarea) {
                        blockedSitesTextarea.value = (items[STORAGE_KEYS.BLOCKED] || []).join('\n');
                    }
                    if (disabledDragSitesTextarea) {
                        disabledDragSitesTextarea.value = (items[STORAGE_KEYS.DISABLED_DRAG] || []).join('\n');
                    }
                }
            });
        } else {
             console.error('Chrome Storage API is not available.');
        }
    };

    const handleBackup = async () => {
        if (!beginDataOperation()) {
            showStatus('다른 데이터 작업이 진행 중입니다.', true);
            return;
        }

        try {
            const syncData = await chrome.storage.sync.get(SYNC_KEYS);
            const localData = await chrome.storage.local.get(LOCAL_KEYS);

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
                await new Promise((resolve, reject) => {
                    chrome.downloads.download({ url, filename }, (downloadId) => {
                        const downloadError = chrome.runtime.lastError;
                        if (downloadId === undefined || downloadError) {
                            reject(new Error(downloadError?.message || '다운로드를 시작할 수 없습니다.'));
                            return;
                        }
                        resolve(downloadId);
                    });
                });
                setTimeout(() => URL.revokeObjectURL(url), BACKUP_URL_REVOKE_DELAY_MS);
                showStatus('데이터를 성공적으로 백업했습니다.');
            } catch (downloadError) {
                URL.revokeObjectURL(url);
                throw downloadError;
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
            let syncSnapshot = null;
            let localSnapshot = null;
            let reloadScheduled = false;
            try {
                const backupData = normalizeBackupData(JSON.parse(e.target.result));
                
                // 경고 후 진행
                if (!confirm('경고: 현재 LunaTools 설정과 데이터(URL 목록, 세션 포함)가 백업 파일의 내용으로 대체됩니다. 계속하시겠습니까?')) {
                    if (restoreFileInput) restoreFileInput.value = ''; // Reset file input
                    return;
                }

                syncSnapshot = await chrome.storage.sync.get(SYNC_KEYS);
                localSnapshot = await chrome.storage.local.get(LOCAL_KEYS);

                await replaceKnownStorageKeys(chrome.storage.sync, backupData.syncKeysToReplace, backupData.sync);
                await replaceKnownStorageKeys(chrome.storage.local, backupData.localKeysToReplace, backupData.local);
                
                showStatus('데이터를 성공적으로 복원했습니다. 페이지가 새로고침됩니다.');
                
                // 페이지를 새로고침하여 모든 변경사항을 완전히 적용
                setTimeout(() => {
                    location.reload();
                }, 1500);
                reloadScheduled = true;

            } catch (error) {
                console.error('Restore failed:', error);
                if (syncSnapshot && localSnapshot) {
                    const rollbackSucceeded = await restoreStorageSnapshots(syncSnapshot, localSnapshot);
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
