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
        MAX_SCAN_SLICE_MS: 8,
        MAX_SCAN_SLICE_ELEMENTS: 250,
        SAFE_MEDIA_PROTOCOLS: new Set(['blob:', 'data:', 'mediastream:']),
        UI: {
            INDICATOR_ID: 'sound-booster-indicator',
            VISIBLE_CLASS: 'sbi-visible',
            IGNORED_TAGS: new Set(['INPUT', 'TEXTAREA', 'SELECT']),
        }
    };


    // 하나의 MutationObserver 배치에 부모와 자손이 함께 들어와도 각 하위
    // 트리는 한 번만 방문합니다. 이미 방문한 요소는 자손까지 건너뜁니다.
    async function visitElementsOnce(rootNodes, visit, isCancelled = () => false) {
        const roots = Array.from(rootNodes || []);
        const visited = new WeakSet();
        let sliceStartedAt = performance.now();
        let sliceElements = 0;
        const collect = element => {
            visit(element);
            if (element.shadowRoot) roots.push(element.shadowRoot);
        };
        for (let index = 0; index < roots.length; index += 1) {
            if (isCancelled()) return false;
            const root = roots[index];
            if (!root?.isConnected || visited.has(root) || ![Node.DOCUMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE, Node.ELEMENT_NODE].includes(root.nodeType)) continue;
            visited.add(root);
            if (root.nodeType === Node.ELEMENT_NODE) {
                collect(root);
                sliceElements++;
            }
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
                acceptNode: element => visited.has(element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
            });
            let element;
            while ((element = walker.nextNode())) {
                if (isCancelled()) return false;
                // A yielded scan can outlive removal of its subtree. Do not
                // rediscover detached ShadowRoots after the removal observer
                // has already pruned them, or retain them until another removal.
                if (!root.isConnected) break;
                if (!element.isConnected) continue;
                visited.add(element);
                collect(element);
                sliceElements++;
                if (sliceElements >= CONFIG.MAX_SCAN_SLICE_ELEMENTS ||
                    performance.now() - sliceStartedAt >= CONFIG.MAX_SCAN_SLICE_MS) {
                    // A microtask alone does not let input/rendering run. Yield
                    // to a new task even when one added subtree is very large.
                    await new Promise(resolve => setTimeout(resolve, 0));
                    if (isCancelled()) return false;
                    sliceElements = 0;
                    sliceStartedAt = performance.now();
                }
            }
            // Many separate leaf roots must obey the same budget as a subtree.
            if (sliceElements >= CONFIG.MAX_SCAN_SLICE_ELEMENTS ||
                performance.now() - sliceStartedAt >= CONFIG.MAX_SCAN_SLICE_MS) {
                await new Promise(resolve => setTimeout(resolve, 0));
                if (isCancelled()) return false;
                sliceElements = 0;
                sliceStartedAt = performance.now();
            }
        }
        return !isCancelled();
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

            // 사이트의 pointer-events/display !important 규칙이 있어도 OFF의
            // 투명한 표시기가 페이지 입력을 가로채지 않도록 합니다.
            this.#indicatorElement.inert = !isActivated;
            this.#indicatorElement.style.setProperty('display', isActivated ? 'flex' : 'none', 'important');
            this.#indicatorElement.style.setProperty('pointer-events', isActivated ? 'auto' : 'none', 'important');
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
                #${this.#indicatorId} {
                    --lunatools-sbi-size: 40px;
                    --lunatools-sbi-bg-color: rgba(255, 255, 255, 0.2);
                    --lunatools-sbi-border-color: rgba(255, 255, 255, 0.4);
                    --lunatools-sbi-icon-color: rgba(0, 0, 0, 0.7);
                    --lunatools-sbi-font-size: 24px;
                    --lunatools-sbi-scale-initial: 0.9;
                    --lunatools-sbi-scale-hover: 1.08;
                    --lunatools-sbi-scale-active: 1.02;
                    position: fixed; bottom: 25px; right: 25px;
                    width: var(--lunatools-sbi-size); height: var(--lunatools-sbi-size);
                    background: var(--lunatools-sbi-bg-color);
                    border: 1px solid var(--lunatools-sbi-border-color);
                    color: var(--lunatools-sbi-icon-color);
                    font-size: var(--lunatools-sbi-font-size);
                    backdrop-filter: blur(12px) saturate(180%);
                    -webkit-backdrop-filter: blur(12px) saturate(180%);
                    border-radius: 50%;
                    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
                    display: flex; justify-content: center; align-items: center;
                    z-index: 2147483647;
                    user-select: none;
                    opacity: 0; transform: scale(var(--lunatools-sbi-scale-initial)) translateY(10px);
                    pointer-events: none; transition: opacity 0.3s ease-out, transform 0.3s ease-out;
                    cursor: pointer;
                }
                @media (prefers-color-scheme: dark) {
                    #${this.#indicatorId} {
                        --lunatools-sbi-bg-color: rgba(0, 0, 0, 0.3);
                        --lunatools-sbi-border-color: rgba(255, 255, 255, 0.3);
                        --lunatools-sbi-icon-color: rgba(255, 255, 255, 0.8);
                    }
                }
                #${this.#indicatorId}.${this.#visibleClass} { opacity: 1; transform: scale(1) translateY(0); pointer-events: auto; }
                #${this.#indicatorId}:hover { transform: scale(var(--lunatools-sbi-scale-hover)); }
                #${this.#indicatorId}:active { transform: scale(var(--lunatools-sbi-scale-active)); }
            `;
            (document.head || document.documentElement).appendChild(style);
        }
    }

    class AudioProcessor {
        #audioContext = null;
        #sourceNodeMap = new WeakMap();
        #trackedMediaRefs = new Set();
        #volumeUpdateGeneration = 0;
        #warnedUnsafeMedia = new WeakSet();
        #disconnectedMediaRefs = new Set();
        #disconnectedMediaRefByElement = new WeakMap();
        #disconnectedMediaPlayHandlerByElement = new WeakMap();
        #pendingDetachedCleanupByElement = new WeakMap();
        #pendingDetachedMediaRefs = new Set();
        #hasSetupMedia = false;
        #userHasInteracted = false; 
        #targetVolume = 1.0;
        #allowNewSetup = false;

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

        setDesiredActivation(isActivated, multiplier) {
            this.#volumeUpdateGeneration++;
            this.#targetVolume = isActivated ? multiplier : 1.0;
            this.#allowNewSetup = isActivated;
        }

        async updateAllVolumes(isActivated, multiplier) {
            // 비동기 AudioContext 재개가 역순으로 끝나더라도 마지막 사용자 상태를 적용합니다.
            this.setDesiredActivation(isActivated, multiplier);
            const generation = this.#volumeUpdateGeneration;
            this.#pruneDeadMediaRefs();

            const context = await this.ensureContextIsRunning();
            if (!context || generation !== this.#volumeUpdateGeneration) return false;
            const volume = this.#targetVolume;
            // OFF must restore all routed media immediately, including media
            // later in a huge document. It must not depend on a cancellable scan.
            for (const mediaRef of this.#trackedMediaRefs) {
                const media = mediaRef.deref();
                if (media?.isConnected) this.#applyVolume([media], volume, context, false);
            }
            this.#applyVolumeToDetachedMedia(volume, context);
            if (!isActivated) return true;

            const isCancelled = () => generation !== this.#volumeUpdateGeneration;
            await this.#processMediaInNodes([document.documentElement], context, isCancelled);
            if (isCancelled()) return false;
            return true;
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

        async processNewNodes(nodeList) {
            const generation = this.#volumeUpdateGeneration;
            const context = await this.ensureContextIsRunning();
            if (!context || !nodeList?.length || generation !== this.#volumeUpdateGeneration) return;

            const isCancelled = () => generation !== this.#volumeUpdateGeneration || !this.#allowNewSetup;
            await this.#processMediaInNodes(nodeList, context, isCancelled);
        }

        handleAddedNodes(nodeList) {
            if (!nodeList?.length) return;
            this.#pruneDeadMediaRefs();
            if (!this.#hasSetupMedia || !this.#audioContext) return;

            // Reinsertions only need attention for media already tracked by this
            // processor. Walking every descendant of every added DOM subtree here
            // duplicated the debounced new-media scan and could synchronously stall
            // large SPAs even after the booster had been turned off.
            const trackedRefs = new Set([
                ...this.#pendingDetachedMediaRefs,
                ...this.#disconnectedMediaRefs
            ]);
            for (const mediaRef of trackedRefs) {
                const media = mediaRef.deref();
                if (!media || !media.isConnected) continue;

                this.#cancelPendingDetachedCleanup(media);
                const audioComponents = this.#setup(media, false);
                if (audioComponents?.connected) {
                    audioComponents.gainNode.gain.setTargetAtTime(
                        this.#targetVolume,
                        this.#audioContext.currentTime,
                        0.05
                    );
                }
            }
        }

        #pruneDeadMediaRefs() {
            for (const mediaRef of this.#trackedMediaRefs) {
                if (!mediaRef.deref()) this.#trackedMediaRefs.delete(mediaRef);
            }
            for (const mediaRef of Array.from(this.#disconnectedMediaRefs)) {
                if (!mediaRef.deref()) this.#disconnectedMediaRefs.delete(mediaRef);
            }
            for (const mediaRef of Array.from(this.#pendingDetachedMediaRefs)) {
                if (!mediaRef.deref()) this.#pendingDetachedMediaRefs.delete(mediaRef);
            }
        }

        #trackDisconnectedMedia(mediaElement) {
            if (this.#disconnectedMediaRefByElement.has(mediaElement)) return;
            const mediaRef = new WeakRef(mediaElement);
            const handlePlay = () => {
                // HTMLMediaElement can keep playing while detached from the DOM.
                // Reconnect the existing graph when a site reuses that same
                // element so cleanup never turns later playback permanently silent.
                this.#reconnectDisconnectedMediaElement(mediaElement);
            };
            this.#disconnectedMediaRefByElement.set(mediaElement, mediaRef);
            this.#disconnectedMediaPlayHandlerByElement.set(mediaElement, handlePlay);
            this.#disconnectedMediaRefs.add(mediaRef);
            mediaElement.addEventListener('play', handlePlay);
        }

        #forgetDisconnectedMedia(mediaElement) {
            const mediaRef = this.#disconnectedMediaRefByElement.get(mediaElement);
            if (!mediaRef) return;
            const handlePlay = this.#disconnectedMediaPlayHandlerByElement.get(mediaElement);
            if (handlePlay) {
                mediaElement.removeEventListener('play', handlePlay);
                this.#disconnectedMediaPlayHandlerByElement.delete(mediaElement);
            }
            this.#disconnectedMediaRefs.delete(mediaRef);
            this.#disconnectedMediaRefByElement.delete(mediaElement);
        }

        #reconnectDisconnectedMediaElement(mediaElement) {
            const context = this.#audioContext;
            if (!context) return false;

            const audioComponents = this.#setup(mediaElement, false);
            if (!audioComponents?.connected) return false;

            audioComponents.gainNode.gain.setTargetAtTime(
                this.#targetVolume,
                context.currentTime,
                0.05
            );
            // A replay can begin before the site puts this element back in the
            // document. Keep it in the detached-media lifecycle so later ON/OFF
            // changes reach its gain and pause/ended can disconnect it again.
            if (!mediaElement.isConnected) {
                this.#scheduleDetachedCleanup(mediaElement, audioComponents);
            }
            if (context.state === 'suspended') {
                void this.ensureContextIsRunning();
            }
            return true;
        }

        async reconnectDisconnectedMedia() {
            this.#pruneDeadMediaRefs();
            if (!this.#hasSetupMedia || this.#disconnectedMediaRefs.size === 0) return;

            if (!(await this.#getOrCreateAudioContext())) return;

            // 추가된 DOM 전체를 다시 스캔하지 않고, 실제로 끊겼던 소수의 미디어만 확인합니다.
            for (const mediaRef of Array.from(this.#disconnectedMediaRefs)) {
                const mediaElement = mediaRef.deref();
                if (!mediaElement) {
                    this.#disconnectedMediaRefs.delete(mediaRef);
                    continue;
                }
                // A detached media element is still playable. The play listener
                // normally reconnects it immediately; this branch also recovers
                // it if another DOM mutation is observed after playback starts.
                if (!mediaElement.isConnected && mediaElement.paused) continue;
                this.#reconnectDisconnectedMediaElement(mediaElement);
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
            if (!nodeList?.length) return;
            this.#pruneDeadMediaRefs();
            if (!this.#hasSetupMedia) return;

            // DOM removal can include hundreds of thousands of unrelated nodes,
            // even while OFF. Only our already-routed media need cleanup.
            for (const mediaRef of this.#trackedMediaRefs) {
                const media = mediaRef.deref();
                if (!media) continue;
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

        async #processMediaInNodes(nodeList, context, isCancelled = () => false) {
            const processedMedia = new WeakSet();
            await visitElementsOnce(nodeList, element => {
                let media = element.matches('video, audio') ? element : null;
                if (element.matches('source') && element.parentElement?.matches('video, audio')) {
                    media = element.parentElement;
                }
                if (!media || processedMedia.has(media)) return;
                processedMedia.add(media);
                // Graph creation is part of the bounded scan as well; do not
                // collect thousands of media and route them in one final task.
                this.#applyVolume([media], this.#targetVolume, context, this.#allowNewSetup);
            }, isCancelled);
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
                this.#trackedMediaRefs.add(new WeakRef(mediaElement));
                return audioComponents;
            } catch {
                return null;
            }
        }

    }

    class SoundBooster {
        #isActivated = false;
        #requestedActivation = false;
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
        #domObserver = null;
        #observedMutationRoots = new Set();
        #boundHandleMediaReady = this.#handleMediaReady.bind(this);

        #handleMediaReady(event) {
            const mediaElement = event?.target;
            if (!this.#requestedActivation || !(mediaElement instanceof Element) || !mediaElement.matches('video, audio')) {
                return;
            }

            // Assigning srcObject does not create a DOM/attribute mutation.
            // Reuse the existing debounced path when metadata confirms that a
            // dynamically attached MediaStream is ready, without adding polling.
            this.#audioProcessor.handleAddedNodes([mediaElement]);
            this.#queueAddedNodes([mediaElement]);
        }

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

        #observeMutationRootWithObserver(rootNode) {
            this.#domObserver.observe(rootNode, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src', 'crossorigin']
            });
        }

        #observeMutationRoot(rootNode) {
            if (!this.#domObserver || !rootNode?.isConnected || this.#observedMutationRoots.has(rootNode)) return;

            this.#observeMutationRootWithObserver(rootNode);
            rootNode.addEventListener('loadedmetadata', this.#boundHandleMediaReady, true);
            this.#observedMutationRoots.add(rootNode);
        }

        #pruneDetachedMutationRoots() {
            if (!this.#domObserver || this.#observedMutationRoots.size === 0) return;

            let removedObservedRoot = false;
            for (const rootNode of Array.from(this.#observedMutationRoots)) {
                if (!(rootNode instanceof ShadowRoot) || rootNode.host?.isConnected) continue;
                rootNode.removeEventListener('loadedmetadata', this.#boundHandleMediaReady, true);
                this.#observedMutationRoots.delete(rootNode);
                removedObservedRoot = true;
            }
            if (!removedObservedRoot) return;

            // MutationObserver has no per-target unobserve(). Disconnect once
            // only when an observed ShadowRoot actually became detached, then
            // immediately re-register the still-live roots. This prevents an
            // unbounded list of detached SPA ShadowRoots from being retained.
            this.#domObserver.disconnect();
            for (const rootNode of this.#observedMutationRoots) {
                this.#observeMutationRootWithObserver(rootNode);
            }
        }

        async #observeOpenShadowRoots(rootNodes) {
            return visitElementsOnce(rootNodes, element => {
                if (element.shadowRoot) this.#observeMutationRoot(element.shadowRoot);
            }, () => !this.#requestedActivation);
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
                // Keep mutations received during the first asynchronous ON scan.
                // They are processed once activation has finished.
                if (!this.#requestedActivation) this.#clearPendingNodeScan();
                return;
            }
            if (this.#pendingAddedNodes.size === 0 && !this.#needsFullDocumentScan) return;

            this.#isFlushingPendingNodes = true;
            try {
                if (this.#needsFullDocumentScan) {
                    this.#pendingAddedNodes.clear();
                    this.#needsFullDocumentScan = false;
                    await this.#observeOpenShadowRoots([document.documentElement]);
                    if (!this.#requestedActivation) return;
                    await this.#audioProcessor.updateAllVolumes(this.#isActivated, CONFIG.VOLUME_MULTIPLIER);
                } else {
                    const nodes = Array.from(this.#pendingAddedNodes);
                    this.#pendingAddedNodes.clear();
                    await this.#observeOpenShadowRoots(nodes);
                    if (!this.#requestedActivation) return;
                    await this.#audioProcessor.processNewNodes(nodes);
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
        }

        async #toggleActivation() {
            // 비동기 전환 중의 추가 입력도 버리지 않고 마지막 요청 상태를 보존합니다.
            this.#requestedActivation = !this.#requestedActivation;
            this.#audioProcessor.setDesiredActivation(this.#requestedActivation, CONFIG.VOLUME_MULTIPLIER);
            if (this.#toggleInProgress) return;
            this.#toggleInProgress = true;

            try {
                this.#audioProcessor.setUserInteracted();

                // A cancelled ON scan may already have boosted some media even
                // though #isActivated is still false. Always apply the latest
                // request once more after cancellation, including OFF -> OFF.
                while (true) {
                    const context = await this.#audioProcessor.ensureContextIsRunning();
                    if (!context) {
                        this.#requestedActivation = this.#isActivated;
                        return;
                    }

                    const targetActivation = this.#requestedActivation;
                    // 최초 활성화에서 관찰을 시작하고, OFF 동안 새로 생긴
                    // ShadowRoot는 다음 ON 전환 때 한 번만 다시 발견합니다.
                    // OFF 상태의 매 DOM 삽입마다 대형 하위 트리를 순회하지 않습니다.
                    if (targetActivation) {
                        if (!this.#domObserver) {
                            this.#setupDOMObserver();
                        }
                        await this.#observeOpenShadowRoots([document.documentElement]);
                    }
                    if (targetActivation !== this.#requestedActivation) continue;

                    const multiplier = CONFIG.VOLUME_MULTIPLIER;
                    const applied = await this.#audioProcessor.updateAllVolumes(targetActivation, multiplier);
                    if (!applied) continue;
                    this.#isActivated = targetActivation;
                    if (!this.#isActivated) this.#clearPendingNodeScan();
                    this.#uiController.update(this.#isActivated, multiplier);
                    if (this.#isActivated && (this.#pendingAddedNodes.size || this.#needsFullDocumentScan)) {
                        this.#schedulePendingNodeScan();
                    }
                    if (this.#isActivated === this.#requestedActivation) break;
                }
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
            if (!e.isTrusted || e.repeat || e.defaultPrevented || e.isComposing || e.ctrlKey || e.shiftKey || e.metaKey) return;
            if (!e.altKey || e.key.toLowerCase() !== CONFIG.ACTIVATION_KEY || lunaToolsIsProtectedInputEvent(e)) return;

            e.preventDefault();
            e.stopPropagation();
            this.#toggleActivation();
        }

        #setupDOMObserver() {
            if (this.#domObserver) return;

            this.#domObserver = new MutationObserver((mutationsList) => {
                const addedNodes = [];
                const removedNodes = [];
                for (const mutation of mutationsList) {
                    if (mutation.type === 'attributes') {
                        if (this.#shouldQueueAttributeTarget(mutation.target)) {
                            addedNodes.push(mutation.target);
                        }
                    } else {
                        // 대량의 노드를 인자로 펼칠 때 엔진의 인자 개수 제한을 넘지 않게 합니다.
                        for (const node of mutation.addedNodes) addedNodes.push(node);
                        for (const node of mutation.removedNodes) removedNodes.push(node);
                    }
                }

                // OFF 상태에서는 새 DOM의 ShadowRoot/하위 요소를 매번 전수
                // 순회하지 않습니다. 기존에 처리했던 미디어 재삽입만 추적하고,
                // 다음 ON 전환 때 문서의 열린 ShadowRoot를 한 번 재동기화합니다.
                if (removedNodes.length > 0) {
                    this.#audioProcessor.cleanupRemovedNodes(removedNodes);
                    this.#pruneDetachedMutationRoots();
                }
                if (addedNodes.length > 0) {
                    this.#audioProcessor.handleAddedNodes(addedNodes);
                    if (this.#requestedActivation) {
                        this.#queueAddedNodes(addedNodes);
                    }
                }
            });

            // Observe the stable Document node so replacing documentElement cannot
            // strand the observer on a detached root. Open ShadowRoots are added
            // separately as they are discovered.
            this.#observeMutationRoot(document);
        }
    }

    new SoundBooster().init();

})();
