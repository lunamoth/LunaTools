document.addEventListener('DOMContentLoaded', function() {
    'use strict';

    const CONFIG = {
        TEXT: {
            RUN: '실행하기',
            RUN_COUNT: (count) => `🚀 ${count}개 URL 실행`,
            PAUSE: '⏸️ 일시 정지',
            RESUME: '▶️ 계속하기',
            RESTART: '🔄️ 새로 시작하기',
            IDLE: 'URL 목록을 입력하거나 붙여넣어 주세요.',
            EMPTY_INPUT: 'URL이 없습니다. 목록을 확인해주세요.',
            PAUSED_BY_USER: '⏸️ 사용자에 의해 일시 정지됨.',
            STOPPED_BY_USER: '작업이 사용자에 의해 종료되었습니다.',
            PROCESS_COMPLETE: (total, success, failed) => `🎉 총 ${total}개 실행 완료 (성공: ${success}, 실패: ${failed})`,
            PROGRESS: (opened, total, remaining) => `⏳ 총 ${total}개 | ${opened}개 열림 | ${remaining}개 남음`,
            SELECT_LIST_PLACEHOLDER: '저장된 목록 선택...'
        },
        CSS: {
            REMOVING_CLASS: 'removing', PROCESSING_CLASS: 'processing', ERROR_CLASS: 'error', COMPLETE_CLASS: 'complete', SUCCESS_BTN_CLASS: 'success'
        },
        SELECTOR: {
            MAIN_CONTAINER: '.main-container',
            SECTION_CARD_CONTAINER: '.section-card-container',
            URL_INPUT: '#urlInput', INTERVAL_INPUT: '#intervalInput', REMOVE_DUPLICATES_CHECKBOX: '#removeDuplicates',
            FOCUS_LOCK_CHECKBOX: '#focusLock', DELAY_LOADING_CHECKBOX: '#delayLoading',
            START_RUN_BUTTON: '#startRunButton',
            PAUSE_RESUME_BUTTON: '#pauseResumeButton',
            STOP_PROCESS_BUTTON: '#stopProcessButton',
            PROGRESS_STATS: '#progressStats', PROGRESS_BAR: '#progressBar',
            URL_QUEUE: '#urlQueue', OPTIONS_LIST: '.options-list',
            OPTIONS_LIST_WRAPPER: '.options-list-wrapper',
            CLEAR_BUTTON: '#clearButton',
            SORT_URLS_BUTTON: '#sortUrlsButton', DEDUPLICATE_URLS_BUTTON: '#deduplicateUrlsButton',
            CANCEL_EDIT_BUTTON: '#cancelEditButton',
            NEW_LIST_BUTTON: '#newListButton',
            SAVE_LIST_BUTTON: '#saveListButton', DELETE_LIST_BUTTON: '#deleteListButton',
            RENAME_LIST_BUTTON: '#renameListButton', SAVED_LISTS_DROPDOWN: '#savedListsDropdown',
            GET_ALL_TABS_BUTTON: '#getAllTabsButton',
            GET_CURRENT_TABS_BUTTON: '#getCurrentTabsButton', IMPORT_BUTTON: '#importButton', EXPORT_BUTTON: '#exportButton', IMPORT_FILE_INPUT: '#importFileInput',
            CURRENT_LIST_INDICATOR: '#currentListIndicator',
            MODAL_OVERLAY: '#modal-overlay', MODAL_HEADER: '#modal-header', MODAL_BODY: '#modal-body',
            MODAL_FOOTER: '.modal-footer', MODAL_CANCEL_BTN: '#modal-cancel-btn', MODAL_CONFIRM_BTN: '#modal-confirm-btn', TOAST_CONTAINER: '#toast-container',
            INPUT_WRAPPER: '.input-wrapper',
            INPUT_WRAPPER_CONTENT: '.input-wrapper-content',
            INPUT_CONTROL_BUTTONS_WRAPPER: '#input-control-buttons-wrapper',
            RUNNING_WRAPPER: '.running-wrapper',
            RUNNING_WRAPPER_STICKY_HEADER: '.running-wrapper-sticky-header',
            RUNNING_WRAPPER_SCROLLABLE_CONTENT: '.running-wrapper-scrollable-content'
        },
        STORAGE_KEY: 'multiOpenUrlOptions',
        URL_LISTS_KEY: 'savedUrlLists',
        DEFAULT_OPTIONS: {
            interval: 2.5, removeDuplicates: true, focusLock: true, delayLoading: false
        },
        FADE_DURATION: 300
    };

    const UI = Object.keys(CONFIG.SELECTOR).reduce((acc, key) => {
        const selector = CONFIG.SELECTOR[key];
        if (selector) {
            const element = document.querySelector(selector);
            if (element) {
                 acc[key.toLowerCase().replace(/_([a-z])/g, g => g[1].toUpperCase())] = element;
            } else {
                console.warn(`UI element not found for selector: ${selector}`);
                acc[key.toLowerCase().replace(/_([a-z])/g, g => g[1].toUpperCase())] = null;
            }
        }
        return acc;
    }, {});

    const state = {
        intervalId: null, isPaused: false, urlsToProcess: [], currentUrlIndex: 0, errorCount: 0,
        isDirty: false, loadedListName: null, originalLoadedListUrls: null,
        currentView: 'input',
        isTransitioning: false,
        isInitialLoad: true
    };

    const Modal = {
        resolve: null,
        _keydownListener: null,
        show(config) {
            UI.modalHeader.textContent = config.title;
            UI.modalBody.innerHTML = config.body;
            UI.modalConfirmBtn.textContent = config.confirmText || '확인';
            UI.modalCancelBtn.textContent = config.cancelText || '취소';
            UI.modalConfirmBtn.className = 'modal-confirm-btn' + (config.danger ? ' danger' : '');
            const confirmBtn = UI.modalConfirmBtn;
            const cancelBtn = UI.modalCancelBtn;
            confirmBtn.style.display = 'inline-block';
            cancelBtn.style.display = 'inline-block';
            if (config.hideConfirm) confirmBtn.style.display = 'none';
            if (config.hideCancel) cancelBtn.style.display = 'none';
            const customButtonWrapper = UI.modalFooter.querySelector('.custom-buttons');
            if (customButtonWrapper) customButtonWrapper.remove();
            if (config.buttons && config.buttons.length > 0) {
                confirmBtn.style.display = 'none';
                cancelBtn.style.display = 'none';
                const newButtonWrapper = document.createElement('div');
                newButtonWrapper.className = 'custom-buttons';
                newButtonWrapper.style.display = 'flex';
                newButtonWrapper.style.gap = 'var(--spacing-sm)';
                newButtonWrapper.style.justifyContent = 'flex-end';
                config.buttons.forEach(buttonConfig => {
                    const button = document.createElement('button');
                    button.textContent = buttonConfig.text;
                    button.className = buttonConfig.className || '';
                    if (buttonConfig.isDefaultCancel) {
                        button.style.backgroundColor = 'var(--bg-control)';
                        button.style.color = 'var(--text-secondary)';
                    } else if (buttonConfig.isDanger) {
                         button.style.backgroundColor = 'var(--danger-color)';
                         button.style.color = 'white';
                    } else {
                        button.style.backgroundColor = 'var(--accent-color)';
                        button.style.color = 'white';
                    }
                    button.addEventListener('click', () => this.hide(buttonConfig.value));
                    newButtonWrapper.appendChild(button);
                });
                UI.modalFooter.appendChild(newButtonWrapper);
            }
            UI.modalOverlay.classList.add('visible');
            const input = UI.modalBody.querySelector('input');
            if (input) {
                setTimeout(() => input.focus(), 50);
                if (this._keydownListener) {
                    document.removeEventListener('keydown', this._keydownListener);
                }
                this._keydownListener = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const confirmButton = UI.modalConfirmBtn.style.display !== 'none' ? UI.modalConfirmBtn : UI.modalFooter.querySelector('.custom-buttons button:not([style*="var(--bg-control)"])');
                        if(confirmButton) confirmButton.click();
                    } else if (e.key === 'Escape') {
                        const cancelButton = UI.modalCancelBtn.style.display !== 'none' ? UI.modalCancelBtn : UI.modalFooter.querySelector('.custom-buttons button[style*="var(--bg-control)"]');
                        if(cancelButton) cancelButton.click();
                        else this.hide(undefined);
                    }
                };
                document.addEventListener('keydown', this._keydownListener);
            }
            return new Promise(resolve => { this.resolve = resolve; });
        },
        hide(result) {
            UI.modalOverlay.classList.remove('visible');
            if (this._keydownListener) {
                document.removeEventListener('keydown', this._keydownListener);
                this._keydownListener = null;
            }
            const customButtonWrapper = UI.modalFooter.querySelector('.custom-buttons');
            if (customButtonWrapper) customButtonWrapper.remove();
            if (this.resolve) this.resolve(result);
            this.resolve = null;
        }
    };

    const Toast = {
        show(message, type = 'info', duration = 3000) {
            if (!UI.toastContainer) return;
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.textContent = message;
            UI.toastContainer.appendChild(toast);
            setTimeout(() => toast.classList.add('show'), 10);
            setTimeout(() => {
                toast.classList.remove('show');
                toast.addEventListener('transitionend', () => toast.remove(), { once: true });
            }, duration);
        }
    };

    const getElementHeightWithMargins = (element) => {
        if (!element || getComputedStyle(element).display === 'none') return 0;
        const style = getComputedStyle(element);
        let height = element.offsetHeight;
        height += parseFloat(style.marginTop) || 0;
        height += parseFloat(style.marginBottom) || 0;
        return height;
    };

    let setCardHeightTimeout = null;
    const scheduleSetCardHeight = () => {
        if (setCardHeightTimeout) {
            cancelAnimationFrame(setCardHeightTimeout);
        }
        setCardHeightTimeout = requestAnimationFrame(() => {
            _setCardHeightInternal();
            setCardHeightTimeout = null;
        });
    };

    const _setCardHeightInternal = () => {
        if (!UI.sectionCardContainer || !UI.inputWrapper || !UI.runningWrapper) return;

        if (state.currentView === 'input') {
            UI.sectionCardContainer.style.height = '';
            UI.sectionCardContainer.style.overflowY = 'auto';
        } else if (state.currentView === 'running' || state.currentView === 'complete') {
            let totalContentHeight = 0;
            if (UI.runningWrapper.style.display !== 'none') {
                if (UI.runningWrapperStickyHeader) totalContentHeight += getElementHeightWithMargins(UI.runningWrapperStickyHeader);

                let scrollableContentActualHeight = 0;
                if (UI.runningWrapperScrollableContent) {
                    if (UI.urlQueue) {
                        scrollableContentActualHeight = UI.urlQueue.scrollHeight;
                        const urlQueueStyle = getComputedStyle(UI.urlQueue);
                        scrollableContentActualHeight += parseFloat(urlQueueStyle.marginTop) || 0;
                        scrollableContentActualHeight += parseFloat(urlQueueStyle.marginBottom) || 0;
                    }
                     const scrollableContainerStyle = getComputedStyle(UI.runningWrapperScrollableContent);
                    scrollableContentActualHeight += parseFloat(scrollableContainerStyle.paddingTop) || 0;
                    scrollableContentActualHeight += parseFloat(scrollableContainerStyle.paddingBottom) || 0;
                }
                totalContentHeight += scrollableContentActualHeight;

                const wrapperStyle = getComputedStyle(UI.runningWrapper);
                totalContentHeight += parseFloat(wrapperStyle.paddingTop) || 0;
                totalContentHeight += parseFloat(wrapperStyle.paddingBottom) || 0;
            }

            const cssMinHeight = parseFloat(getComputedStyle(UI.sectionCardContainer).minHeight) || 50;
            let newHeight = Math.max(totalContentHeight, cssMinHeight);

            const mainContainerHeight = UI.mainContainer ? UI.mainContainer.clientHeight : window.innerHeight;
            const headerHeight = UI.header ? getElementHeightWithMargins(UI.header) : 0;
            const availableHeight = mainContainerHeight - headerHeight - (parseFloat(getComputedStyle(UI.mainContainer).gap) || 0) - (parseFloat(getComputedStyle(UI.mainContainer).paddingTop) || 0) - (parseFloat(getComputedStyle(UI.mainContainer).paddingBottom) || 0);

            newHeight = Math.min(newHeight, availableHeight);


            if (totalContentHeight > 0) {
                 UI.sectionCardContainer.style.height = `${newHeight}px`;
            } else {
                UI.sectionCardContainer.style.height = 'auto';
            }
            UI.sectionCardContainer.style.overflowY = 'hidden';
        } else {
            UI.sectionCardContainer.style.height = 'auto';
            UI.sectionCardContainer.style.overflowY = 'hidden';
        }
    };


    const setView = (viewState) => {
        if (state.isTransitioning || !UI.inputWrapper || !UI.runningWrapper) return;

        const isActuallySwitching = state.currentView !== viewState || state.isInitialLoad;
        state.currentView = viewState;

        if (!isActuallySwitching && !state.isInitialLoad) {
            scheduleSetCardHeight();
            updateButtonState();
            return;
        }

        state.isTransitioning = true;
        if(UI.sectionCardContainer) UI.sectionCardContainer.dataset.viewState = viewState;

        const wrapperToShow = viewState === 'input' ? UI.inputWrapper : UI.runningWrapper;
        const wrapperToHide = viewState === 'input' ? UI.runningWrapper : UI.inputWrapper;

        if (state.isInitialLoad) {
            wrapperToHide.style.display = 'none';
            wrapperToHide.style.opacity = '0';
            wrapperToHide.style.transform = 'translateY(10px)';
            wrapperToHide.style.pointerEvents = 'none';

            wrapperToShow.style.display = 'flex';
            wrapperToShow.style.opacity = '1';
            wrapperToShow.style.transform = 'translateY(0px)';
            wrapperToShow.style.pointerEvents = 'auto';

            state.isTransitioning = false;
            state.isInitialLoad = false;
            scheduleSetCardHeight();
        } else {
            wrapperToHide.style.opacity = '0';
            wrapperToHide.style.transform = 'translateY(10px)';
            wrapperToHide.style.pointerEvents = 'none';

            setTimeout(() => {
                wrapperToHide.style.display = 'none';

                wrapperToShow.style.display = 'flex';
                requestAnimationFrame(() => {
                    wrapperToShow.style.opacity = '1';
                    wrapperToShow.style.transform = 'translateY(0px)';
                    wrapperToShow.style.pointerEvents = 'auto';
                    scheduleSetCardHeight();
                });

                state.isTransitioning = false;
            }, CONFIG.FADE_DURATION);
        }

        updateButtonState();
    };

    const setControlsEnabled = (isEnabled) => {
        if(UI.urlInput) UI.urlInput.disabled = !isEnabled;
        if(UI.optionsList) UI.optionsList.querySelectorAll('input, button').forEach(el => el.disabled = !isEnabled);

        [UI.savedListsDropdown, UI.importButton, UI.exportButton, UI.clearButton,
         UI.sortUrlsButton, UI.deduplicateUrlsButton, UI.getAllTabsButton, UI.getCurrentTabsButton,
         UI.cancelEditButton, UI.newListButton].forEach(el => {
            if (el) el.disabled = !isEnabled;
        });

        if (isEnabled) {
            updateListControlStates();
        } else {
            [UI.saveListButton, UI.renameListButton, UI.deleteListButton].forEach(b => {
                if (b) b.disabled = true;
            });
        }
    };

    const resetToIdle = async (message = CONFIG.TEXT.IDLE, isError = false) => {
        if (!state.isInitialLoad && state.isDirty && state.currentView !== 'input') {
        } else if (!state.isInitialLoad && state.isDirty) {
             const confirmed = await Modal.show({
                title: '저장되지 않은 변경사항',
                body: `<strong>${state.loadedListName || '현재'}</strong> 목록에 저장되지 않은 변경사항이 있습니다. 정말 새로 시작하시겠습니까? (모든 내용이 초기화됩니다)`,
                danger: true,
                confirmText: '새로 시작'
            });
            if (!confirmed) return;
        }

        Object.assign(state, {
            urlsToProcess: [], currentUrlIndex: 0, isPaused: false, errorCount: 0,
            isDirty: false, loadedListName: null, originalLoadedListUrls: null
        });
        clearTimeout(state.intervalId); state.intervalId = null;

        if(UI.urlInput) UI.urlInput.value = '';
        if(UI.urlQueue) UI.urlQueue.innerHTML = '';
        if(UI.progressBar) UI.progressBar.value = 0;
        if (UI.savedListsDropdown) UI.savedListsDropdown.value = '';
        if(UI.progressStats) {
            UI.progressStats.textContent = message;
            UI.progressStats.className = isError ? 'error' : '';
        }

        setView('input');
        setControlsEnabled(true);
        if (!state.isInitialLoad) {
             loadSavedLists();
        }
    };

    const handleStopProcess = () => {
        clearTimeout(state.intervalId);
        state.intervalId = null;
        state.isPaused = false;

        if(UI.urlQueue) UI.urlQueue.innerHTML = '';
        if(UI.progressBar) UI.progressBar.value = 0;
        if(UI.progressStats) UI.progressStats.textContent = CONFIG.TEXT.STOPPED_BY_USER;

        setView('input');
        setControlsEnabled(true);
    };

    const updateCurrentListIndicator = () => {
        if (!UI.currentListIndicator) return;
        if (state.loadedListName) {
            let text = `현재 편집 중: <strong style="color: var(--accent-color);">${state.loadedListName}</strong>`;
            if (state.isDirty) {
                text += ' <span style="color:var(--danger-color); font-weight: 500;">(수정됨)</span>';
            }
            UI.currentListIndicator.innerHTML = text;
            UI.currentListIndicator.style.display = 'block';
        } else {
            UI.currentListIndicator.innerHTML = '';
            UI.currentListIndicator.style.display = 'none';
        }
         scheduleSetCardHeight();
    };

    const updateButtonState = () => {
        const viewState = state.currentView;
        const hasText = UI.urlInput && UI.urlInput.value.trim().length > 0;
        const urls = UI.urlInput ? UI.urlInput.value.split('\n').map(u => u.trim()).filter(Boolean) : [];
        const displayCount = UI.removeDuplicatesCheckbox && UI.removeDuplicatesCheckbox.checked ? [...new Set(urls)].length : urls.length;

        if (UI.startRunButton) {
            UI.startRunButton.classList.remove(CONFIG.CSS.SUCCESS_BTN_CLASS);
            if (viewState === 'input') {
                UI.startRunButton.innerHTML = displayCount > 0 ? CONFIG.TEXT.RUN_COUNT(displayCount) : CONFIG.TEXT.RUN;
                UI.startRunButton.disabled = displayCount === 0;
            } else if (viewState === 'complete') {
                 UI.startRunButton.innerHTML = CONFIG.TEXT.RESTART;
                 UI.startRunButton.classList.add(CONFIG.CSS.SUCCESS_BTN_CLASS);
                 UI.startRunButton.disabled = false;
            }
        }

        if (UI.pauseResumeButton) {
            if (viewState === 'running') {
                UI.pauseResumeButton.innerHTML = state.isPaused ? CONFIG.TEXT.RESUME : CONFIG.TEXT.PAUSE;
                UI.pauseResumeButton.disabled = false;
            }
        }

        if (UI.saveListButton) {
            if (state.loadedListName && state.isDirty) {
                UI.saveListButton.innerHTML = '🔄️';
                UI.saveListButton.title = '현재 목록 업데이트';
                UI.saveListButton.disabled = false;
            } else {
                UI.saveListButton.innerHTML = '💾';
                UI.saveListButton.title = '새 목록으로 저장 / 현재 목록 업데이트';
                UI.saveListButton.disabled = !hasText;
            }
        }
        updateListControlStates();
    };

    const updateListControlStates = () => {
        const hasText = UI.urlInput && UI.urlInput.value.trim().length > 0;
        const listSelected = UI.savedListsDropdown && UI.savedListsDropdown.value !== '';

        [UI.sortUrlsButton, UI.deduplicateUrlsButton].forEach(btn => {
            if(btn) btn.disabled = !hasText;
        });

        if(UI.renameListButton) UI.renameListButton.disabled = !listSelected;
        if(UI.deleteListButton) UI.deleteListButton.disabled = !listSelected;

        if(UI.exportButton && UI.savedListsDropdown) {
            UI.exportButton.disabled = UI.savedListsDropdown.options.length <= 1;
        }

        if (UI.cancelEditButton) {
            UI.cancelEditButton.disabled = !(state.isDirty && state.loadedListName && state.originalLoadedListUrls !== null);
        }
        if (UI.newListButton) UI.newListButton.disabled = false;

        updateCurrentListIndicator();
    };

    const getSavedLists = async () => {
        try {
            const data = await chrome.storage.local.get(CONFIG.URL_LISTS_KEY);
            return data[CONFIG.URL_LISTS_KEY] || {};
        } catch (e) {
            console.error('Error getting saved lists:', e);
            Toast.show('저장된 목록을 불러오는데 실패했습니다.', 'error');
            return {};
        }
    };

    const saveLists = async (lists) => {
        try {
            await chrome.storage.local.set({ [CONFIG.URL_LISTS_KEY]: lists });
            return true;
        } catch (e) {
            console.error('Error saving lists:', e);
            const message = e.message && e.message.includes('QUOTA_BYTES')
                ? '저장 공간이 부족합니다. (최대 약 5MB)'
                : '목록 저장에 실패했습니다.';
            Modal.show({ title: '오류', body: message, hideCancel: true });
            return false;
        }
    };

    const loadSavedLists = async () => {
        const lists = await getSavedLists();
        const listNames = Object.keys(lists);
        const currentSelectionInDropdown = UI.savedListsDropdown ? UI.savedListsDropdown.value : '';

        if (UI.savedListsDropdown) {
            UI.savedListsDropdown.innerHTML = `<option value="">${CONFIG.TEXT.SELECT_LIST_PLACEHOLDER}</option>`;
            listNames.sort().forEach(name => {
                const urlCount = (lists[name] && lists[name].urls) ? lists[name].urls.split('\n').filter(Boolean).length : 0;
                const option = document.createElement('option');
                option.value = name;
                option.textContent = `${name} (${urlCount}개)`;
                UI.savedListsDropdown.appendChild(option);
            });

            if (state.loadedListName && listNames.includes(state.loadedListName)) {
                UI.savedListsDropdown.value = state.loadedListName;
            } else if (listNames.includes(currentSelectionInDropdown)) {
                 UI.savedListsDropdown.value = currentSelectionInDropdown;
            } else {
                if(state.loadedListName && !listNames.includes(state.loadedListName)) {
                    state.loadedListName = null;
                    state.originalLoadedListUrls = null;
                }
            }
        }
        updateButtonState();
        scheduleSetCardHeight();
    };

    const _switchToNewListState = () => {
        if(UI.urlInput) UI.urlInput.value = '';
        state.loadedListName = null;
        state.originalLoadedListUrls = null;
        state.isDirty = false;
        if (UI.savedListsDropdown) UI.savedListsDropdown.value = '';
        updateButtonState();
        if(UI.urlInput) UI.urlInput.focus();
        Toast.show('새 URL 목록 작성을 시작합니다.', 'info');
        scheduleSetCardHeight();
    };

    const handleStartNewList = async () => {
        if (state.isDirty) {
            const choice = await Modal.show({
                title: '저장되지 않은 변경사항',
                body: `<strong>${state.loadedListName || '현재'}</strong> 목록에 저장되지 않은 변경사항이 있습니다. 어떻게 하시겠습니까?`,
                buttons: [
                    { text: '취소', value: 'cancel', isDefaultCancel: true },
                    { text: '변경사항 버리고 새로 작성', value: 'discard', isDanger: true },
                    { text: '저장 후 새로 작성', value: 'save_and_new' }
                ]
            });

            if (choice === 'cancel' || choice === undefined || choice === null) return;

            if (choice === 'save_and_new') {
                let savedSuccessfully = false;
                if (state.loadedListName) {
                    const urlsToSave = UI.urlInput.value.trim();
                    const lists = await getSavedLists();
                    if (lists[state.loadedListName]) {
                        lists[state.loadedListName].urls = urlsToSave;
                        if (await saveLists(lists)) {
                            state.originalLoadedListUrls = urlsToSave;
                            Toast.show(`'${state.loadedListName}' 목록이 업데이트되었습니다.`, 'success');
                            savedSuccessfully = true;
                        }
                    } else {
                         Toast.show(`'${state.loadedListName}' 목록을 찾을 수 없어 저장하지 못했습니다.`, 'error');
                    }
                } else {
                    const now = new Date(); const year = now.getFullYear(); const month = String(now.getMonth() + 1).padStart(2, '0'); const day = String(now.getDate()).padStart(2, '0'); let hours = now.getHours(); const minutes = String(now.getMinutes()).padStart(2, '0'); const ampm = hours >= 12 ? '오후' : '오전'; hours = hours % 12; hours = hours ? hours : 12;
                    const defaultListName = `${year}-${month}-${day} ${ampm} ${String(hours).padStart(2, '0')}:${minutes}`;

                    const result = await Modal.show({
                        title: '새 목록으로 저장',
                        body: `<input type="text" id="modal-input" value="${defaultListName}" placeholder="저장할 목록의 이름을 입력하세요." />`,
                        confirmText: '저장'
                    });
                    const rawListName = document.getElementById('modal-input')?.value;

                    if (result && rawListName) {
                        const listName = rawListName.trim().replace(/\s+/g, ' ');
                        if (!listName) {
                            Toast.show('목록 이름은 비워둘 수 없습니다. 새 목록 작성을 계속합니다.', 'error');
                        } else {
                            const lists = await getSavedLists();
                            if (lists[listName]) {
                                Toast.show(`'${listName}' 목록이 이미 존재합니다. 다른 이름을 사용해주세요. 새 목록 작성을 계속합니다.`, 'error');
                            } else {
                                const urlsToSave = UI.urlInput.value.trim();
                                lists[listName] = { urls: urlsToSave, createdAt: new Date().toISOString() };
                                if (await saveLists(lists)) {
                                    state.originalLoadedListUrls = urlsToSave;
                                    Toast.show(`'${listName}' 목록이 저장되었습니다.`, 'success');
                                    await loadSavedLists();
                                    if (UI.savedListsDropdown) UI.savedListsDropdown.value = listName;
                                    state.loadedListName = listName;
                                    savedSuccessfully = true;
                                }
                            }
                        }
                    } else {
                        Toast.show('저장이 취소되었습니다. 새 목록 작성을 계속합니다.', 'info');
                    }
                }
                if (savedSuccessfully) state.isDirty = false;
            }
            _switchToNewListState();
        } else {
            _switchToNewListState();
        }
    };

    const handleUpdateList = async () => {
        if (!state.loadedListName || !state.isDirty) return;

        const urlsToSave = UI.urlInput.value.trim();
        const lists = await getSavedLists();
        if (!lists[state.loadedListName]) {
            Toast.show(`'${state.loadedListName}' 목록을 찾을 수 없어 업데이트할 수 없습니다. 새 목록으로 저장해보세요.`, 'error');
            state.loadedListName = null;
            state.isDirty = true;
            await loadSavedLists();
            return;
        }
        lists[state.loadedListName].urls = urlsToSave;
        if (await saveLists(lists)) {
            state.isDirty = false;
            state.originalLoadedListUrls = urlsToSave;
            Toast.show(`'${state.loadedListName}' 목록이 업데이트되었습니다.`, 'success');
            await loadSavedLists();
            if (UI.savedListsDropdown) UI.savedListsDropdown.blur();
        }
    };

    const handleSaveAsNewList = async () => {
        const now = new Date(); const year = now.getFullYear(); const month = String(now.getMonth() + 1).padStart(2, '0'); const day = String(now.getDate()).padStart(2, '0'); let hours = now.getHours(); const minutes = String(now.getMinutes()).padStart(2, '0'); const ampm = hours >= 12 ? '오후' : '오전'; hours = hours % 12; hours = hours ? hours : 12;
        const defaultListName = `${year}-${month}-${day} ${ampm} ${String(hours).padStart(2, '0')}:${minutes}`;

        const result = await Modal.show({
            title: '새 목록으로 저장',
            body: `<input type="text" id="modal-input" value="${defaultListName}" placeholder="저장할 목록의 이름을 입력하세요." />`,
            confirmText: '저장'
        });
        const rawListName = document.getElementById('modal-input')?.value;

        if (!result || !rawListName) {
            Toast.show('저장이 취소되었습니다.', 'info');
            return false;
        }

        const listName = rawListName.trim().replace(/\s+/g, ' ');
        if (!listName) {
            Toast.show('목록 이름은 비워둘 수 없습니다.', 'error');
            return false;
        }

        const lists = await getSavedLists();
        if (lists[listName] && listName !== state.loadedListName) {
            const overwrite = await Modal.show({
                title: '덮어쓰기 확인',
                body: `<strong>'${listName}'</strong> 목록이 이미 있습니다. 덮어쓰시겠습니까?`,
                danger: true,
                confirmText: '덮어쓰기'
            });
            if (!overwrite) return false;
        }

        const urlsToSave = UI.urlInput.value.trim();
        lists[listName] = { urls: urlsToSave, createdAt: new Date().toISOString() };

        if (await saveLists(lists)) {
            state.isDirty = false;
            state.loadedListName = listName;
            state.originalLoadedListUrls = urlsToSave;
            Toast.show(`'${listName}' 목록이 저장되었습니다.`, 'success');
            await loadSavedLists();
            if (UI.savedListsDropdown) UI.savedListsDropdown.value = listName;
            if (UI.savedListsDropdown) UI.savedListsDropdown.blur();
            return true;
        }
        return false;
    };

    const handleLoadList = async () => {
        const listNameToLoad = UI.savedListsDropdown ? UI.savedListsDropdown.value : null;

        if (state.isDirty && ( (state.loadedListName && state.loadedListName !== listNameToLoad) || (!state.loadedListName && listNameToLoad !== '') || (listNameToLoad === '' && state.loadedListName) ) ) {
            let modalMessage = `<strong>${state.loadedListName || '현재 편집 중인'}</strong> 목록에 저장되지 않은 변경사항이 있습니다. `;
            if (listNameToLoad && listNameToLoad !== state.loadedListName) {
                modalMessage += `정말 <strong>'${listNameToLoad}'</strong> 목록을 불러오시겠습니까? (변경사항은 사라집니다)`;
            } else if (listNameToLoad === '' && state.loadedListName) {
                modalMessage += `선택을 해제하고 새 목록 상태로 전환하시겠습니까? (변경사항은 사라집니다)`;
            } else if (!state.loadedListName && listNameToLoad !== '') {
                 modalMessage += `정말 <strong>'${listNameToLoad}'</strong> 목록을 불러오시겠습니까? (현재 입력한 내용은 사라집니다)`;
            }


            const confirmed = await Modal.show({
                title: '저장되지 않은 변경사항',
                body: modalMessage,
                danger: true,
                confirmText: listNameToLoad ? '불러오기' : '새로 시작',
                cancelText: '취소'
            });
            if (!confirmed) {
                if (UI.savedListsDropdown) UI.savedListsDropdown.value = state.loadedListName || '';
                return;
            }
        }

        if (!listNameToLoad) {
            _switchToNewListState();
            return;
        }

        const lists = await getSavedLists();
        const loadedData = lists[listNameToLoad];
        if (!loadedData) {
            Toast.show(`'${listNameToLoad}' 목록을 찾을 수 없습니다. 목록이 삭제되었을 수 있습니다.`, 'error');
            state.loadedListName = null;
            state.originalLoadedListUrls = null;
            state.isDirty = (UI.urlInput && UI.urlInput.value.trim() !== '');
            await loadSavedLists();
            return;
        }
        const loadedUrls = loadedData.urls || '';
        if (UI.urlInput) UI.urlInput.value = loadedUrls;

        state.originalLoadedListUrls = loadedUrls;
        state.isDirty = false;
        state.loadedListName = listNameToLoad;

        updateButtonState();
        Toast.show(`'${listNameToLoad}' 목록을 불러왔습니다.`, 'info');
        if (UI.savedListsDropdown) UI.savedListsDropdown.blur();
        scheduleSetCardHeight();
    };

    const handleDeleteList = async () => {
        const listName = UI.savedListsDropdown ? UI.savedListsDropdown.value : null;
        if (!listName) return;

        const confirmed = await Modal.show({
            title: '목록 삭제 확인',
            body: `<strong>'${listName}'</strong> 목록을 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
            danger: true,
            confirmText: '삭제'
        });
        if (!confirmed) return;

        const lists = await getSavedLists();
        delete lists[listName];

        if (await saveLists(lists)) {
            const wasCurrentlyLoaded = state.loadedListName === listName;
            if (wasCurrentlyLoaded) {
                _switchToNewListState();
                Toast.show(`'${listName}' 목록이 삭제되었고, 새 목록 상태로 전환합니다.`, 'success');
            } else {
                Toast.show(`'${listName}' 목록이 삭제되었습니다.`, 'success');
            }
            await loadSavedLists();
        } else {
            Toast.show(`'${listName}' 목록 삭제에 실패했습니다. 변경사항이 저장되지 않았습니다.`, 'error');
            await loadSavedLists();
        }
        if (UI.savedListsDropdown) UI.savedListsDropdown.blur();
    };

    const handleRenameList = async () => {
        const oldName = UI.savedListsDropdown ? UI.savedListsDropdown.value : null;
        if (!oldName) return;

        const result = await Modal.show({
            title: '이름 변경',
            body: `<input type="text" id="modal-input" value="${oldName}" />`,
            confirmText: '변경'
        });
        const rawNewName = document.getElementById('modal-input')?.value;
        if (!result || !rawNewName) return;

        const newName = rawNewName.trim().replace(/\s+/g, ' ');
        if (!newName) {
            Toast.show('목록 이름은 비워둘 수 없습니다.', 'error');
            return;
        }
        if (newName === oldName) return;

        const lists = await getSavedLists();
        if (lists[newName]) {
            await Modal.show({ title: '오류', body: '같은 이름의 목록이 이미 존재합니다.', hideCancel: true });
            return;
        }

        lists[newName] = lists[oldName];
        delete lists[oldName];

        if (await saveLists(lists)) {
            if (state.loadedListName === oldName) {
                state.loadedListName = newName;
            }
            Toast.show('이름이 변경되었습니다.', 'success');
            await loadSavedLists();
            if(UI.savedListsDropdown) UI.savedListsDropdown.value = newName;
            if (UI.savedListsDropdown) UI.savedListsDropdown.blur();
        }
    };

    const handleCancelEdit = () => {
        if (state.loadedListName && state.originalLoadedListUrls !== null && state.isDirty) {
            if (UI.urlInput) UI.urlInput.value = state.originalLoadedListUrls;
            state.isDirty = false;
            updateButtonState();
            Toast.show(`'${state.loadedListName}' 목록의 변경사항이 취소되었습니다.`, 'info');
            scheduleSetCardHeight();
        }
    };

    const fetchAndApplyTabs = async (mode, queryOptions) => {
        try {
            const tabs = await chrome.tabs.query(queryOptions);
            let newUrls = tabs
                .map(tab => tab.url)
                .filter(url => url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://')));

            if (newUrls.length === 0) {
                Toast.show('가져올 수 있는 탭이 없습니다. (http, https, file 프로토콜만 지원)', 'info');
                return;
            }

            let urlString = newUrls.join('\n');
            if (UI.urlInput) {
                if (mode === 'overwrite') {
                    UI.urlInput.value = urlString + (urlString.length > 0 ? '\n' : '');
                } else if (mode === 'append') {
                    const existingText = UI.urlInput.value.trim();
                    UI.urlInput.value = (existingText ? existingText + '\n' : '') + urlString + '\n';
                }
            }

            state.isDirty = true;
            if (!state.loadedListName) {
                state.originalLoadedListUrls = null;
            }
            updateButtonState();
            Toast.show(`${newUrls.length}개의 탭을 ${mode === 'overwrite' ? '가져왔습니다' : '추가했습니다'}.`, 'success');
            scheduleSetCardHeight();
        } catch (e) {
            console.error('Error fetching tabs:', e);
            Toast.show('탭을 불러오는 데 실패했습니다.', 'error');
        }
    };

    const createTabFetchHandler = (queryOptions, modalTitle) => {
        return async () => {
            if (UI.urlInput && UI.urlInput.value.trim() === '' && !state.loadedListName && !state.isDirty) {
                fetchAndApplyTabs('overwrite', queryOptions);
                return;
            }

            const choice = await Modal.show({
                title: modalTitle,
                body: '기존 목록을 지우고 새로 가져오거나, 현재 목록의 끝에 추가할 수 있습니다.',
                buttons: [
                    { text: '취소', value: 'cancel', isDefaultCancel: true },
                    { text: '추가하기', value: 'append' },
                    { text: '덮어쓰기', value: 'overwrite', isDanger: true }
                ]
            });

            if (choice === 'append') fetchAndApplyTabs('append', queryOptions);
            else if (choice === 'overwrite') fetchAndApplyTabs('overwrite', queryOptions);
        };
    };

    const handleExportLists = async () => {
        const lists = await getSavedLists();
        if (Object.keys(lists).length === 0) {
            Toast.show('내보낼 목록이 없습니다.', 'error');
            return;
        }
        const dataStr = JSON.stringify(lists, null, 2);
        const blob = new Blob([dataStr], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `multi_url_opener_lists_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Toast.show('모든 목록을 내보냈습니다.', 'success');
    };

    async function processJsonImport(jsonString) {
        let importedJson;
        try {
            importedJson = JSON.parse(jsonString);
            if (typeof importedJson !== 'object' || importedJson === null || Array.isArray(importedJson)) {
                throw new Error('Invalid JSON structure. Expected an object of lists.');
            }
        } catch (err) {
            console.error("JSON parsing error:", err);
            await Modal.show({ title: '가져오기 실패', body: '유효하지 않은 JSON 파일이거나, 올바른 목록 구조가 아닙니다 (최상위는 객체여야 합니다).', hideCancel: true });
            return;
        }

        const validImportedLists = {};
        for (const key in importedJson) {
            if (Object.prototype.hasOwnProperty.call(importedJson, key) &&
                typeof importedJson[key] === 'object' &&
                importedJson[key] !== null &&
                'urls' in importedJson[key] &&
                typeof importedJson[key].urls === 'string') {
                validImportedLists[key] = {
                    urls: importedJson[key].urls,
                    createdAt: importedJson[key].createdAt || new Date().toISOString()
                };
            } else {
                console.warn(`Skipping invalid list structure for key: ${key} during import.`);
            }
        }

        if (Object.keys(validImportedLists).length === 0) {
            Toast.show('JSON 파일에 유효한 목록 데이터가 없습니다.', 'info');
            return;
        }

        const currentLists = await getSavedLists();
        const conflicts = Object.keys(validImportedLists).filter(key => currentLists[key]);
        let applyImport = true;
        let newListsData = { ...currentLists };

        if (conflicts.length > 0) {
            const choice = await Modal.show({
                title: '목록 충돌 발생',
                body: `다음 목록이 이미 존재합니다: <strong>${conflicts.join(', ')}</strong>.<br>충돌하는 목록을 덮어쓰시겠습니까, 건너뛰시겠습니까? (충돌하지 않는 목록은 항상 추가됩니다)`,
                buttons: [
                    { text: '가져오기 취소', value: 'cancel_import', isDefaultCancel: true },
                    { text: '모두 건너뛰기', value: 'skip_all_conflicts' },
                    { text: '모두 덮어쓰기', value: 'overwrite_all_conflicts', isDanger: true },
                ]
            });

            if (choice === 'overwrite_all_conflicts') {
                for (const key in validImportedLists) { newListsData[key] = validImportedLists[key]; }
            } else if (choice === 'skip_all_conflicts') {
                for (const key in validImportedLists) { if (!conflicts.includes(key)) newListsData[key] = validImportedLists[key]; }
            } else {
                applyImport = false;
            }
        } else {
            newListsData = { ...currentLists, ...validImportedLists };
        }

        if (applyImport && await saveLists(newListsData)) {
            Toast.show('JSON 목록을 성공적으로 가져왔습니다.', 'success');
            _switchToNewListState();
            await loadSavedLists();
        } else if (!applyImport) {
            Toast.show('JSON 가져오기가 취소되었거나 변경사항이 없습니다.', 'info');
        }
    }

    async function processTextImport(textContent) {
        const urls = textContent.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('file://')));

        if (urls.length === 0) {
            Toast.show('텍스트 파일에 유효한 URL이 없거나 지원하는 프로토콜(http, https, file)이 아닙니다.', 'info');
            return;
        }
        const urlString = urls.join('\n');

        if (UI.urlInput && UI.urlInput.value.trim() !== '') {
            const choice = await Modal.show({
                title: '텍스트 파일 가져오기',
                body: '현재 편집 중인 URL 목록이 있습니다. 가져온 URL 목록으로 덮어쓰시겠습니까, 아니면 뒤에 추가하시겠습니까?',
                buttons: [
                    { text: '취소', value: 'cancel', isDefaultCancel: true },
                    { text: '뒤에 추가', value: 'append' },
                    { text: '덮어쓰기', value: 'overwrite', isDanger: true },
                ]
            });

            if (choice === 'overwrite') {
                if (UI.urlInput) UI.urlInput.value = urlString + '\n';
                Toast.show(`텍스트 파일에서 ${urls.length}개의 URL을 가져와 덮어썼습니다.`, 'success');
            } else if (choice === 'append') {
                if (UI.urlInput) UI.urlInput.value += (UI.urlInput.value.endsWith('\n') || UI.urlInput.value.trim() === '' ? '' : '\n') + urlString + '\n';
                Toast.show(`텍스트 파일에서 ${urls.length}개의 URL을 추가했습니다.`, 'success');
            } else {
                Toast.show('텍스트 파일 가져오기가 취소되었습니다.', 'info');
                return;
            }
        } else {
            if (UI.urlInput) UI.urlInput.value = urlString + '\n';
            Toast.show(`텍스트 파일에서 ${urls.length}개의 URL을 가져왔습니다.`, 'success');
        }

        state.isDirty = true;
        if (!state.loadedListName) {
            state.originalLoadedListUrls = null;
        }
        updateButtonState();
        scheduleSetCardHeight();
        if (UI.urlInput) {
            UI.urlInput.focus();
            UI.urlInput.scrollTop = UI.urlInput.scrollHeight;
        }
    }

    const processImportedFile = (file) => {
        if (!file) return;
        const reader = new FileReader();

        reader.onload = async (e) => {
            const fileContent = e.target.result;
            const fileName = file.name.toLowerCase();
            const fileType = file.type;

            if (fileType === 'application/json' || fileName.endsWith('.json')) {
                await processJsonImport(fileContent);
            } else if (fileType === 'text/plain' || fileName.endsWith('.txt')) {
                await processTextImport(fileContent);
            } else {
                Toast.show('지원하지 않는 파일 형식입니다. (.json 또는 .txt 파일만 가능)', 'error');
            }
        };
        reader.onerror = () => {
            console.error('File reading error');
            Toast.show('파일을 읽는 중 오류가 발생했습니다.', 'error');
        };
        reader.readAsText(file);
    };
    const handleImportLists = (event) => {
        if (!event.target.files || event.target.files.length === 0) return;
        const file = event.target.files[0];
        if (!file) return;
        processImportedFile(file);
        event.target.value = '';
    };

    async function createAndDiscardTab(url) {
        let newTab;
        const tabToWatch = { id: null };
        let updateListener, removeListener;

        const cleanup = () => {
            if (updateListener) chrome.tabs.onUpdated.removeListener(updateListener);
            if (removeListener) chrome.tabs.onRemoved.removeListener(removeListener);
        };

        updateListener = (tabId, changeInfo) => {
            if (tabId === tabToWatch.id && changeInfo.status === 'loading') {
                cleanup();
                chrome.tabs.discard(tabId).catch((discardError) => {
                    console.warn(`Failed to discard tab ${tabId} for URL ${url}:`, discardError);
                });
            }
        };

        removeListener = (tabId) => {
            if (tabId === tabToWatch.id) {
                cleanup();
            }
        };

        try {
            newTab = await chrome.tabs.create({ active: false });
            tabToWatch.id = newTab.id;

            chrome.tabs.onUpdated.addListener(updateListener);
            chrome.tabs.onRemoved.addListener(removeListener);

            await chrome.tabs.update(newTab.id, { url });
        } catch (error) {
            console.error(`Error creating/updating tab for ${url}:`, error);
            cleanup();
            if (newTab && newTab.id) {
                chrome.tabs.remove(newTab.id).catch(removeError => {
                    console.warn(`Failed to remove tab ${newTab.id} after error:`, removeError);
                });
            }
            throw error;
        }
    }

    const processNextUrl = async () => {
        if (state.isPaused || state.currentUrlIndex >= state.urlsToProcess.length) {
            if (state.currentUrlIndex >= state.urlsToProcess.length && state.urlsToProcess.length > 0) {
                setTimeout(handleCompletion, 400);
            }
            return;
        }

        const previousSpan = UI.urlQueue ? UI.urlQueue.querySelector(`.${CONFIG.CSS.PROCESSING_CLASS}`) : null;
        if (previousSpan) {
            previousSpan.classList.remove(CONFIG.CSS.PROCESSING_CLASS);
            previousSpan.classList.add(CONFIG.CSS.REMOVING_CLASS);
        }

        const url = state.urlsToProcess[state.currentUrlIndex];
        const fullUrl = (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://')) ? url : 'https://' + url;

        const currentSpan = UI.urlQueue && UI.urlQueue.children[state.currentUrlIndex] ? UI.urlQueue.children[state.currentUrlIndex] : null;
        if (currentSpan) {
            currentSpan.classList.add(CONFIG.CSS.PROCESSING_CLASS);
            currentSpan.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        try {
            const urlToOpen = new URL(fullUrl).href;
            if (UI.delayLoadingCheckbox && UI.delayLoadingCheckbox.checked) {
                await createAndDiscardTab(urlToOpen);
            } else {
                await chrome.tabs.create({ url: urlToOpen, active: (UI.focusLockCheckbox ? !UI.focusLockCheckbox.checked : true) });
            }
        } catch (e) {
            console.error(`Error processing URL ${url}:`, e);
            state.errorCount++;
            if (currentSpan) {
                currentSpan.classList.add(CONFIG.CSS.ERROR_CLASS);
                currentSpan.textContent = `⚠️ ${url}`;
                currentSpan.title = `오류: ${e.message}`;
            }
        }

        state.currentUrlIndex++;
        updateProgress();

        const value = UI.intervalInput ? parseFloat(UI.intervalInput.value) : CONFIG.DEFAULT_OPTIONS.interval;
        const intervalSeconds = !isNaN(value) && value >= 0.1 ? value : 0.1;
        state.intervalId = setTimeout(processNextUrl, intervalSeconds * 1000);
    };

    const startProcess = () => {
        if (!UI.urlInput) return;
        const rawUrls = UI.urlInput.value.split('\n').map(u => u.trim()).filter(Boolean);
        state.urlsToProcess = (UI.removeDuplicatesCheckbox && UI.removeDuplicatesCheckbox.checked)
            ? [...new Set(rawUrls)]
            : rawUrls;

        if (state.urlsToProcess.length === 0) {
            resetToIdle(CONFIG.TEXT.EMPTY_INPUT, true);
            return;
        }

        Object.assign(state, { currentUrlIndex: 0, isPaused: false, errorCount: 0 });

        if (UI.urlQueue) {
            const fragment = document.createDocumentFragment();
            state.urlsToProcess.forEach(url => {
                const span = document.createElement('span');
                span.textContent = url;
                fragment.appendChild(span);
            });
            UI.urlQueue.innerHTML = '';
            UI.urlQueue.appendChild(fragment);
        }

        setView('running');
        setControlsEnabled(false);
        updateProgress();
        processNextUrl();
    };

    const togglePause = () => {
        state.isPaused = !state.isPaused;
        updateButtonState();
        updateProgress();

        if (state.isPaused) {
            clearTimeout(state.intervalId);
        } else {
            processNextUrl();
        }
    };

    const handleCompletion = () => {
        const total = state.urlsToProcess.length;
        const success = total - state.errorCount;
        if (UI.progressStats) {
            UI.progressStats.textContent = CONFIG.TEXT.PROCESS_COMPLETE(total, success, state.errorCount);
            UI.progressStats.className = CONFIG.CSS.COMPLETE_CLASS;
        }
        if (UI.urlQueue) UI.urlQueue.innerHTML = '';

        setView('complete');
    };

    const handleStartRunButtonClick = () => {
        const viewState = state.currentView;
        if (viewState === 'input') {
            startProcess();
        } else if (viewState === 'complete') {
            resetToIdle();
        }
    };

    const updateProgress = () => {
        if (!UI.progressBar || !UI.progressStats) return;

        const total = state.urlsToProcess.length;
        const opened = state.currentUrlIndex;
        const remaining = total - opened;

        UI.progressBar.value = total > 0 ? (opened / total) * 100 : 0;

        let progressMessage;
        const listDisplayName = state.loadedListName ? `'${state.loadedListName}'` : '현재 목록';

        if (state.isPaused) {
            progressMessage = `${listDisplayName} | ${CONFIG.TEXT.PAUSED_BY_USER}`;
        } else {
            const percentage = total > 0 ? Math.round((opened / total) * 100) : 0;
            progressMessage = `${listDisplayName} | ⏳ 총 ${total}개 | ${opened}개 열림 | ${remaining}개 남음 | ${percentage}% 진행`;
        }
        UI.progressStats.textContent = progressMessage;
        UI.progressStats.className = '';
        scheduleSetCardHeight();
    };

    const saveOptions = () => {
        if (!UI.intervalInput || !UI.removeDuplicatesCheckbox || !UI.focusLockCheckbox || !UI.delayLoadingCheckbox) return;
        try {
            chrome.storage.local.set({ [CONFIG.STORAGE_KEY]: {
                interval: parseFloat(UI.intervalInput.value),
                removeDuplicates: UI.removeDuplicatesCheckbox.checked,
                focusLock: UI.focusLockCheckbox.checked,
                delayLoading: UI.delayLoadingCheckbox.checked
            }});
        } catch (e) { console.error('Failed to save options:', e); }
    };
    const loadOptions = async () => {
        if (!UI.intervalInput || !UI.removeDuplicatesCheckbox || !UI.focusLockCheckbox || !UI.delayLoadingCheckbox) return;
        try {
            const data = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
            const options = { ...CONFIG.DEFAULT_OPTIONS, ...(data[CONFIG.STORAGE_KEY] || {}) };
            UI.intervalInput.value = options.interval;
            UI.removeDuplicatesCheckbox.checked = options.removeDuplicates;
            UI.focusLockCheckbox.checked = options.focusLock;
            UI.delayLoadingCheckbox.checked = options.delayLoading;
        } catch (e) { console.error('Failed to load options:', e); }
    };

    async function initializeApp() {
        const handleGetAllTabs = createTabFetchHandler({}, '모든 창의 탭 가져오기');
        const handleGetCurrentTabs = createTabFetchHandler({ currentWindow: true }, '현재 창의 탭 가져오기');

        if (UI.startRunButton) UI.startRunButton.addEventListener('click', handleStartRunButtonClick);
        if (UI.pauseResumeButton) UI.pauseResumeButton.addEventListener('click', togglePause);
        if (UI.stopProcessButton) {
            UI.stopProcessButton.addEventListener('click', async () => {
                const confirmed = await Modal.show({
                    title: '실행 종료 확인',
                    body: '정말 현재 작업을 종료하시겠습니까?',
                    danger: true,
                    confirmText: '종료'
                });
                if (confirmed) handleStopProcess();
            });
        }

        if(UI.urlInput) {
            UI.urlInput.addEventListener('input', () => {
                state.isDirty = true;
                if (!state.loadedListName) state.originalLoadedListUrls = null;
                updateButtonState();
                if (state.currentView === 'input') scheduleSetCardHeight();
            });
            UI.urlInput.addEventListener('paste', () => {
                setTimeout(() => {
                    state.isDirty = true;
                    if (!state.loadedListName) state.originalLoadedListUrls = null;
                    updateButtonState();
                    if (state.currentView === 'input') scheduleSetCardHeight();
                }, 0);
            });
        }
        if(UI.removeDuplicatesCheckbox) UI.removeDuplicatesCheckbox.addEventListener('change', updateButtonState);

        if (UI.clearButton) {
            UI.clearButton.addEventListener('click', () => {
                if (UI.urlInput) UI.urlInput.value = '';
                state.isDirty = true;
                if (!state.loadedListName) state.originalLoadedListUrls = null;
                updateButtonState();
                if (UI.urlInput) UI.urlInput.focus();
                if (state.currentView === 'input') scheduleSetCardHeight();
            });
        }
        if (UI.sortUrlsButton) {
            UI.sortUrlsButton.addEventListener('click', () => {
                if (!UI.urlInput) return;
                const urls = UI.urlInput.value.split('\n').filter(Boolean);
                if (urls.length === 0) return;
                urls.sort((a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'}));
                const newValue = urls.join('\n') + '\n';
                if (UI.urlInput.value !== newValue) {
                    UI.urlInput.value = newValue;
                    state.isDirty = true; if (!state.loadedListName) state.originalLoadedListUrls = null;
                    updateButtonState();
                    if (state.currentView === 'input') scheduleSetCardHeight();
                }
            });
        }
        if (UI.deduplicateUrlsButton) {
            UI.deduplicateUrlsButton.addEventListener('click', () => {
                if (!UI.urlInput) return;
                const urls = UI.urlInput.value.split('\n').filter(Boolean);
                if (urls.length === 0) return;
                const uniqueUrls = [...new Set(urls)];
                const newValue = uniqueUrls.join('\n') + '\n';
                if (UI.urlInput.value !== newValue) {
                    UI.urlInput.value = newValue;
                    state.isDirty = true; if (!state.loadedListName) state.originalLoadedListUrls = null;
                    updateButtonState();
                    if (state.currentView === 'input') scheduleSetCardHeight();
                }
            });
        }

        if (UI.newListButton) UI.newListButton.addEventListener('click', handleStartNewList);
        if (UI.cancelEditButton) UI.cancelEditButton.addEventListener('click', handleCancelEdit);

        if(UI.urlQueue) {
            UI.urlQueue.addEventListener('transitionend', (e) => {
                if (e.target.classList.contains(CONFIG.CSS.REMOVING_CLASS)) {
                    e.target.style.display = 'none';
                }
            });
        }

        if(UI.optionsList) {
            UI.optionsList.addEventListener('change', (e) => {
                saveOptions();
                if (e.target.id === 'removeDuplicates') updateButtonState();
                if (state.currentView === 'input') scheduleSetCardHeight();
            });
            UI.optionsList.addEventListener('click', (e) => {
                const item = e.target.closest('.option-item');
                const checkbox = item?.querySelector('input[type="checkbox"]');
                if (checkbox && e.target !== checkbox && e.target.tagName !== 'INPUT') {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        }

        if (UI.saveListButton) {
            UI.saveListButton.addEventListener('click', () => {
                if (state.loadedListName && state.isDirty) {
                    handleUpdateList();
                } else {
                    handleSaveAsNewList();
                }
            });
        }
        if (UI.deleteListButton) UI.deleteListButton.addEventListener('click', handleDeleteList);
        if (UI.renameListButton) UI.renameListButton.addEventListener('click', handleRenameList);
        if (UI.savedListsDropdown) {
            UI.savedListsDropdown.addEventListener('change', async () => await handleLoadList());
            UI.savedListsDropdown.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    await handleLoadList();
                    UI.savedListsDropdown.blur();
                }
            });
        }

        if (UI.getAllTabsButton) UI.getAllTabsButton.addEventListener('click', handleGetAllTabs);
        if (UI.getCurrentTabsButton) UI.getCurrentTabsButton.addEventListener('click', handleGetCurrentTabs);
        if (UI.exportButton) UI.exportButton.addEventListener('click', handleExportLists);
        if (UI.importButton) UI.importButton.addEventListener('click', () => { if (UI.importFileInput) UI.importFileInput.click(); });
        if (UI.importFileInput) UI.importFileInput.addEventListener('change', handleImportLists);

        if(UI.mainContainer) {
            UI.mainContainer.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); UI.mainContainer.classList.add('dragover'); });
            UI.mainContainer.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); UI.mainContainer.classList.remove('dragover'); });
            UI.mainContainer.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                UI.mainContainer.classList.remove('dragover');
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    processImportedFile(file);
                }
            });
        }

        if(UI.modalConfirmBtn) UI.modalConfirmBtn.addEventListener('click', () => Modal.hide(true));
        if(UI.modalCancelBtn) UI.modalCancelBtn.addEventListener('click', () => Modal.hide(false));
        if(UI.modalOverlay) UI.modalOverlay.addEventListener('click', (e) => { if (e.target === UI.modalOverlay) Modal.hide(undefined); });

        const observer = new MutationObserver((mutationsList, observer) => {
            for(const mutation of mutationsList) {
                if (mutation.type === 'childList' || mutation.type === 'characterData' ||
                    (mutation.type === 'attributes' && (mutation.attributeName === 'style' || mutation.attributeName === 'class' || mutation.attributeName === 'value'))) {
                    scheduleSetCardHeight();
                    return;
                }
            }
        });

        const observerConfig = {
            childList: true, subtree: true, characterData: true,
            attributes: true, attributeFilter: ['style', 'class', 'value', 'disabled', 'checked', 'selected', 'open']
        };

        const observeElements = [
            UI.urlQueue, UI.currentListIndicator, UI.inputWrapperContent,
            UI.inputControlButtonsWrapper, UI.runningWrapperScrollableContent,
            UI.runningWrapperStickyHeader, UI.optionsListWrapper, UI.progressStats, UI.progressBar,
            UI.sectionCardContainer
        ];
        observeElements.forEach(el => {
            if (el) observer.observe(el, observerConfig);
        });

        window.addEventListener('resize', scheduleSetCardHeight);

        await resetToIdle();
        await Promise.all([loadOptions(), loadSavedLists()]);

        requestAnimationFrame(() => {
             scheduleSetCardHeight();
        });
    };

    initializeApp().catch(err => {
        console.error("Initialization failed:", err);
        Toast.show("앱 초기화에 실패했습니다. 새로고침하거나 다시 시도해주세요.", "error", 5000);
    });
});