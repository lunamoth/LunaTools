(() => {
    'use strict';

    const normalizeHostname = (value) => String(value || '').trim().toLowerCase().replace(/\.+$/, '');

    const isLikelyHostRule = (entry) => (
        /^[a-z0-9.-]+(?::\d+)?(?:[/?#].*)?$/i.test(entry) &&
        (
            entry.includes('.') ||
            /^localhost(?::|[/?#]|$)/i.test(entry) ||
            /^\d{1,3}(?:\.\d{1,3}){3}(?::|[/?#]|$)/.test(entry)
        )
    );

    const parseHostnameRule = (rawRule) => {
        const entry = String(rawRule || '').trim();
        if (!entry) return null;

        const hasHttpScheme = /^https?:\/\//i.test(entry);
        if (!hasHttpScheme && !isLikelyHostRule(entry)) return null;

        try {
            const parsed = new URL(hasHttpScheme ? entry : `https://${entry}`);
            const hostname = normalizeHostname(parsed.hostname);
            return hostname || null;
        } catch (_) {
            return null;
        }
    };

    const matchesHostnameRule = (currentHostname, rawRule) => {
        const hostname = normalizeHostname(currentHostname);
        const rule = parseHostnameRule(rawRule) || normalizeHostname(rawRule);
        return Boolean(rule) && (hostname === rule || hostname.endsWith(`.${rule}`));
    };

    class DragSelector {
        static CONFIG = {
            MODIFIERS: {
                alt: { color: '40, 205, 65', emoji: '🐢', label: '2초 지연 열기' },
                ctrl: { color: '0, 122, 255', emoji: '📋', label: '복사' },
                shift: { color: '255, 45, 85', emoji: '🚀', label: '열기' }
            },
            STYLE: {
                EMOJI_FONT_SIZE_PX: 24,
                LABEL_FONT_SIZE_PX: 18,
                LABEL_FONT_FAMILY: "'Lato', '나눔바른고딕', -apple-system, 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', sans-serif"
            },
            CSS_CLASSES: {
                HIGHLIGHT: 'ds-highlight-final',
                FADE_OUT: 'ds-fade-out-final',
                BODY_DRAG_STATE: 'ds-no-select-final',
                INDICATOR_LABEL: 'ds-indicator-label-final',
                SELECTION_BOX: 'ds-selection-box-final',
                ACTION_INDICATOR: 'ds-action-indicator-final'
            },
            BEHAVIOR: {
                MIN_DRAG_DISTANCE: 10,
                AUTO_SCROLL_ZONE: 50,
                AUTO_SCROLL_SPEED: 15,
                Z_INDEX: 2147483646
            },
            LIMITS: {
                MAX_URLS_PER_ACTION: 100,
                MAX_URL_LENGTH: 2048
            },
            TIMING: {
                FADE_OUT_DURATION_MS: 250,
                DELAY_OPEN_INTERVAL_MS: 2000
            }
        };

        #isDragging = false;
        #startPos = { x: 0, y: 0 };
        #selectionBox = null;
        #actionIndicator = null;
        #modifier = null;
        #highlightedLinks = new Set();
        #allLinksOnPage = [];
        #animationFrameId = null;
        #lastMouseEvent = null;
        #indicatorLabel = null;
        #isTrustedSequence = false;
        #activeDelayedOpenController = null;
        #lastObservedScrollY = null;
        #dragBody = null;
        #mouseDownEvent = null;

        #listenerOptions = { capture: true, passive: false };

        #boundHandleMouseDown = this.#handleMouseDown.bind(this);
        #boundHandleMouseMove = this.#handleMouseMove.bind(this);
        #boundHandleMouseUp = this.#handleMouseUp.bind(this);
        #boundHandleKeyDown = this.#handleKeyDown.bind(this);
        #boundHandleKeyUp = this.#handleKeyUp.bind(this);
        #boundHandleInteractionAbort = this.#handleInteractionAbort.bind(this);
        #boundHandleVisibilityChange = this.#handleVisibilityChange.bind(this);
        #boundHandleFocusChange = this.#handleFocusChange.bind(this);
        #boundHandleWheel = this.#handleWheel.bind(this);

        constructor() {
            this.#injectStyles();
            this.#addEventListeners();
        }

        destroy() {
            this.#removeEventListeners();
            this.#abortDelayedOpen();
            const styleElement = document.getElementById('drag-selector-styles');
            if (styleElement) styleElement.remove();
            this.#resetState();
        }

        #addEventListeners() {
            document.addEventListener('mousedown', this.#boundHandleMouseDown, this.#listenerOptions);
            document.addEventListener('mousemove', this.#boundHandleMouseMove, this.#listenerOptions);
            window.addEventListener('mouseup', this.#boundHandleMouseUp, this.#listenerOptions);
            document.addEventListener('keydown', this.#boundHandleKeyDown, this.#listenerOptions);
            document.addEventListener('keyup', this.#boundHandleKeyUp, this.#listenerOptions);
            window.addEventListener('blur', this.#boundHandleFocusChange, true);
            // 브라우저 창을 다시 활성화할 때 이전 창에서 끝나지 않은
            // 포인터 시퀀스가 남아 있으면 첫 mousemove가 페이지 입력을
            // 계속 가로챌 수 있습니다. 포커스 복귀도 새 시퀀스의 경계로
            // 취급해 드래그 잠금과 보조키 상태를 정리합니다.
            window.addEventListener('focus', this.#boundHandleFocusChange, true);
            window.addEventListener('pagehide', this.#boundHandleInteractionAbort, true);
            window.addEventListener('pageshow', this.#boundHandleInteractionAbort, true);
            window.addEventListener('pointercancel', this.#boundHandleInteractionAbort, true);
            window.addEventListener('dragstart', this.#boundHandleInteractionAbort, true);
            window.addEventListener('dragend', this.#boundHandleInteractionAbort, true);
            window.addEventListener('wheel', this.#boundHandleWheel, { capture: true, passive: true });
            document.addEventListener('visibilitychange', this.#boundHandleVisibilityChange, true);
        }

        #removeEventListeners() {
            document.removeEventListener('mousedown', this.#boundHandleMouseDown, this.#listenerOptions);
            document.removeEventListener('mousemove', this.#boundHandleMouseMove, this.#listenerOptions);
            window.removeEventListener('mouseup', this.#boundHandleMouseUp, this.#listenerOptions);
            document.removeEventListener('keydown', this.#boundHandleKeyDown, this.#listenerOptions);
            document.removeEventListener('keyup', this.#boundHandleKeyUp, this.#listenerOptions);
            window.removeEventListener('blur', this.#boundHandleFocusChange, true);
            window.removeEventListener('focus', this.#boundHandleFocusChange, true);
            window.removeEventListener('pagehide', this.#boundHandleInteractionAbort, true);
            window.removeEventListener('pageshow', this.#boundHandleInteractionAbort, true);
            window.removeEventListener('pointercancel', this.#boundHandleInteractionAbort, true);
            window.removeEventListener('dragstart', this.#boundHandleInteractionAbort, true);
            window.removeEventListener('dragend', this.#boundHandleInteractionAbort, true);
            window.removeEventListener('wheel', this.#boundHandleWheel, true);
            document.removeEventListener('visibilitychange', this.#boundHandleVisibilityChange, true);
        }

        #injectStyles() {
            if (document.getElementById('drag-selector-styles')) return;
            const style = document.createElement('style');
            style.id = 'drag-selector-styles';
            const C = DragSelector.CONFIG;
            const highlightColor = `rgba(${C.MODIFIERS.ctrl.color}, 0.15)`;
            const fadeOutDurationSeconds = C.TIMING.FADE_OUT_DURATION_MS / 1000;

            style.textContent = `
                .${C.CSS_CLASSES.BODY_DRAG_STATE} *:not(input):not(textarea):not([contenteditable="true"]) { user-select: none !important; -webkit-user-select: none !important; cursor: crosshair !important; }
                @keyframes DS-PopIn-Overshoot { 0% { opacity: 0; transform: scale(0.8); } 80% { opacity: 1; transform: scale(1.05); } 100% { opacity: 1; transform: scale(1); } }
                @keyframes DS-Indicator-PopIn { 0% { opacity: 0; transform: translate(-50%, 0px) scale(0.8); } 80% { opacity: 1; transform: translate(-50%, 20px) scale(1.05); } 100% { opacity: 1; transform: translate(-50%, 15px) scale(1); } }
                @keyframes DS-Shimmer { 0%{border-image-source:linear-gradient(135deg,#007AFF,#FF2D55,#FFCC00)}25%{border-image-source:linear-gradient(135deg,#FFCC00,#007AFF,#FF2D55)}50%{border-image-source:linear-gradient(135deg,#FF2D55,#FFCC00,#007AFF)}100%{border-image-source:linear-gradient(135deg,#007AFF,#FF2D55,#FFCC00)} }
                @keyframes DS-FadeOut { from { opacity: 1; } to { opacity: 0; transform: scale(0.95); } }
                .${C.CSS_CLASSES.FADE_OUT} { animation: DS-FadeOut ${fadeOutDurationSeconds}s ease-out forwards; }
                .${C.CSS_CLASSES.HIGHLIGHT} { background-color: ${highlightColor} !important; border-radius: 7px; box-shadow: inset 0 0 0 1.5px rgba(${C.MODIFIERS.ctrl.color}, 0.25); transition: all 0.2s cubic-bezier(0.4,0,0.2,1); }
                
                .${C.CSS_CLASSES.SELECTION_BOX} { 
                    position: fixed; 
                    z-index: ${C.BEHAVIOR.Z_INDEX}; 
                    border: 2px solid; 
                    border-image-slice: 1; 
                    border-radius: 18px; 
                    box-shadow: 0 8px 32px -8px rgba(0,0,0,0.2); 
                    pointer-events: none; 
                    transform-origin: center center;
                    animation: DS-PopIn-Overshoot 0.5s cubic-bezier(0.34,1.56,0.64,1), DS-Shimmer 3s linear infinite; 
                }

                .${C.CSS_CLASSES.ACTION_INDICATOR} { position: fixed; z-index: ${C.BEHAVIOR.Z_INDEX + 1}; padding: 10px 20px; background: radial-gradient(circle,rgba(255,255,255,0.7) 0%,rgba(240,240,240,0.6) 100%); color: #1d1d1f; border-radius: 999px; box-shadow: 0 16px 48px rgba(0,0,0,0.3); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); border: 1px solid rgba(255,255,255,0.5); pointer-events: none; display: flex; align-items: center; gap: 10px; transform: translate(-50%, 15px); animation: DS-Indicator-PopIn 0.5s cubic-bezier(0.34,1.56,0.64,1); }
                .${C.CSS_CLASSES.ACTION_INDICATOR} > span:first-child { font-size: ${C.STYLE.EMOJI_FONT_SIZE_PX}px; }
                .${C.CSS_CLASSES.INDICATOR_LABEL} { font-size: ${C.STYLE.LABEL_FONT_SIZE_PX}px; font-weight: 600; font-family: ${C.STYLE.LABEL_FONT_FAMILY}; }
            `;
            const styleHost = document.head || document.documentElement;
            if (!styleHost) return;
            styleHost.appendChild(style);
        }

        #getModifier(e) { return e.altKey ? 'alt' : e.ctrlKey ? 'ctrl' : e.shiftKey ? 'shift' : null; }

        #isEditableEvent(e) {
            if (document.designMode === 'on') return true;
            const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
            const candidates = [...path, e.target, e.target?.parentElement];
            const selector = 'input, textarea, select, [contenteditable], [role="textbox"], [role="searchbox"], [role="combobox"], .CodeMirror, .monaco-editor, .ace_editor';
            // closest()는 ShadowRoot를 넘지 않으므로 슬롯·호스트를 포함한
            // 이벤트 경로 전체를 확인합니다. 직전 activeElement만 검사하면
            // 입력란 밖에서 새로 시작하는 정상적인 링크 드래그도 막게 됩니다.
            return candidates.some(candidate => {
                if (!(candidate instanceof Element)) return false;
                if (candidate.isContentEditable) return true;
                const editable = candidate.closest(selector);
                if (!editable) return false;
                if (editable.matches('input, textarea, select, [role="textbox"], [role="searchbox"], [role="combobox"], .CodeMirror, .monaco-editor, .ace_editor')) return true;
                const value = editable.getAttribute('contenteditable');
                return editable.isContentEditable || (value !== null && value.toLowerCase() !== 'false');
            });
        }

        #isDocumentActive() {
            return document.visibilityState !== 'hidden' && document.hasFocus();
        }

        #hasLiveDragContext() {
            return this.#isDocumentActive() &&
                !this.#mouseDownEvent?.defaultPrevented &&
                this.#dragBody === document.body && Boolean(this.#dragBody?.isConnected) &&
                (!this.#isDragging || Boolean(this.#selectionBox?.isConnected && this.#actionIndicator?.isConnected));
        }

        #isRectIntersecting(r1, r2) { return !(r2.right < r1.left || r2.left > r1.right || r2.bottom < r1.top || r2.top > r1.bottom); }

        #isElementIntersecting(element, selectionRect) {
            const clientRects = element.getClientRects();
            for (let i = 0; i < clientRects.length; i++) {
                if (this.#isRectIntersecting(clientRects[i], selectionRect)) return true;
            }
            return false;
        }

        #isElementVisible(element) {
            const clientRects = element.getClientRects();
            if (!clientRects || clientRects.length === 0) return false;
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            for (let i = 0; i < clientRects.length; i++) {
                if (clientRects[i].width > 0 && clientRects[i].height > 0) return true;
            }
            return false;
        }

        #getLinkUrl(link) {
            // HTML 앵커의 href는 문자열이지만 SVG 앵커는 SVGAnimatedString입니다.
            // 두 경우 모두 같은 기준 주소로 해석해 링크 하나의 형식 차이가
            // 페이지 전체의 드래그 선택을 중단시키지 않도록 합니다.
            const href = typeof link?.href === 'string'
                ? link.href
                : link?.getAttribute?.('href');
            if (typeof href !== 'string' || !href.trim()) return null;

            try {
                return new URL(href, link.baseURI || document.baseURI);
            } catch {
                return null;
            }
        }

        #findAllLinks(rootNode) {
            const links = [];
            const queue = [rootNode];
            for (let index = 0; index < queue.length; index += 1) {
                const node = queue[index];
                if (!node) continue;
                // 대량의 링크를 함수 인자로 펼치면 인자 개수 제한으로 실패합니다.
                for (const link of node.querySelectorAll('a[href]')) links.push(link);
                for (const el of node.querySelectorAll('*')) { if (el.shadowRoot) queue.push(el.shadowRoot); }
            }
            return links.filter(link => {
                if (!this.#isElementVisible(link)) return false;
                const url = this.#getLinkUrl(link);
                return url && !url.href.startsWith(window.location.href + '#') &&
                    ['http:', 'https:'].includes(url.protocol);
            });
        }

        #createVisualElements() {
            const C = DragSelector.CONFIG;
            const config = C.MODIFIERS[this.#modifier];
            this.#selectionBox = document.createElement('div');
            this.#selectionBox.className = C.CSS_CLASSES.SELECTION_BOX;
            this.#actionIndicator = document.createElement('div');
            this.#actionIndicator.className = C.CSS_CLASSES.ACTION_INDICATOR;

            const emojiSpan = document.createElement('span');
            emojiSpan.textContent = config.emoji;
            const labelSpan = document.createElement('span');
            labelSpan.className = C.CSS_CLASSES.INDICATOR_LABEL;
            labelSpan.textContent = config.label;
            this.#indicatorLabel = labelSpan;

            // 페이지의 div/span CSS 때문에 투명한 입력 차단막이 되지 않게 합니다.
            // 자식 요소도 pointer-events를 재정의할 수 있으므로 각각 보호합니다.
            for (const element of [this.#selectionBox, this.#actionIndicator, emojiSpan, labelSpan]) {
                element.style.setProperty('pointer-events', 'none', 'important');
            }
            this.#actionIndicator.append(emojiSpan, this.#indicatorLabel);
            document.body.append(this.#selectionBox, this.#actionIndicator);
        }

        #updateOnFrame() {
            this.#animationFrameId = null;
            if (!this.#isDragging) return;
            try {
                // blur를 놓쳐도 실행 중인 기존 프레임에서 포커스 상실과
                // DOM/UI 교체를 확인해 자동 스크롤이 계속되지 않게 합니다.
                if (!this.#hasLiveDragContext()) { this.#resetState(); return; }
                this.#handleAutoScroll();
                this.#updateVisuals();
                this.#updateLinkHighlights();
                if (this.#isDragging) {
                    this.#animationFrameId = requestAnimationFrame(() => this.#updateOnFrame());
                }
            } catch (_) {
                // SPA DOM 교체나 페이지별 DOM 객체가 프레임 처리 중
                // 예외를 내더라도 전역 입력 잠금이 남지 않도록 복구합니다.
                this.#resetState();
                return;
            }
        }

        #handleAutoScroll() {
            const { clientY } = this.#lastMouseEvent;
            const C = DragSelector.CONFIG.BEHAVIOR;
            const scrollYBeforeRequest = window.scrollY;

            // 이전 프레임 이후 실제로 이동한 만큼만 원점을 보정합니다.
            // 경계에서 scrollBy()가 0px 이동하거나 smooth-scroll이 지연되어도 오차가 누적되지 않습니다.
            if (Number.isFinite(this.#lastObservedScrollY)) {
                this.#startPos.y -= scrollYBeforeRequest - this.#lastObservedScrollY;
            }

            let scrollAmount = 0;
            if (clientY < C.AUTO_SCROLL_ZONE) scrollAmount = -C.AUTO_SCROLL_SPEED;
            else if (clientY > window.innerHeight - C.AUTO_SCROLL_ZONE) scrollAmount = C.AUTO_SCROLL_SPEED;
            if (scrollAmount !== 0) {
                window.scrollBy(0, scrollAmount);
            }

            const scrollYAfterRequest = window.scrollY;
            this.#startPos.y -= scrollYAfterRequest - scrollYBeforeRequest;
            this.#lastObservedScrollY = scrollYAfterRequest;
        }

        #updateVisuals() {
            const { clientX, clientY } = this.#lastMouseEvent;
            const { x: startX, y: startY } = this.#startPos;
            const left = Math.min(startX, clientX);
            const top = Math.min(startY, clientY);
            const width = Math.abs(clientX - startX);
            const height = Math.abs(clientY - startY);
            
            this.#selectionBox.style.left = `${left}px`;
            this.#selectionBox.style.top = `${top}px`;
            this.#selectionBox.style.width = `${width}px`;
            this.#selectionBox.style.height = `${height}px`;
            
            this.#actionIndicator.style.left = `${clientX}px`;
            this.#actionIndicator.style.top = `${clientY}px`;
        }

        #getFinalSelectedLinks() {
            return this.#getLinksInRect(this.#getSelectionRect());
        }

        #getSelectionRect() {
            const { clientX, clientY } = this.#lastMouseEvent;
            // 선택 상자의 테두리·확대 애니메이션·렌더링 시점은 실행 범위에
            // 영향을 주지 않습니다. 마지막 프레임 이후의 스크롤도 반영합니다.
            const scrollDeltaY = Number.isFinite(this.#lastObservedScrollY)
                ? window.scrollY - this.#lastObservedScrollY
                : 0;
            const startY = this.#startPos.y - scrollDeltaY;
            return {
                left: Math.min(this.#startPos.x, clientX),
                right: Math.max(this.#startPos.x, clientX),
                top: Math.min(startY, clientY),
                bottom: Math.max(startY, clientY)
            };
        }
        
        #getLinksInRect(selectionRect) {
            const linksInRect = new Set();
            for (const link of this.#allLinksOnPage) {
                if (this.#isElementIntersecting(link, selectionRect)) {
                    linksInRect.add(link);
                }
            }
            return linksInRect;
        }

        #applyHighlightChanges(toAdd, toRemove) {
            const highlightClass = DragSelector.CONFIG.CSS_CLASSES.HIGHLIGHT;
            for (const link of toRemove) {
                if (!this.#isDragging) return;
                if (link.classList.contains(highlightClass)) link.classList.remove(highlightClass);
                this.#highlightedLinks.delete(link);
            }
            for (const link of toAdd) {
                if (!this.#isDragging) return;
                // DOM 변경이 동기 포커스 이벤트를 일으켜도
                // 해당 요소가 즉시 정리 대상에 포함되도록 먼저 기록합니다.
                this.#highlightedLinks.add(link);
                link.classList.add(highlightClass);
            }
        }
        
        #updateLinkHighlights() {
            const selectionRect = this.#getSelectionRect();
            const currentLinksInRect = this.#getLinksInRect(selectionRect);
            
            const toRemove = new Set([...this.#highlightedLinks].filter(x => !currentLinksInRect.has(x)));
            const toAdd = new Set([...currentLinksInRect].filter(x => !this.#highlightedLinks.has(x)));

            if (toRemove.size > 0 || toAdd.size > 0) {
                this.#applyHighlightChanges(toAdd, toRemove);
                if (this.#isDragging) this.#updateIndicatorText();
            }
        }

        #updateIndicatorText() {
            const config = DragSelector.CONFIG.MODIFIERS[this.#modifier];
            const count = this.#highlightedLinks.size;
            const maxUrls = DragSelector.CONFIG.LIMITS.MAX_URLS_PER_ACTION;
            if (this.#indicatorLabel) {
                this.#indicatorLabel.textContent = count > maxUrls
                    ? `${count}개 선택됨 · 최대 ${maxUrls}개 ${config.label}`
                    : count > 0 ? `${count}개 ${config.label}` : config.label;
            }
        }

        #normalizeActionUrls(links) {
            const urls = [];
            const seenUrls = new Set();
            const stats = { invalid: 0, duplicate: 0, overLimit: 0 };
            const { MAX_URLS_PER_ACTION, MAX_URL_LENGTH } = DragSelector.CONFIG.LIMITS;

            for (const link of links) {
                const parsed = this.#getLinkUrl(link);
                if (!parsed) {
                    stats.invalid += 1;
                    continue;
                }

                try {
                    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
                        stats.invalid += 1;
                        continue;
                    }

                    const normalizedUrl = parsed.href;
                    if (normalizedUrl.length > MAX_URL_LENGTH) {
                        stats.invalid += 1;
                        continue;
                    }

                    if (seenUrls.has(normalizedUrl)) {
                        stats.duplicate += 1;
                        continue;
                    }

                    if (urls.length >= MAX_URLS_PER_ACTION) {
                        stats.overLimit += 1;
                        continue;
                    }

                    seenUrls.add(normalizedUrl);
                    urls.push(normalizedUrl);
                } catch (_) {
                    stats.invalid += 1;
                }
            }

            return { urls, ...stats };
        }

        async #copyTextToClipboard(text) {
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                    return true;
                }
            } catch (_) {
            }

            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.setAttribute('readonly', '');
            textArea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
            document.documentElement.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                return document.execCommand('copy');
            } catch (_) {
                return false;
            } finally {
                textArea.remove();
            }
        }

        #sendOpenTabsMessage(urls) {
            try {
                chrome.runtime.sendMessage({ action: 'openTabsInNewTab', urls }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn('LunaTools: 탭 열기 메시지 전송 실패', chrome.runtime.lastError.message);
                        return;
                    }

                    if (!response) return;

                    const failed = Number(response.failed || 0);
                    const safetySkipped = Number(response.invalid || 0) + Number(response.overLimit || 0);
                    if (failed > 0 || safetySkipped > 0) {
                        console.warn(`LunaTools: 탭 열기 결과 - 실패 ${failed}개, 안전 제한 제외 ${safetySkipped}개.`);
                    }
                });
            } catch (error) {
                console.warn('LunaTools: 탭 열기 메시지 전송 실패', error);
            }
        }

        #abortDelayedOpen() {
            if (!this.#activeDelayedOpenController) return;
            this.#activeDelayedOpenController.abort();
            this.#activeDelayedOpenController = null;
        }

        #sleep(ms, signal) {
            return new Promise(resolve => {
                if (signal?.aborted) {
                    resolve(false);
                    return;
                }

                let timeoutId = null;
                const cleanup = () => {
                    if (timeoutId !== null) clearTimeout(timeoutId);
                    signal?.removeEventListener('abort', onAbort);
                };
                const onAbort = () => {
                    cleanup();
                    resolve(false);
                };

                timeoutId = setTimeout(() => {
                    cleanup();
                    resolve(true);
                }, ms);
                signal?.addEventListener('abort', onAbort, { once: true });
            });
        }

        async #performAction(links, modifier = this.#modifier) {
            if (links.size === 0 || !modifier) return;
            const { urls, invalid, overLimit } = this.#normalizeActionUrls(links);
            const safetySkipped = invalid + overLimit;

            // 같은 URL을 가리키는 여러 링크 요소는 흔한 페이지 구조이므로 조용히 중복 제거합니다.
            if (safetySkipped > 0) {
                console.warn(`LunaTools: 선택한 링크 중 ${safetySkipped}개를 안전 제한으로 제외했습니다.`);
            }
            if (urls.length === 0) return;

            if (modifier === 'ctrl') {
                const copied = await this.#copyTextToClipboard(urls.join('\n'));
                if (!copied) console.warn('LunaTools: 클립보드 복사 실패');
            } else if (modifier === 'shift') {
                this.#sendOpenTabsMessage(urls);
            } else if (modifier === 'alt') {
                this.#abortDelayedOpen();
                const controller = new AbortController();
                this.#activeDelayedOpenController = controller;

                try {
                    for (let index = 0; index < urls.length; index += 1) {
                        if (controller.signal.aborted) break;
                        this.#sendOpenTabsMessage([urls[index]]);

                        if (index < urls.length - 1) {
                            const completed = await this.#sleep(
                                DragSelector.CONFIG.TIMING.DELAY_OPEN_INTERVAL_MS,
                                controller.signal
                            );
                            if (!completed) break;
                        }
                    }
                } finally {
                    if (this.#activeDelayedOpenController === controller) {
                        this.#activeDelayedOpenController = null;
                    }
                }
            }
        }

        #resetState() {
            const frameId = this.#animationFrameId;
            const dragBody = this.#dragBody;
            const highlightedLinks = this.#highlightedLinks;
            const overlays = [this.#selectionBox, this.#actionIndicator];
            // DOM 조작보다 먼저 입력 상태를 해제합니다. 정리 중 예외나
            // 동기 이벤트 재진입 때문에 이전 캡처 상태가 남지 않게 합니다.
            this.#isDragging = false;
            this.#selectionBox = null;
            this.#actionIndicator = null;
            this.#modifier = null;
            this.#highlightedLinks = new Set();
            this.#allLinksOnPage = [];
            this.#animationFrameId = null;
            this.#lastMouseEvent = null;
            this.#indicatorLabel = null;
            this.#isTrustedSequence = false;
            this.#lastObservedScrollY = null;
            this.#dragBody = null;
            this.#mouseDownEvent = null;

            const safely = action => { try { action(); } catch (_) {} };
            const C = DragSelector.CONFIG;
            if (frameId !== null) safely(() => cancelAnimationFrame(frameId));
            // 이전 body와 잠금 클래스까지 복제했을 수 있는 현재 body를 모두 정리합니다.
            for (const body of new Set([dragBody, document.body])) {
                safely(() => {
                    if (body?.classList.contains(C.CSS_CLASSES.BODY_DRAG_STATE)) {
                        body.classList.remove(C.CSS_CLASSES.BODY_DRAG_STATE);
                    }
                });
            }
            highlightedLinks.forEach(link => safely(() => {
                if (link.classList.contains(C.CSS_CLASSES.HIGHLIGHT)) link.classList.remove(C.CSS_CLASSES.HIGHLIGHT);
            }));
            for (const overlay of overlays) {
                if (!overlay) continue;
                safely(() => overlay.classList.add(C.CSS_CLASSES.FADE_OUT));
                setTimeout(() => safely(() => overlay.remove()), C.TIMING.FADE_OUT_DURATION_MS);
            }
        }
        
        #handleMouseDown(e) {
            if (!e.isTrusted) return;

            // 새 마우스 버튼 입력은 이전 드래그 시퀀스와 동시에 성립할 수 없다.
            // 페이지 밖에서 mouseup/keyup이 유실된 경우 남아 있던 상태를 먼저 정리한다.
            if (this.#isTrustedSequence || this.#isDragging || this.#modifier ||
                document.body?.classList.contains(DragSelector.CONFIG.CSS_CLASSES.BODY_DRAG_STATE)) {
                this.#resetState();
            }
            if (e.button !== 0 || e.buttons !== 1) return;
            
            const modifier = this.#getModifier(e);
            if (!modifier || e.defaultPrevented || !document.body || !this.#isDocumentActive()) return;
            
            // Shadow DOM 밖에서는 event.target이 입력란 대신 호스트로 바뀝니다.
            // 공개된 이벤트 경로의 실제 시작 요소를 사용해 입력 영역을 보호합니다.
            if (this.#isEditableEvent(e)) return;
            
            this.#abortDelayedOpen();
            this.#modifier = modifier;
            this.#isTrustedSequence = true;
            this.#dragBody = document.body;
            // 문서 캡처 이후 사이트의 mousedown 핸들러가 preventDefault()한
            // 경우도 다음 이동에서 확인할 수 있도록 시작 이벤트를 보관합니다.
            this.#mouseDownEvent = e;
            this.#startPos = { x: e.clientX, y: e.clientY };
            this.#lastMouseEvent = e;
            this.#lastObservedScrollY = window.scrollY;
        }

        #handleMouseMove(e) {
            if (!e.isTrusted || !this.#isTrustedSequence) return;
            if (!this.#modifier) return;
            if (e.buttons !== 1 || !this.#getModifier(e) || !this.#hasLiveDragContext()) {
                this.#resetState();
                return;
            }

            this.#lastMouseEvent = e;
            if (this.#isDragging) {
                e.preventDefault();
                return;
            }
            
            const dragDistance = Math.hypot(e.clientX - this.#startPos.x, e.clientY - this.#startPos.y);
            if (dragDistance > DragSelector.CONFIG.BEHAVIOR.MIN_DRAG_DISTANCE) {
                try {
                    // 제스처마다 현재 DOM을 한 번만 읽어 SPA에서 교체된 링크까지 반영합니다.
                    this.#allLinksOnPage = this.#findAllLinks(document.body);
                    if (!this.#hasLiveDragContext()) { this.#resetState(); return; }
                    this.#createVisualElements();
                    this.#isDragging = true;
                    this.#dragBody.classList.add(DragSelector.CONFIG.CSS_CLASSES.BODY_DRAG_STATE);
                    if (!this.#isDragging) return;
                    // 사이트에도 같은 입력 이벤트를 전달해 자체 UI 상태 정리를 돕습니다.
                    e.preventDefault();

                    if (!this.#animationFrameId) { this.#updateOnFrame(); }
                } catch (_) {
                    // 링크 탐색·시각 요소 생성 중 예외가 발생해도
                    // ds-no-select-final 클래스와 캡처 상태를 즉시 해제합니다.
                    this.#resetState();
                }
            }
        }

        #handleMouseUp(e) {
            if (!e.isTrusted || !this.#isTrustedSequence) return;
            if (e.button !== 0) return;
            if (!this.#getModifier(e) || !this.#hasLiveDragContext()) {
                this.#resetState();
                return;
            }

            // mousedown을 받은 사이트가 자체 드래그/스크롤 잠금을 해제할 수
            // 있도록 짝이 되는 mouseup의 기본 동작과 전파를 막지 않습니다.
            const modifier = this.#modifier;
            let finalLinks = null;
            try {
                if (this.#isDragging) {
                    // mousemove 이후 다음 프레임 전에 놓아도 실제 해제 좌표를 사용합니다.
                    this.#lastMouseEvent = e;
                    finalLinks = this.#getFinalSelectedLinks();
                }
            } finally {
                this.#resetState();
            }
            if (finalLinks) {
                void this.#performAction(finalLinks, modifier);
            }
        }

        #handleKeyDown(e) {
            if (!e.isTrusted || e.key !== 'Escape') return;

            if (this.#isDragging || this.#activeDelayedOpenController) {
                e.preventDefault();
            }

            if (this.#isTrustedSequence || this.#isDragging || this.#modifier) this.#resetState();
            this.#abortDelayedOpen();
        }

        #handleKeyUp(e) {
            if (!e.isTrusted) return;
            if (this.#isDragging && !e.altKey && !e.ctrlKey && !e.shiftKey) {
                this.#resetState();
            } else if (!this.#isDragging && this.#modifier && !this.#getModifier(e)) {
                this.#resetState();
            }
        }

        #handleInteractionAbort() {
            this.#abortDelayedOpen();
            if (this.#isTrustedSequence || this.#isDragging || this.#modifier ||
                document.body?.classList.contains(DragSelector.CONFIG.CSS_CLASSES.BODY_DRAG_STATE)) {
                this.#resetState();
            }
        }

        #handleFocusChange(e) {
            if (!e.isTrusted) return;
            // capture는 요소의 focus/blur도 받습니다. 링크로의 정상적인
            // 포커스 이동을 창 전환으로 오인하지 않도록 구별합니다.
            const isEmbeddedContext = e.target instanceof Element && e.target.matches('iframe, object, embed');
            if (e.target === window || (e.type === 'focus' && (isEmbeddedContext || this.#isEditableEvent(e)))) {
                this.#handleInteractionAbort();
            }
        }

        #handleWheel(e) {
            if (!e.isTrusted || !this.#isTrustedSequence) return;
            if ((e.buttons & 1) === 0 || !this.#getModifier(e) || !this.#hasLiveDragContext()) {
                this.#resetState();
            }
            // passive 리스너이므로 일반 스크롤의 기본 동작을 막지 않습니다.
        }

        #handleVisibilityChange() {
            // hidden 뿐 아니라 visible 복귀도 이전 창의 포인터 상태를
            // 이어받지 않도록 항상 새 상호작용 경계로 처리합니다.
            this.#handleInteractionAbort();
        }
    }

    const getCurrentHostname = () => {
        try {
            return window.location.hostname;
        } catch {
            return '';
        }
    };

    const isDragDisabledForCurrentSite = (disabledDragSites) => {
        const currentHostname = getCurrentHostname();
        const disabledSites = Array.isArray(disabledDragSites) ? disabledDragSites : [];
        return disabledSites.some(site => matchesHostnameRule(currentHostname, site));
    };

    const initializeDragSelector = () => {
        if (!window.dragSelectorInstance) {
            window.dragSelectorInstance = new DragSelector();
        }
    };

    const destroyDragSelector = () => {
        if (!window.dragSelectorInstance) return;
        window.dragSelectorInstance.destroy();
        delete window.dragSelectorInstance;
    };

    const syncDragSelectorState = (disabledDragSites) => {
        if (isDragDisabledForCurrentSite(disabledDragSites)) {
            destroyDragSelector();
        } else {
            initializeDragSelector();
        }
    };

    const loadAndSyncDragSelectorState = () => {
        try {
            chrome.storage.sync.get({ disabledDragSites: [] }, ({ disabledDragSites }) => {
                if (chrome.runtime.lastError) {
                    initializeDragSelector();
                    return;
                }
                syncDragSelectorState(disabledDragSites);
            });
        } catch {
            initializeDragSelector();
        }
    };

    loadAndSyncDragSelectorState();

    try {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'sync' || !changes.disabledDragSites) return;
            syncDragSelectorState(changes.disabledDragSites.newValue);
        });
    } catch {}
})();
