document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    const lockedSitesTextarea = document.getElementById('lockedSites');
    const blockedSitesTextarea = document.getElementById('blockedSites');
    const disabledDragSitesTextarea = document.getElementById('disabledDragSites');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');
    const backupButton = document.getElementById('backupButton');
    const restoreButton = document.getElementById('restoreButton');
    const restoreFileInput = document.getElementById('restoreFileInput');
    const elementsWithHighlight = document.querySelectorAll('.liquid-glass, .btn--primary');

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

    const getValuesFromTextarea = (textarea) => {
        if (!textarea) return [];
        return textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
    };

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
                const backupData = JSON.parse(e.target.result);

                if (!backupData || typeof backupData.sync !== 'object' || typeof backupData.local !== 'object') {
                    throw new Error('유효하지 않은 백업 파일 형식입니다.');
                }
                
                // 경고 후 진행
                if (!confirm('경고: 현재 모든 설정과 데이터(URL 목록, 세션 포함)가 백업 파일의 내용으로 대체됩니다. 계속하시겠습니까?')) {
                    restoreFileInput.value = ''; // Reset file input
                    return;
                }

                await chrome.storage.sync.clear();
                await chrome.storage.local.clear();

                await chrome.storage.sync.set(backupData.sync);
                await chrome.storage.local.set(backupData.local);
                
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
    };

    init();
});