// sanitizer.js
// Shared HTML helpers for extension pages. Native Sanitizer API is used when
// available; the existing strict allow-list sanitizer remains as a fallback.

const MARKDOWN_ALLOWED_TAGS = new Set([
    'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup',
    'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'hr', 'i', 'img', 'input', 'kbd', 'li', 'mark', 'ol', 'p',
    'pre', 's', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table',
    'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
]);

const RICH_ALLOWED_TAGS = new Set([
    ...MARKDOWN_ALLOWED_TAGS,
    'article', 'aside', 'footer', 'header', 'main', 'nav', 'section'
]);

const DROP_WITH_CONTENT_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base',
    'form', 'svg', 'math', 'template', 'video', 'audio', 'source', 'track',
    'canvas'
]);

const MARKDOWN_GLOBAL_ATTRS = new Set(['title', 'aria-label', 'aria-hidden', 'role']);
const RICH_GLOBAL_ATTRS = new Set([...MARKDOWN_GLOBAL_ATTRS, 'class']);

const COMMON_TAG_ATTRS = {
    a: new Set(['href', 'title', 'target', 'rel']),
    img: new Set(['src', 'alt', 'title', 'width', 'height', 'loading']),
    input: new Set(['type', 'checked', 'disabled']),
    th: new Set(['align', 'colspan', 'rowspan']),
    td: new Set(['align', 'colspan', 'rowspan']),
    col: new Set(['span']),
    colgroup: new Set(['span']),
    code: new Set(['class'])
};

const PROFILES = {
    markdown: {
        allowedTags: MARKDOWN_ALLOWED_TAGS,
        globalAttrs: MARKDOWN_GLOBAL_ATTRS,
        tagAttrs: COMMON_TAG_ATTRS,
        classPolicy: 'code-language-only'
    },
    rich: {
        allowedTags: RICH_ALLOWED_TAGS,
        globalAttrs: RICH_GLOBAL_ATTRS,
        tagAttrs: COMMON_TAG_ATTRS,
        classPolicy: 'safe-css-tokens'
    }
};

const URL_ATTRS = new Set(['href', 'src']);
const SAFE_TARGETS = new Set(['_blank', '_self', '_parent', '_top']);
const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const SAFE_ALIGN_VALUES = new Set(['left', 'right', 'center', 'justify']);
const MAX_ATTR_LENGTH = 1024;
const MAX_CLASS_ATTR_LENGTH = 512;
const nativeSanitizerCache = new Map();

