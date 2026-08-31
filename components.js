// components.js

import { state, CONSTANTS } from './state.js';
import { setSanitizedHtml } from './sanitizer.js';

// --- DOM 요소 캐싱 ---
const getEl = id => document.getElementById(id);
export const folderList = getEl('folder-list'), noteList = getEl('note-list');
export const addFolderBtn = getEl('add-folder-btn'), addNoteBtn = getEl('add-note-btn');
export const emptyTrashBtn = getEl('empty-trash-btn');
export const notesPanelTitle = getEl('notes-panel-title');
export const searchInput = getEl('search-input'), clearSearchBtn = getEl('clear-search');
export const noteSortSelect = getEl('note-sort-select');
export const importFileInput = getEl('import-file-input');
export const editorContainer = getEl(CONSTANTS.EDITOR.DOM_IDS.container), placeholderContainer = getEl('placeholder-container');
export const noteTitleInput = getEl(CONSTANTS.EDITOR.DOM_IDS.titleInput), noteContentTextarea = getEl(CONSTANTS.EDITOR.DOM_IDS.contentTextArea), noteContentView = getEl(CONSTANTS.EDITOR.DOM_IDS.contentView);
export const editorFooter = getEl(CONSTANTS.EDITOR.DOM_IDS.footer), toastContainer = getEl('toast-container');
const modal = getEl('modal'), modalTitle = getEl('modal-title'), modalMessage = getEl('modal-message');
const modalErrorMessage = getEl('modal-error-message');
const modalForm = getEl('modal-form'), modalInput = getEl('modal-input');
const modalConfirmBtn = getEl('modal-confirm-btn'), modalCancelBtn = getEl('modal-cancel-btn');
const modalCloseBtn = getEl('modal-close-btn');
export const itemTemplate = getEl('item-template');
export const shortcutGuideBtn = getEl('shortcut-guide-btn');
export const settingsBtn = getEl('settings-btn');
export const saveStatusIndicator = getEl(CONSTANTS.EDITOR.DOM_IDS.saveStatus);
export const datePickerPopover = getEl('date-picker-popover');
export const yearInput = getEl('year-input');
export const monthInput = getEl('month-input');
export const datePickerCloseBtn = getEl('date-picker-close-btn');
export const datePickerTodayBtn = getEl('date-picker-today-btn');
export const datePickerConfirmBtn = getEl('date-picker-confirm-btn');

// --- 설정 모달 DOM 요소 캐싱 ---
export const settingsModal = getEl('settings-modal');
export const settingsModalCloseBtn = getEl('settings-modal-close-btn');
export const settingsTabs = document.querySelector('.settings-tabs');
export const settingsTabPanels = document.querySelectorAll('.settings-tab-panel');
export const settingsCol1Width = getEl('settings-col1-width');
export const settingsCol2Width = getEl('settings-col2-width');
export const settingsEditorFontFamily = getEl('settings-editor-font-family');
export const settingsEditorFontSize = getEl('settings-editor-font-size');
export const settingsWeatherLat = getEl('settings-weather-lat');
export const settingsWeatherLon = getEl('settings-weather-lon');
export const settingsWeatherCitySearch = getEl('settings-weather-city-search');
export const settingsWeatherCitySearchBtn = getEl('settings-weather-city-search-btn');
export const settingsWeatherCityResults = getEl('settings-weather-city-results');
export const settingsExportBtn = getEl('settings-export-btn');
export const settingsImportBtn = getEl('settings-import-btn');
export const settingsResetBtn = getEl('settings-reset-btn');
export const settingsSaveBtn = getEl('settings-save-btn');
// [기능 추가] 저장소 사용량 표시 요소를 내보냅니다.
export const settingsStorageUsage = getEl('settings-storage-usage');

// [기능 추가] 습관 트래커 관련 DOM 요소를 내보냅니다.
export const habitTrackerBtn = getEl('habit-tracker-btn');
export const habitTrackerContainer = getEl('habit-tracker-container');
export const habitTrackerIframe = getEl('habit-tracker-iframe');
export const closeHabitTrackerBtn = getEl('close-habit-tracker-btn');

// [기능 추가] 다이어트 챌린지 관련 DOM 요소를 내보냅니다.
export const dietChallengeBtn = getEl('diet-challenge-btn');
export const dietChallengeContainer = getEl('diet-challenge-container');
export const dietChallengeIframe = getEl('diet-challenge-iframe');
export const closeDietChallengeBtn = getEl('close-diet-challenge-btn');


