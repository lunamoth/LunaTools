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
        if (!Array.isArray(value)) return [];
        return value
            .filter(item => typeof item === 'string')
            .map(item => item.trim())
            .filter(Boolean);
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

        const normalizedSync = { ...syncRaw };
        normalizedSync[STORAGE_KEYS.LOCKED] = normalizeStringArray(syncRaw[STORAGE_KEYS.LOCKED]);
        normalizedSync[STORAGE_KEYS.BLOCKED] = normalizeStringArray(syncRaw[STORAGE_KEYS.BLOCKED]);
        normalizedSync[STORAGE_KEYS.DISABLED_DRAG] = normalizeStringArray(syncRaw[STORAGE_KEYS.DISABLED_DRAG]);

        return {
            sync: normalizedSync,
            local: { ...localRaw }
        };
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
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const backupData = normalizeBackupData(JSON.parse(e.target.result));
                
                // 경고 후 진행
                if (!confirm('경고: 현재 모든 설정과 데이터(URL 목록, 세션 포함)가 백업 파일의 내용으로 대체됩니다. 계속하시겠습니까?')) {
                    restoreFileInput.value = ''; // Reset file input
                    return;
                }

                // clear()를 먼저 호출하지 않고, 새 데이터 반영 후 남은 키를 정리한다.
                const existingSync = await chrome.storage.sync.get(null);
                const existingLocal = await chrome.storage.local.get(null);
                const syncKeysToRemove = Object.keys(existingSync).filter(key => !(key in backupData.sync));
                const localKeysToRemove = Object.keys(existingLocal).filter(key => !(key in backupData.local));

                await chrome.storage.sync.set(backupData.sync);
                await chrome.storage.local.set(backupData.local);
                if (syncKeysToRemove.length > 0) {
                    await chrome.storage.sync.remove(syncKeysToRemove);
                }
                if (localKeysToRemove.length > 0) {
                    await chrome.storage.local.remove(localKeysToRemove);
                }
                
                showStatus('데이터를 성공적으로 복원했습니다. 페이지가 새로고침됩니다.');
                
                // 페이지를 새로고침하여 모든 변경사항을 완전히 적용
                setTimeout(() => {
                    location.reload();
                }, 1500);

            } catch (error) {
                console.error('Restore failed:', error);
                showStatus(`복원 실패: ${error.message}`, true);
            } finally {
                restoreFileInput.value = ''; // Reset file input for next use
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
            restoreButton.addEventListener('click', () => restoreFileInput.click());
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
