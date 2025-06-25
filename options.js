document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    const lockedSitesTextarea = document.getElementById('lockedSites');
    const blockedSitesTextarea = document.getElementById('blockedSites');
    const disabledDragSitesTextarea = document.getElementById('disabledDragSites');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');
    const elementsWithHighlight = document.querySelectorAll('.liquid-glass, .btn--primary');

    const STORAGE_KEYS = {
        LOCKED: 'lockedSites',
        BLOCKED: 'blockedSites',
        DISABLED_DRAG: 'disabledDragSites'
    };
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
        const keysToGet = [STORAGE_KEYS.LOCKED, STORAGE_KEYS.BLOCKED, STORAGE_KEYS.DISABLED_DRAG];

        if (chrome && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.get(keysToGet, (items) => {
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

    const init = () => {
        if (saveButton) {
            saveButton.addEventListener('click', saveOptions);
        }
        restoreOptions();
        initializeDynamicHighlight();
    };

    init();
});