// --- UI 유틸리티 ---
export const formatDate = d => {
    if (!d) return '';
    const date = new Date(d);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const timePart = date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: 'numeric', hour12: true });
    return `${year}. ${month}. ${day}. ${timePart}`;
};

export const showToast = (message, type = CONSTANTS.TOAST_TYPE.SUCCESS, duration = CONSTANTS.TOAST_DURATION) => {
    if (!toastContainer) return;

    // [BUG FIX] duration이 0이면 UI를 가리는 문제를 방지하기 위해 토스트 대신 모달(showAlert)로 처리합니다.
    // 이는 사용자의 확인이 반드시 필요한 중요한 메시지(예: 심각한 오류)에 해당합니다.
    if (duration === 0) {
        showAlert({
            title: type === CONSTANTS.TOAST_TYPE.ERROR ? '❗️ 오류' : '🔔 알림',
            message: message,
            confirmText: '✅ 확인',
        });
        return; // 여기서 함수 실행을 종료합니다.
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    if (message instanceof Node) {
        toast.appendChild(message);
    } else {
        toast.textContent = message;
    }
    
    // 이제 duration이 0인 경우는 없으므로, 해당 조건 분기(if/else)가 필요 없습니다.
    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, duration);

    // [개선] appendChild 대신 prepend를 사용하여 새 토스트가 항상 맨 위에 표시되도록 합니다.
    toastContainer.prepend(toast);
};

// 모달 요청은 하나씩 처리합니다. 동일한 <dialog>를 동시에 재사용하면
// 이벤트 리스너와 UI 상태가 서로 덮어써져 Promise가 끝나지 않을 수 있습니다.
let modalQueue = Promise.resolve();

