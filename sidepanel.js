// 이 앱은 여러 창/탭에서 여러 사이드 패널 (여러 URL 열기, 세션 매니저) 을 열고 동시에 편집하는 것 자체를 지원하지 않고, 가정하지도 않습니다.
document.addEventListener('DOMContentLoaded', function() {
    'use strict';

    // --- Tab UI Control ---
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;

            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            tabPanes.forEach(pane => {
                if (pane.id === `${targetTab}-pane`) {
                    pane.classList.add('active');
                } else {
                    pane.classList.remove('active');
                }
            });
        });
    });

    // --- App Initializer Function ---
    function initializeApp(appScope, paneId) {
        const pane = document.getElementById(paneId);
        if (pane) {
            appScope(pane);
        } else {
            console.error(`Pane with ID "${paneId}" not found.`);
        }
    }

    // --- "여러 URL 열기" App Logic (Scoped IIFE) ---
    const lunaToolsApp = (function(pane) {
        const CONFIG = {
            TEXT: {
                RUN: '실행하기 (Ctrl+Enter)',
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
                HEADER: '.header',
                SECTION_CARD_CONTAINER: '.section-card-container',
                URL_INPUT: '#urlInput', INTERVAL_INPUT: '#intervalInput', REMOVE_DUPLICATES_CHECKBOX: '#removeDuplicates',
                SORT_URLS_BEFORE_RUN_CHECKBOX: '#sortUrlsBeforeRun',
                FOCUS_LOCK_CHECKBOX: '#focusLock', DELAY_LOADING_CHECKBOX: '#delayLoading',
                PLAY_SOUND_CHECKBOX: '#playSound',
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
                interval: 2, removeDuplicates: true, focusLock: true, delayLoading: false, sortUrlsBeforeRun: true, playSound: true
            },
            FADE_DURATION: 300,
            MAX_IMPORT_FILE_SIZE_BYTES: 32 * 1024 * 1024,
            MAX_URLS_PER_RUN: 300,
            MAX_URL_LENGTH: 2048,
            MAX_LIST_NAME_LENGTH: 200,
            EXPORT_URL_REVOKE_DELAY_MS: 60 * 1000,
            DELAY_LOADING_NAVIGATION_WAIT_MS: 2500,
            MIN_INTERVAL_SECONDS: 0.1,
            // setTimeout() uses a signed 32-bit millisecond delay in Chromium.
            MAX_INTERVAL_SECONDS: Math.floor(0x7FFFFFFF / 1000)
        };

        const UI = Object.keys(CONFIG.SELECTOR).reduce((acc, key) => {
            const selector = CONFIG.SELECTOR[key];
            if (selector) {
                const element = pane.querySelector(selector);
                if (element) {
                     acc[key.toLowerCase().replace(/_([a-z])/g, g => g[1].toUpperCase())] = element;
                } else {
                    // console.warn(`UI element not found for selector: ${selector}`);
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
            isInitialLoad: true,
            currentRunId: 0,
            processingRunId: null,
            completionRunId: null,
            unprocessedInputCount: 0
        };

        const canAutoFocusUrlInput = () => (
            UI.urlInput &&
            !UI.urlInput.disabled &&
            state.currentView === 'input' &&
            pane.classList.contains('active') &&
            (!UI.modalOverlay || !UI.modalOverlay.classList.contains('visible')) &&
            document.visibilityState !== 'hidden'
        );

        const focusUrlInput = () => {
            if (!canAutoFocusUrlInput()) return;

            try {
                UI.urlInput.focus({ preventScroll: true });
            } catch (_) {
                UI.urlInput.focus();
            }

            const cursorPosition = UI.urlInput.value.length;
            try {
                UI.urlInput.setSelectionRange(cursorPosition, cursorPosition);
            } catch (_) {
                // 일부 브라우저/상태에서 selectionRange가 실패해도 포커스 자체는 유지합니다.
            }
        };

        const focusUrlInputWhenPanelIsReady = () => {
            requestAnimationFrame(focusUrlInput);
            setTimeout(focusUrlInput, 80);
            setTimeout(focusUrlInput, 250);
            setTimeout(focusUrlInput, 600);
        };

        const escapeHtml = (value) => String(value ?? '').replace(/[&<>"'`]/g, (ch) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '`': '&#96;'
        }[ch]));

        const OPENABLE_URL_PROTOCOLS = new Set(['http:', 'https:']);
        const URL_CONTROL_CHARACTER_REGEX = /[\u0000-\u001F\u007F]/u;
        const HOSTNAME_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
        const IPV4_HOSTNAME_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
        const IPV6_HOSTNAME_REGEX = /^\[[0-9a-f:.]+\]$/i;

        const isValidOpenableHostname = (hostname) => {
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

        const normalizeUrlForOpening = (rawUrl) => {
            if (typeof rawUrl !== 'string') return null;
            const trimmed = rawUrl.trim();
            if (!trimmed || trimmed.length > CONFIG.MAX_URL_LENGTH || URL_CONTROL_CHARACTER_REGEX.test(trimmed)) return null;
            // Relative paths and protocol-relative URLs must not be reinterpreted as external domains.
            if (/^[\\/]/.test(trimmed)) return null;

            const hasOpenableScheme = /^https?:\/\//i.test(trimmed);
            const protocolMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);

            // Bare host:port values are accepted, but explicit unsafe schemes are rejected.
            if (protocolMatch && !hasOpenableScheme) {
                const candidateScheme = protocolMatch[1].toLowerCase();
                const valueAfterColon = trimmed.slice(protocolMatch[0].length);
                const looksLikeBareHostWithPort =
                    (candidateScheme.includes('.') || candidateScheme === 'localhost') && /^\d+(?:[/?#]|$)/.test(valueAfterColon);
                if (!looksLikeBareHostWithPort) return null;
            }

            const candidate = hasOpenableScheme ? trimmed : `https://${trimmed}`;
            try {
                const parsed = new URL(candidate);
                if (!OPENABLE_URL_PROTOCOLS.has(parsed.protocol) || !isValidOpenableHostname(parsed.hostname)) return null;
                if (parsed.href.length > CONFIG.MAX_URL_LENGTH) return null;
                if (parsed.username || parsed.password) return null;
                return parsed.href;
            } catch (_) {
                return null;
            }
        };

        const prepareUrlsForRun = (rawUrls) => {
            const prepared = [];
            const stats = { invalid: 0, tooLong: 0, duplicate: 0, overLimit: 0 };

            for (const rawUrl of rawUrls) {
                if (typeof rawUrl !== 'string') {
                    stats.invalid += 1;
                    continue;
                }

                const trimmed = rawUrl.trim();
                if (!trimmed) continue;
                if (trimmed.length > CONFIG.MAX_URL_LENGTH) {
                    stats.tooLong += 1;
                    continue;
                }

                const normalizedUrl = normalizeUrlForOpening(trimmed);
                if (!normalizedUrl) {
                    stats.invalid += 1;
                    continue;
                }
                prepared.push(normalizedUrl);
            }

            let urls = prepared;
            if (UI.sortUrlsBeforeRunCheckbox && UI.sortUrlsBeforeRunCheckbox.checked) {
                urls = [...urls].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
            }

            if (UI.removeDuplicatesCheckbox && UI.removeDuplicatesCheckbox.checked) {
                const deduplicated = [];
                const seenUrls = new Set();
                for (const url of urls) {
                    if (seenUrls.has(url)) {
                        stats.duplicate += 1;
                        continue;
                    }
                    seenUrls.add(url);
                    deduplicated.push(url);
                }
                urls = deduplicated;
            }

            if (urls.length > CONFIG.MAX_URLS_PER_RUN) {
                stats.overLimit = urls.length - CONFIG.MAX_URLS_PER_RUN;
                urls = urls.slice(0, CONFIG.MAX_URLS_PER_RUN);
            }

            return { urls, ...stats };
        };

        const showSkippedUrlNotice = ({ invalid = 0, tooLong = 0, duplicate = 0, overLimit = 0 }) => {
            const parts = [];
            if (invalid > 0) parts.push(`형식 오류 ${invalid}개`);
            if (tooLong > 0) parts.push(`길이 초과 ${tooLong}개`);
            if (duplicate > 0) parts.push(`중복 제외 ${duplicate}개`);
            if (overLimit > 0) parts.push(`최대 ${CONFIG.MAX_URLS_PER_RUN}개 초과 ${overLimit}개`);
            if (parts.length > 0) {
                Toast.show(`일부 URL을 제외했습니다. (${parts.join(', ')})`, 'info', 6000);
            }
        };

        const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
        const CONTROL_CHARACTER_REGEX = /[\u0000-\u001F\u007F]/;
        const hasOwnListKey = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
        const isReservedObjectKey = (key) => RESERVED_OBJECT_KEYS.has(String(key));
        const normalizeListName = (name) => String(name ?? '').trim().replace(/\s+/g, ' ');
        const generateUniqueListName = (baseName, usedNames) => {
            const used = usedNames instanceof Set ? usedNames : new Set(usedNames || []);
            const maxLength = CONFIG.MAX_LIST_NAME_LENGTH;
            const fallbackName = 'URL 목록';
            const normalizedBase = normalizeListName(baseName).slice(0, maxLength).trim() || fallbackName;

            if (!used.has(normalizedBase)) return normalizedBase;

            let counter = 2;
            let candidate;
            do {
                const suffix = ` (${counter++})`;
                const availableLength = Math.max(1, maxLength - suffix.length);
                const truncatedBase = normalizedBase.slice(0, availableLength).trimEnd() || fallbackName.slice(0, availableLength);
                candidate = `${truncatedBase}${suffix}`;
            } while (used.has(candidate));

            return candidate;
        };
        const isValidListName = (name) => {
            const normalizedName = normalizeListName(name);
            return Boolean(normalizedName) &&
                normalizedName.length <= CONFIG.MAX_LIST_NAME_LENGTH &&
                !CONTROL_CHARACTER_REGEX.test(normalizedName) &&
                !isReservedObjectKey(normalizedName);
        };

        const toSafeListMap = (value) => {
            const safeMap = Object.create(null);
            if (!value || typeof value !== 'object' || Array.isArray(value)) return safeMap;

            for (const [key, list] of Object.entries(value)) {
                let normalizedName = normalizeListName(key);
                if (!isValidListName(normalizedName)) continue;
                if (!list || typeof list !== 'object' || Array.isArray(list) || typeof list.urls !== 'string') continue;
                if (hasOwnListKey(safeMap, normalizedName)) {
                    normalizedName = generateUniqueListName(normalizedName, Object.keys(safeMap));
                }
                safeMap[normalizedName] = {
                    urls: list.urls,
                    createdAt: typeof list.createdAt === 'string' ? list.createdAt : new Date().toISOString()
                };
            }
            return safeMap;
        };

        const parseStoredListMap = (value) => {
            const safeMap = Object.create(null);
            if (value === undefined) return safeMap;
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                throw new Error('저장된 URL 목록 데이터의 형식이 올바르지 않습니다.');
            }

            for (const [key, list] of Object.entries(value)) {
                const normalizedName = normalizeListName(key);
                if (!isValidListName(normalizedName)) {
                    throw new Error(`저장된 URL 목록 '${key}'의 이름이 올바르지 않습니다.`);
                }
                if (!list || typeof list !== 'object' || Array.isArray(list) || typeof list.urls !== 'string') {
                    throw new Error(`저장된 URL 목록 '${key}'의 데이터가 손상되었습니다.`);
                }
                if (hasOwnListKey(safeMap, normalizedName)) {
                    throw new Error(`저장된 URL 목록 '${key}'의 이름이 다른 목록과 충돌합니다.`);
                }
                safeMap[normalizedName] = {
                    urls: list.urls,
                    createdAt: typeof list.createdAt === 'string' ? list.createdAt : new Date().toISOString()
                };
            }
            return safeMap;
        };

        const assertSafeListName = (name) => {
            const normalizedName = normalizeListName(name);
            if (!normalizedName) {
                Toast.show('목록 이름은 비워둘 수 없습니다.', 'error');
                return false;
            }
            if (normalizedName.length > CONFIG.MAX_LIST_NAME_LENGTH) {
                Toast.show(`목록 이름은 ${CONFIG.MAX_LIST_NAME_LENGTH}자를 초과할 수 없습니다.`, 'error');
                return false;
            }
            if (CONTROL_CHARACTER_REGEX.test(normalizedName)) {
                Toast.show('목록 이름에 제어 문자는 사용할 수 없습니다.', 'error');
                return false;
            }
            if (isReservedObjectKey(normalizedName)) {
                Toast.show('사용할 수 없는 목록 이름입니다. 다른 이름을 입력해주세요.', 'error');
                return false;
            }
            return true;
        };

        const parseHtmlFragmentWithNativeSanitizer = (html, sanitizerConfig) => {
            const source = String(html ?? '');
            const container = document.createElement('div');

            if (typeof container.setHTML === 'function') {
                const attempts = [];
                const SanitizerCtor = globalThis.Sanitizer;
                if (typeof SanitizerCtor === 'function') {
                    attempts.push(() => {
                        const sanitizer = new SanitizerCtor(sanitizerConfig);
                        container.setHTML(source, { sanitizer });
                    });
                    attempts.push(() => {
                        // Transitional implementations may accept a Sanitizer instance directly.
                        const sanitizer = new SanitizerCtor(sanitizerConfig);
                        container.setHTML(source, sanitizer);
                    });
                }
                attempts.push(() => {
                    container.setHTML(source, { sanitizer: sanitizerConfig });
                });
                attempts.push(() => {
                    container.setHTML(source, { sanitizer: 'default' });
                });
                attempts.push(() => {
                    container.setHTML(source);
                });

                for (const applyNativeSanitizer of attempts) {
                    try {
                        container.replaceChildren();
                        applyNativeSanitizer();

                        const nativeFragment = document.createDocumentFragment();
                        while (container.firstChild) {
                            nativeFragment.appendChild(container.firstChild);
                        }
                        return nativeFragment;
                    } catch (_) {
                        // Keep LunaTools' app-level allowlist sanitizer as the reliable fallback
                        // for unsupported or incompatible Sanitizer API implementations.
                    }
                }
            }

            const template = document.createElement('template');
            template.innerHTML = source;
            return template.content;
        };

        const MODAL_HTML_SANITIZER_CONFIG = {
            elements: ['strong', 'br', 'input'],
            attributes: ['id', 'type', 'value', 'placeholder', 'maxlength', 'min', 'max', 'step', 'class', 'autocomplete'],
            comments: false,
            dataAttributes: false
        };

        const createSafeModalFragment = (html) => {
            const fragment = document.createDocumentFragment();
            const sourceFragment = parseHtmlFragmentWithNativeSanitizer(html, MODAL_HTML_SANITIZER_CONFIG);

            const allowedTags = new Set(['STRONG', 'BR', 'INPUT']);
            const allowedInputAttributes = new Set(['id', 'value', 'placeholder', 'maxlength', 'min', 'max', 'step', 'class', 'autocomplete']);
            const allowedInputTypes = new Set(['text', 'search', 'number']);

            const sanitizeNode = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    return document.createTextNode(node.textContent || '');
                }
                if (node.nodeType !== Node.ELEMENT_NODE) {
                    return document.createDocumentFragment();
                }

                const tagName = node.tagName;
                if (!allowedTags.has(tagName)) {
                    const childFragment = document.createDocumentFragment();
                    Array.from(node.childNodes).forEach(child => {
                        const safeChild = sanitizeNode(child);
                        if (safeChild) childFragment.appendChild(safeChild);
                    });
                    return childFragment;
                }

                if (tagName === 'BR') {
                    return document.createElement('br');
                }

                if (tagName === 'INPUT') {
                    const input = document.createElement('input');
                    const requestedType = String(node.getAttribute('type') || 'text').toLowerCase();
                    input.type = allowedInputTypes.has(requestedType) ? requestedType : 'text';
                    for (const attr of allowedInputAttributes) {
                        const value = node.getAttribute(attr);
                        if (value !== null) input.setAttribute(attr, value);
                    }
                    input.setAttribute('type', input.type);
                    return input;
                }

                const clone = document.createElement('strong');
                Array.from(node.childNodes).forEach(child => {
                    const safeChild = sanitizeNode(child);
                    if (safeChild) clone.appendChild(safeChild);
                });
                return clone;
            };

            Array.from(sourceFragment.childNodes).forEach(child => {
                const safeChild = sanitizeNode(child);
                if (safeChild) fragment.appendChild(safeChild);
            });
            return fragment;
        };

        const setSafeModalBody = (element, html) => {
            if (!element) return;
            element.replaceChildren(createSafeModalFragment(html));
        };

        const Modal = {
            resolve: null,
            _keydownListener: null,
            show(config) {
                // Resolve any previous modal before replacing it. Otherwise the
                // previous caller can remain suspended forever.
                if (this.resolve || UI.modalOverlay?.classList.contains('visible')) {
                    this.hide(undefined);
                }
                UI.modalHeader.textContent = config.title;
                setSafeModalBody(UI.modalBody, config.body);
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
                            button.dataset.defaultAction = 'cancel';
                            button.style.backgroundColor = 'var(--bg-control)';
                            button.style.color = 'var(--text-secondary)';
                        } else if (buttonConfig.isDanger) {
                             button.dataset.dangerAction = 'true';
                             button.style.backgroundColor = 'var(--danger-color)';
                             button.style.color = 'white';
                        } else {
                            if (buttonConfig.isDefaultConfirm) {
                                button.dataset.defaultAction = 'confirm';
                            }
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
                if (input) setTimeout(() => input.focus(), 50);
                if (this._keydownListener) {
                    document.removeEventListener('keydown', this._keydownListener);
                }
                this._keydownListener = (e) => {
                    if (!UI.modalOverlay.classList.contains('visible') || e.isComposing) return;
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const customButtonWrapper = UI.modalFooter.querySelector('.custom-buttons');
                        const confirmButton = UI.modalConfirmBtn.style.display !== 'none'
                            ? UI.modalConfirmBtn
                            : customButtonWrapper?.querySelector('button[data-default-action="confirm"]') ||
                              customButtonWrapper?.querySelector('button:not([data-default-action="cancel"]):not([data-danger-action="true"])');
                        if (confirmButton) confirmButton.click();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        const cancelButton = UI.modalCancelBtn.style.display !== 'none'
                            ? UI.modalCancelBtn
                            : UI.modalFooter.querySelector('.custom-buttons button[data-default-action="cancel"]');
                        if (cancelButton) cancelButton.click();
                        else this.hide(undefined);
                    }
                };
                document.addEventListener('keydown', this._keydownListener);
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

		const SoundEffect = {
            _currentContext: null,
            _stopTimer: null,

            async _stopCurrentContext() {
                if (this._stopTimer) {
                    clearTimeout(this._stopTimer);
                    this._stopTimer = null;
                }
                if (this._currentContext) {
                    try { await this._currentContext.close(); } catch (error) {}
                    this._currentContext = null;
                }
            },

            async playSuccess() {
                const TOTAL_SECONDS = 5.0;

                try {
                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    if (!AudioContext) return;

                    await this._stopCurrentContext();

                    const ctx = new AudioContext();
                    this._currentContext = ctx;
                    if (ctx.state === 'suspended') await ctx.resume();

                    const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
                    const cents = (value) => Math.pow(2, value / 1200);

                    const createImpulseResponse = (seconds = 2.85, decay = 4.2) => {
                        const length = Math.floor(ctx.sampleRate * seconds);
                        const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
                        for (let channel = 0; channel < 2; channel += 1) {
                            const data = impulse.getChannelData(channel);
                            for (let i = 0; i < length; i += 1) {
                                const x = i / length;
                                const early = Math.exp(-x * decay);
                                const late = Math.exp(-x * (decay * 0.62));
                                const shimmer = Math.sin(i * 0.017 + channel) * 0.14 + Math.sin(i * 0.041) * 0.06;
                                data[i] = (Math.random() * 2 - 1) * (early * 0.68 + late * 0.22) * (0.82 + shimmer);
                            }
                        }
                        return impulse;
                    };

                    const envelope = (gainParam, time, attack, peak, decayTime, sustainLevel, releaseStart, releaseEnd) => {
                        gainParam.cancelScheduledValues(time);
                        gainParam.setValueAtTime(0.0001, time);
                        gainParam.exponentialRampToValueAtTime(Math.max(peak, 0.0001), time + attack);
                        gainParam.exponentialRampToValueAtTime(Math.max(sustainLevel, 0.0001), time + attack + decayTime);
                        gainParam.setValueAtTime(Math.max(sustainLevel, 0.0001), releaseStart);
                        gainParam.exponentialRampToValueAtTime(0.0001, releaseEnd);
                    };

                    const createAudioGraph = (startTime) => {
                        const master = ctx.createGain();
                        const dry = ctx.createGain();
                        const reverbSend = ctx.createGain();
                        const reverb = ctx.createConvolver();
                        const reverbTone = ctx.createBiquadFilter();
                        const wet = ctx.createGain();
                        const highpass = ctx.createBiquadFilter();
                        const safety = ctx.createDynamicsCompressor();

                        reverb.buffer = createImpulseResponse();
                        reverbTone.type = 'lowpass';
                        reverbTone.frequency.value = 6900;
                        reverbTone.Q.value = 0.35;

                        highpass.type = 'highpass';
                        highpass.frequency.value = 120;
                        highpass.Q.value = 0.55;

                        safety.threshold.value = -9;
                        safety.knee.value = 18;
                        safety.ratio.value = 8.5;
                        safety.attack.value = 0.004;
                        safety.release.value = 0.18;

                        dry.gain.value = 0.98;
                        reverbSend.gain.value = 0.44;
                        wet.gain.value = 0.34;

                        const volumeGain = 0.88;
                        master.gain.setValueAtTime(0.0001, startTime);
                        master.gain.exponentialRampToValueAtTime(0.86 * volumeGain + 0.0001, startTime + 0.035);
                        master.gain.setValueAtTime(0.86 * volumeGain + 0.0001, startTime + 4.22);
                        master.gain.exponentialRampToValueAtTime(0.0001, startTime + TOTAL_SECONDS);

                        dry.connect(master);
                        reverbSend.connect(reverb);
                        reverb.connect(reverbTone);
                        reverbTone.connect(wet);
                        wet.connect(master);
                        master.connect(highpass);
                        highpass.connect(safety);
                        safety.connect(ctx.destination);

                        return {
                            route(node, dryLevel = 1, wetLevel = 1) {
                                const dryGain = ctx.createGain();
                                const wetGain = ctx.createGain();
                                dryGain.gain.value = dryLevel;
                                wetGain.gain.value = wetLevel;
                                node.connect(dryGain);
                                node.connect(wetGain);
                                dryGain.connect(dry);
                                wetGain.connect(reverbSend);
                            }
                        };
                    };

                    const playBell = (graph, options) => {
                        const {
                            midi,
                            time,
                            duration = 1.25,
                            gain = 0.22,
                            pan = 0,
                            detuneCents = 0,
                            bright = 1
                        } = options;

                        const out = ctx.createGain();
                        const tone = ctx.createBiquadFilter();
                        const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
                        tone.type = 'highpass';
                        tone.frequency.value = 360;
                        tone.Q.value = 0.35;
                        out.connect(tone);

                        if (panner) {
                            tone.connect(panner);
                            panner.pan.setValueAtTime(pan, time);
                            graph.route(panner, 1, 0.95);
                        } else {
                            graph.route(tone, 1, 0.95);
                        }

                        const base = midiToHz(midi) * cents(detuneCents);
                        const partials = [
                            { ratio: 1.000, amp: 1.00 },
                            { ratio: 2.002, amp: 0.30 * bright },
                            { ratio: 3.006, amp: 0.105 * bright },
                            { ratio: 4.018, amp: 0.035 * bright }
                        ];

                        partials.forEach((partial, index) => {
                            const osc = ctx.createOscillator();
                            const g = ctx.createGain();
                            osc.type = index === 0 ? 'sine' : 'triangle';
                            osc.frequency.setValueAtTime(base * partial.ratio, time);
                            envelope(
                                g.gain,
                                time,
                                0.006 + index * 0.002,
                                gain * partial.amp,
                                0.16 + index * 0.08,
                                gain * partial.amp * 0.10,
                                time + duration * (0.48 + index * 0.03),
                                time + duration
                            );
                            osc.connect(g);
                            g.connect(out);
                            osc.start(time);
                            osc.stop(time + duration + 0.08);
                        });
                    };

                    const playCelesteChord = (graph, time, notes, baseGain = 0.10) => {
                        notes.forEach((note) => {
                            playBell(graph, {
                                midi: note.midi,
                                time: time + note.delay,
                                duration: note.duration || 2.65,
                                gain: baseGain * (note.weight || 1),
                                pan: note.pan || 0,
                                detuneCents: note.detune || 0,
                                bright: note.bright || 0.9
                            });
                        });
                    };

                    const playSoftPad = (graph, midi, time, duration, gain, pan, detune = 0) => {
                        const out = ctx.createGain();
                        const filter = ctx.createBiquadFilter();
                        const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
                        const oscA = ctx.createOscillator();
                        const oscB = ctx.createOscillator();
                        const gA = ctx.createGain();
                        const gB = ctx.createGain();

                        oscA.type = 'triangle';
                        oscB.type = 'sine';
                        oscA.frequency.setValueAtTime(midiToHz(midi) * cents(detune), time);
                        oscB.frequency.setValueAtTime(midiToHz(midi + 12) * cents(detune - 4), time);
                        gA.gain.value = 0.70;
                        gB.gain.value = 0.22;

                        filter.type = 'lowpass';
                        filter.frequency.setValueAtTime(760, time);
                        filter.frequency.exponentialRampToValueAtTime(1850, time + 1.35);
                        filter.frequency.exponentialRampToValueAtTime(980, time + duration);
                        filter.Q.value = 0.48;

                        envelope(out.gain, time, 0.38, gain, 0.75, gain * 0.56, time + duration - 1.65, time + duration);

                        oscA.connect(gA); gA.connect(filter);
                        oscB.connect(gB); gB.connect(filter);
                        filter.connect(out);

                        if (panner) {
                            out.connect(panner);
                            panner.pan.setValueAtTime(pan, time);
                            graph.route(panner, 0.72, 1.05);
                        } else {
                            graph.route(out, 0.72, 1.05);
                        }

                        oscA.start(time);
                        oscB.start(time);
                        oscA.stop(time + duration + 0.08);
                        oscB.stop(time + duration + 0.08);
                    };

                    const playAirLift = (graph, time, duration, gain) => {
                        const length = Math.floor(ctx.sampleRate * duration);
                        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
                        const data = buffer.getChannelData(0);
                        for (let i = 0; i < length; i += 1) {
                            const x = i / length;
                            const fadeIn = Math.min(1, x / 0.08);
                            const fadeOut = Math.pow(1 - x, 1.9);
                            data[i] = (Math.random() * 2 - 1) * fadeIn * fadeOut;
                        }

                        const source = ctx.createBufferSource();
                        const band = ctx.createBiquadFilter();
                        const high = ctx.createBiquadFilter();
                        const g = ctx.createGain();
                        source.buffer = buffer;
                        band.type = 'bandpass';
                        band.frequency.setValueAtTime(4800, time);
                        band.frequency.exponentialRampToValueAtTime(7600, time + duration * 0.42);
                        band.Q.value = 0.7;
                        high.type = 'highpass';
                        high.frequency.value = 2300;
                        g.gain.setValueAtTime(0.0001, time);
                        g.gain.exponentialRampToValueAtTime(gain, time + 0.055);
                        g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
                        source.connect(band);
                        band.connect(high);
                        high.connect(g);
                        graph.route(g, 0.42, 1.35);
                        source.start(time);
                    };

                    const playGentleAccent = (graph, time) => {
                        const out = ctx.createGain();
                        const filter = ctx.createBiquadFilter();
                        const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
                        filter.type = 'bandpass';
                        filter.frequency.value = 760;
                        filter.Q.value = 0.88;
                        out.connect(filter);

                        if (panner) {
                            filter.connect(panner);
                            panner.pan.value = 0;
                            graph.route(panner, 0.64, 0.62);
                        } else {
                            graph.route(filter, 0.64, 0.62);
                        }

                        [60, 67, 72].forEach((midi, index) => {
                            const osc = ctx.createOscillator();
                            const g = ctx.createGain();
                            osc.type = 'sine';
                            osc.frequency.setValueAtTime(midiToHz(midi), time);
                            envelope(g.gain, time, 0.012, [0.040, 0.034, 0.030][index], 0.09, 0.006, time + 0.24, time + 0.50);
                            osc.connect(g);
                            g.connect(out);
                            osc.start(time);
                            osc.stop(time + 0.62);
                        });
                    };

                    const start = ctx.currentTime + 0.055;
                    const graph = createAudioGraph(start);

                    // 정석적인 완료 인지감: E → G → C로 올라가는 맑은 3음 상승 차임.
                    playBell(graph, { midi: 76, time: start + 0.00, duration: 0.92, gain: 0.235, pan: -0.08, bright: 1.05 });
                    playBell(graph, { midi: 79, time: start + 0.18, duration: 1.06, gain: 0.255, pan:  0.08, bright: 1.00 });
                    playBell(graph, { midi: 84, time: start + 0.43, duration: 1.86, gain: 0.315, pan:  0.00, bright: 0.93 });

                    // 완료 확정감은 살리되, 뭉툭한 저음 임팩트는 쓰지 않는 짧은 중역 어택.
                    playGentleAccent(graph, start + 0.43);

                    // 예술적 업그레이드: C major 9 / 6 색채의 투명한 화성.
                    playCelesteChord(graph, start + 0.69, [
                        { midi: 72, delay: 0.000, weight: 0.98, pan: -0.28, duration: 2.65, bright: 0.74 },
                        { midi: 76, delay: 0.025, weight: 0.74, pan: -0.08, duration: 2.48, bright: 0.72 },
                        { midi: 79, delay: 0.050, weight: 0.70, pan:  0.12, duration: 2.54, bright: 0.72 },
                        { midi: 83, delay: 0.072, weight: 0.46, pan:  0.28, duration: 2.35, bright: 0.65 },
                        { midi: 86, delay: 0.096, weight: 0.40, pan:  0.02, duration: 2.22, bright: 0.60 },
                        { midi: 81, delay: 0.122, weight: 0.28, pan: -0.20, duration: 2.10, bright: 0.58 }
                    ], 0.112);

                    // 짧고 따뜻한 현악/합창 질감의 잔향 배경.
                    const padStart = start + 0.18;
                    const padDur = 4.45;
                    playSoftPad(graph, 60, padStart,        padDur,        0.052, -0.38, -5);
                    playSoftPad(graph, 64, padStart + 0.04, padDur - 0.06, 0.046,  0.34,  4);
                    playSoftPad(graph, 67, padStart + 0.08, padDur - 0.10, 0.044, -0.10, -2);
                    playSoftPad(graph, 71, padStart + 0.16, padDur - 0.18, 0.032,  0.22,  3);
                    playSoftPad(graph, 74, padStart + 0.24, padDur - 0.25, 0.027, -0.18, -4);

                    // 맑고 고급스러운 공기감.
                    playAirLift(graph, start + 0.36, 2.90, 0.018);

                    this._stopTimer = window.setTimeout(async () => {
                        if (this._currentContext === ctx) {
                            await this._stopCurrentContext();
                        }
                    }, TOTAL_SECONDS * 1000 + 650);
                } catch (e) {
                    console.error('Audio playback failed', e);
                }
            }
        };


        const setInlineStyleIfChanged = (element, propertyName, value) => {
            if (!element || element.style[propertyName] === value) return;
            element.style[propertyName] = value;
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
                setInlineStyleIfChanged(UI.sectionCardContainer, 'height', '');
                setInlineStyleIfChanged(UI.sectionCardContainer, 'overflowY', 'auto');
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
                const mainContainerStyle = UI.mainContainer ? getComputedStyle(UI.mainContainer) : null;
                const availableHeight = mainContainerHeight - headerHeight
                    - (parseFloat(mainContainerStyle?.gap) || 0)
                    - (parseFloat(mainContainerStyle?.paddingTop) || 0)
                    - (parseFloat(mainContainerStyle?.paddingBottom) || 0);

                newHeight = Math.min(newHeight, Math.max(cssMinHeight, availableHeight));


                if (totalContentHeight > 0) {
                    setInlineStyleIfChanged(UI.sectionCardContainer, 'height', `${newHeight}px`);
                } else {
                    setInlineStyleIfChanged(UI.sectionCardContainer, 'height', 'auto');
                }
                setInlineStyleIfChanged(UI.sectionCardContainer, 'overflowY', 'hidden');
            } else {
                setInlineStyleIfChanged(UI.sectionCardContainer, 'height', 'auto');
                setInlineStyleIfChanged(UI.sectionCardContainer, 'overflowY', 'hidden');
            }
        };

        const setView = (viewState) => {
            if (!UI.inputWrapper || !UI.runningWrapper) return;

            const previousViewState = state.currentView;
            const staysInRunningWrapper = !state.isInitialLoad &&
                previousViewState !== 'input' &&
                viewState !== 'input';

            // Running and complete use the same wrapper. Updating only the
            // logical state avoids an unnecessary transition lock that could
            // otherwise reject an immediate restart click.
            if (staysInRunningWrapper) {
                state.currentView = viewState;
                if (UI.sectionCardContainer) UI.sectionCardContainer.dataset.viewState = viewState;
                updateButtonState();
                scheduleSetCardHeight();
                return;
            }

            if (state.isTransitioning) return;

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

        const canResetCompletedAdHocRunWithoutWarning = () => (
            state.currentView === 'complete' &&
            state.loadedListName === null &&
            state.urlsToProcess.length > 0 &&
            state.currentUrlIndex === state.urlsToProcess.length &&
            state.errorCount === 0 &&
            state.unprocessedInputCount === 0 &&
            state.processingRunId === null &&
            state.completionRunId === null
        );

        const resetToIdle = async (message = CONFIG.TEXT.IDLE, isError = false) => {
            // 저장 목록을 불러오지 않은 일회성 입력은 성공적으로 실행한 뒤 바로
            // 비울 수 있습니다. 저장 목록을 편집한 경우에는 실행 성공 여부와
            // 무관하게 미저장 변경사항을 계속 보호합니다.
            if (!state.isInitialLoad && state.isDirty && !canResetCompletedAdHocRunWithoutWarning()) {
                 const safeListName = escapeHtml(state.loadedListName || '현재');
                 const confirmed = await Modal.show({
                    title: '저장되지 않은 변경사항',
                    body: `<strong>${safeListName}</strong> 목록에 저장되지 않은 변경사항이 있습니다. 정말 새로 시작하시겠습니까? (모든 내용이 초기화됩니다)`,
                    danger: true,
                    confirmText: '새로 시작'
                });
                if (!confirmed) return;
            }

            Object.assign(state, {
                urlsToProcess: [], currentUrlIndex: 0, isPaused: false, errorCount: 0,
                isDirty: false, loadedListName: null, originalLoadedListUrls: null,
                processingRunId: null, completionRunId: null, unprocessedInputCount: 0
            });
            state.currentRunId += 1;
            clearTimeout(state.intervalId); state.intervalId = null;

            if(UI.urlInput) UI.urlInput.value = '';
            if(UI.urlQueue) UI.urlQueue.replaceChildren();
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
            state.currentRunId += 1;
            state.processingRunId = null;
            state.completionRunId = null;
            state.urlsToProcess = [];
            state.currentUrlIndex = 0;
            state.errorCount = 0;
            state.unprocessedInputCount = 0;

            if(UI.urlQueue) UI.urlQueue.replaceChildren();
            if(UI.progressBar) UI.progressBar.value = 0;
            if(UI.progressStats) UI.progressStats.textContent = CONFIG.TEXT.STOPPED_BY_USER;

            setView('input');
            setControlsEnabled(true);
        };

        const updateCurrentListIndicator = () => {
            if (!UI.currentListIndicator) return;
            if (state.loadedListName) {
                let text = `현재 편집 중: ${state.loadedListName}`;
                if (state.isDirty) {
                    text += ' (수정됨)';
                }
                UI.currentListIndicator.textContent = text;
                UI.currentListIndicator.style.display = 'block';
            } else {
                UI.currentListIndicator.textContent = '';
                UI.currentListIndicator.style.display = 'none';
            }
             scheduleSetCardHeight();
        };

        const updateButtonState = () => {
            const viewState = state.currentView;
            const rawUrlsForDisplay = UI.urlInput ? UI.urlInput.value.split('\n') : [];
            const hasText = rawUrlsForDisplay.some(url => url.trim().length > 0);
            const displayCount = hasText ? prepareUrlsForRun(rawUrlsForDisplay).urls.length : 0;

            if (UI.startRunButton) {
                UI.startRunButton.classList.remove(CONFIG.CSS.SUCCESS_BTN_CLASS);
                if (viewState === 'input') {
                    UI.startRunButton.textContent = displayCount > 0 ? CONFIG.TEXT.RUN_COUNT(displayCount) : CONFIG.TEXT.RUN;
                    UI.startRunButton.disabled = displayCount === 0;
                } else if (viewState === 'complete') {
                     UI.startRunButton.textContent = CONFIG.TEXT.RESTART;
                     UI.startRunButton.classList.add(CONFIG.CSS.SUCCESS_BTN_CLASS);
                     UI.startRunButton.disabled = false;
                }
            }

            if (UI.pauseResumeButton) {
                UI.pauseResumeButton.classList.remove(CONFIG.CSS.SUCCESS_BTN_CLASS);
                if (viewState === 'running') {
                    UI.pauseResumeButton.textContent = state.isPaused ? CONFIG.TEXT.RESUME : CONFIG.TEXT.PAUSE;
                    UI.pauseResumeButton.disabled = false;
                } else if (viewState === 'complete') {
                    UI.pauseResumeButton.textContent = CONFIG.TEXT.RESTART;
                    UI.pauseResumeButton.classList.add(CONFIG.CSS.SUCCESS_BTN_CLASS);
                    UI.pauseResumeButton.disabled = false;
                }
            }

            if (UI.stopProcessButton) {
                UI.stopProcessButton.style.display = viewState === 'complete' ? 'none' : '';
            }

            if (UI.saveListButton) {
                if (state.loadedListName && state.isDirty) {
                    UI.saveListButton.textContent = '🔄️';
                    UI.saveListButton.title = '현재 목록 업데이트';
                    UI.saveListButton.disabled = false;
                } else {
                    UI.saveListButton.textContent = '💾';
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
                return parseStoredListMap(data[CONFIG.URL_LISTS_KEY]);
            } catch (e) {
                console.error('Error getting saved lists:', e);
                Toast.show('저장된 목록을 불러오지 못했습니다. 기존 데이터를 보호하기 위해 작업을 중단했습니다.', 'error', 5000);
                return null;
            }
        };

        const saveLists = async (lists) => {
            try {
                const safeLists = Object.fromEntries(Object.entries(toSafeListMap(lists)));
                await chrome.storage.local.set({ [CONFIG.URL_LISTS_KEY]: safeLists });
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
            if (!lists) return false;
            const listNames = Object.keys(lists);
            const currentSelectionInDropdown = UI.savedListsDropdown ? UI.savedListsDropdown.value : '';

            if (UI.savedListsDropdown) {
                UI.savedListsDropdown.replaceChildren(new Option(CONFIG.TEXT.SELECT_LIST_PLACEHOLDER, ''));
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
            return true;
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
                const safeListName = escapeHtml(state.loadedListName || '현재');
                const choice = await Modal.show({
                    title: '저장되지 않은 변경사항',
                    body: `<strong>${safeListName}</strong> 목록에 저장되지 않은 변경사항이 있습니다. 어떻게 하시겠습니까?`,
                    buttons: [
                        { text: '취소', value: 'cancel', isDefaultCancel: true },
                        { text: '변경사항 버리고 새로 작성', value: 'discard', isDanger: true },
                        { text: '저장 후 새로 작성', value: 'save_and_new', isDefaultConfirm: true }
                    ]
                });

                if (choice === 'cancel' || choice === undefined || choice === null) return;

                if (choice === 'discard') {
                    _switchToNewListState();
                    return;
                }

                if (choice === 'save_and_new') {
                    let savedSuccessfully = false;
                    if (state.loadedListName) {
                        const urlsToSave = UI.urlInput.value.trim();
                        const lists = await getSavedLists();
                        if (!lists) return;
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
                            const listName = normalizeListName(rawListName);
                            if (!listName) {
                                Toast.show('목록 이름은 비워둘 수 없습니다. 현재 편집 내용은 유지됩니다.', 'error');
                            } else if (!assertSafeListName(listName)) {
                                return;
                            } else {
                                const lists = await getSavedLists();
                                if (!lists) return;
                                if (lists[listName]) {
                                    Toast.show(`'${listName}' 목록이 이미 존재합니다. 현재 편집 내용은 유지됩니다.`, 'error');
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
                            Toast.show('저장이 취소되었습니다. 현재 편집 내용은 유지됩니다.', 'info');
                        }
                    }
                    if (!savedSuccessfully) return;
                    state.isDirty = false;
                    _switchToNewListState();
                }
            } else {
                _switchToNewListState();
            }
        };

        const handleUpdateList = async () => {
            if (!state.loadedListName || !state.isDirty) return;

            const urlsToSave = UI.urlInput.value.trim();
            const lists = await getSavedLists();
            if (!lists) return;
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

            const listName = normalizeListName(rawListName);
            if (!listName) {
                Toast.show('목록 이름은 비워둘 수 없습니다.', 'error');
                return false;
            }
            if (!assertSafeListName(listName)) {
                return false;
            }

            const lists = await getSavedLists();
            if (!lists) return false;
            if (lists[listName] && listName !== state.loadedListName) {
                const safeListName = escapeHtml(listName);
                const overwrite = await Modal.show({
                    title: '덮어쓰기 확인',
                    body: `<strong>'${safeListName}'</strong> 목록이 이미 있습니다. 덮어쓰시겠습니까?`,
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
                const safeCurrentName = escapeHtml(state.loadedListName || '현재 편집 중인');
                const safeTargetName = escapeHtml(listNameToLoad || '');
                let modalMessage = `<strong>${safeCurrentName}</strong> 목록에 저장되지 않은 변경사항이 있습니다. `;
                if (listNameToLoad && listNameToLoad !== state.loadedListName) {
                    modalMessage += `정말 <strong>'${safeTargetName}'</strong> 목록을 불러오시겠습니까? (변경사항은 사라집니다)`;
                } else if (listNameToLoad === '' && state.loadedListName) {
                    modalMessage += `선택을 해제하고 새 목록 상태로 전환하시겠습니까? (변경사항은 사라집니다)`;
                } else if (!state.loadedListName && listNameToLoad !== '') {
                     modalMessage += `정말 <strong>'${safeTargetName}'</strong> 목록을 불러오시겠습니까? (현재 입력한 내용은 사라집니다)`;
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
            if (!lists) {
                if (UI.savedListsDropdown) UI.savedListsDropdown.value = state.loadedListName || '';
                return;
            }
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
            const safeListName = escapeHtml(listName);

            const confirmed = await Modal.show({
                title: '목록 삭제 확인',
                body: `<strong>'${safeListName}'</strong> 목록을 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
                danger: true,
                confirmText: '삭제'
            });
            if (!confirmed) return;

            const lists = await getSavedLists();
            if (!lists) return;
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
                body: `<input type="text" id="modal-input" value="${escapeHtml(oldName)}" />`,
                confirmText: '변경'
            });
            const rawNewName = document.getElementById('modal-input')?.value;
            if (!result || !rawNewName) return;

            const newName = normalizeListName(rawNewName);
            if (!newName) {
                Toast.show('목록 이름은 비워둘 수 없습니다.', 'error');
                return;
            }
            if (!assertSafeListName(newName)) return;
            if (newName === oldName) return;

            const lists = await getSavedLists();
            if (!lists) return;
            if (!lists[oldName]) {
                Toast.show(`'${oldName}' 목록을 찾을 수 없어 이름을 변경하지 못했습니다.`, 'error');
                await loadSavedLists();
                return;
            }
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
                let skippedTabs = 0;
                let newUrls = tabs.reduce((urls, tab) => {
                    const normalizedUrl = normalizeUrlForOpening(tab?.url || '');
                    if (normalizedUrl) {
                        urls.push(normalizedUrl);
                    } else if (tab?.url) {
                        skippedTabs += 1;
                    }
                    return urls;
                }, []);

                if (newUrls.length === 0) {
                    Toast.show('가져올 수 있는 탭이 없습니다. (http, https 프로토콜만 지원)', 'info');
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
                const skippedSuffix = skippedTabs > 0 ? ` (지원하지 않는/민감한 URL ${skippedTabs}개 제외)` : '';
                Toast.show(`${newUrls.length}개의 탭을 ${mode === 'overwrite' ? '가져왔습니다' : '추가했습니다'}${skippedSuffix}.`, 'success');
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
            if (!lists) return;
            if (Object.keys(lists).length === 0) {
                Toast.show('내보낼 목록이 없습니다.', 'error');
                return;
            }
            const dataStr = JSON.stringify(lists);
            const blob = new Blob([dataStr], {type: "application/json"});
            const url = URL.createObjectURL(blob);
            const now = new Date();
            const year = now.getFullYear().toString().slice(-2);
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const filename = `${year}${month}${day}_LunaTools_Multi_URL_Opener_Lists.json`;

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
                setTimeout(() => URL.revokeObjectURL(url), CONFIG.EXPORT_URL_REVOKE_DELAY_MS);
                Toast.show('모든 목록을 내보냈습니다.', 'success');
            } catch (downloadError) {
                URL.revokeObjectURL(url);
                const detail = downloadError?.message ? ` (${downloadError.message})` : '';
                Toast.show(`목록 내보내기에 실패했습니다.${detail}`, 'error', 5000);
            }
        };

        const normalizeImportedUrlListText = (urlsText) => {
            const normalizedUrls = [];
            const seenUrls = new Set();
            const stats = { invalid: 0, tooLong: 0, duplicate: 0, overLimit: 0 };

            for (const rawLine of String(urlsText ?? '').split(/\r?\n/)) {
                const trimmed = rawLine.trim();
                if (!trimmed) continue;
                if (trimmed.length > CONFIG.MAX_URL_LENGTH) {
                    stats.tooLong += 1;
                    continue;
                }

                const normalizedUrl = normalizeUrlForOpening(trimmed);
                if (!normalizedUrl) {
                    stats.invalid += 1;
                    continue;
                }
                if (seenUrls.has(normalizedUrl)) {
                    stats.duplicate += 1;
                    continue;
                }
                if (normalizedUrls.length >= CONFIG.MAX_URLS_PER_RUN) {
                    stats.overLimit += 1;
                    continue;
                }

                seenUrls.add(normalizedUrl);
                normalizedUrls.push(normalizedUrl);
            }

            return {
                urls: normalizedUrls.length > 0 ? `${normalizedUrls.join('\n')}\n` : '',
                count: normalizedUrls.length,
                ...stats
            };
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

            const validImportedLists = Object.create(null);
            const importedListNames = new Set();
            let skippedInvalidListNames = 0;
            let renamedDuplicateListNames = 0;
            let skippedInvalidListStructures = 0;

            for (const [key, importedList] of Object.entries(importedJson)) {
                const normalizedName = normalizeListName(key);
                if (!isValidListName(normalizedName)) {
                    skippedInvalidListNames += 1;
                    console.warn(`Skipping unsafe or invalid list name during import: ${key}`);
                    continue;
                }
                if (typeof importedList === 'object' &&
                    importedList !== null &&
                    !Array.isArray(importedList) &&
                    'urls' in importedList &&
                    typeof importedList.urls === 'string') {
                    let finalName = normalizedName;
                    if (importedListNames.has(finalName)) {
                        finalName = generateUniqueListName(finalName, importedListNames);
                        renamedDuplicateListNames += 1;
                    }
                    importedListNames.add(finalName);

                    validImportedLists[finalName] = {
                        // JSON 내보내기 파일은 백업이므로 중복·빈 줄·300개 초과 항목을 포함한 원문을 보존합니다.
                        // 실행 시의 안전 검증과 300개 제한은 prepareUrlsForRun()에서 별도로 적용합니다.
                        urls: importedList.urls,
                        createdAt: typeof importedList.createdAt === 'string' ? importedList.createdAt : new Date().toISOString()
                    };
                } else {
                    skippedInvalidListStructures += 1;
                    console.warn(`Skipping invalid list structure for key: ${key} during import.`);
                }
            }

            if (Object.keys(validImportedLists).length === 0) {
                Toast.show('JSON 파일에 유효한 목록 데이터가 없습니다.', 'info');
                return;
            }

            const currentLists = await getSavedLists();
            if (!currentLists) return;
            const conflicts = Object.keys(validImportedLists).filter(key => currentLists[key]);
            let applyImport = true;
            let newListsData = { ...currentLists };

            if (conflicts.length > 0) {
                const safeConflicts = conflicts.map(name => escapeHtml(name)).join(', ');
                const choice = await Modal.show({
                    title: '목록 충돌 발생',
                    body: `다음 목록이 이미 존재합니다: <strong>${safeConflicts}</strong>.<br>충돌하는 목록을 덮어쓰시겠습니까, 건너뛰시겠습니까? (충돌하지 않는 목록은 항상 추가됩니다)`,
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
                const skippedDetails = [];
                if (skippedInvalidListNames > 0) skippedDetails.push(`이름 오류 ${skippedInvalidListNames}개 제외`);
                if (renamedDuplicateListNames > 0) skippedDetails.push(`중복 이름 ${renamedDuplicateListNames}개 자동 변경`);
                if (skippedInvalidListStructures > 0) skippedDetails.push(`무효 목록 ${skippedInvalidListStructures}개 제외`);
                const skippedSuffix = skippedDetails.length > 0 ? ` (${skippedDetails.join(', ')} 제외)` : '';
                Toast.show(`JSON 목록을 성공적으로 가져왔습니다.${skippedSuffix}`, 'success');

                if (state.loadedListName && newListsData[state.loadedListName]) {
                    const persistedUrls = newListsData[state.loadedListName].urls;
                    if (state.isDirty) {
                        state.originalLoadedListUrls = persistedUrls;
                    } else if (UI.urlInput) {
                        UI.urlInput.value = persistedUrls;
                        state.originalLoadedListUrls = persistedUrls;
                    }
                }
                await loadSavedLists();
            } else if (!applyImport) {
                Toast.show('JSON 가져오기가 취소되었거나 변경사항이 없습니다.', 'info');
            }
        }

        async function processTextImport(textContent) {
            const normalizedImport = normalizeImportedUrlListText(textContent);
            const urlString = normalizedImport.urls.trimEnd();
            const importedCount = normalizedImport.count;

            if (importedCount === 0) {
                Toast.show('텍스트 파일에 유효한 URL이 없거나 지원하는 형식(http, https, 도메인 주소)이 아닙니다.', 'info');
                showSkippedUrlNotice(normalizedImport);
                return;
            }

            showSkippedUrlNotice(normalizedImport);

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
                    Toast.show(`텍스트 파일에서 ${importedCount}개의 URL을 가져와 덮어썼습니다.`, 'success');
                } else if (choice === 'append') {
                    if (UI.urlInput) UI.urlInput.value += (UI.urlInput.value.endsWith('\n') || UI.urlInput.value.trim() === '' ? '' : '\n') + urlString + '\n';
                    Toast.show(`텍스트 파일에서 ${importedCount}개의 URL을 추가했습니다.`, 'success');
                } else {
                    Toast.show('텍스트 파일 가져오기가 취소되었습니다.', 'info');
                    return;
                }
            } else {
                if (UI.urlInput) UI.urlInput.value = urlString + '\n';
                Toast.show(`텍스트 파일에서 ${importedCount}개의 URL을 가져왔습니다.`, 'success');
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
            if (file.size > CONFIG.MAX_IMPORT_FILE_SIZE_BYTES) {
                Toast.show('가져오기 파일은 32MiB를 초과할 수 없습니다.', 'error', 5000);
                return;
            }
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

        const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        async function waitForTabUrlAssignment(tabId, expectedUrl) {
            const deadline = Date.now() + CONFIG.DELAY_LOADING_NAVIGATION_WAIT_MS;
            let latestTab = null;

            while (Date.now() < deadline) {
                latestTab = await chrome.tabs.get(tabId);
                const candidateUrl = latestTab.pendingUrl || latestTab.url || '';
                if (normalizeUrlForOpening(candidateUrl) === expectedUrl) {
                    return latestTab;
                }
                await wait(100);
            }

            return latestTab || await chrome.tabs.get(tabId);
        }

        async function createAndDiscardTab(url) {
            const normalizedUrl = normalizeUrlForOpening(url);
            if (!normalizedUrl) {
                throw new Error('지원하지 않는 URL 형식입니다.');
            }

            let tabId = null;

            try {
                const newTab = await chrome.tabs.create({ url: normalizedUrl, active: false });
                if (!Number.isInteger(newTab?.id)) {
                    throw new Error('새 탭의 식별자를 확인할 수 없습니다.');
                }
                tabId = newTab.id;

                const tabWithTargetUrl = await waitForTabUrlAssignment(tabId, normalizedUrl);

                try {
                    const discardResult = await chrome.tabs.discard(tabId);
                    const verifiedTab = discardResult?.discarded === true
                        ? discardResult
                        : await chrome.tabs.get(tabId);

                    if (verifiedTab?.discarded !== true) {
                        console.warn(`Tab ${tabId} was opened but could not be discarded immediately. Keeping it as an inactive tab.`);
                    }

                    return verifiedTab || tabWithTargetUrl || newTab;
                } catch (discardError) {
                    console.warn(`Discard failed for tab ${tabId}. Keeping the inactive tab instead:`, discardError);
                    try {
                        return await chrome.tabs.get(tabId);
                    } catch (_) {
                        return tabWithTargetUrl || newTab;
                    }
                }
            } catch (error) {
                console.error(`Error creating delay-loaded tab for ${normalizedUrl}:`, error);
                if (Number.isInteger(tabId)) {
                    try {
                        await chrome.tabs.remove(tabId);
                    } catch (removeError) {
                        console.warn(`Failed to remove tab ${tabId} after error:`, removeError);
                    }
                }
                throw error;
            }
        }

        const finalizeProcessedQueueItem = (span) => {
            if (!span) return;

            span.classList.remove(CONFIG.CSS.PROCESSING_CLASS);
            if (!span.classList.contains(CONFIG.CSS.ERROR_CLASS)) {
                span.classList.add(CONFIG.CSS.REMOVING_CLASS);
            }
        };

        const scheduleRunCompletion = (runId) => {
            if (runId !== state.currentRunId || state.completionRunId === runId) return;

            state.completionRunId = runId;
            clearTimeout(state.intervalId);
            state.intervalId = setTimeout(() => {
                state.intervalId = null;
                if (state.completionRunId === runId) state.completionRunId = null;
                if (runId === state.currentRunId) handleCompletion();
            }, 400);
        };

        const processNextUrl = async (runId) => {
            if (runId !== state.currentRunId || state.processingRunId === runId) return;

            if (state.currentUrlIndex >= state.urlsToProcess.length) {
                if (state.urlsToProcess.length > 0) scheduleRunCompletion(runId);
                return;
            }
            if (state.isPaused) return;

            state.processingRunId = runId;
            updateProgress();

            const previousSpan = UI.urlQueue ? UI.urlQueue.querySelector(`.${CONFIG.CSS.PROCESSING_CLASS}`) : null;
            finalizeProcessedQueueItem(previousSpan);

            const url = state.urlsToProcess[state.currentUrlIndex];

            const currentSpan = UI.urlQueue && UI.urlQueue.children[state.currentUrlIndex] ? UI.urlQueue.children[state.currentUrlIndex] : null;
            if (currentSpan) {
                currentSpan.classList.add(CONFIG.CSS.PROCESSING_CLASS);
                currentSpan.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }

            try {
                const urlToOpen = normalizeUrlForOpening(url);
                if (!urlToOpen) throw new Error('지원하지 않는 URL 형식입니다.');

                if (UI.delayLoadingCheckbox && UI.delayLoadingCheckbox.checked) {
                    await createAndDiscardTab(urlToOpen);
                } else {
                    await chrome.tabs.create({ url: urlToOpen, active: (UI.focusLockCheckbox ? !UI.focusLockCheckbox.checked : true) });
                }
            } catch (e) {
                console.error(`Error processing URL ${url}:`, e);
                state.errorCount++;
                if (currentSpan) {
                    currentSpan.classList.remove(CONFIG.CSS.PROCESSING_CLASS);
                    currentSpan.classList.add(CONFIG.CSS.ERROR_CLASS);
                    currentSpan.textContent = `⚠️ ${url}`;
                    currentSpan.title = `오류: ${e.message}`;
                }
            } finally {
                if (state.processingRunId === runId) state.processingRunId = null;
            }

            if (runId !== state.currentRunId) return;

            state.currentUrlIndex++;
            updateProgress();

            if (state.currentUrlIndex >= state.urlsToProcess.length) {
                scheduleRunCompletion(runId);
                return;
            }

            // A pause may occur while chrome.tabs.create() is pending. Do not
            // schedule a second callback; resume will continue exactly once.
            if (state.isPaused) return;

            const value = UI.intervalInput ? Number(UI.intervalInput.value) : CONFIG.DEFAULT_OPTIONS.interval;
            const intervalSeconds = Number.isFinite(value) && value >= CONFIG.MIN_INTERVAL_SECONDS
                ? Math.min(value, CONFIG.MAX_INTERVAL_SECONDS)
                : CONFIG.DEFAULT_OPTIONS.interval;
            state.intervalId = setTimeout(() => {
                state.intervalId = null;
                processNextUrl(runId);
            }, intervalSeconds * 1000);
        };

        const startProcess = () => {
            if (!UI.urlInput) return;
            const rawUrls = UI.urlInput.value.split('\n');
            const prepared = prepareUrlsForRun(rawUrls);

            state.urlsToProcess = prepared.urls;
            // Duplicates are deliberately excluded when that option is enabled.
            // Invalid, overlong, or over-limit entries were not processed and
            // must keep the unsaved-change warning active after completion.
            state.unprocessedInputCount = prepared.invalid + prepared.tooLong + prepared.overLimit;
            if (state.urlsToProcess.length === 0) {
                if (UI.progressStats) {
                    UI.progressStats.textContent = CONFIG.TEXT.EMPTY_INPUT;
                    UI.progressStats.className = CONFIG.CSS.ERROR_CLASS;
                }
                if (UI.progressBar) UI.progressBar.value = 0;
                updateButtonState();
                showSkippedUrlNotice(prepared);
                return;
            }

            showSkippedUrlNotice(prepared);

            clearTimeout(state.intervalId);
            state.intervalId = null;
            Object.assign(state, {
                currentUrlIndex: 0, isPaused: false, errorCount: 0,
                processingRunId: null, completionRunId: null
            });
            state.currentRunId += 1;
            const runId = state.currentRunId;

            if (UI.urlQueue) {
                const fragment = document.createDocumentFragment();
                state.urlsToProcess.forEach(url => {
                    const span = document.createElement('span');
                    span.textContent = url;
                    fragment.appendChild(span);
                });
                UI.urlQueue.replaceChildren(fragment);
            }

            setView('running');
            setControlsEnabled(false);
            updateProgress();
            processNextUrl(runId);
        };

        const togglePause = () => {
            state.isPaused = !state.isPaused;
            updateButtonState();
            updateProgress();

            if (state.isPaused) {
                clearTimeout(state.intervalId);
                state.intervalId = null;
                if (state.completionRunId === state.currentRunId) state.completionRunId = null;
            } else {
                processNextUrl(state.currentRunId);
            }
        };

        const handleCompletion = () => {
            const total = state.urlsToProcess.length;
            const success = total - state.errorCount;
            const activeProcessingSpan = UI.urlQueue ? UI.urlQueue.querySelector(`.${CONFIG.CSS.PROCESSING_CLASS}`) : null;

            finalizeProcessedQueueItem(activeProcessingSpan);

            if (UI.progressStats) {
                UI.progressStats.textContent = CONFIG.TEXT.PROCESS_COMPLETE(total, success, state.errorCount);
                UI.progressStats.className = state.errorCount > 0 ? CONFIG.CSS.ERROR_CLASS : CONFIG.CSS.COMPLETE_CLASS;
            }
            if (UI.progressBar) UI.progressBar.value = 100;
            if (UI.urlQueue && state.errorCount === 0) UI.urlQueue.replaceChildren();
            
            if (UI.playSoundCheckbox && UI.playSoundCheckbox.checked) {
                SoundEffect.playSuccess();
            }

            setView('complete');
        };

        const handleStartRunButtonClick = async () => {
            const viewState = state.currentView;
            if (viewState === 'input') {
                startProcess();
            } else if (viewState === 'complete') {
                await resetToIdle();
            }
        };

        const handleUrlInputKeydown = (event) => {
            const isCtrlEnter = event.key === 'Enter' && event.ctrlKey &&
                !event.altKey && !event.shiftKey && !event.metaKey;

            if (!isCtrlEnter || event.isComposing || event.repeat) return;

            event.preventDefault();
            event.stopPropagation();

            if (state.currentView !== 'input') return;

            // 실행 버튼과 동일한 검증 및 옵션 처리를 거쳐 현재 URL 목록을 실행합니다.
            updateButtonState();
            if (UI.startRunButton && !UI.startRunButton.disabled) {
                UI.startRunButton.click();
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
                const percentage = total > 0 ? Math.floor((opened / total) * 100) : 0;
                progressMessage = `${listDisplayName} | ⏳ 총 ${total}개 | ${opened}개 열림 | ${remaining}개 남음 | ${percentage}% 진행`;
            }
            UI.progressStats.textContent = progressMessage;
            UI.progressStats.className = '';
            scheduleSetCardHeight();
        };

        const normalizeRunOptions = (rawOptions = {}) => {
            const normalized = { ...CONFIG.DEFAULT_OPTIONS };
            const interval = Number(rawOptions.interval);
            if (Number.isFinite(interval) && interval >= CONFIG.MIN_INTERVAL_SECONDS) {
                normalized.interval = Math.min(interval, CONFIG.MAX_INTERVAL_SECONDS);
            }

            for (const key of ['removeDuplicates', 'focusLock', 'delayLoading', 'sortUrlsBeforeRun', 'playSound']) {
                if (typeof rawOptions[key] === 'boolean') {
                    normalized[key] = rawOptions[key];
                }
            }
            return normalized;
        };

        const saveOptions = async () => {
            if (!UI.intervalInput || !UI.removeDuplicatesCheckbox || !UI.focusLockCheckbox || !UI.delayLoadingCheckbox || !UI.sortUrlsBeforeRunCheckbox || !UI.playSoundCheckbox) return;
            const options = normalizeRunOptions({
                interval: UI.intervalInput.value,
                removeDuplicates: UI.removeDuplicatesCheckbox.checked,
                focusLock: UI.focusLockCheckbox.checked,
                delayLoading: UI.delayLoadingCheckbox.checked,
                sortUrlsBeforeRun: UI.sortUrlsBeforeRunCheckbox.checked,
                playSound: UI.playSoundCheckbox.checked
            });
            UI.intervalInput.value = options.interval;

            try {
                await chrome.storage.local.set({ [CONFIG.STORAGE_KEY]: options });
            } catch (e) {
                console.error('Failed to save options:', e);
                Toast.show('실행 옵션 저장에 실패했습니다. 저장 공간 또는 권한 상태를 확인해주세요.', 'error', 5000);
            }
        };
        const loadOptions = async () => {
            if (!UI.intervalInput || !UI.removeDuplicatesCheckbox || !UI.focusLockCheckbox || !UI.delayLoadingCheckbox || !UI.sortUrlsBeforeRunCheckbox || !UI.playSoundCheckbox) return;
            try {
                const data = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
                const options = normalizeRunOptions(data[CONFIG.STORAGE_KEY]);
                UI.intervalInput.value = options.interval;
                UI.removeDuplicatesCheckbox.checked = options.removeDuplicates;
                UI.focusLockCheckbox.checked = options.focusLock;
                UI.delayLoadingCheckbox.checked = options.delayLoading;
                UI.sortUrlsBeforeRunCheckbox.checked = options.sortUrlsBeforeRun;
                UI.playSoundCheckbox.checked = options.playSound;
            } catch (e) {
                console.error('Failed to load options:', e);
                Toast.show('실행 옵션을 불러오지 못해 기본값을 사용합니다.', 'error', 5000);
                const options = normalizeRunOptions();
                UI.intervalInput.value = options.interval;
                UI.removeDuplicatesCheckbox.checked = options.removeDuplicates;
                UI.focusLockCheckbox.checked = options.focusLock;
                UI.delayLoadingCheckbox.checked = options.delayLoading;
                UI.sortUrlsBeforeRunCheckbox.checked = options.sortUrlsBeforeRun;
                UI.playSoundCheckbox.checked = options.playSound;
            }
        };

        async function initialize() {
            const handleGetAllTabs = createTabFetchHandler({}, '모든 창의 탭 가져오기');
            const handleGetCurrentTabs = createTabFetchHandler({ currentWindow: true }, '현재 창의 탭 가져오기');

            if (UI.startRunButton) UI.startRunButton.addEventListener('click', handleStartRunButtonClick);
            if (UI.pauseResumeButton) {
                UI.pauseResumeButton.addEventListener('click', async () => {
                    if (state.currentView === 'complete') {
                        await resetToIdle();
                    } else if (state.currentView === 'running') {
                        togglePause();
                    }
                });
            }
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
                UI.urlInput.addEventListener('keydown', handleUrlInputKeydown);
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
                    const urls = UI.urlInput.value.split('\n').map(url => url.trim()).filter(Boolean);
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
                    const urls = UI.urlInput.value.split('\n').map(url => url.trim()).filter(Boolean);
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
                    if (!item) return;

                    const checkbox = item.querySelector('input[type="checkbox"]');
                    if (!checkbox) return;
                    
                    if (e.target.closest('.switch')) {
                        return; 
                    }

                    if (e.target !== checkbox) {
                        checkbox.checked = !checkbox.checked;
                        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
                const presetButtons = UI.optionsList.querySelectorAll('.preset-btn');
                presetButtons.forEach(button => {
                    button.addEventListener('click', () => {
                        if (UI.intervalInput) {
                            UI.intervalInput.value = button.dataset.value;
                            UI.intervalInput.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    });
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
            focusUrlInputWhenPanelIsReady();
            requestAnimationFrame(() => {
                 scheduleSetCardHeight();
            });

            const multiUrlTabButton = document.querySelector('.tab-button[data-tab="multi-url-opener"]');
            if (multiUrlTabButton) {
                multiUrlTabButton.addEventListener('click', focusUrlInputWhenPanelIsReady);
            }
            window.addEventListener('focus', focusUrlInputWhenPanelIsReady);
            window.addEventListener('pageshow', focusUrlInputWhenPanelIsReady);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    focusUrlInputWhenPanelIsReady();
                }
            });

            // Expose a public method for TabHaiku integration
            window.lunaToolsURLOpener = {
                openUrls: (urls) => {
                    const prepared = prepareUrlsForRun(Array.isArray(urls) ? urls : []);
                    if (prepared.urls.length === 0) {
                        showSkippedUrlNotice(prepared);
                        Toast.show('열 수 있는 유효한 URL이 없습니다.', 'error');
                        return;
                    }

                    showSkippedUrlNotice(prepared);
                    if (UI.urlInput) {
                        UI.urlInput.value = prepared.urls.join('\n');
                        // BUG FIX: Manually dispatch input event to update the state of the app
                        UI.urlInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }

                    const multiUrlTabButton = document.querySelector('.tab-button[data-tab="multi-url-opener"]');
                    if (multiUrlTabButton) multiUrlTabButton.click();
                    
                    // Allow UI to update before clicking
                    setTimeout(() => {
                        if (UI.startRunButton && !UI.startRunButton.disabled) {
                            UI.startRunButton.click();
                        }
                    }, 100);
                }
            };
        }

        initialize().catch(err => {
            console.error("LunaTools Multi URL Opener initialization failed:", err);
            Toast.show("URL 열기 앱 초기화에 실패했습니다.", "error", 5000);
        });
    });

    // --- "세션 매니저" App Logic (Scoped IIFE from TabHaiku) ---
    const tabHaikuApp = (function(pane) {
      const CONSTANTS = {
        UI: { TOAST_DURATION: 4000, SESSION_NAME_MAX_LENGTH: 200, SEARCH_DEBOUNCE_TIME: 200 },
        DEFAULTS: { SESSION_PREFIX: '' },
        PROTOCOLS: { SAFE: ['http:', 'https:'] },
        LIMITS: {
            TAB_URL_MAX_LENGTH: 2048,
            MAX_IMPORT_SESSIONS: 250000,
            MAX_TABS_PER_IMPORTED_SESSION: 300,
            MAX_IMPORT_TOTAL_TABS: 550000,
            MAX_IMPORT_FILE_SIZE_BYTES: 32 * 1024 * 1024,
            MAX_SAVE_TABS: 300,
            MAX_RESTORE_TABS: 300,
            RESTORE_CONFIRM_TAB_THRESHOLD: 50,
            SESSION_ID_MAX_LENGTH: 256
        },
        TIMING: { EXPORT_URL_REVOKE_DELAY: 60000 },
        STORAGE_KEYS: { SESSIONS: 'sessions' },
        ACTIONS: { RESTORE: 'restore', COPY: 'copy', UPDATE: 'update', RENAME: 'rename', PIN: 'pin', DELETE: 'delete' },
        SAVE_SCOPES: { CURRENT_WINDOW: 'current', ALL_WINDOWS: 'all' },
        MESSAGES: {
            STORAGE_ERROR: '저장 공간이 부족하거나 쓰기 오류가 발생했습니다.', GET_TABS_FAILED: '⚠️ 탭 정보를 가져오는데 실패했습니다.',
            GET_TAB_GROUPS_FAILED: '⚠️ 탭 그룹 정보를 가져오지 못했습니다.', NO_VALID_TABS_TO_SAVE: '⚠️ 저장할 유효한 탭이 없습니다.',
            UPDATE_SESSION_NOT_FOUND: '⚠️ 업데이트할 세션을 찾을 수 없습니다.', SESSION_SAVE_FAILED: '세션 저장 실패',
            SESSION_NOT_FOUND: '⚠️ 세션을 찾을 수 없습니다.', createSessionDeletedMessage: (name) => `🗑️ '${escapeHtml(name)}' 세션을 삭제했습니다.`,
            SESSION_RESTORED: '✅ 세션을 복원했습니다.', DELETE_FAILED: '삭제 실패', NAME_CANNOT_BE_EMPTY: '⚠️ 이름은 비워둘 수 없습니다.',
            RENAME_FAILED: '이름 변경 실패', SESSION_PINNED: '📍 세션을 고정했습니다.', SESSION_UNPINNED: '📌 고정을 해제했습니다.',
            PIN_FAILED: '고정 실패', NO_URLS_TO_COPY: '⚠️ 복사할 URL이 없습니다.', URLS_COPIED: '📋 모든 URL을 클립보드에 복사했습니다.',
            COPY_FAILED: '❌ 클립보드 복사에 실패했습니다.', NO_SESSIONS_TO_EXPORT: '⚠️ 내보낼 세션이 없습니다.',
            EXPORT_SUCCESS: '📤 모든 세션을 내보냈습니다.', EXPORT_FAILED: '❌ 세션 내보내기에 실패했습니다.',
            IMPORT_FILE_TOO_LARGE: '❌ 파일이 너무 큽니다 (최대 32MiB)',
            IMPORT_FILE_READ_ERROR: '❌ 파일을 읽는 중 오류가 발생했습니다.', IMPORT_INVALID_FORMAT: '❌ 잘못된 파일 형식입니다.',
            IMPORT_NO_VALID_SESSIONS: '유효한 세션이 없습니다.',
            IMPORT_TOO_MANY_SESSIONS: (max) => `가져오기 제한 초과: 세션은 최대 ${max}개까지 가져올 수 있습니다.`,
            IMPORT_TOO_MANY_TABS_IN_SESSION: (max) => `가져오기 제한 초과: 세션당 탭은 최대 ${max}개까지 가져올 수 있습니다.`,
            IMPORT_TOO_MANY_TOTAL_TABS: (max) => `가져오기 제한 초과: 전체 가져오기 탭은 최대 ${max}개까지 허용됩니다.`,
            RESTORE_TOO_MANY_TABS: (max) => `복원 제한 초과: 한 번에 복원할 수 있는 탭은 최대 ${max}개입니다.`,
            SAVE_TOO_MANY_TABS: (max) => `저장 제한 초과: 한 세션에 저장할 수 있는 탭은 최대 ${max}개입니다.`,
            SESSION_DATA_CORRUPTED: '저장된 세션 데이터에 유효하지 않은 항목이 있습니다. 기존 데이터를 보호하기 위해 저장·편집 작업을 중단했습니다.',
            SESSION_DATA_WARNING: '⚠️ 저장된 세션 데이터에 유효하지 않은 항목이 있습니다. 유효한 세션만 표시하며, 기존 데이터 보호를 위해 저장·편집을 차단합니다.',
            SESSION_SAVED_AND_TABS_CLOSED: (name, count) => `✅ '${escapeHtml(name)}'으로 저장하고 ${count}개의 탭을 닫았습니다.`,
            SESSION_SAVED_TABS_CLOSE_FAILED: (name) => `⚠️ 탭 닫기 실패. '${escapeHtml(name)}' 세션은 저장되었습니다.`,
            SESSION_SAVED_TABS_PARTIALLY_CLOSED: (name, closed, failed) => `⚠️ '${escapeHtml(name)}' 세션은 저장했습니다. ${closed}개 탭을 닫았고 ${failed}개는 상태 변경으로 남겨두었습니다.`,
            createDuplicateNameWarning: (name) => `⚠️ 중복된 이름입니다. '${name}'(으)로 저장합니다.`,
            createSessionUpdatedMessage: (name) => `🔄 '${escapeHtml(name)}' 세션을 업데이트했습니다.`,
            createSessionSavedMessage: (name) => `💾 '${escapeHtml(name)}' 세션을 저장했습니다.`,
            createSessionRestoreStartedMessage: (name) => `🚀 '${escapeHtml(name)}' 복원을 시작합니다...`,
            createConfirmUpdateMessage: (name) => `'${escapeHtml(name)}' 세션을 현재 열린 모든 창의 탭으로 덮어씁니까?`,
            createConfirmLargeRestoreMessage: (name, count) => `'${escapeHtml(name)}' 세션은 ${count}개의 탭을 새 창으로 엽니다. 계속하시겠습니까?`,
            createNameTooLongMessage: (max) => `⚠️ 이름은 ${max}자를 초과할 수 없습니다.`,
            createNameAlreadyExistsMessage: (name) => `⚠️ '${escapeHtml(name)}' 이름이 이미 존재합니다.`,
            createNameChangedMessage: (name) => `✅ 이름이 '${escapeHtml(name)}'(으)로 변경되었습니다.`,
            createImportSuccessMessage: (count) => `📥 ${count}개의 세션을 가져왔습니다.`,
            createConfirmSaveAndCloseMessage: (count) => `현재 탭을 제외한 모든 탭을 닫고, 전체 ${count}개의 탭을 새 세션으로 저장하시겠습니까?`
        }
      };

      const sessionInput = pane.querySelector('#session-input');
      const saveCurrentWindowBtn = pane.querySelector('#save-current-window-btn');
      const saveAllWindowsBtn = pane.querySelector('#save-all-windows-btn');
      const sessionListEl = pane.querySelector('#session-list');
      const toastEl = pane.querySelector('#session-manager-toast');
      const sessionItemTemplate = pane.querySelector('#session-item-template');
      const importBtn = pane.querySelector('#import-btn');
      const importFileInput = pane.querySelector('#import-file-input');
      const exportBtn = pane.querySelector('#export-btn');
      const saveAndCloseBtn = pane.querySelector('#save-and-close-btn');

      let allSessions = [];
      let toastTimeout;
      let inputDebounce;
      let sessionMutationQueue = Promise.resolve();

      const storage = {
        get: async (key, defaultValue = []) => {
          const result = await chrome.storage.local.get(key);
          return Object.prototype.hasOwnProperty.call(result, key) ? result[key] : defaultValue;
        },
        set: async (key, value) => {
          try {
            await chrome.storage.local.set({ [key]: value });
          } catch (error) {
            throw new Error(CONSTANTS.MESSAGES.STORAGE_ERROR);
          }
        },
      };

      const formatDate = (timestamp) => {
        const numericTimestamp = Number(timestamp);
        if (!Number.isFinite(numericTimestamp) || numericTimestamp <= 0) {
          return '날짜 없음';
        }
        const d = new Date(numericTimestamp);
        if (Number.isNaN(d.getTime())) {
          return '날짜 없음';
        }
        const datePart = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? '오후' : '오전';
        hours %= 12;
        if (hours === 0) hours = 12;
        const timePart = `${ampm} ${hours}시 ${minutes}분`;
        return `${datePart} ${timePart}`;
      };

      const showToast = (message, duration = CONSTANTS.UI.TOAST_DURATION, undoCallback = null) => {
        clearTimeout(toastTimeout);
        toastEl.replaceChildren();
        
        const messageSpan = document.createElement('span');
        messageSpan.textContent = message;
        toastEl.appendChild(messageSpan);

        if (undoCallback) {
            const undoButton = document.createElement('button');
            undoButton.textContent = '실행 취소';
            undoButton.className = 'toast-undo-btn';
            let undoStarted = false;
            undoButton.onclick = () => {
                if (undoStarted) return;
                undoStarted = true;
                undoButton.disabled = true;
                clearTimeout(toastTimeout);
                toastEl.classList.remove('show');
                void undoCallback();
            };
            toastEl.appendChild(undoButton);
        }
        
        toastEl.classList.add('show');
        toastTimeout = setTimeout(() => {
            toastEl.classList.remove('show');
        }, duration);
      };
      
      const escapeHtml = (str) => String(str).replace(/[&<>"'\/]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '/': '&#x2F;' }[s]));
      const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
      const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
      
      const writeTextToClipboard = async (text) => {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(String(text));
            return true;
          }
        } catch (_) {
        }

        const textArea = document.createElement('textarea');
        textArea.value = String(text);
        textArea.setAttribute('readonly', '');
        textArea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        (document.body || document.documentElement).appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          return document.execCommand('copy');
        } catch (_) {
          return false;
        } finally {
          textArea.remove();
        }
      };
      
      const SESSION_HOSTNAME_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
      const SESSION_IPV4_HOSTNAME_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
      const SESSION_IPV6_HOSTNAME_REGEX = /^\[[0-9a-f:.]+\]$/i;
      const SESSION_URL_CONTROL_CHARACTER_REGEX = /[\u0000-\u001F\u007F]/u;
      const SUPPORTED_TAB_GROUP_COLORS = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);

      const normalizeSessionGroupInfo = (value) => {
        if (value === null || value === undefined) return null;
        if (!isRecord(value)) return null;

        const normalized = {};
        if (hasOwn(value, 'title') && typeof value.title === 'string') {
          normalized.title = value.title.slice(0, CONSTANTS.UI.SESSION_NAME_MAX_LENGTH);
        }
        if (hasOwn(value, 'color') && SUPPORTED_TAB_GROUP_COLORS.has(value.color)) {
          normalized.color = value.color;
        }
        if (hasOwn(value, 'collapsed') && typeof value.collapsed === 'boolean') {
          normalized.collapsed = value.collapsed;
        }

        return Object.keys(normalized).length > 0 ? normalized : null;
      };

      const isValidSessionHostname = (hostname) => {
        const normalizedHostname = String(hostname || '').trim().toLowerCase().replace(/\.+$/, '');
        if (!normalizedHostname || normalizedHostname.length > 253) return false;
        if (normalizedHostname === 'localhost') return true;
        if (SESSION_IPV6_HOSTNAME_REGEX.test(normalizedHostname)) return true;

        if (SESSION_IPV4_HOSTNAME_REGEX.test(normalizedHostname)) {
          return normalizedHostname.split('.').every(part => {
            if (!/^\d+$/.test(part)) return false;
            const numericPart = Number(part);
            return Number.isInteger(numericPart) && numericPart >= 0 && numericPart <= 255;
          });
        }

        const labels = normalizedHostname.split('.');
        return labels.every(label => SESSION_HOSTNAME_LABEL_REGEX.test(label));
      };

      const normalizeSessionUrl = (url) => {
        if (typeof url !== 'string') return null;
        const trimmedUrl = url.trim();
        if (!trimmedUrl || trimmedUrl.length > CONSTANTS.LIMITS.TAB_URL_MAX_LENGTH || SESSION_URL_CONTROL_CHARACTER_REGEX.test(trimmedUrl)) return null;
        if (/^[\\/]/.test(trimmedUrl)) return null;
        try {
          const parsed = new URL(trimmedUrl);
          if (!CONSTANTS.PROTOCOLS.SAFE.includes(parsed.protocol)) return null;
          if (parsed.href.length > CONSTANTS.LIMITS.TAB_URL_MAX_LENGTH) return null;
          if (parsed.username || parsed.password) return null;
          if (!isValidSessionHostname(parsed.hostname)) return null;
          return parsed.href;
        } catch (_) {
          return null;
        }
      };

      const getSessionTabNavigationState = (tab) => {
        const rawCommittedUrl = typeof tab?.url === 'string' ? tab.url.trim() : '';
        const rawPendingUrl = typeof tab?.pendingUrl === 'string' ? tab.pendingUrl.trim() : '';
        const hasPendingUrl = rawPendingUrl.length > 0;

        return {
          committedUrl: normalizeSessionUrl(rawCommittedUrl),
          pendingUrl: hasPendingUrl ? normalizeSessionUrl(rawPendingUrl) : null,
          hasPendingUrl
        };
      };

      const isStableSessionClosingCandidate = (liveTab, candidate) => {
        const navigationState = getSessionTabNavigationState(liveTab);
        return liveTab?.windowId === candidate?.windowId &&
          !navigationState.hasPendingUrl &&
          navigationState.committedUrl === candidate?.url;
      };

      const isValidUrl = (url) => Boolean(normalizeSessionUrl(url));

      const normalizeSessionTab = (tab) => {
        if (!isRecord(tab) || typeof tab.url !== 'string') return null;

        const normalizedUrl = normalizeSessionUrl(tab.url);
        if (!normalizedUrl) return null;

        if ((hasOwn(tab, 'title') && typeof tab.title !== 'string') ||
            (hasOwn(tab, 'pinned') && typeof tab.pinned !== 'boolean') ||
            (hasOwn(tab, 'groupId') && !Number.isInteger(tab.groupId)) ||
            (hasOwn(tab, 'windowId') && !Number.isInteger(tab.windowId))) {
          return null;
        }

        if (hasOwn(tab, 'groupInfo')) {
          const groupInfo = tab.groupInfo;
          const groupInfoOk = groupInfo === null || (
            isRecord(groupInfo) &&
            (!hasOwn(groupInfo, 'title') || typeof groupInfo.title === 'string') &&
            (!hasOwn(groupInfo, 'color') || typeof groupInfo.color === 'string') &&
            (!hasOwn(groupInfo, 'collapsed') || typeof groupInfo.collapsed === 'boolean')
          );
          if (!groupInfoOk) return null;
        }

        const normalizedTab = { url: normalizedUrl };
        if (hasOwn(tab, 'title')) normalizedTab.title = tab.title;
        if (hasOwn(tab, 'pinned')) normalizedTab.pinned = tab.pinned;
        if (hasOwn(tab, 'groupId')) normalizedTab.groupId = tab.groupId;
        if (hasOwn(tab, 'windowId')) normalizedTab.windowId = tab.windowId;
        if (hasOwn(tab, 'groupInfo')) normalizedTab.groupInfo = normalizeSessionGroupInfo(tab.groupInfo);

        return normalizedTab;
      };

      const isValidTab = (tab) => Boolean(normalizeSessionTab(tab));

      const isValidSessionId = (id) => {
        if (typeof id === 'number') return Number.isFinite(id);
        if (typeof id !== 'string') return false;
        return id.trim().length > 0 &&
          id.length <= CONSTANTS.LIMITS.SESSION_ID_MAX_LENGTH &&
          !SESSION_URL_CONTROL_CHARACTER_REGEX.test(id);
      };

      const isValidSession = (session) => {
        return session &&
          typeof session === 'object' &&
          !Array.isArray(session) &&
          isValidSessionId(session.id) &&
          typeof session.name === 'string' &&
          session.name.trim().length > 0 &&
          session.name.length <= CONSTANTS.UI.SESSION_NAME_MAX_LENGTH &&
          (!hasOwn(session, 'isPinned') || typeof session.isPinned === 'boolean') &&
          Array.isArray(session.tabs) &&
          session.tabs.length > 0 &&
          session.tabs.every(isValidTab);
      };

      const inspectStoredSessions = (value) => {
        if (value === undefined) {
          return { sessions: [], hasInvalidData: false };
        }
        if (!Array.isArray(value)) {
          return { sessions: [], hasInvalidData: true };
        }

        const sessions = [];
        const seenSessionIds = new Set();
        let hasInvalidData = false;

        for (const session of value) {
          if (!isValidSession(session)) {
            hasInvalidData = true;
            continue;
          }

          const sessionIdKey = String(session.id);
          if (seenSessionIds.has(sessionIdKey)) {
            hasInvalidData = true;
            continue;
          }

          seenSessionIds.add(sessionIdKey);
          sessions.push(session);
        }

        return {
          sessions,
          hasInvalidData
        };
      };

      const parseSessionsForMutation = (value) => {
        const inspected = inspectStoredSessions(value);
        if (inspected.hasInvalidData) {
          throw new Error(CONSTANTS.MESSAGES.SESSION_DATA_CORRUPTED);
        }
        return inspected.sessions;
      };

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[CONSTANTS.STORAGE_KEYS.SESSIONS]) {
          const inspected = inspectStoredSessions(changes[CONSTANTS.STORAGE_KEYS.SESSIONS].newValue);
          allSessions = inspected.sessions;
          renderSessions();
          if (inspected.hasInvalidData) {
            showToast(CONSTANTS.MESSAGES.SESSION_DATA_WARNING, CONSTANTS.UI.TOAST_DURATION * 2);
          }
        }
      });

      const isDuplicateSessionName = (name, excludeId = null, sessions = allSessions) =>
        sessions.some(s => String(s.id) !== String(excludeId) && s.name === name);
      const generateUniqueId = () => `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      const findSessionById = (id) => allSessions.find(s => String(s.id) === String(id));
      const findSessionIndexById = (id) => allSessions.findIndex(s => String(s.id) === String(id));
      const findSessionDataOrShowError = (id) => {
        const index = findSessionIndexById(id);
        if (index === -1) {
          showToast(CONSTANTS.MESSAGES.SESSION_NOT_FOUND);
          return null;
        }
        return { session: allSessions[index], index };
      };
      const getSessionTimestamp = (session) => {
        const id = session?.id;
        const rawTimestamp = typeof id === 'string' ? id.split('-')[0] : id;
        const timestamp = Number(rawTimestamp);
        return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
      };

      const createActionButton = (action, title, icon) => {
        const button = document.createElement('button');
        button.className = `beos-icon-button ${action.toLowerCase()}-btn`;
        button.dataset.action = action;
        button.title = title;
        button.textContent = icon;
        return button;
      };

      const withLoadingState = async (elements, asyncFunc) => {
        const elementsArray = Array.isArray(elements) || elements instanceof NodeList ? Array.from(elements) : [elements];
        if (elementsArray.some(el => !el || el.disabled)) return;
        const previousDisabledStates = new Map(elementsArray.map(el => [el, el.disabled]));
        elementsArray.forEach(el => { el.disabled = true; });
        pane.style.cursor = 'wait';
        try {
          await asyncFunc();
        } finally {
          elementsArray.forEach(el => {
            if (pane.contains(el)) {
              el.disabled = previousDisabledStates.get(el) ?? false;
            }
          });
          pane.style.cursor = 'default';
        }
      };

      const renderSessions = () => {
        const fragment = document.createDocumentFragment();
        const searchTerm = sessionInput.value.trim().toLowerCase();
        const filteredSessions = searchTerm 
            ? allSessions.filter(s => 
                s.name.toLowerCase().includes(searchTerm) || 
                s.tabs.some(t => 
                    t.url.toLowerCase().includes(searchTerm) ||
                    (t.title && t.title.toLowerCase().includes(searchTerm))
                )
              ) 
            : allSessions;

        if (filteredSessions.length === 0) {
          const p = document.createElement('p');
          p.style.textAlign = 'center';
          p.style.padding = '20px 0';
          p.textContent = allSessions.length === 0 ? "저장된 세션이 없습니다." : "검색 결과가 없습니다.";
          sessionListEl.replaceChildren(p);
          return;
        }

        const sortedSessions = [...filteredSessions].sort((a, b) => {
          if (a.isPinned !== b.isPinned) {
            return a.isPinned ? -1 : 1;
          }
          return getSessionTimestamp(b) - getSessionTimestamp(a);
        });

        sortedSessions.forEach(session => fragment.appendChild(createSessionListItem(session)));
        sessionListEl.replaceChildren(fragment);
      };
      
      const createSessionListItem = (session) => {
        const item = sessionItemTemplate.content.cloneNode(true).firstElementChild;
        item.dataset.sessionId = session.id;
        if (session.isPinned) item.classList.add('pinned');
        const groupCount = new Set(session.tabs.map(t => t.groupId).filter(id => Number.isInteger(id) && id >= 0)).size;
        const sessionIdNum = getSessionTimestamp(session);
        const dateMeta = formatDate(sessionIdNum);
        const countMeta = `탭: ${session.tabs.length}${groupCount > 0 ? `, 그룹: ${groupCount}` : ''}`;
        const sessionNameEl = item.querySelector('.session-name');
        sessionNameEl.textContent = session.name;
        sessionNameEl.title = session.name;
        item.querySelector('.session-meta-date').textContent = dateMeta;
        item.querySelector('.session-meta-count').textContent = countMeta;
        const sessionActions = item.querySelector('.session-actions');
        const actions = [
          { action: CONSTANTS.ACTIONS.RESTORE, title: '복원(열기)', icon: '🚀' },
          { action: CONSTANTS.ACTIONS.COPY, title: 'URL 복사', icon: '📋' },
          { action: CONSTANTS.ACTIONS.UPDATE, title: '덮어쓰기', icon: '🔄' },
          { action: CONSTANTS.ACTIONS.RENAME, title: '이름 변경', icon: '✏️' },
          { action: CONSTANTS.ACTIONS.PIN, title: session.isPinned ? '고정 해제' : '세션 고정', icon: session.isPinned ? '📍' : '📌' },
          { action: CONSTANTS.ACTIONS.DELETE, title: '삭제', icon: '🗑️' },
        ];
        actions.forEach(({ action, title, icon }) => {
          sessionActions.appendChild(createActionButton(action, title, icon));
        });
        const detailsList = item.querySelector('.session-details-list');
        session.tabs.forEach(tab => {
          const tabItem = document.createElement('li');
          tabItem.textContent = tab.url;
          detailsList.appendChild(tabItem);
        });
        const sessionHeader = item.querySelector('.session-header');
        const sessionDetails = item.querySelector('.session-details');
        sessionHeader.addEventListener('click', (e) => {
          if (!e.target.closest('.beos-icon-button')) {
            sessionDetails.style.display = sessionDetails.style.display === 'block' ? 'none' : 'block';
          }
        });
        return item;
      };

      const enqueueSessionMutation = (operation) => {
        const queuedOperation = sessionMutationQueue
          .catch(() => {})
          .then(operation);
        sessionMutationQueue = queuedOperation.catch(() => {});
        return queuedOperation;
      };

      const mutateAndPersistSessions = (mutator) => enqueueSessionMutation(async () => {
        const persistedSessions = parseSessionsForMutation(
          await storage.get(CONSTANTS.STORAGE_KEYS.SESSIONS, [])
        );
        const workingSessions = JSON.parse(JSON.stringify(persistedSessions));

        try {
          const result = await mutator(workingSessions);
          if (result?.skipSave) {
            allSessions = persistedSessions;
            renderSessions();
            return result;
          }

          await storage.set(CONSTANTS.STORAGE_KEYS.SESSIONS, workingSessions);
          allSessions = workingSessions;
          renderSessions();
          return result;
        } catch (error) {
          allSessions = persistedSessions;
          renderSessions();
          throw error;
        }
      });

      const updateAndSaveSessions = async (updateFunction, { errorMessagePrefix }) => {
        try {
          const result = await mutateAndPersistSessions(async (sessions) => {
            const successMessage = await updateFunction(sessions);
            if (successMessage === null) {
              return { skipSave: true, successMessage: null };
            }
            return { successMessage };
          });
          if (result?.successMessage) showToast(result.successMessage);
          return !result?.skipSave;
        } catch (e) {
          showToast(`❌ ${errorMessagePrefix}: ${escapeHtml(e.message)}`);
          return false;
        }
      };

      const getTabsSnapshot = async (scope) => {
        try {
          const queryInfo = scope === CONSTANTS.SAVE_SCOPES.CURRENT_WINDOW
            ? { currentWindow: true }
            : {};
          const tabs = await chrome.tabs.query(queryInfo);
          if (tabs.length === 0) return { tabs: [], closingCandidates: [] };

          const windowIds = [...new Set(
            tabs
              .map(tab => tab.windowId)
              .filter(windowId => Number.isInteger(windowId))
          )];
          let allTabGroups = [];
          const tabGroupResults = await Promise.allSettled(
            windowIds.map(windowId => chrome.tabGroups.query({ windowId }))
          );
          allTabGroups = tabGroupResults
            .filter(result => result.status === 'fulfilled' && Array.isArray(result.value))
            .flatMap(result => result.value);
          if (tabGroupResults.some(result => result.status === 'rejected')) {
            showToast(CONSTANTS.MESSAGES.GET_TAB_GROUPS_FAILED);
          }

          const validTabEntries = tabs
            .map(tab => {
              const navigationState = getSessionTabNavigationState(tab);
              return {
                tab,
                // A pending destination is the tab's current effective URL. If it
                // is not a supported session URL, never fall back to the stale
                // committed URL and accidentally treat the tab as safely saved.
                normalizedUrl: navigationState.hasPendingUrl
                  ? navigationState.pendingUrl
                  : navigationState.committedUrl
              };
            })
            .filter(({ normalizedUrl }) => Boolean(normalizedUrl));
          return {
            tabs: validTabEntries.map(({ tab, normalizedUrl }) => ({
              url: normalizedUrl,
              title: typeof tab.title === 'string' ? tab.title : '',
              pinned: Boolean(tab.pinned),
              groupId: Number.isInteger(tab.groupId) ? tab.groupId : -1,
              groupInfo: Number.isInteger(tab.groupId) && tab.groupId > -1
                ? normalizeSessionGroupInfo(
                    allTabGroups.find(group => group.id === tab.groupId && group.windowId === tab.windowId) || null
                  )
                : null,
              windowId: Number.isInteger(tab.windowId) ? tab.windowId : undefined
            })),
            closingCandidates: validTabEntries
              .filter(({ tab }) => Number.isInteger(tab.id) && Number.isInteger(tab.windowId))
              .map(({ tab, normalizedUrl }) => ({
                id: tab.id,
                windowId: tab.windowId,
                url: normalizedUrl
              }))
          };
        } catch (error) {
          showToast(CONSTANTS.MESSAGES.GET_TABS_FAILED);
          return { tabs: [], closingCandidates: [] };
        }
      };

      const getTabsToSave = async (scope) => (await getTabsSnapshot(scope)).tabs;

      const canSaveTabCount = (tabCount) => {
        if (tabCount <= CONSTANTS.LIMITS.MAX_SAVE_TABS) return true;
        showToast(`❌ ${CONSTANTS.MESSAGES.SAVE_TOO_MANY_TABS(CONSTANTS.LIMITS.MAX_SAVE_TABS)}`);
        return false;
      };
      
      const restoreTabGroupsForWindow = async (createdTabs, windowId) => {
        if (!chrome.tabs?.group || !chrome.tabGroups?.update) return;

        const groupsToRestore = new Map();
        createdTabs.forEach(({ savedTab, createdTabId }) => {
          if (!createdTabId || savedTab.pinned || typeof savedTab.groupId !== 'number' || savedTab.groupId < 0) return;
          const groupKey = String(savedTab.groupId);
          if (!groupsToRestore.has(groupKey)) {
            groupsToRestore.set(groupKey, { info: savedTab.groupInfo || null, tabIds: [] });
          }
          groupsToRestore.get(groupKey).tabIds.push(createdTabId);
        });

        for (const { info, tabIds } of groupsToRestore.values()) {
          if (!tabIds.length) continue;
          try {
            const newGroupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
            const groupInfo = normalizeSessionGroupInfo(info);
            const updateProperties = {};
            if (groupInfo && typeof groupInfo.title === 'string') updateProperties.title = groupInfo.title;
            if (groupInfo && SUPPORTED_TAB_GROUP_COLORS.has(groupInfo.color)) updateProperties.color = groupInfo.color;
            if (groupInfo && typeof groupInfo.collapsed === 'boolean') updateProperties.collapsed = groupInfo.collapsed;
            if (Object.keys(updateProperties).length > 0) {
              await chrome.tabGroups.update(newGroupId, updateProperties);
            }
          } catch (groupError) {
            console.warn('Failed to restore tab group:', groupError);
            showToast(CONSTANTS.MESSAGES.GET_TAB_GROUPS_FAILED);
          }
        }
      };

      const restoreSessionTabs = async (session) => {
        const validTabs = session.tabs.map(normalizeSessionTab).filter(Boolean);
        if (validTabs.length === 0) {
          showToast(CONSTANTS.MESSAGES.NO_VALID_TABS_TO_SAVE);
          return;
        }
        if (validTabs.length > CONSTANTS.LIMITS.MAX_RESTORE_TABS) {
          throw new Error(CONSTANTS.MESSAGES.RESTORE_TOO_MANY_TABS(CONSTANTS.LIMITS.MAX_RESTORE_TABS));
        }

        const tabsByWindow = new Map();
        validTabs.forEach((tab, index) => {
          const windowKey = tab.windowId === undefined || tab.windowId === null ? 'single-window' : String(tab.windowId);
          if (!tabsByWindow.has(windowKey)) tabsByWindow.set(windowKey, []);
          tabsByWindow.get(windowKey).push({ ...tab, originalIndex: index });
        });

        const createdWindowIds = [];
        const createdRestoreTabs = [];
        try {
          for (const windowTabs of tabsByWindow.values()) {
            const [firstTab, ...remainingTabs] = windowTabs;
            const createdWindow = await chrome.windows.create({ url: firstTab.url, focused: createdWindowIds.length === 0 });
            if (!Number.isInteger(createdWindow?.id)) {
              throw new Error('복원된 창의 식별자를 확인할 수 없습니다.');
            }
            const createdWindowId = createdWindow.id;
            createdWindowIds.push(createdWindowId);

            const createdTabs = [];
            let createdFirstTab = Array.isArray(createdWindow.tabs)
              ? createdWindow.tabs.find(tab => Number.isInteger(tab?.id))
              : null;
            if (!createdFirstTab) {
              const createdWindowTabs = await chrome.tabs.query({ windowId: createdWindowId });
              createdFirstTab = createdWindowTabs.find(tab => Number.isInteger(tab?.id));
            }
            if (!Number.isInteger(createdFirstTab?.id)) {
              throw new Error('복원된 창의 첫 번째 탭을 확인할 수 없습니다.');
            }

            createdTabs.push({ savedTab: firstTab, createdTabId: createdFirstTab.id });
            createdRestoreTabs.push({
              tabId: createdFirstTab.id,
              windowId: createdWindowId,
              expectedUrl: firstTab.url
            });
            if (firstTab.pinned) {
              await chrome.tabs.update(createdFirstTab.id, { pinned: true });
            }

            for (const savedTab of remainingTabs) {
              const createdTab = await chrome.tabs.create({
                windowId: createdWindowId,
                url: savedTab.url,
                active: false,
                pinned: Boolean(savedTab.pinned)
              });
              if (!Number.isInteger(createdTab?.id)) {
                throw new Error('복원된 탭의 식별자를 확인할 수 없습니다.');
              }
              createdTabs.push({ savedTab, createdTabId: createdTab.id });
              createdRestoreTabs.push({
                tabId: createdTab.id,
                windowId: createdWindowId,
                expectedUrl: savedTab.url
              });
            }

            await restoreTabGroupsForWindow(createdTabs, createdWindowId);
          }

          if (createdWindowIds.length > 0) {
            await chrome.windows.update(createdWindowIds[0], { focused: true });
          }
          showToast(CONSTANTS.MESSAGES.SESSION_RESTORED);
        } catch (error) {
          let rollbackFailureCount = 0;
          let preservedChangedTabCount = 0;

          // 창 전체를 닫으면 복원 도중 사용자가 그 창에 추가하거나 이동한 탭까지
          // 함께 사라질 수 있습니다. 이번 복원에서 만든 탭만, URL과 창이 그대로일 때만 정리합니다.
          for (const restoreTab of [...createdRestoreTabs].reverse()) {
            try {
              const liveTab = await chrome.tabs.get(restoreTab.tabId);
              const navigationState = getSessionTabNavigationState(liveTab);
              const isStillInRestoreWindow = liveTab.windowId === restoreTab.windowId;
              const isStillOnRestoreUrl = navigationState.hasPendingUrl
                ? navigationState.pendingUrl === restoreTab.expectedUrl &&
                  (!navigationState.committedUrl || navigationState.committedUrl === restoreTab.expectedUrl)
                : navigationState.committedUrl === restoreTab.expectedUrl;

              if (!isStillInRestoreWindow || !isStillOnRestoreUrl) {
                preservedChangedTabCount += 1;
                continue;
              }

              await chrome.tabs.remove(restoreTab.tabId);
            } catch (rollbackError) {
              const rollbackErrorMessage = String(rollbackError?.message || '').toLowerCase();
              const tabAlreadyGone = rollbackErrorMessage.includes('no tab with id') ||
                rollbackErrorMessage.includes('invalid tab id') ||
                rollbackErrorMessage.includes('tab id not found');
              if (!tabAlreadyGone) {
                rollbackFailureCount += 1;
                console.error(`Failed to roll back restored tab ${restoreTab.tabId}.`, rollbackError);
              }
            }
          }

          const reason = error instanceof Error ? error.message : String(error);
          let rollbackStatus = rollbackFailureCount === 0
            ? ' 변경되지 않은 복원 탭은 모두 정리했습니다.'
            : ` 복원 탭 중 ${rollbackFailureCount}개를 정리하지 못했습니다.`;
          if (preservedChangedTabCount > 0) {
            rollbackStatus += ` 사용자가 이동하거나 주소를 변경한 탭 ${preservedChangedTabCount}개는 보존했습니다.`;
          }
          throw new Error(`${reason}${rollbackStatus}`);
        }
      };

      const generateUniqueSessionName = (
        baseName,
        sessions = allSessions,
        { showWarning = false } = {}
      ) => {
        const maxLength = CONSTANTS.UI.SESSION_NAME_MAX_LENGTH;
        const fallbackName = `세션 ${formatDate(Date.now())}`;
        const normalizedBase = String(baseName ?? '').trim().slice(0, maxLength) || fallbackName.slice(0, maxLength);

        if (!isDuplicateSessionName(normalizedBase, null, sessions)) return normalizedBase;

        let counter = 2;
        let newName;
        do {
          const suffix = ` (${counter++})`;
          const availableLength = Math.max(1, maxLength - suffix.length);
          const truncatedBase = normalizedBase.slice(0, availableLength).trimEnd();
          newName = `${truncatedBase}${suffix}`;
        } while (isDuplicateSessionName(newName, null, sessions));

        if (showWarning) showToast(CONSTANTS.MESSAGES.createDuplicateNameWarning(newName));
        return newName;
      };

      const generateUniqueSessionId = (sessions) => {
        const existingIds = new Set(sessions.map(session => String(session.id)));
        let id;
        do {
          id = generateUniqueId();
        } while (existingIds.has(String(id)));
        return id;
      };

      const handleSaveSession = async (scope, overwriteId = null, overwriteName = null) => {
        const requestedName = sessionInput.value.trim();
        const tabs = await getTabsToSave(scope);
        if (tabs.length === 0) {
          showToast(CONSTANTS.MESSAGES.NO_VALID_TABS_TO_SAVE);
          return;
        }
        if (!canSaveTabCount(tabs.length)) return;

        const saved = await updateAndSaveSessions(
          (sessions) => {
            if (overwriteId) {
              const sessionIndex = sessions.findIndex(s => String(s.id) === String(overwriteId));
              if (sessionIndex === -1) {
                showToast(CONSTANTS.MESSAGES.UPDATE_SESSION_NOT_FOUND);
                return null;
              }
              const name = overwriteName;
              sessions[sessionIndex] = { ...sessions[sessionIndex], tabs, name };
              return CONSTANTS.MESSAGES.createSessionUpdatedMessage(name);
            }

            let name = requestedName;
            if (!name) name = `${CONSTANTS.DEFAULTS.SESSION_PREFIX} ${formatDate(Date.now())}`.trim();
            name = generateUniqueSessionName(name, sessions);
            sessions.push({ id: generateUniqueSessionId(sessions), name, tabs, isPinned: false });
            return CONSTANTS.MESSAGES.createSessionSavedMessage(name);
          },
          { errorMessagePrefix: CONSTANTS.MESSAGES.SESSION_SAVE_FAILED }
        );

        // Preserve the typed name on a failed write. A successful clear also
        // changes the current search filter, so refresh the list immediately.
        if (saved && !overwriteId) {
          sessionInput.value = '';
          renderSessions();
        }
      };

      const handleSaveAndCloseAll = async () => {
        const initialSnapshot = await getTabsSnapshot(CONSTANTS.SAVE_SCOPES.ALL_WINDOWS);
        if (initialSnapshot.tabs.length === 0) {
          showToast(CONSTANTS.MESSAGES.NO_VALID_TABS_TO_SAVE);
          return;
        }
        if (!canSaveTabCount(initialSnapshot.tabs.length)) return;

        if (!confirm(CONSTANTS.MESSAGES.createConfirmSaveAndCloseMessage(initialSnapshot.tabs.length))) return;

        // Re-capture after confirmation. Anything opened after this snapshot is
        // neither part of the saved session nor eligible for automatic closing.
        const snapshot = await getTabsSnapshot(CONSTANTS.SAVE_SCOPES.ALL_WINDOWS);
        if (snapshot.tabs.length === 0) {
          showToast(CONSTANTS.MESSAGES.NO_VALID_TABS_TO_SAVE);
          return;
        }
        if (!canSaveTabCount(snapshot.tabs.length)) return;

        const requestedName = sessionInput.value.trim();
        let savedSession;
        try {
          savedSession = await mutateAndPersistSessions((sessions) => {
            let name = requestedName;
            if (!name) name = `${CONSTANTS.DEFAULTS.SESSION_PREFIX} ${formatDate(Date.now())}`.trim();
            name = generateUniqueSessionName(name, sessions);
            sessions.push({
              id: generateUniqueSessionId(sessions),
              name, tabs: snapshot.tabs, isPinned: false
            });
            return { name };
          });
          sessionInput.value = '';
          renderSessions();
        } catch (saveError) {
          showToast(`❌ ${CONSTANTS.MESSAGES.SESSION_SAVE_FAILED}: ${escapeHtml(saveError.message)}`);
          return;
        }

        const name = savedSession.name;
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          const protectedTabIds = new Set(Number.isInteger(activeTab?.id) ? [activeTab.id] : []);
          const verifiedCandidates = [];
          let changedCount = 0;

          for (const candidate of snapshot.closingCandidates) {
            if (protectedTabIds.has(candidate.id)) continue;
            try {
              const liveTab = await chrome.tabs.get(candidate.id);
              // A raw pendingUrl means navigation is still in flight even when
              // its scheme is unsupported and normalization returns null. Keep
              // such tabs instead of closing content that was not stably saved.
              if (isStableSessionClosingCandidate(liveTab, candidate)) {
                verifiedCandidates.push(candidate);
              } else {
                changedCount++;
              }
            } catch (_) {
              // Already closed by the user; no action is needed.
            }
          }

          // Protect a tab selected while verification was running.
          const [latestActiveTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (Number.isInteger(latestActiveTab?.id)) protectedTabIds.add(latestActiveTab.id);
          const candidatesToClose = verifiedCandidates.filter(candidate => !protectedTabIds.has(candidate.id));

          let closedCount = 0;
          let failedCount = 0;
          for (const candidate of candidatesToClose) {
            try {
              // The first verification pass can take noticeable time with a
              // large session. Re-check immediately before each destructive
              // removal so navigation/window changes made meanwhile survive.
              const liveTab = await chrome.tabs.get(candidate.id);
              if (!isStableSessionClosingCandidate(liveTab, candidate)) {
                changedCount++;
                continue;
              }

              // Verification and removal can span several seconds for a large
              // session. Refresh the protected foreground tab immediately
              // before every destructive removal so a tab selected while the
              // closing loop is running is never removed.
              const [activeTabBeforeRemoval] = await chrome.tabs.query({
                active: true,
                lastFocusedWindow: true
              });
              if (activeTabBeforeRemoval?.id === candidate.id) {
                protectedTabIds.add(candidate.id);
                changedCount++;
                continue;
              }

              await chrome.tabs.remove(candidate.id);
              closedCount++;
            } catch (closeError) {
              const closeErrorMessage = String(closeError?.message || '').toLowerCase();
              const tabAlreadyGone = closeErrorMessage.includes('no tab with id') ||
                closeErrorMessage.includes('invalid tab id') ||
                closeErrorMessage.includes('tab id not found');
              if (!tabAlreadyGone) {
                failedCount++;
                console.warn(`Failed to close saved tab ${candidate.id}.`, closeError);
              }
            }
          }
          const notClosedCount = changedCount + failedCount;

          if (notClosedCount > 0) {
            showToast(
              CONSTANTS.MESSAGES.SESSION_SAVED_TABS_PARTIALLY_CLOSED(name, closedCount, notClosedCount),
              CONSTANTS.UI.TOAST_DURATION * 1.5
            );
          } else {
            showToast(CONSTANTS.MESSAGES.SESSION_SAVED_AND_TABS_CLOSED(name, closedCount));
          }
        } catch (closeError) {
          console.error('Error closing tabs:', closeError);
          showToast(CONSTANTS.MESSAGES.SESSION_SAVED_TABS_CLOSE_FAILED(name), CONSTANTS.UI.TOAST_DURATION * 1.5);
        }
      };
      
      const handleRestoreSession = async (sessionId) => {
        const session = findSessionById(sessionId);
        if (!session) {
          showToast(CONSTANTS.MESSAGES.SESSION_NOT_FOUND);
          return;
        }
        const validTabCount = session.tabs.map(normalizeSessionTab).filter(Boolean).length;
        if (validTabCount === 0) {
          showToast(CONSTANTS.MESSAGES.NO_VALID_TABS_TO_SAVE);
          return;
        }
        if (validTabCount > CONSTANTS.LIMITS.MAX_RESTORE_TABS) {
          showToast(`❌ ${CONSTANTS.MESSAGES.RESTORE_TOO_MANY_TABS(CONSTANTS.LIMITS.MAX_RESTORE_TABS)}`);
          return;
        }
        if (validTabCount >= CONSTANTS.LIMITS.RESTORE_CONFIRM_TAB_THRESHOLD &&
            !confirm(CONSTANTS.MESSAGES.createConfirmLargeRestoreMessage(session.name, validTabCount))) {
          return;
        }
        showToast(CONSTANTS.MESSAGES.createSessionRestoreStartedMessage(session.name));
        try {
          await restoreSessionTabs(session);
        } catch (restoreError) {
          console.error("Failed to restore session layout:", restoreError);
          showToast(`❌ 세션 복원 실패: ${escapeHtml(restoreError.message)}`, CONSTANTS.UI.TOAST_DURATION * 1.5);
        }
      };
      
      const handleUpdateSession = async (sessionId) => {
        const session = findSessionById(sessionId);
        if (!session) return;
        if (!confirm(CONSTANTS.MESSAGES.createConfirmUpdateMessage(session.name))) {
          return;
        }
        await handleSaveSession(CONSTANTS.SAVE_SCOPES.ALL_WINDOWS, sessionId, session.name);
      };

      const handleDeleteSession = async (sessionId) => {
        let deletionResult;
        try {
          deletionResult = await mutateAndPersistSessions((sessions) => {
            const sessionIndex = sessions.findIndex(s => String(s.id) === String(sessionId));
            if (sessionIndex === -1) return { skipSave: true, missing: true };
            const [session] = sessions.splice(sessionIndex, 1);
            return { session, sessionIndex };
          });
        } catch (e) {
          showToast(`❌ ${CONSTANTS.MESSAGES.DELETE_FAILED}: ${escapeHtml(e.message)}`);
          return;
        }

        if (deletionResult?.missing || !deletionResult?.session) {
          showToast(CONSTANTS.MESSAGES.SESSION_NOT_FOUND);
          return;
        }

        const { session: sessionToDelete, sessionIndex } = deletionResult;
        const undoCallback = async () => {
          try {
            await mutateAndPersistSessions((sessions) => {
              const restoredSession = JSON.parse(JSON.stringify(sessionToDelete));
              if (sessions.some(session => String(session.id) === String(restoredSession.id))) {
                restoredSession.id = generateUniqueSessionId(sessions);
              }
              restoredSession.name = generateUniqueSessionName(restoredSession.name, sessions);
              sessions.splice(Math.min(sessionIndex, sessions.length), 0, restoredSession);
              return { restoredName: restoredSession.name };
            });
            showToast(CONSTANTS.MESSAGES.SESSION_RESTORED);
          } catch (e) {
            showToast(`❌ 복원 실패: ${escapeHtml(e.message)}`);
          }
        };

        showToast(
          CONSTANTS.MESSAGES.createSessionDeletedMessage(sessionToDelete.name),
          CONSTANTS.UI.TOAST_DURATION,
          undoCallback
        );
      };
      
      const handleRenameSession = async (sessionId) => {
        const sessionData = findSessionDataOrShowError(sessionId);
        if (!sessionData) return;
        const { session } = sessionData;
        const originalName = session.name;
        const newName = prompt('새 세션 이름을 입력하세요:', originalName);
        if (newName === null) return;
        const trimmedNewName = newName.trim();
        if (!trimmedNewName) {
          showToast(CONSTANTS.MESSAGES.NAME_CANNOT_BE_EMPTY);
          return;
        }
        if (trimmedNewName.length > CONSTANTS.UI.SESSION_NAME_MAX_LENGTH) {
          showToast(CONSTANTS.MESSAGES.createNameTooLongMessage(CONSTANTS.UI.SESSION_NAME_MAX_LENGTH));
          return;
        }
        if (trimmedNewName === originalName) return;
        if (isDuplicateSessionName(trimmedNewName, session.id)) {
          showToast(CONSTANTS.MESSAGES.createNameAlreadyExistsMessage(trimmedNewName));
          return;
        }

        const renamed = await updateAndSaveSessions(
          (sessions) => {
            const sessionIndex = sessions.findIndex(s => String(s.id) === String(sessionId));
            if (sessionIndex === -1) {
              showToast(CONSTANTS.MESSAGES.SESSION_NOT_FOUND);
              return null;
            }
            if (isDuplicateSessionName(trimmedNewName, sessionId, sessions)) {
              showToast(CONSTANTS.MESSAGES.createNameAlreadyExistsMessage(trimmedNewName));
              return null;
            }
            sessions[sessionIndex].name = trimmedNewName;
            return CONSTANTS.MESSAGES.createNameChangedMessage(trimmedNewName);
          },
          { errorMessagePrefix: CONSTANTS.MESSAGES.RENAME_FAILED }
        );
        if (renamed && sessionInput.value.trim()) {
          sessionInput.value = '';
          renderSessions();
        }
      };

      const handlePinSession = async (sessionId) => {
        if (!findSessionById(sessionId)) {
          showToast(CONSTANTS.MESSAGES.SESSION_NOT_FOUND);
          return;
        }
        await updateAndSaveSessions(
          (sessions) => {
            const sessionIndex = sessions.findIndex(s => String(s.id) === String(sessionId));
            if (sessionIndex === -1) {
              showToast(CONSTANTS.MESSAGES.SESSION_NOT_FOUND);
              return null;
            }
            const session = sessions[sessionIndex];
            session.isPinned = !session.isPinned;
            return session.isPinned ? CONSTANTS.MESSAGES.SESSION_PINNED : CONSTANTS.MESSAGES.SESSION_UNPINNED;
          },
          { errorMessagePrefix: CONSTANTS.MESSAGES.PIN_FAILED }
        );
      };
      
      const handleCopySessionUrls = async (sessionId) => {
        const sessionData = findSessionDataOrShowError(sessionId);
        if (!sessionData) return;
        const { session } = sessionData;
        const urlsToCopy = session.tabs.map(tab => tab.url).join('\n');
        if (!urlsToCopy) {
            showToast(CONSTANTS.MESSAGES.NO_URLS_TO_COPY);
            return;
        }
        try {
            const copied = await writeTextToClipboard(urlsToCopy);
            showToast(copied ? CONSTANTS.MESSAGES.URLS_COPIED : CONSTANTS.MESSAGES.COPY_FAILED);
        } catch (err) {
            showToast(CONSTANTS.MESSAGES.COPY_FAILED);
        }
      };

      const handleExport = () => {
        if (allSessions.length === 0) { showToast(CONSTANTS.MESSAGES.NO_SESSIONS_TO_EXPORT); return; }
        const dataStr = JSON.stringify(allSessions);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const now = new Date();
        const year = now.getFullYear().toString().slice(-2);
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const filename = `${year}${month}${day}_LunaTools_Session_Manager_Backup.json`;
        
        try {
          chrome.downloads.download({ url, filename }, (downloadId) => {
            const downloadError = chrome.runtime.lastError;
            if (downloadId === undefined || downloadError) {
              URL.revokeObjectURL(url);
              const detail = downloadError?.message ? ` (${downloadError.message})` : '';
              showToast(`${CONSTANTS.MESSAGES.EXPORT_FAILED}${detail}`);
              return;
            }

            setTimeout(() => URL.revokeObjectURL(url), CONSTANTS.TIMING.EXPORT_URL_REVOKE_DELAY);
            showToast(CONSTANTS.MESSAGES.EXPORT_SUCCESS);
          });
        } catch (error) {
          URL.revokeObjectURL(url);
          const detail = error?.message ? ` (${error.message})` : '';
          showToast(`${CONSTANTS.MESSAGES.EXPORT_FAILED}${detail}`);
        }
      };

      const normalizeImportedTab = (tab) => normalizeSessionTab(tab);

      const normalizeImportedSessions = (imported) => {
        if (!Array.isArray(imported)) throw new Error('Invalid format');
        if (imported.length > CONSTANTS.LIMITS.MAX_IMPORT_SESSIONS) {
          throw new Error(CONSTANTS.MESSAGES.IMPORT_TOO_MANY_SESSIONS(CONSTANTS.LIMITS.MAX_IMPORT_SESSIONS));
        }

        const valid = [];
        let totalTabCount = 0;
        for (const session of imported) {
          if (!isRecord(session)) continue;
          const sessionName = typeof session.name === 'string' ? session.name.trim() : '';
          if (!isValidSessionId(session.id) ||
              !sessionName ||
              sessionName.length > CONSTANTS.UI.SESSION_NAME_MAX_LENGTH ||
              (hasOwn(session, 'isPinned') && typeof session.isPinned !== 'boolean') ||
              !Array.isArray(session.tabs) ||
              session.tabs.length === 0) {
            continue;
          }
          if (session.tabs.length > CONSTANTS.LIMITS.MAX_TABS_PER_IMPORTED_SESSION) {
            throw new Error(CONSTANTS.MESSAGES.IMPORT_TOO_MANY_TABS_IN_SESSION(CONSTANTS.LIMITS.MAX_TABS_PER_IMPORTED_SESSION));
          }

          const tabs = session.tabs.map(normalizeImportedTab).filter(Boolean);
          if (tabs.length === 0) continue;
          totalTabCount += tabs.length;
          if (totalTabCount > CONSTANTS.LIMITS.MAX_IMPORT_TOTAL_TABS) {
            throw new Error(CONSTANTS.MESSAGES.IMPORT_TOO_MANY_TOTAL_TABS(CONSTANTS.LIMITS.MAX_IMPORT_TOTAL_TABS));
          }

          valid.push({
            id: session.id,
            name: sessionName,
            tabs,
            isPinned: hasOwn(session, 'isPinned') ? session.isPinned : false
          });
        }

        return valid;
      };

      const handleImport = () => {
        const file = importFileInput.files[0];
        if (!file) return;
        if (file.size > CONSTANTS.LIMITS.MAX_IMPORT_FILE_SIZE_BYTES) {
          showToast(CONSTANTS.MESSAGES.IMPORT_FILE_TOO_LARGE);
          importFileInput.value = '';
          return;
        }

        const reader = new FileReader();
        reader.onerror = () => {
          showToast(CONSTANTS.MESSAGES.IMPORT_FILE_READ_ERROR);
          importFileInput.value = '';
        };
        reader.onload = async (e) => {
          try {
            const imported = JSON.parse(e.target.result);
            const valid = normalizeImportedSessions(imported);

            if (valid.length === 0) throw new Error(CONSTANTS.MESSAGES.IMPORT_NO_VALID_SESSIONS);

            const result = await mutateAndPersistSessions((sessions) => {
              for (const importedSession of valid) {
                const sessionToImport = JSON.parse(JSON.stringify(importedSession));
                if (sessions.some(session => String(session.id) === String(sessionToImport.id))) {
                  sessionToImport.id = generateUniqueSessionId(sessions);
                }
                sessionToImport.name = generateUniqueSessionName(sessionToImport.name, sessions);
                sessions.push(sessionToImport);
              }
              return { importedCount: valid.length };
            });

            showToast(CONSTANTS.MESSAGES.createImportSuccessMessage(result.importedCount));
          } catch (error) {
            const message = String(error?.message || '');
            showToast(
              message.startsWith('저장 공간') || message.startsWith('가져오기 제한 초과') || message === CONSTANTS.MESSAGES.IMPORT_NO_VALID_SESSIONS
                ? `❌ ${message}`
                : CONSTANTS.MESSAGES.IMPORT_INVALID_FORMAT
            );
          } finally {
            importFileInput.value = '';
          }
        };
        reader.readAsText(file);
      };

      const handleSessionAction = (e) => {
        const btn = e.target.closest('.beos-icon-button');
        if (!btn) return;
        const sessionItem = btn.closest('.session-item');
        if (!sessionItem) return;
        const sessionId = sessionItem.dataset.sessionId;
        const allActionButtons = sessionItem.querySelectorAll('.beos-icon-button');
        withLoadingState(allActionButtons, async () => {
          switch (btn.dataset.action) {
            case CONSTANTS.ACTIONS.RESTORE: await handleRestoreSession(sessionId); break;
            case CONSTANTS.ACTIONS.COPY: await handleCopySessionUrls(sessionId); break;
            case CONSTANTS.ACTIONS.UPDATE: await handleUpdateSession(sessionId); break;
            case CONSTANTS.ACTIONS.RENAME: await handleRenameSession(sessionId); break;
            case CONSTANTS.ACTIONS.PIN: await handlePinSession(sessionId); break;
            case CONSTANTS.ACTIONS.DELETE: await handleDeleteSession(sessionId); break;
          }
        });
      };

      const cleanup = () => {
        if (toastTimeout) clearTimeout(toastTimeout);
        if (inputDebounce) clearTimeout(inputDebounce);
      };

      const initialize = async () => {
        sessionInput.maxLength = CONSTANTS.UI.SESSION_NAME_MAX_LENGTH;

        const sessions = await storage.get(CONSTANTS.STORAGE_KEYS.SESSIONS, []);
        const inspectedSessions = inspectStoredSessions(sessions);
        allSessions = inspectedSessions.sessions;
        
        renderSessions();
        if (inspectedSessions.hasInvalidData) {
          showToast(CONSTANTS.MESSAGES.SESSION_DATA_WARNING, CONSTANTS.UI.TOAST_DURATION * 2);
        }
        
        saveCurrentWindowBtn.addEventListener('click', () => {
          withLoadingState(saveCurrentWindowBtn, () => handleSaveSession(CONSTANTS.SAVE_SCOPES.CURRENT_WINDOW));
        });

        const saveAllWindowsAction = () => {
            withLoadingState(saveAllWindowsBtn, () => handleSaveSession(CONSTANTS.SAVE_SCOPES.ALL_WINDOWS));
        };
        saveAllWindowsBtn.addEventListener('click', saveAllWindowsAction);

        sessionInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            saveAllWindowsBtn.click();
          }
        });
        
        sessionInput.addEventListener('input', () => {
          clearTimeout(inputDebounce);
          inputDebounce = setTimeout(renderSessions, CONSTANTS.UI.SEARCH_DEBOUNCE_TIME);
        });
        
        exportBtn.addEventListener('click', (e) => { e.preventDefault(); handleExport(); });
        importBtn.addEventListener('click', (e) => { e.preventDefault(); importFileInput.click(); });
        importFileInput.addEventListener('change', handleImport);
        saveAndCloseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const menuItems = pane.querySelectorAll('.dropdown-content a');
            withLoadingState(menuItems, handleSaveAndCloseAll);
        });
        
        sessionListEl.addEventListener('click', handleSessionAction);
        
        window.addEventListener('pagehide', cleanup);
      };

      initialize().catch((error) => {
        console.error('LunaTools Session Manager initialization failed:', error);
        showToast('❌ 세션 관리자 초기화에 실패했습니다. 패널을 다시 열어주세요.', CONSTANTS.UI.TOAST_DURATION * 2);
      });
    });

    // Initialize both apps within their respective panes
    initializeApp(lunaToolsApp, 'multi-url-opener-pane');
    initializeApp(tabHaikuApp, 'session-manager-pane');
});
