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
    const MAX_RESTORE_FILE_SIZE = 10 * 1024 * 1024;
    const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

    // --- Helper Functions ---

    const showStatus = (message, isError = false) => {
        if (!statusDiv) return;
        statusDiv.textContent = message;
        statusDiv.className = `status-toast liquid-glass ${isError ? 'error' : 'success'} show`;
        setTimeout(() => {
            statusDiv.classList.remove('show');
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
        return textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
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

    const cloneJsonValue = (value) => JSON.parse(JSON.stringify(value));

    const normalizeMultiUrlOptions = (value) => {
        if (!isRecord(value)) {
            throw new Error('여러 URL 열기 옵션 데이터의 형식이 올바르지 않습니다.');
        }

        const normalized = {};
        if (hasOwn(value, 'interval')) {
            const interval = Number(value.interval);
            if (!Number.isFinite(interval) || interval < 0.1) {
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
            if (RESERVED_OBJECT_KEYS.has(name) || !isRecord(list) || typeof list.urls !== 'string') {
                throw new Error(`URL 목록 '${name}'의 데이터가 올바르지 않습니다.`);
            }
            if (hasOwn(list, 'createdAt') && typeof list.createdAt !== 'string') {
                throw new Error(`URL 목록 '${name}'의 생성 시각 데이터가 올바르지 않습니다.`);
            }
            normalized[name] = {
                urls: list.urls,
                createdAt: typeof list.createdAt === 'string' ? list.createdAt : new Date().toISOString()
            };
        }
        return Object.fromEntries(Object.entries(normalized));
    };

    const isSafeSessionUrl = (url) => {
        if (typeof url !== 'string') return false;
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch (_) {
            return false;
        }
    };

    const normalizeSessions = (value) => {
        if (!Array.isArray(value)) {
            throw new Error('세션 데이터의 형식이 올바르지 않습니다.');
        }

        return value.map((session, sessionIndex) => {
            const validSession = isRecord(session) &&
                (typeof session.id === 'number' || typeof session.id === 'string') &&
                typeof session.name === 'string' &&
                session.name.length > 0 &&
                session.name.length <= 200 &&
                Array.isArray(session.tabs) &&
                session.tabs.length > 0;

            if (!validSession) {
                throw new Error(`${sessionIndex + 1}번째 세션의 형식이 올바르지 않습니다.`);
            }

            for (const [tabIndex, tab] of session.tabs.entries()) {
                const validTab = isRecord(tab) &&
                    isSafeSessionUrl(tab.url) &&
                    (!hasOwn(tab, 'title') || typeof tab.title === 'string') &&
                    (!hasOwn(tab, 'pinned') || typeof tab.pinned === 'boolean') &&
                    (!hasOwn(tab, 'groupId') || typeof tab.groupId === 'number') &&
                    (!hasOwn(tab, 'windowId') || typeof tab.windowId === 'number');

                if (!validTab) {
                    throw new Error(`${sessionIndex + 1}번째 세션의 ${tabIndex + 1}번째 탭 데이터가 올바르지 않습니다.`);
                }
            }

            if (hasOwn(session, 'isPinned') && typeof session.isPinned !== 'boolean') {
                throw new Error(`${sessionIndex + 1}번째 세션의 고정 상태가 올바르지 않습니다.`);
            }

            return cloneJsonValue(session);
        });
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

        const normalizedSync = {
            [STORAGE_KEYS.LOCKED]: normalizeStringArray(syncRaw[STORAGE_KEYS.LOCKED]),
            [STORAGE_KEYS.BLOCKED]: normalizeStringArray(syncRaw[STORAGE_KEYS.BLOCKED]),
            [STORAGE_KEYS.DISABLED_DRAG]: normalizeStringArray(syncRaw[STORAGE_KEYS.DISABLED_DRAG])
        };

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
            local: normalizedLocal
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
        const settingsToSave = {
            [STORAGE_KEYS.LOCKED]: getValuesFromTextarea(lockedSitesTextarea),
            [STORAGE_KEYS.BLOCKED]: getValuesFromTextarea(blockedSitesTextarea),
            [STORAGE_KEYS.DISABLED_DRAG]: getValuesFromTextarea(disabledDragSitesTextarea)
        };

        if (chrome && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.set(settingsToSave, () => {
                if (chrome.runtime.lastError) {
                    showStatus(`저장 실패: ${chrome.runtime.lastError.message}`, true);
                } else {
                    showStatus('설정이 저장되었습니다.');
                }
            });
        } else {
            console.error('Chrome Storage API is not available.');
            showStatus('저장 기능을 사용할 수 없습니다.', true);
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
        try {
            const syncData = await chrome.storage.sync.get(SYNC_KEYS);
            const localData = await chrome.storage.local.get(LOCAL_KEYS);

            const backupData = {
                formatVersion: 1,
                extensionVersion: chrome.runtime.getManifest().version,
                sync: syncData,
                local: localData
            };

            const jsonString = JSON.stringify(backupData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const now = new Date();
            const dateString = now.getFullYear().toString().slice(-2) +
                               ('0' + (now.getMonth() + 1)).slice(-2) +
                               ('0' + now.getDate()).slice(-2);
            const filename = `${dateString}_LunaTools_Backup.json`;

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showStatus('데이터를 성공적으로 백업했습니다.');
        } catch (error) {
            console.error('Backup failed:', error);
            showStatus(`백업 실패: ${error.message}`, true);
        }
    };

    const handleRestoreFileSelect = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.size > MAX_RESTORE_FILE_SIZE) {
            showStatus('복원 실패: 백업 파일이 너무 큽니다. (최대 10MB)', true);
            if (restoreFileInput) restoreFileInput.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onerror = () => {
            showStatus('복원 실패: 백업 파일을 읽을 수 없습니다.', true);
            if (restoreFileInput) restoreFileInput.value = '';
        };
        reader.onload = async (e) => {
            let syncSnapshot = null;
            let localSnapshot = null;
            if (restoreButton) restoreButton.disabled = true;
            try {
                const backupData = normalizeBackupData(JSON.parse(e.target.result));
                
                // 경고 후 진행
                if (!confirm('경고: 현재 LunaTools 설정과 데이터(URL 목록, 세션 포함)가 백업 파일의 내용으로 대체됩니다. 계속하시겠습니까?')) {
                    if (restoreFileInput) restoreFileInput.value = ''; // Reset file input
                    return;
                }

                syncSnapshot = await chrome.storage.sync.get(SYNC_KEYS);
                localSnapshot = await chrome.storage.local.get(LOCAL_KEYS);

                await replaceKnownStorageKeys(chrome.storage.sync, SYNC_KEYS, backupData.sync);
                await replaceKnownStorageKeys(chrome.storage.local, LOCAL_KEYS, backupData.local);
                
                showStatus('데이터를 성공적으로 복원했습니다. 페이지가 새로고침됩니다.');
                
                // 페이지를 새로고침하여 모든 변경사항을 완전히 적용
                setTimeout(() => {
                    location.reload();
                }, 1500);

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
                if (restoreButton) restoreButton.disabled = false;
                if (restoreFileInput) restoreFileInput.value = ''; // Reset file input for next use
            }
        };
        reader.readAsText(file);
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