function getProfile(profileName = 'markdown') {
    return PROFILES[profileName] || PROFILES.markdown;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const isSafeUrl = (value, attrName) => {
    const raw = String(value ?? '').trim();
    if (!raw) return false;
    if (raw.startsWith('#')) return true;

    try {
        const currentLocation = (typeof window !== 'undefined' && window.location) ? window.location : null;
        const base = currentLocation ? currentLocation.href : 'https://invalid.local/';
        const parsed = new URL(raw, base);
        const isSameOrigin = !!currentLocation && (
            parsed.origin === currentLocation.origin
            || (parsed.protocol === currentLocation.protocol && parsed.host === currentLocation.host)
        );

        // Markdown image loads can make silent requests as soon as a note is previewed.
        // Keep links flexible, but restrict rendered media sources to same-origin URLs
        // so a pasted/imported note cannot beacon to arbitrary remote hosts.
        if (attrName === 'src') return isSameOrigin;

        if (SAFE_URL_PROTOCOLS.has(parsed.protocol)) return true;
        if (isSameOrigin) return true;
        return false;
    } catch {
        return false;
    }
};

function sanitizeClassValue(value, tagName, profile) {
    if (!value || value.length > MAX_CLASS_ATTR_LENGTH) return '';

    if (profile.classPolicy === 'code-language-only') {
        if (tagName !== 'code') return '';
        return value
            .split(/\s+/)
            .filter(token => /^language-[a-z0-9_+-]+$/i.test(token))
            .join(' ');
    }

    return value
        .split(/\s+/)
        .filter(token => /^[a-z0-9_-]{1,80}$/i.test(token))
        .slice(0, 32)
        .join(' ');
}

function sanitizeNumericAttribute(element, attrName, value) {
    if (attrName === 'colspan' || attrName === 'rowspan' || attrName === 'span') {
        if (!/^\d{1,3}$/.test(value) || Number(value) < 1) element.removeAttribute(attrName);
        return;
    }

    if (attrName === 'width' || attrName === 'height') {
        if (!/^\d{1,4}$/.test(value) || Number(value) < 1) element.removeAttribute(attrName);
    }
}

const sanitizeAttributes = (element, profileName = 'markdown') => {
    const profile = getProfile(profileName);
    const tagName = element.tagName.toLowerCase();
    const tagAttrs = profile.tagAttrs[tagName] || new Set();

    for (const attr of Array.from(element.attributes)) {
        const originalName = attr.name;
        const name = originalName.toLowerCase();
        const value = attr.value ?? '';
        const isAllowed = profile.globalAttrs.has(name) || tagAttrs.has(name);

        if (!isAllowed || name.startsWith('on') || name === 'style' || name === 'srcdoc' || value.length > MAX_ATTR_LENGTH) {
            element.removeAttribute(originalName);
            continue;
        }

        if (URL_ATTRS.has(name) && !isSafeUrl(value, name)) {
            element.removeAttribute(originalName);
            continue;
        }

        if (name === 'target' && !SAFE_TARGETS.has(value)) {
            element.removeAttribute(originalName);
            continue;
        }

        if (name === 'rel' && tagName !== 'a') {
            element.removeAttribute(originalName);
            continue;
        }

        if (name === 'class') {
            const safeClasses = sanitizeClassValue(value, tagName, profile);
            if (safeClasses) element.setAttribute('class', safeClasses);
            else element.removeAttribute(originalName);
            continue;
        }

        if (name === 'align' && !SAFE_ALIGN_VALUES.has(String(value).toLowerCase())) {
            element.removeAttribute(originalName);
            continue;
        }

        sanitizeNumericAttribute(element, name, value);
    }

    if (tagName === 'a' && element.hasAttribute('href')) {
        element.setAttribute('rel', 'noopener noreferrer');
        if (!element.hasAttribute('target')) element.setAttribute('target', '_blank');
    }

    if (tagName === 'input') {
        if ((element.getAttribute('type') || '').toLowerCase() !== 'checkbox') {
            element.remove();
            return;
        }
        element.setAttribute('type', 'checkbox');
        element.setAttribute('disabled', '');
    }

    if (tagName === 'img') {
        if (!element.hasAttribute('src')) {
            element.remove();
            return;
        }
        element.setAttribute('loading', 'lazy');
    }
};

const unwrapElement = (element) => {
    const parent = element.parentNode;
    if (!parent) return;
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    element.remove();
};

const sanitizeNode = (node, profileName = 'markdown') => {
    if (typeof Node !== 'undefined'
        && (node.nodeType === Node.COMMENT_NODE || node.nodeType === Node.PROCESSING_INSTRUCTION_NODE)) {
        node.remove();
        return;
    }

    if (typeof Node === 'undefined' || node.nodeType !== Node.ELEMENT_NODE) return;

    const tagName = node.tagName.toLowerCase();
    if (DROP_WITH_CONTENT_TAGS.has(tagName)) {
        node.remove();
        return;
    }

    for (const child of Array.from(node.childNodes)) {
        sanitizeNode(child, profileName);
    }

    if (!getProfile(profileName).allowedTags.has(tagName)) {
        unwrapElement(node);
        return;
    }

    sanitizeAttributes(node, profileName);
};

function hardenSanitizedTree(root, options = {}) {
    if (!root || typeof Node === 'undefined') return;
    const profileName = options.profile || 'markdown';
    const nodes = options.includeRoot
        ? [root]
        : (root.nodeType === Node.DOCUMENT_NODE && root.body
            ? Array.from(root.body.childNodes)
            : Array.from(root.childNodes || []));
    for (const child of nodes) sanitizeNode(child, profileName);
}

function parseAndHardenHtml(dirtyHtml, profileName) {
    if (dirtyHtml === null || dirtyHtml === undefined) return null;
    const html = String(dirtyHtml);

    if (typeof DOMParser === 'undefined') return null;

    const doc = new DOMParser().parseFromString(html, 'text/html');
    hardenSanitizedTree(doc.body, { profile: profileName });
    return doc;
}

function sanitizeHtmlWithProfile(dirtyHtml, profileName) {
    if (dirtyHtml === null || dirtyHtml === undefined) return '';
    const doc = parseAndHardenHtml(dirtyHtml, profileName);
    if (!doc) return escapeHtml(dirtyHtml);
    return doc.body.innerHTML;
}

function buildNativeSanitizerConfig(profileName) {
    const profile = getProfile(profileName);
    const attributes = new Set(profile.globalAttrs);

    for (const tagAttrs of Object.values(profile.tagAttrs)) {
        for (const attr of tagAttrs) attributes.add(attr);
    }

    return {
        // Keep the native config deliberately simple and spec-valid:
        // per-element attributes combined with repeated global attributes can be
        // rejected by some Chromium Sanitizer implementations after
        // canonicalization. MothNote applies its stricter per-tag URL/class/media
        // policy in parseAndHardenHtml() before live DOM insertion, and again in
        // hardenSanitizedTree() after native setHTML().
        elements: Array.from(profile.allowedTags).sort(),
        attributes: Array.from(attributes).sort(),
        comments: false,
        dataAttributes: false
    };
}

function supportsNativeSanitizer() {
    return typeof window !== 'undefined'
        && typeof window.Sanitizer === 'function'
        && typeof Element !== 'undefined'
        && typeof Element.prototype.setHTML === 'function';
}

function getNativeSanitizer(profileName) {
    if (!supportsNativeSanitizer()) return null;
    if (nativeSanitizerCache.has(profileName)) return nativeSanitizerCache.get(profileName);

    try {
        const sanitizer = new window.Sanitizer(buildNativeSanitizerConfig(profileName));
        nativeSanitizerCache.set(profileName, sanitizer);
        return sanitizer;
    } catch {
        // Native Sanitizer API is still evolving across browser versions. A
        // config rejected by one implementation must be a quiet capability miss,
        // not a user-visible console warning; the local allow-list sanitizer is
        // the supported fallback path.
        nativeSanitizerCache.set(profileName, null);
        return null;
    }
}

function replaceChildrenSafely(target, nodes) {
    if (typeof target.replaceChildren === 'function') {
        target.replaceChildren(...nodes);
        return;
    }
    while (target.firstChild) target.removeChild(target.firstChild);
    for (const node of nodes) target.appendChild(node);
}

function setSanitizedHtml(target, dirtyHtml, options = {}) {
    if (!target) return;
    const profileName = options.profile || 'markdown';
    const html = String(dirtyHtml ?? '');

    if (!html) {
        replaceChildrenSafely(target, []);
        return;
    }

    // First apply MothNote's local policy in an inert document. This prevents
    // remote image beacons and other app-policy violations before any live DOM
    // insertion can trigger resource loads.
    const doc = parseAndHardenHtml(html, profileName);
    if (!doc) {
        target.textContent = html;
        return;
    }

    const safeHtml = doc.body.innerHTML;
    const nativeSanitizer = getNativeSanitizer(profileName);
    if (nativeSanitizer && typeof target.setHTML === 'function') {
        try {
            target.setHTML(safeHtml, { sanitizer: nativeSanitizer });
            // Re-apply the app policy after native sanitization because the
            // native config is intentionally broad for cross-version validity.
            hardenSanitizedTree(target, { profile: profileName });
            return;
        } catch {
            // Treat native setHTML failures as a silent fallback. The already
            // hardened inert document below remains the source of truth.
        }
    }

    replaceChildrenSafely(target, Array.from(doc.body.childNodes));
}

function sanitizeHtml(dirtyHtml) {
    return sanitizeHtmlWithProfile(dirtyHtml, 'markdown');
}

function sanitizeRichHtml(dirtyHtml) {
    return sanitizeHtmlWithProfile(dirtyHtml, 'rich');
}

function setSanitizedRichHtml(target, dirtyHtml) {
    setSanitizedHtml(target, dirtyHtml, { profile: 'rich' });
}

const api = Object.freeze({
    escapeHtml,
    hardenSanitizedTree,
    sanitizeHtml,
    sanitizeRichHtml,
    setSanitizedHtml,
    setSanitizedRichHtml
});

if (typeof window !== 'undefined') {
    window.MothNoteSanitizer = api;
}

export {
    escapeHtml,
    hardenSanitizedTree,
    sanitizeHtml,
    sanitizeRichHtml,
    setSanitizedHtml,
    setSanitizedRichHtml
};
