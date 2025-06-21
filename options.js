document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    const STORAGE_KEYS = {
        LOCKED: 'lockedSites',
        BLOCKED: 'blockedSites'
    };

    const lockedSitesTextarea = document.getElementById('lockedSites');
    const blockedSitesTextarea = document.getElementById('blockedSites');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');

    const getValuesFromTextarea = (textarea) => {
        return textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
    };

    const showStatus = (message, isError = false) => {
        statusDiv.textContent = message;
        statusDiv.classList.toggle('error', isError);
        statusDiv.classList.add('show');
        setTimeout(() => {
            statusDiv.classList.remove('show');
        }, 3000);
    };

    const saveOptions = () => {
        const settingsToSave = {
            [STORAGE_KEYS.LOCKED]: getValuesFromTextarea(lockedSitesTextarea),
            [STORAGE_KEYS.BLOCKED]: getValuesFromTextarea(blockedSitesTextarea)
        };

        chrome.storage.sync.set(settingsToSave, () => {
            if (chrome.runtime.lastError) {
                showStatus(`❌ 저장 실패: ${chrome.runtime.lastError.message}`, true);
            } else {
                showStatus('✓ 설정이 저장되었습니다.');
            }
        });
    };

    const restoreOptions = () => {
        const defaultValues = {
            [STORAGE_KEYS.LOCKED]: [],
            [STORAGE_KEYS.BLOCKED]: []
        };

        chrome.storage.sync.get(defaultValues, (items) => {
            if (chrome.runtime.lastError) {
                showStatus('❌ 설정 불러오기 실패!', true);
            } else {
                lockedSitesTextarea.value = items[STORAGE_KEYS.LOCKED].join('\n');
                blockedSitesTextarea.value = items[STORAGE_KEYS.BLOCKED].join('\n');
            }
        });
    };

    saveButton.addEventListener('click', saveOptions);
    restoreOptions();
});