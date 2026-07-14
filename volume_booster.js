(function() {
    'use strict';

    if (window.self !== window.top) {
        return;
    }

    const CONFIG = {
        VOLUME_MULTIPLIER: 3.0,
        ACTIVATION_KEY: 'v',
        DEBOUNCE_DELAY: 200,
        MAX_PENDING_NODE_COUNT: 500,
        SAFE_MEDIA_PROTOCOLS: new Set(['blob:', 'data:', 'mediastream:']),
        UI: {
            INDICATOR_ID: 'sound-booster-indicator',
            VISIBLE_CLASS: 'sbi-visible',
            IGNORED_TAGS: new Set(['INPUT', 'TEXTAREA', 'SELECT']),
        }
    };


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
            const uiHost = document.body || document.documentElement;
            if (!uiHost) return;

            const existingOwnedIndicator = document.getElementById(this.#indicatorId);
            if (existingOwnedIndicator?.dataset?.lunatoolsVolumeBooster === 'indicator') {
                this.#indicatorElement = existingOwnedIndicator;
                this.update(false, 1);
                return;
            }

            if (existingOwnedIndicator) {
                this.#indicatorId = `${this.#indicatorId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            }

            this.#indicatorElement = document.createElement('div');
            this.#indicatorElement.id = this.#indicatorId;
            this.#indicatorElement.dataset.lunatoolsVolumeBooster = 'indicator';
            this.#indicatorElement.textContent = '🔊';
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
            const styleId = `${this.#indicatorId}-styles`;
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
        #disconnectedMediaRefs = new Set();
        #disconnectedMediaRefByElement = new WeakMap();
        #pendingDetachedCleanupByElement = new WeakMap();
        #pendingDetachedMediaRefs = new Set();
        #hasSetupMedia = false;
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
            this.#applyVolumeToDetachedMedia(volume, context);
        }

        #applyVolumeToDetachedMedia(volume, context) {
            for (const mediaRef of Array.from(this.#pendingDetachedMediaRefs)) {
                const mediaElement = mediaRef.deref();
                if (!mediaElement) {
                    this.#pendingDetachedMediaRefs.delete(mediaRef);
                    continue;
                }

                if (mediaElement.isConnected) {
                    this.#cancelPendingDetachedCleanup(mediaElement);
                }

                const audioComponents = this.#sourceNodeMap.get(mediaElement);
                if (audioComponents?.connected) {
                    audioComponents.gainNode.gain.setTargetAtTime(volume, context.currentTime, 0.05);
                }
            }
        }

        async processNewNodes(nodeList, isActivated, multiplier) {
            const context = await this.ensureContextIsRunning();
            if (!context || !nodeList?.length) return; 

            const newMediaElements = this.#findMediaInNodes(nodeList);
            if (newMediaElements.length === 0) return;

            const volume = isActivated ? multiplier : 1.0;
            this.#applyVolume(newMediaElements, volume, context, isActivated);
        }

        handleAddedNodes(nodeList, isActivated, multiplier) {
            if (!this.#hasSetupMedia || !this.#audioContext || !nodeList?.length) return;

            const volume = isActivated ? multiplier : 1.0;
            for (const media of this.#findMediaInNodes(nodeList)) {
                if (!media.isConnected) continue;

                this.#cancelPendingDetachedCleanup(media);
                const audioComponents = this.#setup(media, false);
                if (audioComponents?.connected) {
                    audioComponents.gainNode.gain.setTargetAtTime(volume, this.#audioContext.currentTime, 0.05);
                }
            }
        }

        #trackDisconnectedMedia(mediaElement) {
            if (this.#disconnectedMediaRefByElement.has(mediaElement)) return;
            const mediaRef = new WeakRef(mediaElement);
            this.#disconnectedMediaRefByElement.set(mediaElement, mediaRef);
            this.#disconnectedMediaRefs.add(mediaRef);
        }

        #forgetDisconnectedMedia(mediaElement) {
            const mediaRef = this.#disconnectedMediaRefByElement.get(mediaElement);
            if (!mediaRef) return;
            this.#disconnectedMediaRefs.delete(mediaRef);
            this.#disconnectedMediaRefByElement.delete(mediaElement);
        }

        async reconnectDisconnectedMedia() {
            if (!this.#hasSetupMedia || this.#disconnectedMediaRefs.size === 0) return;

            const context = await this.#getOrCreateAudioContext();
            if (!context) return;

            // 추가된 DOM 전체를 다시 스캔하지 않고, 실제로 끊겼던 소수의 미디어만 확인합니다.
            for (const mediaRef of Array.from(this.#disconnectedMediaRefs)) {
                const mediaElement = mediaRef.deref();
                if (!mediaElement) {
                    this.#disconnectedMediaRefs.delete(mediaRef);
                    continue;
                }
                if (!mediaElement.isConnected) continue;

                const audioComponents = this.#setup(mediaElement, false);
                if (audioComponents?.connected) {
                    audioComponents.gainNode.gain.setTargetAtTime(1.0, context.currentTime, 0.05);
                    this.#forgetDisconnectedMedia(mediaElement);
                }
            }
        }

        #cancelPendingDetachedCleanup(mediaElement) {
            const pendingCleanup = this.#pendingDetachedCleanupByElement.get(mediaElement);
            if (!pendingCleanup) return;

            mediaElement.removeEventListener('pause', pendingCleanup.cleanup);
            mediaElement.removeEventListener('ended', pendingCleanup.cleanup);
            this.#pendingDetachedMediaRefs.delete(pendingCleanup.mediaRef);
            this.#pendingDetachedCleanupByElement.delete(mediaElement);
        }

        #disconnectMedia(mediaElement, audioComponents) {
            if (!audioComponents?.connected) return;

            this.#cancelPendingDetachedCleanup(mediaElement);
            const { source, gainNode } = audioComponents;
            try {
                source.disconnect();
                gainNode.disconnect();
            } catch {}
            audioComponents.connected = false;
            this.#trackDisconnectedMedia(mediaElement);
        }

        #scheduleDetachedCleanup(mediaElement, audioComponents) {
            if (this.#pendingDetachedCleanupByElement.has(mediaElement)) return;

            const cleanup = () => {
                if (mediaElement.isConnected) {
                    this.#cancelPendingDetachedCleanup(mediaElement);
                    return;
                }
                if (!mediaElement.paused && !mediaElement.ended) return;

                this.#disconnectMedia(mediaElement, audioComponents);
            };

            const mediaRef = new WeakRef(mediaElement);
            this.#pendingDetachedCleanupByElement.set(mediaElement, { cleanup, mediaRef });
            this.#pendingDetachedMediaRefs.add(mediaRef);
            mediaElement.addEventListener('pause', cleanup);
            mediaElement.addEventListener('ended', cleanup);

            // 제거 직후 상태가 바뀐 경우에도 pause/ended 이벤트를 놓치지 않습니다.
            if (mediaElement.paused || mediaElement.ended) cleanup();
        }

        cleanupRemovedNodes(nodeList) {
            if (!this.#hasSetupMedia || !nodeList?.length) return;

            for (const media of this.#findMediaInNodes(nodeList)) {
                const audioComponents = this.#sourceNodeMap.get(media);
                if (audioComponents && !media.isConnected && audioComponents.connected) {
                    if (!media.paused && !media.ended) {
                        this.#scheduleDetachedCleanup(media, audioComponents);
                    } else {
                        this.#disconnectMedia(media, audioComponents);
                    }
                }
            }
        }

        #findMediaInNodes(nodeList) {
            const mediaElements = new Set();
            for (const node of nodeList) {
                this.#findAllMediaElements(node).forEach(media => mediaElements.add(media));
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
                        this.#forgetDisconnectedMedia(mediaElement);
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
                this.#hasSetupMedia = true;
                this.#sourceNodeMap.set(mediaElement, audioComponents);
                return audioComponents;
            } catch {
                return null;
            }
        }

        #findAllMediaElements(rootNode) {
            const mediaElements = new Set();
            const nodesToScan = [rootNode];
            const queuedShadowRoots = new WeakSet();

            const collectElement = (element) => {
                if (!element?.matches) return;

                if (element.matches('video, audio')) mediaElements.add(element);
                if (element.matches('source') && element.parentElement?.matches('video, audio')) {
                    mediaElements.add(element.parentElement);
                }
                if (element.shadowRoot && !queuedShadowRoots.has(element.shadowRoot)) {
                    queuedShadowRoots.add(element.shadowRoot);
                    nodesToScan.push(element.shadowRoot);
                }
            };

            while (nodesToScan.length > 0) {
                const currentNode = nodesToScan.pop();
                if (!currentNode) continue;

                const isScannableRoot = currentNode.nodeType === Node.DOCUMENT_NODE ||
                    currentNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE ||
                    currentNode.nodeType === Node.ELEMENT_NODE;
                if (!isScannableRoot) continue;

                if (currentNode.nodeType === Node.ELEMENT_NODE) collectElement(currentNode);

                const treeWalker = document.createTreeWalker(currentNode, NodeFilter.SHOW_ELEMENT);
                let element = treeWalker.nextNode();
                while (element) {
                    collectElement(element);
                    element = treeWalker.nextNode();
                }
            }

            return Array.from(mediaElements);
        }
    }

    class SoundBooster {
        #isActivated = false;
        #audioProcessor = new AudioProcessor();
        #uiController = new UIController(
            this.#toggleActivation.bind(this),
            CONFIG.UI
        );
        #pendingAddedNodes = new Set();
        #pendingScanTimer = null;
        #isFlushingPendingNodes = false;
        #needsFullDocumentScan = false;
        #toggleInProgress = false;

        #queueAddedNodes(nodes) {
            for (const node of nodes) {
                if (!this.#shouldQueueAddedNode(node)) continue;

                if (this.#pendingAddedNodes.size >= CONFIG.MAX_PENDING_NODE_COUNT) {
                    this.#pendingAddedNodes.clear();
                    this.#needsFullDocumentScan = true;
                    break;
                }
                this.#pendingAddedNodes.add(node);
            }

            if (this.#pendingAddedNodes.size > 0 || this.#needsFullDocumentScan) {
                this.#schedulePendingNodeScan();
            }
        }

        #shouldQueueAddedNode(node) {
            return node?.nodeType === Node.ELEMENT_NODE ||
                node?.nodeType === Node.DOCUMENT_FRAGMENT_NODE ||
                node?.nodeType === Node.DOCUMENT_NODE;
        }

        #shouldQueueAttributeTarget(target) {
            return target instanceof Element && target.matches('video, audio, source');
        }

        #schedulePendingNodeScan() {
            if (this.#pendingScanTimer !== null || this.#isFlushingPendingNodes) return;

            this.#pendingScanTimer = window.setTimeout(() => {
                this.#pendingScanTimer = null;
                this.#flushPendingAddedNodes();
            }, CONFIG.DEBOUNCE_DELAY);
        }

        #clearPendingNodeScan() {
            if (this.#pendingScanTimer !== null) {
                clearTimeout(this.#pendingScanTimer);
                this.#pendingScanTimer = null;
            }
            this.#pendingAddedNodes.clear();
            this.#needsFullDocumentScan = false;
        }

        async #flushPendingAddedNodes() {
            if (this.#isFlushingPendingNodes) return;
            if (!this.#isActivated) {
                this.#clearPendingNodeScan();
                return;
            }
            if (this.#pendingAddedNodes.size === 0 && !this.#needsFullDocumentScan) return;

            this.#isFlushingPendingNodes = true;
            try {
                if (this.#needsFullDocumentScan) {
                    this.#pendingAddedNodes.clear();
                    this.#needsFullDocumentScan = false;
                    await this.#audioProcessor.updateAllVolumes(this.#isActivated, CONFIG.VOLUME_MULTIPLIER);
                } else {
                    const nodes = Array.from(this.#pendingAddedNodes);
                    this.#pendingAddedNodes.clear();
                    await this.#audioProcessor.processNewNodes(nodes, this.#isActivated, CONFIG.VOLUME_MULTIPLIER);
                }
            } finally {
                this.#isFlushingPendingNodes = false;
                if ((this.#pendingAddedNodes.size > 0 || this.#needsFullDocumentScan) && this.#isActivated) {
                    this.#schedulePendingNodeScan();
                }
            }
        }

        init() {
            this.#uiController.create();
            window.addEventListener('keydown', this.#handleKeyDown.bind(this));
            this.#setupDOMObserver();
        }

        async #toggleActivation() {
            if (this.#toggleInProgress) return;
            this.#toggleInProgress = true;

            try {
                this.#audioProcessor.setUserInteracted();
                
                const context = await this.#audioProcessor.ensureContextIsRunning();
                if (!context) {
                    const newContext = await this.#audioProcessor.ensureContextIsRunning();
                    if(!newContext) return;
                }

                this.#isActivated = !this.#isActivated;
                const multiplier = CONFIG.VOLUME_MULTIPLIER;
                await this.#audioProcessor.updateAllVolumes(this.#isActivated, multiplier);
                if (!this.#isActivated) this.#clearPendingNodeScan();
                this.#uiController.update(this.#isActivated, multiplier);
            } finally {
                this.#toggleInProgress = false;
            }
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
            if (!e.isTrusted || e.repeat) return;
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
                        if (this.#shouldQueueAttributeTarget(mutation.target)) {
                            addedNodes.push(mutation.target);
                        }
                    } else {
                        addedNodes.push(...mutation.addedNodes);
                        removedNodes.push(...mutation.removedNodes);
                    }
                }

                if (removedNodes.length > 0) this.#audioProcessor.cleanupRemovedNodes(removedNodes);
                if (addedNodes.length > 0) {
                    this.#audioProcessor.handleAddedNodes(
                        addedNodes,
                        this.#isActivated,
                        CONFIG.VOLUME_MULTIPLIER
                    );
                    if (this.#isActivated) {
                        this.#queueAddedNodes(addedNodes);
                    } else {
                        // 일시정지/종료 후 정리된 요소가 OFF 상태에서 재삽입되어도
                        // 끊긴 graph와 기본 gain을 즉시 복구합니다.
                        void this.#audioProcessor.reconnectDisconnectedMedia().catch(() => {});
                    }
                }
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
