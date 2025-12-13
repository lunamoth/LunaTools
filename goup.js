goup.js(function () {
    'use strict';

    // 악의적인 스크립트가 URL이나 location 등을 덮어씌웠을 경우를 대비해 네이티브 함수 캐싱
    const OriginalURL = URL;
    const originalLocation = window.location;
    const { assign: locationAssign } = window.location;
    const documentCreateElement = document.createElement.bind(document);
    const elementMatches = Element.prototype.matches;

    const CONFIG = Object.freeze({
        // 1. PSL(Public Suffix List) 모방 및 PaaS/Cloud 도메인 보강
        // 2단계 도메인(co.kr) 뿐만 아니라 github.io, s3.amazonaws.com 등도 하나의 TLD처럼 취급
        CC_SLDS: new Set([
            'co', 'ac', 'go', 'or', 'ne', 're', 'pe', 'com', 'net', 'org', 'edu',
            'gov', 'mil', 'int', 'school', 'biz', 'info', 'pro', 'museum', 'aero',
            'gen', 'id', 'in', 'firm', 'law', 'pol', 'lib', 'shop', 'club', 'site',
            'news', 'blog', 'app', 'xyz', 'io', 'dev', 'jp', 'kr', 'cn', 'tw', 'hk',
            'sg', 'my', 'uk', 'au', 'nz', 'art', 'design', 'online', 'store', 'tech',
            'media', 'tv', 'fm', 'io', 'me',
            // Cloud/PaaS Provider Suffixes
            'github', 'gitlab', 'vercel', 'netlify', 'herokuapp', 'amazonaws', 'azurewebsites',
            'google', 'tistory', 'blogspot', 'wordpress'
        ]),
        ALLOWED_PROTOCOLS: new Set(['http:', 'https:']),
        MIN_SEGMENTS: 2,
        KEYS: { UP: 'ArrowUp' },
        
        // CSS Selector 최적화: 자주 사용되는 클래스명을 단순 문자열 체크로 먼저 필터링
        // 복잡한 에디터 컨테이너
        EDITOR_SELECTOR: '.monaco-editor, .codemirror, .ace_editor, .notion-page-content, .prosemirror, .kix-appview-editor, .docs-gm, [class*="Editor"], [class*="editor"]',
        
        // 무시할 Role 목록
        IGNORED_ROLES: new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'grid', 'treegrid', 'menuitem', 'application']),
        
        // 빠른 태그 검사 목록 (대문자)
        INPUT_TAGS: new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT']),
        
        REGEX: {
            IPV4: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
            // 일반적인 국가별 2단계 도메인 패턴
            CC_SLD_FALLBACK: /^(?:co|com|org|net|gov|edu|mil|ac)$/,
            HASH_PATH: /^#!?\/+/,
            // Javascript 프로토콜 등 위험한 패턴 차단
            UNSAFE_PROTOCOL: /^\s*(?:javascript|data|vbscript):/i
        }
    });

    class UrlUtils {
        static isTwoLevel(hostname) {
            const parts = hostname.split('.');
            if (parts.length < 3) return false;
            
            const tld = parts[parts.length - 1];
            const sld = parts[parts.length - 2];

            // 1. 설정된 목록(SLD/PaaS)에 포함되는지 확인
            if (CONFIG.CC_SLDS.has(sld.toLowerCase())) return true;

            // 2. 2글자 TLD인 경우 (국가 도메인) 일반적인 패턴인지 확인
            if (tld.length === 2) {
                return CONFIG.REGEX.CC_SLD_FALLBACK.test(sld);
            }
            return false;
        }

        static getMinSegments(hostname) {
            return this.isTwoLevel(hostname) ? 3 : CONFIG.MIN_SEGMENTS;
        }

        static isBaseDomain(hostname) {
            // IPv4 정규식은 비용이 들므로 문자열 길이 체크 후 실행
            if (hostname.length >= 7 && hostname.length <= 15 && CONFIG.REGEX.IPV4.test(hostname)) return true;
            return hostname.split('.').length <= this.getMinSegments(hostname);
        }

        static getParentHost(hostname) {
            if (this.isBaseDomain(hostname)) return null;
            const parts = hostname.split('.');
            // 포트 처리는 URL 객체에서 하므로 hostname만 신경 씀
            const next = parts.slice(1).join('.');
            return next.includes('.') || next === 'localhost' ? next : null;
        }

        static getRootHost(hostname) {
            if (hostname.length >= 7 && CONFIG.REGEX.IPV4.test(hostname)) return hostname;
            
            const parts = hostname.split('.');
            const min = this.getMinSegments(hostname);
            if (parts.length <= min) return hostname;
            return parts.slice(-min).join('.');
        }

        static getParentPath(path) {
            if (!path || path === '/' || path === '') return null;
            // 트레일링 슬래시 처리: /a/b/ -> /a/b -> parent: /a/
            // /a/b -> /a/b -> parent: /a/
            const clean = (path.length > 1 && path.endsWith('/')) ? path.slice(0, -1) : path;
            const idx = clean.lastIndexOf('/');
            
            // 최상위 경로이거나 잘못된 경로인 경우
            if (idx < 0) return '/';
            // 루트(/)만 남는 경우
            if (idx === 0) return '/';
            
            return clean.substring(0, idx) + '/';
        }
    }
    Object.freeze(UrlUtils);

    class InputValidator {
        static check(e) {
            // 1. 이벤트 신뢰성 확인
            if (!e.isTrusted || document.designMode === 'on') return false;

            const target = e.target;
            
            // 2. DOM 탐색 최소화: Target 직접 검사 (가장 빈번한 케이스)
            if (target && target.nodeType === 1) {
                // 태그 이름 확인
                if (CONFIG.INPUT_TAGS.has(target.tagName)) return false;
                // ContentEditable 확인
                if (target.isContentEditable) return false;
            }

            // 3. Shadow DOM 및 복잡한 구조 탐색
            // composedPath()는 비용이 있으므로 위에서 필터링 후 실행
            const path = e.composedPath ? e.composedPath() : [target];

            for (const el of path) {
                // Window/Document 도달 시 종료
                if (el === window || el === document) break;
                if (el.nodeType !== 1) continue;

                // 이미 확인한 Target 제외하고 다시 확인 (Shadow Root 상위 요소 등)
                if (el !== target) {
                    if (CONFIG.INPUT_TAGS.has(el.tagName)) return false;
                    if (el.isContentEditable) return false;
                }

                const role = el.getAttribute('role');
                if (role && CONFIG.IGNORED_ROLES.has(role)) return false;

                // 4. 무거운 CSS Selector (matches) 검사는 마지막에 수행
                // inert 속성은 예외적으로 허용 (비활성 영역 클릭)
                if (el.hasAttribute('inert')) return true;

                // 복잡한 에디터 감지
                try {
                    if (elementMatches.call(el, CONFIG.EDITOR_SELECTOR)) return false;
                } catch (_) {}
            }

            return true;
        }
    }
    Object.freeze(InputValidator);

    class Navigator {
        constructor() {
            this.strategies = [
                this.#parentHash,
                this.#cleanQuery,
                this.#parentPath,
                this.#parentDomain
            ];
            Object.freeze(this);
        }

        // 전략 메서드들은 원본 URL 객체를 변경하지 않고 새 URL 문자열을 반환하거나 null 반환
        // u는 읽기 전용으로 취급
        #parentHash(u) {
            if (!u.hash || !CONFIG.REGEX.HASH_PATH.test(u.hash)) return null;
            
            const isBang = u.hash.startsWith('#!');
            const hashContent = u.hash.slice(isBang ? 2 : 1);
            const [pathPart] = hashContent.split('?'); // Query part 무시
            
            const parent = UrlUtils.getParentPath(pathPart);
            if (!parent || parent === pathPart) return null;

            const nextHash = (isBang ? '#!' : '#') + parent;
            
            // URL 객체 재생성을 줄이기 위해 문자열 조작
            const href = u.href;
            const hashIndex = href.indexOf('#');
            return href.substring(0, hashIndex) + nextHash;
        }

        #cleanQuery(u) {
            if (!u.search && !u.hash) return null;
            const next = new OriginalURL(u.href);
            next.search = '';
            next.hash = '';
            return next.href;
        }

        #parentPath(u) {
            const p = UrlUtils.getParentPath(u.pathname);
            // 루트에서 루트로 이동하려는 경우 방지
            if (!p || p === u.pathname || (u.pathname === '/' && p === '/')) return null;
            
            const next = new OriginalURL(u.href);
            next.pathname = p;
            next.search = ''; next.hash = '';
            return next.href;
        }

        #parentDomain(u) {
            const h = UrlUtils.getParentHost(u.hostname);
            if (!h) return null;

            const next = new OriginalURL(u.href);
            // hostname을 설정하면 포트 번호는 유지됨 (URL 스펙 준수)
            next.hostname = h;
            next.pathname = '/';
            next.search = ''; next.hash = '';
            return next.href;
        }

        #exec(href) {
            if (!href || href === originalLocation.href) return false;
            
            // 보안: 위험한 프로토콜 2차 차단
            if (CONFIG.REGEX.UNSAFE_PROTOCOL.test(href)) return false;

            try {
                // DOM XSS 방지를 위한 URL 파싱 검증
                const nextUrl = new OriginalURL(href);
                if (!CONFIG.ALLOWED_PROTOCOLS.has(nextUrl.protocol)) return false;
                
                // 1. 표준 이동 시도
                locationAssign.call(originalLocation, href);
                return true;
            } catch (err) {
                // 2. Fallback: Reflow/Repaint 최소화를 위해 Detached Element 클릭 시도
                try {
                    const a = documentCreateElement('a');
                    a.href = href;
                    a.rel = 'noopener noreferrer';
                    a.referrerPolicy = 'no-referrer'; // 개인정보 보호 강화
                    
                    // DOM에 붙이지 않고 클릭 시도 (최신 브라우저 대부분 지원)
                    a.click();
                    return true;
                } catch (e2) {
                    // 3. 최후의 수단: DOM 부착 후 클릭 (일부 구형 브라우저/보안 환경)
                    try {
                        const a = documentCreateElement('a');
                        a.href = href;
                        a.rel = 'noopener noreferrer';
                        a.style.display = 'none'; // 렌더링 방지
                        (document.body || document.documentElement).appendChild(a);
                        a.click();
                        a.remove(); // 즉시 제거
                        return true;
                    } catch (e3) {
                        return false;
                    }
                }
            }
        }

        up() {
            try {
                // URL 객체 생성 비용 최소화 (한 번 생성 후 재사용)
                const cur = new OriginalURL(originalLocation.href);
                for (const strategy of this.strategies) {
                    const nextHref = strategy.call(this, cur);
                    if (nextHref && this.#exec(nextHref)) return true;
                }
            } catch (e) { /* URL Parsing Error 무시 */ }
            return false;
        }

        root() {
            try {
                const cur = new OriginalURL(originalLocation.href);
                const rootHost = UrlUtils.getRootHost(cur.hostname);
                
                // 이미 루트인 경우 불필요한 로직 실행 방지
                if (cur.hostname === rootHost && cur.pathname === '/' && !cur.search && !cur.hash) return false;

                const next = new OriginalURL(cur.href);
                next.hostname = rootHost;
                next.pathname = '/';
                next.search = ''; next.hash = '';
                return this.#exec(next.href);
            } catch { return false; }
        }
    }

    class App {
        constructor() {
            this.nav = new Navigator();
            this.handle = this.handle.bind(this);
            Object.freeze(this);
        }

        handle(e) {
            // 1. 이벤트 속성 빠른 필터링 (가장 저렴한 비용)
            if (e.key !== CONFIG.KEYS.UP) return;
            if (e.repeat) return;
            if (!e.altKey || e.shiftKey || e.metaKey) return;
            
            // 2. 프로토콜 검증
            if (!CONFIG.ALLOWED_PROTOCOLS.has(originalLocation.protocol)) return;

            // 3. 입력창 검증 (최적화된 로직)
            if (!InputValidator.check(e)) return;

            // 4. 이동 실행
            const success = e.ctrlKey ? this.nav.root() : this.nav.up();

            if (success) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }

        init() {
            window.addEventListener('keydown', this.handle, { passive: false, capture: true });
        }
    }

    new App().init();
})();