const _showSingleModal = ({ type, title, message = '', placeholder = '', initialValue = '', confirmText = '✅ 확인', cancelText = '❌ 취소', isHtml = false, hideConfirmButton = false, hideCancelButton = false, validationFn = null, confirmButtonType = 'confirm' }) => {
    const elementToFocusOnClose = document.activeElement;

    return new Promise((resolve, reject) => {
        if (!modal || !modalTitle || !modalMessage || !modalConfirmBtn || !modalCancelBtn || !modalCloseBtn || !modalInput || !modalErrorMessage) {
            reject(new Error('필수 모달 DOM 요소를 찾을 수 없습니다.'));
            return;
        }

        // 이전 호출의 상태가 다음 모달로 새어 들어오지 않도록 매번 초기화합니다.
        // 특히 ESC로 닫으면 returnValue가 갱신되지 않으므로 반드시 빈 값으로 리셋해야 합니다.
        modal.returnValue = '';
        modalTitle.textContent = title;
        modalMessage.innerHTML = '';
        if (message instanceof Node) modalMessage.appendChild(message);
        else if (isHtml) setSanitizedHtml(modalMessage, message);
        else modalMessage.textContent = message;

        modalErrorMessage.textContent = '';
        modalErrorMessage.style.display = 'none';
        modalConfirmBtn.textContent = confirmText;
        modalCancelBtn.textContent = cancelText;
        modalConfirmBtn.className = 'modal-button ripple-effect ' + confirmButtonType;
        modalConfirmBtn.style.display = hideConfirmButton ? 'none' : 'inline-block';
        modalCancelBtn.style.display = (hideCancelButton || type === CONSTANTS.MODAL_TYPE.ALERT) ? 'none' : 'inline-block';
        modalCloseBtn.style.display = 'block';
        modalConfirmBtn.disabled = false;
        modalInput.style.display = type === CONSTANTS.MODAL_TYPE.PROMPT ? 'block' : 'none';
        modalMessage.style.display = message ? 'block' : 'none';
        modalInput.value = initialValue;
        modalInput.placeholder = placeholder;

        let hasUserInput = false;
        const runValidation = (force = false) => {
            if (!validationFn) return true;
            const validationResult = validationFn(modalInput.value) || {};
            const isValid = validationResult.isValid === true;
            modalConfirmBtn.disabled = !isValid;
            if ((force || hasUserInput) && !isValid && validationResult.message) {
                modalErrorMessage.textContent = validationResult.message;
                modalErrorMessage.style.display = 'block';
            } else {
                modalErrorMessage.style.display = 'none';
            }
            return isValid;
        };

        const handleInput = () => {
            hasUserInput = true;
            runValidation();
        };

        const closeWithValue = (value) => {
            if (modal.open) modal.close(value);
        };

        const handleConfirmClick = (event) => {
            // form method="dialog"의 기본 제출과 직접 close()가 중복 실행되지 않도록 차단합니다.
            event?.preventDefault();
            if (validationFn && !runValidation(true)) return;
            closeWithValue('confirm');
        };

        const handleCancelClick = (event) => {
            event?.preventDefault();
            closeWithValue('cancel');
        };

        const handleCancelRequest = (event) => {
            // ESC/플랫폼 뒤로가기를 언제나 명시적인 취소로 정규화합니다.
            // 기본 동작을 막지 않으면 이전 returnValue가 남아 확인으로 오판될 수 있습니다.
            event.preventDefault();
            closeWithValue('cancel');
        };

        const handleKeydown = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                handleConfirmClick(event);
            }
        };

        const cleanup = () => {
            modalConfirmBtn.removeEventListener('click', handleConfirmClick);
            modalCancelBtn.removeEventListener('click', handleCancelClick);
            modalCloseBtn.removeEventListener('click', handleCancelClick);
            modalInput.removeEventListener('input', handleInput);
            modalInput.removeEventListener('keydown', handleKeydown);
            modal.removeEventListener('cancel', handleCancelRequest);
            modal.removeEventListener('close', handleClose);
        };

        const handleClose = () => {
            cleanup();

            try {
                if (elementToFocusOnClose && typeof elementToFocusOnClose.focus === 'function' && elementToFocusOnClose.isConnected !== false) {
                    elementToFocusOnClose.focus();
                }
            } catch (error) {
                console.warn('Failed to restore focus to the previous element.', error);
            }

            let result = null;
            if (modal.returnValue === 'confirm') {
                if (type === CONSTANTS.MODAL_TYPE.PROMPT) result = modalInput.value;
                else if (message instanceof Node && message.querySelector('select')) result = message.querySelector('select').value;
                else result = true;
            }
            resolve(result);
        };

        modalConfirmBtn.addEventListener('click', handleConfirmClick);
        modalCancelBtn.addEventListener('click', handleCancelClick);
        modalCloseBtn.addEventListener('click', handleCancelClick);
        modal.addEventListener('cancel', handleCancelRequest);
        modal.addEventListener('close', handleClose);

        if (type === CONSTANTS.MODAL_TYPE.PROMPT) {
            modalInput.addEventListener('keydown', handleKeydown);
            if (validationFn) {
                modalInput.addEventListener('input', handleInput);
                runValidation();
            }
        }

        try {
            modal.showModal();
            if (type === CONSTANTS.MODAL_TYPE.PROMPT) {
                modalInput.focus();
                modalInput.select();
            } else if (!hideConfirmButton) {
                modalConfirmBtn.focus();
            }
        } catch (error) {
            cleanup();
            reject(error);
        }
    });
};

const _showModalInternal = (options) => {
    const request = modalQueue.then(() => _showSingleModal(options));
    // 한 요청이 실패해도 다음 요청이 영구적으로 막히지 않도록 큐를 복구합니다.
    modalQueue = request.catch(error => {
        console.error('Modal request failed:', error);
    });
    return request;
};

export const showAlert = (options) => _showModalInternal({ ...options, type: CONSTANTS.MODAL_TYPE.ALERT, hideCancelButton: true });
export const showConfirm = (options) => _showModalInternal({ ...options, type: CONSTANTS.MODAL_TYPE.CONFIRM });
export const showPrompt = (options) => _showModalInternal({ ...options, type: CONSTANTS.MODAL_TYPE.PROMPT });

export const showFolderSelectPrompt = async ({ title, message }) => {
    const formContent = document.createElement('div');
    formContent.style.display = 'flex';
    formContent.style.flexDirection = 'column';
    formContent.style.gap = '15px';

    const messageP = document.createElement('p');
    messageP.textContent = message;
    
    const select = document.createElement('select');
    select.className = 'modal-input';

    const realFolders = state.folders.filter(folder => !Object.values(CONSTANTS.VIRTUAL_FOLDERS).some(vf => vf.id === folder.id));
    realFolders.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = `📁 ${folder.name}`;
        select.appendChild(option);
    });

    formContent.appendChild(messageP);
    formContent.appendChild(select);
    
    if (realFolders.length === 0) {
        messageP.textContent = '노트를 복원할 폴더가 없습니다. 먼저 새 폴더를 만들어주세요.';
        select.style.display = 'none';
        await showAlert({ title, message: formContent, confirmText: '✅ 확인' });
        return null;
    }

    return await _showModalInternal({
        type: CONSTANTS.MODAL_TYPE.CONFIRM, title, message: formContent,
        confirmText: '✅ 폴더 선택', cancelText: '❌ 취소'
    });
};

