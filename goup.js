(function () {
    'use strict';

    if (window.self !== window.top) {
        return;
    }

    const OriginalURL = URL;
    const originalLocation = window.location;
    const { assign: locationAssign } = window.location;
    const documentCreateElement = document.createElement.bind(document);
    const elementMatches = Element.prototype.matches;

    const CONFIG = Object.freeze({
        COMMON_CC_SECOND_LEVEL_LABELS: new Set([
            'ac', 'co', 'com', 'edu', 'go', 'gov', 'mil', 'ne', 'net', 'or', 'org', 'school'
        ]),
        PRIVATE_PUBLIC_SUFFIXES: new Set([
            'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'herokuapp.com',
            'azurewebsites.net', 'tistory.com', 'blogspot.com', 'wordpress.com'
        ]),
        ALLOWED_PROTOCOLS: new Set(['http:', 'https:']),
        MIN_SEGMENTS: 2,
        KEYS: { UP: 'ArrowUp' },
        
        EDITOR_SELECTOR: '.monaco-editor, .codemirror, .ace_editor, .notion-page-content, .prosemirror, .kix-appview-editor, .docs-gm, [class*="Editor"], [class*="editor"]',
        
        IGNORED_ROLES: new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'grid', 'treegrid', 'menuitem', 'application']),
        
        INPUT_TAGS: new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT']),
        
        REGEX: {
            IPV4: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
            CC_SLD_FALLBACK: /^(?:co|com|org|net|gov|edu|mil|ac)$/,
            HASH_PATH: /^#!?\/+/,
            UNSAFE_PROTOCOL: /^\s*(?:javascript|data|vbscript):/i
        }
    });

    class UrlUtils {
        static normalizeHostname(hostname) {
            return String(hostname || '').toLowerCase().replace(/\.+$/, '');
        }

        static isTwoLevel(hostname) {
            const normalizedHostname = this.normalizeHostname(hostname);
            const parts = normalizedHostname.split('.');
            if (parts.length < 3) return false;

            const tld = parts[parts.length - 1];
            const sld = parts[parts.length - 2];
            const suffix = `${sld}.${tld}`;

            if (CONFIG.PRIVATE_PUBLIC_SUFFIXES.has(suffix)) return true;

            return tld.length === 2 &&
                (CONFIG.COMMON_CC_SECOND_LEVEL_LABELS.has(sld) || CONFIG.REGEX.CC_SLD_FALLBACK.test(sld));
        }

        static getMinSegments(hostname) {
            return this.isTwoLevel(hostname) ? 3 : CONFIG.MIN_SEGMENTS;
        }

        static isBaseDomain(hostname) {
            const normalizedHostname = this.normalizeHostname(hostname);
            if (normalizedHostname.length >= 7 && normalizedHostname.length <= 15 && CONFIG.REGEX.IPV4.test(normalizedHostname)) return true;
            return normalizedHostname.split('.').length <= this.getMinSegments(normalizedHostname);
        }

        static getParentHost(hostname) {
            const normalizedHostname = this.normalizeHostname(hostname);
            if (this.isBaseDomain(normalizedHostname)) return null;
            const parts = normalizedHostname.split('.');
            const next = parts.slice(1).join('.');
            return next.includes('.') || next === 'localhost' ? next : null;
        }

        static getRootHost(hostname) {
            const normalizedHostname = this.normalizeHostname(hostname);
            if (normalizedHostname.length >= 7 && CONFIG.REGEX.IPV4.test(normalizedHostname)) return normalizedHostname;
            
            const parts = normalizedHostname.split('.');
            const min = this.getMinSegments(normalizedHostname);
            if (parts.length <= min) return normalizedHostname;
            return parts.slice(-min).join('.');
        }

        static getParentPath(path) {
            if (!path || path === '/' || path === '') return null;
            const clean = (path.length > 1 && path.endsWith('/')) ? path.slice(0, -1) : path;
            const idx = clean.lastIndexOf('/');
            
            if (idx < 0) return '/';
            if (idx === 0) return '/';
            
            return clean.substring(0, idx) + '/';
        }
    }
    Object.freeze(UrlUtils);

    class InputValidator {
        static check(e) {
            if (!e.isTrusted || document.designMode === 'on') return false;

            const target = e.target;
            
            if (target && target.nodeType === 1) {
                if (CONFIG.INPUT_TAGS.has(target.tagName)) return false;
                if (target.isContentEditable) return false;
            }

            const path = e.composedPath ? e.composedPath() : [target];

            for (const el of path) {
                if (el === window || el === document) break;
                if (el.nodeType !== 1) continue;

                if (el !== target) {
                    if (CONFIG.INPUT_TAGS.has(el.tagName)) return false;
                    if (el.isContentEditable) return false;
                }

                const role = el.getAttribute('role');
                if (role && CONFIG.IGNORED_ROLES.has(role)) return false;

                if (el.hasAttribute('inert')) return true;

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

        #parentHash(u) {
            if (!u.hash || !CONFIG.REGEX.HASH_PATH.test(u.hash)) return null;
            
            const isBang = u.hash.startsWith('#!');
            const hashContent = u.hash.slice(isBang ? 2 : 1);
            const [pathPart] = hashContent.split('?');
            
            const parent = UrlUtils.getParentPath(pathPart);
            if (!parent || parent === pathPart) return null;

            const nextHash = (isBang ? '#!' : '#') + parent;
            
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
            next.hostname = h;
            next.username = '';
            next.password = '';
            next.pathname = '/';
            next.search = ''; next.hash = '';
            return next.href;
        }

        #exec(href) {
            if (!href || href === originalLocation.href) return false;
            
            if (CONFIG.REGEX.UNSAFE_PROTOCOL.test(href)) return false;

            try {
                const nextUrl = new OriginalURL(href);
                if (!CONFIG.ALLOWED_PROTOCOLS.has(nextUrl.protocol)) return false;
                
                locationAssign.call(originalLocation, href);
                return true;
            } catch (err) {
                try {
                    const a = documentCreateElement('a');
                    a.href = href;
                    a.rel = 'noopener noreferrer';
                    a.referrerPolicy = 'no-referrer';
                    
                    a.click();
                    return true;
                } catch (e2) {
                    try {
                        const a = documentCreateElement('a');
                        a.href = href;
                        a.rel = 'noopener noreferrer';
                        a.style.display = 'none';
                        (document.body || document.documentElement).appendChild(a);
                        a.click();
                        a.remove();
                        return true;
                    } catch (e3) {
                        return false;
                    }
                }
            }
        }

        up() {
            try {
                const cur = new OriginalURL(originalLocation.href);
                for (const strategy of this.strategies) {
                    const nextHref = strategy.call(this, cur);
                    if (nextHref && this.#exec(nextHref)) return true;
                }
            } catch (e) { }
            return false;
        }

        root() {
            try {
                const cur = new OriginalURL(originalLocation.href);
                const rootHost = UrlUtils.getRootHost(cur.hostname);
                
                if (cur.hostname === rootHost && cur.pathname === '/' && !cur.search && !cur.hash) return false;

                const next = new OriginalURL(cur.href);
                next.hostname = rootHost;
                if (cur.hostname !== rootHost) {
                    next.username = '';
                    next.password = '';
                }
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
            if (e.key !== CONFIG.KEYS.UP) return;
            if (e.repeat) return;
            if (!e.altKey || e.shiftKey || e.metaKey) return;
            
            if (!CONFIG.ALLOWED_PROTOCOLS.has(originalLocation.protocol)) return;

            if (!InputValidator.check(e)) return;

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
