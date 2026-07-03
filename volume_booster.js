(function() {

    if (window.self !== window.top) {
        return;
    }

    'use strict';

    const CONFIG = {
        VOLUME_MULTIPLIER: 3.0,
        ACTIVATION_KEY: 'v',
        DEBOUNCE_DELAY: 200,
        SAFE_MEDIA_PROTOCOLS: new Set(['blob:', 'data:', 'mediastream:']),
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
            const uiHost = document.body || document.documentElement;
            if (!uiHost) return;
            uiHost.appendChild(this.#indicatorElement);

            this.#injectStyles();
            this.#indicatorElement.addEventListener('click', (e) => {
                if (!e.isTrusted) return;
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
        #sourceNodeMap = new WeakMap();
        #warnedUnsafeMedia = new WeakSet();
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

        #applyVolume(mediaElements, volume, context, allowNewSetup) {
            for (const media of mediaElements) {
                if (media.isConnected) {
                    const audioComponents = this.#setup(media, allowNewSetup);
                    audioComponents?.gainNode?.gain.setTargetAtTime(volume, context.currentTime, 0.05);
                }
            }
        }

        async updateAllVolumes(isActivated, multiplier) {
            const context = await this.ensureContextIsRunning();
            if (!context) return; 
            const volume = isActivated ? multiplier : 1.0;
            this.#applyVolume(
                this.#findAllMediaElements(document.documentElement),
                volume,
                context,
                isActivated
            );
        }

        async processNewNodes(nodeList, isActivated, multiplier) {
            const context = await this.ensureContextIsRunning();
            if (!context || !nodeList?.length) return; 

            const newMediaElements = this.#findMediaInNodes(nodeList);
            if (newMediaElements.length === 0) return;

            const volume = isActivated ? multiplier : 1.0;
            this.#applyVolume(newMediaElements, volume, context, isActivated);
        }

        cleanupRemovedNodes(nodeList) {
            if (!nodeList?.length) return;

            for (const media of this.#findMediaInNodes(nodeList)) {
                const audioComponents = this.#sourceNodeMap.get(media);
                if (audioComponents && !media.isConnected && audioComponents.connected) {
                    const { source, gainNode } = audioComponents;
                    try {
                        source.disconnect();
                        gainNode.disconnect();
                    } catch {}
                    audioComponents.connected = false;
                }
            }
        }

        #findMediaInNodes(nodeList) {
            const mediaElements = new Set();
            for (const node of nodeList) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                if (node.matches('video, audio')) mediaElements.add(node);
                if (node.matches('source') && node.parentElement?.matches('video, audio')) {
                    mediaElements.add(node.parentElement);
                }
                node.querySelectorAll('video, audio').forEach(el => mediaElements.add(el));
            }
            return Array.from(mediaElements);
        }

        #isSafeToRouteThroughWebAudio(mediaElement) {
            if (mediaElement.srcObject) return true;

            const sourceValue = mediaElement.currentSrc ||
                mediaElement.getAttribute('src') ||
                mediaElement.querySelector('source[src]')?.getAttribute('src');
            if (!sourceValue) return false;

            let mediaUrl;
            try {
                mediaUrl = new URL(sourceValue, document.baseURI);
            } catch {
                return false;
            }

            if (CONFIG.SAFE_MEDIA_PROTOCOLS.has(mediaUrl.protocol)) return true;
            if (mediaUrl.origin === window.location.origin) return true;

            // 명시적인 CORS 모드가 있는 미디어만 교차 출처 Web Audio 라우팅을 허용합니다.
            // CORS 없이 createMediaElementSource()를 사용하면 사양상 노드가 무음을 출력할 수 있습니다.
            return mediaElement.crossOrigin === 'anonymous' ||
                mediaElement.crossOrigin === 'use-credentials' ||
                mediaElement.hasAttribute('crossorigin');
        }

        #warnUnsafeMediaOnce(mediaElement) {
            if (this.#warnedUnsafeMedia.has(mediaElement)) return;
            this.#warnedUnsafeMedia.add(mediaElement);
            console.warn(
                'LunaTools: CORS가 확인되지 않은 교차 출처 미디어는 원본 오디오 보호를 위해 볼륨 부스터에서 제외했습니다.',
                mediaElement.currentSrc || mediaElement.getAttribute('src') || ''
            );
        }

        #setup(mediaElement, allowNewSetup) {
            if (!this.#audioContext) return null;

            const existingComponents = this.#sourceNodeMap.get(mediaElement);
            if (existingComponents) {
                if (!existingComponents.connected) {
                    try {
                        existingComponents.source.connect(existingComponents.gainNode);
                        existingComponents.gainNode.connect(this.#audioContext.destination);
                        existingComponents.connected = true;
                    } catch {}
                }
                return existingComponents;
            }

            if (!allowNewSetup) return null;

            if (!this.#isSafeToRouteThroughWebAudio(mediaElement)) {
                this.#warnUnsafeMediaOnce(mediaElement);
                return null;
            }

            try {
                const source = this.#audioContext.createMediaElementSource(mediaElement);
                const gainNode = this.#audioContext.createGain();
                source.connect(gainNode).connect(this.#audioContext.destination);
                const audioComponents = { source, gainNode, connected: true };
                this.#sourceNodeMap.set(mediaElement, audioComponents);
                return audioComponents;
            } catch {
                return null;
            }
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
        #pendingAddedNodes = new Set();

        constructor() {
            this.#debouncedProcessNewNodes = debounce(
                () => this.#flushPendingAddedNodes(),
                CONFIG.DEBOUNCE_DELAY
            );
        }

        #queueAddedNodes(nodes) {
            for (const node of nodes) this.#pendingAddedNodes.add(node);
            this.#debouncedProcessNewNodes();
        }

        async #flushPendingAddedNodes() {
            if (this.#pendingAddedNodes.size === 0) return;
            const nodes = Array.from(this.#pendingAddedNodes);
            this.#pendingAddedNodes.clear();
            await this.#audioProcessor.processNewNodes(nodes, this.#isActivated, CONFIG.VOLUME_MULTIPLIER);
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

        #isEditableEventTarget(target) {
            if (!(target instanceof Element)) return false;

            const editableElement = target.closest('input, textarea, select, [contenteditable], [role="textbox"]');
            if (!editableElement) return false;

            const tagName = editableElement.tagName?.toUpperCase();
            if (CONFIG.UI.IGNORED_TAGS.has(tagName)) return true;
            if (editableElement.getAttribute('role') === 'textbox') return true;

            const contentEditableValue = editableElement.getAttribute('contenteditable');
            return editableElement.isContentEditable ||
                (contentEditableValue !== null && contentEditableValue.toLowerCase() !== 'false');
        }

        #handleKeyDown(e) {
            if (!e.isTrusted) return;
            if (this.#isEditableEventTarget(e.target) || !e.altKey || e.key.toLowerCase() !== CONFIG.ACTIVATION_KEY) return;

            e.preventDefault();
            e.stopPropagation();
            this.#toggleActivation();
        }

        #setupDOMObserver() {
            const observer = new MutationObserver((mutationsList) => {
                const addedNodes = [];
                const removedNodes = [];
                for (const mutation of mutationsList) {
                    if (mutation.type === 'attributes') {
                        addedNodes.push(mutation.target);
                    } else {
                        addedNodes.push(...mutation.addedNodes);
                        removedNodes.push(...mutation.removedNodes);
                    }
                }

                if (removedNodes.length > 0) this.#audioProcessor.cleanupRemovedNodes(removedNodes);
                // Accumulate every mutation batch. A conventional debounce would
                // retain only the final batch and leave earlier dynamic media unboosted.
                if (addedNodes.length > 0) this.#queueAddedNodes(addedNodes);
            });

            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src', 'crossorigin']
            });
        }
    }

    new SoundBooster().init();

})();