export const showDatePickerPopover = ({ initialDate }) => {
    return new Promise(resolve => {
        yearInput.value = initialDate.getFullYear();
        monthInput.value = initialDate.getMonth() + 1;
        datePickerPopover.style.display = 'flex';
        yearInput.focus();
        yearInput.select();

        const cleanup = (result) => {
            datePickerPopover.style.display = 'none';
            datePickerConfirmBtn.removeEventListener('click', onConfirm);
            datePickerCloseBtn.removeEventListener('click', onCancel);
            datePickerTodayBtn.removeEventListener('click', onToday);
            document.removeEventListener('click', onOutsideClick, true);
            datePickerPopover.removeEventListener('keydown', onKeydown);
            resolve(result);
        };

        const onConfirm = () => {
            const year = parseInt(yearInput.value, 10);
            const month = parseInt(monthInput.value, 10);
            if (isNaN(year) || isNaN(month) || month < 1 || month > 12 || year < 1900 || year > 2200) {
                showToast('🤔 유효한 년(1900-2200)과 월(1-12)을 입력해주세요.', CONSTANTS.TOAST_TYPE.ERROR);
                return;
            }
            cleanup({ year, month: month - 1 });
        };
        
        const onToday = () => {
            const today = new Date();
            cleanup({ year: today.getFullYear(), month: today.getMonth() });
        };

        const onCancel = () => cleanup(null);
        const onOutsideClick = (e) => { if (!datePickerPopover.contains(e.target) && e.target.id !== 'calendar-month-year') onCancel(); };
        const onKeydown = (e) => { if (e.key === 'Enter') onConfirm(); else if (e.key === 'Escape') onCancel(); };

        datePickerConfirmBtn.addEventListener('click', onConfirm);
        datePickerCloseBtn.addEventListener('click', onCancel);
        datePickerTodayBtn.addEventListener('click', onToday);
        document.addEventListener('click', onOutsideClick, true);
        datePickerPopover.addEventListener('keydown', onKeydown);
    });
};

export const showShortcutModal = () => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const ctrlOrCmd = isMac ? 'Cmd' : 'Ctrl';

    const shortcuts = [
        { key: 'Alt + Shift + N', desc: '✨ 새 폴더 만들기' },
        { key: 'Alt + N', desc: '✍️ 새 노트 만들기' },
        { key: 'F2 / 더블클릭', desc: '✏️ 폴더/노트 이름 변경' },
        { key: '↑ / ↓', desc: '↕️ 폴더/노트 이동' },
		{ key: 'Enter', desc: '↵️ 폴더/노트 선택' },
        { key: '드래그 앤 드롭', desc: '🖐️ 폴더 위치 변경, 노트를 다른 폴더로 이동' },
    ];
    const list = document.createElement('ul');
    list.className = 'shortcut-list';
    shortcuts.forEach(sc => {
        const li = document.createElement('li');
        const keySpan = document.createElement('span');
        keySpan.className = 'shortcut-key';
        keySpan.textContent = sc.key;
        const descSpan = document.createElement('span');
        descSpan.className = 'shortcut-desc';
        descSpan.textContent = sc.desc;
        li.appendChild(keySpan);
        li.appendChild(descSpan);
        list.appendChild(li);
    });
    showAlert({ title: CONSTANTS.MODAL_TITLES.SHORTCUT_GUIDE, message: list, hideConfirmButton: true });
};

export const sortNotes = (notes, sortOrder) => {
    if (!notes) return [];
    const sorted = [...notes];
    sorted.sort((a, b) => {
        if (a.isPinned !== b.isPinned) return b.isPinned - a.isPinned;
        switch (sortOrder) {
            case 'createdAt_desc': return b.createdAt - a.createdAt;
            case 'createdAt_asc': return a.createdAt - b.createdAt;
            case 'updatedAt_asc': return a.updatedAt - b.updatedAt;
            case 'title_asc': return (a.title ?? '').localeCompare(b.title ?? '', 'ko');
            case 'title_desc': return (b.title ?? '').localeCompare(a.title ?? '', 'ko');
            case 'updatedAt_desc': default: return b.updatedAt - a.updatedAt;
        }
    });
    return sorted;
};