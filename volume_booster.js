(function() {

    if (window.self !== window.top) {
        return;
    }

    'use strict';

    const CONFIG = {
        VOLUME_MULTIPLIER: 3.0,
        ACTIVATION_KEY: 'v',
        DEBOUNCE_DELAY: 200,
        UI: {
            INDICATOR_ID: 'sound-booster-indicator',
            VISIBLE_CLASS: 'sbi-visible',
            IGNORED_TAGS: new Set(['INPUT', 'TEXTAREA', 'SELECT']),
        }
    };

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    class UIController {
        #indicatorElement = null;
        #toggleCallback;
        #indicatorId;
        #visibleClass;

        constructor(toggleCallback, uiConfig) {
            this.#toggleCallback = toggleCallback;
            this.#indicatorId = uiConfig.INDICATOR_ID;
            this.#visibleClass = uiConfig.VISIBLE_CLASS;
        }

        create() {
            if (document.querySelector(`#${this.#indicatorId}`)) return;
            this.#indicatorElement = document.createElement('div');
            this.#indicatorElement.id = this.#indicatorId;
            this.#indicatorElement.textContent = '🔊';
            document.body.appendChild(this.#indicatorElement);

            this.#injectStyles();
            this.#indicatorElement.addEventListener('click', (e) => {
                e.stopPropagation();
                this.#toggleCallback();
            });
            this.update(false, 1);
        }

        update(isActivated, multiplier) {
            if (!this.#indicatorElement) return;

            this.#indicatorElement.classList.toggle(this.#visibleClass, isActivated);
            this.#indicatorElement.title = isActivated
                ? `볼륨 부스터 ON ${Math.round(multiplier * 100)}% (Alt+V)`
                : '볼륨 부스터 (Alt+V)';
        }

        #injectStyles() {
            const styleId = 'simple-volume-booster-styles';
            if (document.getElementById(styleId)) return;
            
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                :root {
                    --sbi-size: 40px;
                    --sbi-bg-color: rgba(255, 255, 255, 0.2);
                    --sbi-border-color: rgba(255, 255, 255, 0.4);
                    --sbi-icon-color: rgba(0, 0, 0, 0.7);
                    --sbi-font-size: 24px;
                    --sbi-scale-initial: 0.9;
                    --sbi-scale-hover: 1.08;
                    --sbi-scale-active: 1.02;
                }
                @media (prefers-color-scheme: dark) {
                    :root {
                        --sbi-bg-color: rgba(0, 0, 0, 0.3);
                        --sbi-border-color: rgba(255, 255, 255, 0.3);
                        --sbi-icon-color: rgba(255, 255, 255, 0.8);
                    }
                }
                #${this.#indicatorId} {
                    position: fixed; bottom: 25px; right: 25px;
                    width: var(--sbi-size); height: var(--sbi-size);
                    background: var(--sbi-bg-color);
                    border: 1px solid var(--sbi-border-color);
                    color: var(--sbi-icon-color);
                    font-size: var(--sbi-font-size);
                    backdrop-filter: blur(12px) saturate(180%);
                    -webkit-backdrop-filter: blur(12px) saturate(180%);
                    border-radius: 50%;
                    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
                    display: flex; justify-content: center; align-items: center;
                    z-index: 2147483647;
                    user-select: none;
                    opacity: 0; transform: scale(var(--sbi-scale-initial)) translateY(10px);
                    pointer-events: none; transition: opacity 0.3s ease-out, transform 0.3s ease-out;
                    cursor: pointer;
                }
                #${this.#indicatorId}.${this.#visibleClass} { opacity: 1; transform: scale(1) translateY(0); pointer-events: auto; }
                #${this.#indicatorId}:hover { transform: scale(var(--sbi-scale-hover)); }
                #${this.#indicatorId}:active { transform: scale(var(--sbi-scale-active)); }
            `;
            (document.head || document.documentElement).appendChild(style);
        }
    }

    class AudioProcessor {
        #audioContext = null;
        #sourceNodeMap = new Map();
        #userHasInteracted = false; 

        setUserInteracted() {
            this.#userHasInteracted = true;
        }

        async #getOrCreateAudioContext() {
            if (!this.#userHasInteracted && !this.#audioContext) {
                return null;
            }
            if (this.#audioContext) return this.#audioContext;
            try {
                this.#audioContext = new (window.AudioContext || window.webkitAudioContext)();
                return this.#audioContext;
            } catch {
                return null;
            }
        }

        async ensureContextIsRunning() {
            const context = await this.#getOrCreateAudioContext();
            if (!context) return null;

            if (context.state === 'suspended') {
                try {
                    await context.resume();
                } catch {}
            }
            return context.state === 'running' ? context : null;
        }

        #applyVolume(mediaElements, volume, context) {
            for (const media of mediaElements) {
                if (document.body.contains(media)) {
                    this.#setup(media);
                    const audioComponents = this.#sourceNodeMap.get(media);
                    audioComponents?.gainNode?.gain.setTargetAtTime(volume, context.currentTime, 0.05);
                }
            }
        }

        async updateAllVolumes(isActivated, multiplier) {
            const context = await this.ensureContextIsRunning();
            if (!context) return; 
            const volume = isActivated ? multiplier : 1.0;
            this.#applyVolume(this.#findAllMediaElements(document.documentElement), volume, context);
        }

        async processNewNodes(nodeList, isActivated, multiplier) {
            const context = await this.ensureContextIsRunning();
            if (!context || !nodeList?.length) return; 

            const newMediaElements = this.#findMediaInNodes(nodeList);
            if (newMediaElements.length === 0) return;

            const volume = isActivated ? multiplier : 1.0;
            this.#applyVolume(newMediaElements, volume, context);
        }

        cleanupRemovedNodes(nodeList) {
            if (!this.#sourceNodeMap.size || !nodeList?.length) return;

            for (const media of this.#findMediaInNodes(nodeList)) {
                if (this.#sourceNodeMap.has(media)) {
                    const { source, gainNode } = this.#sourceNodeMap.get(media);
                    try {
                        source.disconnect();
                        gainNode.disconnect();
                    } catch {}
                    this.#sourceNodeMap.delete(media);
                }
            }
        }

        #findMediaInNodes(nodeList) {
            const mediaElements = new Set();
            for (const node of nodeList) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                if (node.matches('video, audio')) mediaElements.add(node);
                node.querySelectorAll('video, audio').forEach(el => mediaElements.add(el));
            }
            return Array.from(mediaElements);
        }

        #setup(mediaElement) {
            if (!this.#audioContext || this.#sourceNodeMap.has(mediaElement)) return;
            try {
                const source = this.#audioContext.createMediaElementSource(mediaElement);
                const gainNode = this.#audioContext.createGain();
                source.connect(gainNode).connect(this.#audioContext.destination);
                this.#sourceNodeMap.set(mediaElement, { source, gainNode });
            } catch {}
        }

        #findAllMediaElements(rootNode) {
            const mediaElements = [];
            const nodesToScan = [rootNode];
            while (nodesToScan.length > 0) {
                const currentNode = nodesToScan.pop();
                mediaElements.push(...currentNode.querySelectorAll('video, audio'));
                currentNode.querySelectorAll('*').forEach(element => {
                    if (element.shadowRoot) nodesToScan.push(element.shadowRoot);
                });
            }
            return mediaElements;
        }
    }

    class SoundBooster {
        #isActivated = false;
        #audioProcessor = new AudioProcessor();
        #uiController = new UIController(
            this.#toggleActivation.bind(this),
            CONFIG.UI
        );
        #debouncedProcessNewNodes;

        constructor() {
            this.#debouncedProcessNewNodes = debounce(
                (nodes) => this.#audioProcessor.processNewNodes(nodes, this.#isActivated, CONFIG.VOLUME_MULTIPLIER),
                CONFIG.DEBOUNCE_DELAY
            );
        }

        init() {
            this.#uiController.create();
            window.addEventListener('keydown', this.#handleKeyDown.bind(this));
            this.#setupDOMObserver();
        }

        async #toggleActivation() {
            this.#audioProcessor.setUserInteracted();
            
            const context = await this.#audioProcessor.ensureContextIsRunning();
            if (!context) {
                const newContext = await this.#audioProcessor.ensureContextIsRunning();
                if(!newContext) return;
            }

            this.#isActivated = !this.#isActivated;
            const multiplier = CONFIG.VOLUME_MULTIPLIER;
            await this.#audioProcessor.updateAllVolumes(this.#isActivated, multiplier);
            this.#uiController.update(this.#isActivated, multiplier);
        }

        #handleKeyDown(e) {
            const activeEl = document.activeElement;
            const isInput = activeEl && (CONFIG.UI.IGNORED_TAGS.has(activeEl.tagName) || activeEl.isContentEditable);
            if (isInput || !e.altKey || e.key.toLowerCase() !== CONFIG.ACTIVATION_KEY) return;

            e.preventDefault();
            e.stopPropagation();
            this.#toggleActivation();
        }

        #setupDOMObserver() {
            const observer = new MutationObserver((mutationsList) => {
                const addedNodes = [];
                const removedNodes = [];
                for (const mutation of mutationsList) {
                    addedNodes.push(...mutation.addedNodes);
                    removedNodes.push(...mutation.removedNodes);
                }

                if (removedNodes.length > 0) this.#audioProcessor.cleanupRemovedNodes(removedNodes);
                if (addedNodes.length > 0) this.#debouncedProcessNewNodes(addedNodes);
            });

            observer.observe(document.documentElement, { childList: true, subtree: true });
        }
    }

    new SoundBooster().init();

})();