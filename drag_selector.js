(() => {
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
            TIMING: {
                FADE_OUT_DURATION_MS: 250
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

        #listenerOptions = { capture: true, passive: false };

        #boundHandleMouseDown = this.#handleMouseDown.bind(this);
        #boundHandleMouseMove = this.#handleMouseMove.bind(this);
        #boundHandleMouseUp = this.#handleMouseUp.bind(this);
        #boundHandleKeyDown = this.#handleKeyDown.bind(this);
        #boundHandleKeyUp = this.#handleKeyUp.bind(this);

        constructor() {
            this.#injectStyles();
            this.#addEventListeners();
            this.#domMutationObserver = new MutationObserver(() => {
                this.#allLinksOnPageCached = null;
            });
            this.#domMutationObserver.observe(document.body, { childList: true, subtree: true });
        }

        destroy() {
            this.#removeEventListeners();
            if (this.#domMutationObserver) this.#domMutationObserver.disconnect();
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
        }

        #removeEventListeners() {
            document.removeEventListener('mousedown', this.#boundHandleMouseDown, this.#listenerOptions);
            document.removeEventListener('mousemove', this.#boundHandleMouseMove, this.#listenerOptions);
            window.removeEventListener('mouseup', this.#boundHandleMouseUp, this.#listenerOptions);
            document.removeEventListener('keydown', this.#boundHandleKeyDown, this.#listenerOptions);
            document.removeEventListener('keyup', this.#boundHandleKeyUp, this.#listenerOptions);
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
            document.head.appendChild(style);
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
            if (element.offsetParent === null) return false;
            const style = window.getComputedStyle(element);
            if (style.visibility === 'hidden' || style.opacity === '0') return false;
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return false;
            return true;
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
            return links.filter(link => this.#isElementVisible(link) && link.href && !link.href.startsWith(window.location.href + '#') && link.protocol.startsWith('http'));
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
            let scrollAmount = 0;
            if (clientY < C.AUTO_SCROLL_ZONE) scrollAmount = -C.AUTO_SCROLL_SPEED;
            else if (clientY > window.innerHeight - C.AUTO_SCROLL_ZONE) scrollAmount = C.AUTO_SCROLL_SPEED;
            if (scrollAmount !== 0) {
                window.scrollBy(0, scrollAmount);
                this.#startPos.y -= scrollAmount;
            }
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
            if (this.#indicatorLabel) {
                this.#indicatorLabel.textContent = count > 0 ? `${count}개 ${config.label}` : config.label;
            }
        }

        async #performAction(links) {
            if (links.size === 0) return;
            const urls = Array.from(links, a => a.href);

            if (this.#modifier === 'ctrl') {
                navigator.clipboard.writeText(urls.join('\n'));
            } else if (this.#modifier === 'shift') {
                chrome.runtime.sendMessage({ action: 'openTabsInNewTab', urls });
            } else if (this.#modifier === 'alt') {
                const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
                for (const url of urls) {
                    chrome.runtime.sendMessage({ action: 'openTabsInNewTab', urls: [url] });
                    await sleep(2000);
                }
            }
        }

        #resetState() {
            if (this.#animationFrameId) cancelAnimationFrame(this.#animationFrameId);

            const C = DragSelector.CONFIG;
            document.body.classList.remove(C.CSS_CLASSES.BODY_DRAG_STATE);
            this.#highlightedLinks.forEach(link => link.classList.remove(C.CSS_CLASSES.HIGHLIGHT));

            if (this.#selectionBox) {
                const boxToRemove = this.#selectionBox;
                const indicatorToRemove = this.#actionIndicator;
                const fadeOutClass = C.CSS_CLASSES.FADE_OUT;
                boxToRemove.classList.add(fadeOutClass);
                indicatorToRemove.classList.add(fadeOutClass);
                setTimeout(() => { boxToRemove.remove(); indicatorToRemove.remove(); }, C.TIMING.FADE_OUT_DURATION_MS);
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
        }
        
        #handleMouseDown(e) {
            if (e.button !== 0) return;
            
            const modifier = this.#getModifier(e);
            if (!modifier) return;
            
            const target = e.target;
            const isEditable = target.isContentEditable || target.matches('input, textarea');
            if (isEditable) return;
            
            this.#modifier = modifier;
            this.#startPos = { x: e.clientX, y: e.clientY };
            this.#lastMouseEvent = e;
        }

        #handleMouseMove(e) {
            if (!this.#modifier) return;

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
            if (e.button !== 0) return;

            if (this.#isDragging) {
                e.preventDefault();
                e.stopPropagation();
                const finalLinks = this.#getFinalSelectedLinks();
                this.#performAction(finalLinks);
            }
            if (this.#modifier) {
                this.#resetState();
            }
        }

        #handleKeyDown(e) {
            if (e.key === 'Escape' && this.#isDragging) {
                e.preventDefault();
                e.stopPropagation();
                this.#resetState();
            }
        }

        #handleKeyUp(e) {
            if (this.#isDragging && !e.altKey && !e.ctrlKey && !e.shiftKey) {
                this.#resetState();
            } else if (!this.#isDragging && this.#modifier && !this.#getModifier(e)) {
                this.#resetState();
            }
        }
    }

    const initializeDragSelector = () => {
        if (!window.dragSelectorInstance) {
            window.dragSelectorInstance = new DragSelector();
        }
    };

    try {
        chrome.storage.sync.get({ disabledDragSites: [] }, ({ disabledDragSites }) => {
            if (chrome.runtime.lastError) {
                initializeDragSelector();
                return;
            }

            const currentHostname = window.location.hostname;
            const isDragDisabled = disabledDragSites.some(site => site && (currentHostname === site || currentHostname.endsWith('.' + site)));

            if (!isDragDisabled) {
                initializeDragSelector();
            }
        });
    } catch (e) {
        initializeDragSelector();
    }
})();