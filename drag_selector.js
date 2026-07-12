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
        #allLinksOnPageCached = null;
        #domMutationObserver = null;
        #isTrustedSequence = false;
        #activeDelayedOpenController = null;
        #lastObservedScrollY = null;

        #listenerOptions = { capture: true, passive: false };

        #boundHandleMouseDown = this.#handleMouseDown.bind(this);
        #boundHandleMouseMove = this.#handleMouseMove.bind(this);
        #boundHandleMouseUp = this.#handleMouseUp.bind(this);
        #boundHandleKeyDown = this.#handleKeyDown.bind(this);
        #boundHandleKeyUp = this.#handleKeyUp.bind(this);
        #boundHandleInteractionAbort = this.#handleInteractionAbort.bind(this);
        #boundHandleVisibilityChange = this.#handleVisibilityChange.bind(this);

        constructor() {
            this.#injectStyles();
            this.#addEventListeners();
            this.#domMutationObserver = new MutationObserver(() => {
                this.#allLinksOnPageCached = null;
            });
            const observerTarget = document.body || document.documentElement;
            if (observerTarget) {
                this.#domMutationObserver.observe(observerTarget, { childList: true, subtree: true });
            }
        }

        destroy() {
            this.#removeEventListeners();
            if (this.#domMutationObserver) this.#domMutationObserver.disconnect();
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
            window.addEventListener('blur', this.#boundHandleInteractionAbort, true);
            window.addEventListener('pagehide', this.#boundHandleInteractionAbort, true);
            window.addEventListener('pointercancel', this.#boundHandleInteractionAbort, true);
            document.addEventListener('visibilitychange', this.#boundHandleVisibilityChange, true);
        }

        #removeEventListeners() {
            document.removeEventListener('mousedown', this.#boundHandleMouseDown, this.#listenerOptions);
            document.removeEventListener('mousemove', this.#boundHandleMouseMove, this.#listenerOptions);
            window.removeEventListener('mouseup', this.#boundHandleMouseUp, this.#listenerOptions);
            document.removeEventListener('keydown', this.#boundHandleKeyDown, this.#listenerOptions);
            document.removeEventListener('keyup', this.#boundHandleKeyUp, this.#listenerOptions);
            window.removeEventListener('blur', this.#boundHandleInteractionAbort, true);
            window.removeEventListener('pagehide', this.#boundHandleInteractionAbort, true);
            window.removeEventListener('pointercancel', this.#boundHandleInteractionAbort, true);
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

        #findAllLinks(rootNode) {
            const links = [];
            const queue = [rootNode];
            while (queue.length > 0) {
                const node = queue.shift();
                if (!node) continue;
                links.push(...node.querySelectorAll('a[href]'));
                for (const el of node.querySelectorAll('*')) { if (el.shadowRoot) queue.push(el.shadowRoot); }
            }
            return links.filter(link => this.#isElementVisible(link) && link.href && !link.href.startsWith(window.location.href + '#') && ['http:', 'https:'].includes(link.protocol));
        }

        #getLinksFromCacheOrFind() {
            if (!this.#allLinksOnPageCached) {
                this.#allLinksOnPageCached = this.#findAllLinks(document.body);
            }
            return this.#allLinksOnPageCached;
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

            this.#actionIndicator.append(emojiSpan, this.#indicatorLabel);
            document.body.append(this.#selectionBox, this.#actionIndicator);
        }

        #updateOnFrame() {
            if (!this.#isDragging) { this.#animationFrameId = null; return; }
            this.#handleAutoScroll();
            this.#updateVisuals();
            this.#updateLinkHighlights();
            this.#animationFrameId = requestAnimationFrame(() => this.#updateOnFrame());
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
            const selectionRect = this.#selectionBox.getBoundingClientRect();
            return this.#getLinksInRect(selectionRect);
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
            toRemove.forEach(link => link.classList.remove(highlightClass));
            toAdd.forEach(link => link.classList.add(highlightClass));
        }
        
        #updateLinkHighlights() {
            const selectionRect = this.#selectionBox.getBoundingClientRect();
            const currentLinksInRect = this.#getLinksInRect(selectionRect);
            
            const toRemove = new Set([...this.#highlightedLinks].filter(x => !currentLinksInRect.has(x)));
            const toAdd = new Set([...currentLinksInRect].filter(x => !this.#highlightedLinks.has(x)));

            if (toRemove.size > 0 || toAdd.size > 0) {
                this.#applyHighlightChanges(toAdd, toRemove);
                this.#highlightedLinks = currentLinksInRect;
                this.#updateIndicatorText();
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
            let skipped = 0;
            const { MAX_URLS_PER_ACTION, MAX_URL_LENGTH } = DragSelector.CONFIG.LIMITS;

            for (const link of links) {
                const href = typeof link?.href === 'string' ? link.href.trim() : '';
                if (!href || href.length > MAX_URL_LENGTH) {
                    skipped += 1;
                    continue;
                }

                try {
                    const parsed = new URL(href);
                    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
                        skipped += 1;
                        continue;
                    }

                    const normalizedUrl = parsed.href;
                    if (normalizedUrl.length > MAX_URL_LENGTH || seenUrls.has(normalizedUrl)) {
                        skipped += 1;
                        continue;
                    }

                    if (urls.length >= MAX_URLS_PER_ACTION) {
                        skipped += 1;
                        continue;
                    }

                    seenUrls.add(normalizedUrl);
                    urls.push(normalizedUrl);
                } catch (_) {
                    skipped += 1;
                }
            }

            return { urls, skipped };
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
                    const skipped = Number(response.skipped || 0);
                    if (failed > 0 || skipped > 0) {
                        console.warn(`LunaTools: 탭 열기 결과 - 실패 ${failed}개, 제외 ${skipped}개.`);
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
            const { urls, skipped } = this.#normalizeActionUrls(links);
            if (urls.length === 0) return;
            if (skipped > 0) {
                console.warn(`LunaTools: 선택한 링크 중 ${skipped}개를 안전 제한 또는 중복으로 제외했습니다.`);
            }

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
            if (this.#animationFrameId) cancelAnimationFrame(this.#animationFrameId);

            const C = DragSelector.CONFIG;
            document.body?.classList.remove(C.CSS_CLASSES.BODY_DRAG_STATE);
            this.#highlightedLinks.forEach(link => link.classList.remove(C.CSS_CLASSES.HIGHLIGHT));

            if (this.#selectionBox) {
                const boxToRemove = this.#selectionBox;
                const indicatorToRemove = this.#actionIndicator;
                const fadeOutClass = C.CSS_CLASSES.FADE_OUT;
                boxToRemove.classList.add(fadeOutClass);
                indicatorToRemove?.classList.add(fadeOutClass);
                setTimeout(() => {
                    boxToRemove.remove();
                    indicatorToRemove?.remove();
                }, C.TIMING.FADE_OUT_DURATION_MS);
            }

            this.#isDragging = false;
            this.#selectionBox = null;
            this.#actionIndicator = null;
            this.#modifier = null;
            this.#highlightedLinks.clear();
            this.#allLinksOnPage = [];
            this.#animationFrameId = null;
            this.#lastMouseEvent = null;
            this.#indicatorLabel = null;
            this.#isTrustedSequence = false;
            this.#lastObservedScrollY = null;
        }
        
        #handleMouseDown(e) {
            if (!e.isTrusted) return;
            if (e.button !== 0) return;
            
            const modifier = this.#getModifier(e);
            if (!modifier) return;
            
            const targetElement = e.target instanceof Element ? e.target : e.target?.parentElement;
            const editableElement = targetElement?.closest?.('input, textarea, select, [contenteditable]');
            const isEditable = Boolean(editableElement && (
                editableElement.matches('input, textarea, select') ||
                editableElement.isContentEditable ||
                editableElement.getAttribute('contenteditable') === ''
            ));
            if (isEditable) return;
            
            this.#abortDelayedOpen();
            this.#modifier = modifier;
            this.#isTrustedSequence = true;
            this.#startPos = { x: e.clientX, y: e.clientY };
            this.#lastMouseEvent = e;
            this.#lastObservedScrollY = window.scrollY;
        }

        #handleMouseMove(e) {
            if (!e.isTrusted || !this.#isTrustedSequence) return;
            if (!this.#modifier) return;
            if ((e.buttons & 1) === 0) {
                this.#resetState();
                return;
            }

            this.#lastMouseEvent = e;
            if (this.#isDragging) return;
            
            const dragDistance = Math.hypot(e.clientX - this.#startPos.x, e.clientY - this.#startPos.y);
            if (dragDistance > DragSelector.CONFIG.BEHAVIOR.MIN_DRAG_DISTANCE) {
                e.preventDefault();
                e.stopPropagation();

                document.body.classList.add(DragSelector.CONFIG.CSS_CLASSES.BODY_DRAG_STATE);
                this.#isDragging = true;
                this.#allLinksOnPage = this.#getLinksFromCacheOrFind();
                this.#createVisualElements();

                if (!this.#animationFrameId) { this.#updateOnFrame(); }
            }
        }

        #handleMouseUp(e) {
            if (!e.isTrusted || !this.#isTrustedSequence) return;
            if (e.button !== 0) return;

            if (this.#isDragging) {
                e.preventDefault();
                e.stopPropagation();
                const finalLinks = this.#getFinalSelectedLinks();
                void this.#performAction(finalLinks, this.#modifier);
            }
            if (this.#modifier) {
                this.#resetState();
            }
        }

        #handleKeyDown(e) {
            if (!e.isTrusted || e.key !== 'Escape') return;

            if (this.#isDragging || this.#activeDelayedOpenController) {
                e.preventDefault();
                e.stopPropagation();
            }

            if (this.#isDragging) this.#resetState();
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
            if (this.#isTrustedSequence || this.#isDragging || this.#modifier) {
                this.#resetState();
            }
        }

        #handleVisibilityChange() {
            if (document.visibilityState === 'hidden') {
                this.#handleInteractionAbort();
            }
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
