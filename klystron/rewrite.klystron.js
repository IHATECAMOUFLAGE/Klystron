async function fix(baseurl, content, contentType) {
    if (content == null) content = "";
    if (typeof content !== "string") content = String(content || "");
    if (typeof baseurl !== "string") baseurl = "";
    if (typeof contentType !== "string") contentType = "";

    function s(v) {
        if (v == null) return "";
        if (typeof v === "string") return v;
        try { return String(v); } catch { return ""; }
    }

    function normalize(u) {
        return u.startsWith("http://") || u.startsWith("https://")
            ? u
            : "https://" + u;
    }

    baseurl = normalize(baseurl);
    const p = "/klystron/";

    function isAbs(u) {
        return /^[a-z][a-z0-9+.-]*:\/\//i.test(u) || /^\/\//.test(u);
    }

    function isSpec(u) {
        return /^(data:|blob:|mailto:|javascript:|tel:|sms:|geo:)/i.test(u);
    }

    function isHash(u) {
        return u === "#" || u.startsWith("#");
    }

    function isProx(u) {
        return u.startsWith(p);
    }

    function wrap(u) {
        if (!u) return u;
        if (isProx(u)) return u;
        if (isSpec(u)) return u;
        if (isHash(u)) return u;
        return p + encodeURIComponent(u);
    }

    function abs(u) {
        if (!u) return u;
        u = u.trim();
        if (!u) return u;
        if (isSpec(u)) return u;
        if (isHash(u)) return u;
        if (isProx(u)) return u;
        if (u.startsWith("//")) {
            try {
                const proto = new URL(baseurl).protocol;
                return wrap(proto + u);
            } catch {
                return wrap("https:" + u);
            }
        }
        if (isAbs(u)) return wrap(u);
        try {
            const full = new URL(u, baseurl).toString();
            return wrap(full);
        } catch {
            return u;
        }
    }

    function looksLikePath(u) {
        if (!u) return false;
        if (isSpec(u)) return false;
        if (isProx(u)) return false;
        if (isHash(u)) return false;
        if (isAbs(u)) return true;
        if (u.startsWith("/")) return true;
        if (u.startsWith("./")) return true;
        if (u.startsWith("../")) return true;
        if (u.startsWith("?")) return true;
        if (/\.(css|js|mjs|png|jpg|jpeg|gif|webp|svg|ico|json|xml|map)(\?|#|$)/i.test(u)) return true;
        return false;
    }

    function rewriteUrlInText(t) {
        if (!t) return t;
        t = t.replace(/(?:https?:|wss?:)\/\/[^\s"'<>]+/gi, function (u) {
            return abs(u);
        });
        t = t.replace(/(^|[\s"'(])((?:\/|\.\.\/|\.\/)[^\s"'<>]+)/g, function (m, pre, u) {
            if (!looksLikePath(u)) return m;
            return pre + abs(u);
        });
        return t;
    }

    function rewriteAttr(html, attr) {
        return html.replace(
            new RegExp("\\b" + attr + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\"'\\s>]+))", "gi"),
            function (m, v1, v2, v3) {
                const value = v1 !== undefined ? v1 : v2 !== undefined ? v2 : v3 || "";
                const fixed = abs(value);
                const quote = v1 !== undefined ? '"' : v2 !== undefined ? "'" : "";
                return attr + "=" + (quote ? quote + fixed + quote : fixed);
            }
        );
    }

    function rewriteSrcset(html) {
        return html.replace(
            /\bsrcset=(?:"([^"]*)"|'([^']*)')/gi,
            function (m, a, b) {
                const c = a !== undefined ? a : b || "";
                const parts = c.split(",");
                const fixed = parts.map(function (part) {
                    part = part.trim();
                    if (!part) return part;
                    const sp = part.split(/\s+/);
                    const u = sp[0];
                    const d = sp.slice(1).join(" ");
                    const f = abs(u);
                    return d ? f + " " + d : f;
                });
                return 'srcset="' + fixed.join(", ") + '"';
            }
        );
    }

    function rewriteStyleAttr(html) {
        return html.replace(
            /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
            function (m, v1, v2) {
                const value = v1 !== undefined ? v1 : v2 || "";
                const fixed = value.replace(
                    /url\(\s*(['"]?)([^"')]+)\1\s*\)/gi,
                    function (_, q, u) {
                        return 'url("' + abs(u) + '")';
                    }
                );
                const quote = v1 !== undefined ? '"' : "'";
                return 'style=' + quote + fixed + quote;
            }
        );
    }

    function rewriteCssText(css) {
        if (!css) return css;
        css = css.replace(
            /url\(\s*(['"]?)([^"')]+)\1\s*\)/gi,
            function (_, q, u) {
                return 'url("' + abs(u) + '")';
            }
        );
        css = css.replace(
            /@import\s+(?:url\(\s*)?(['"]?)([^'"\)\s]+)\1(?:\s*\))?/gi,
            function (_, q, u) {
                return '@import url("' + abs(u) + '")';
            }
        );
        css = rewriteUrlInText(css);
        return css;
    }

    function rewriteMetaRefresh(html) {
        return html.replace(
            /<meta\b[^>]*\b(?:http-equiv|equiv)\s*=\s*(['"])refresh\1[^>]*>/gi,
            function (full) {
                return full.replace(/\bcontent\s*=\s*(['"])([^'"]*)\1/i, function (_, q, content) {
                    return 'content=' + q + content.replace(/\burl\s*=\s*(['"]?)([^'"\s]+)\1/i, function (__ , q2, u) {
                        return 'url=' + (q2 || '') + abs(u) + (q2 || '');
                    }) + q;
                });
            }
        );
    }

    function rewriteMetaContentUrls(html) {
        return html.replace(
            /<meta([^>]+)>/gi,
            function (full, inside) {
                const m = inside.match(/\bcontent=["']([^"']+)["']/i);
                if (!m) return full;
                const content = m[1];
                let fixed = content.replace(
                    /https?:\/\/[^\s"']+/gi,
                    function (u) {
                        return abs(u);
                    }
                );
                fixed = fixed.replace(
                    /(^|[\s"'(])((?:\.\.\/|\.\/|\/)[^\s"']+)/g,
                    function (m, pre, u) {
                        return pre + abs(u);
                    }
                );
                const ni = inside.replace(
                    /\bcontent=["'][^"']+["']/i,
                    'content="' + fixed + '"'
                );
                return "<meta" + ni + ">";
            }
        );
    }

    function rewriteLinkTags(html) {
        return html.replace(
            /<link([^>]+)>/gi,
            function (full, inside) {
                const m = inside.match(/\bhref=["']([^"']+)["']/i);
                if (!m) return full;
                const f = abs(m[1]);
                const ni = inside.replace(
                    /\bhref=["'][^"']+["']/,
                    'href="' + f + '"'
                );
                return "<link" + ni + ">";
            }
        );
    }

    function rewriteJsonLd(html) {
        return html.replace(
            /(<script[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi,
            function (full, open, json, close) {
                const fixed = json.replace(
                    /(["'])([^"']+?)\1/g,
                    function (m, q, u) {
                        if (!looksLikePath(u)) return m;
                        return q + abs(u) + q;
                    }
                );
                return open + fixed + close;
            }
        );
    }

    function rewriteJsStrings(text) {
        return text.replace(
            /(["'`])((?:\\.|(?!\1).)*?)\1/g,
            function (m, q, u) {
                if (!looksLikePath(u)) return m;
                const f = abs(u);
                return q + f + q;
            }
        );
    }

    function rewriteWebpackPublicPath(text) {
        return text.replace(
            /(__webpack_require__\.p\s*=\s*)(["'`])([^"'`]+)\2/g,
            function (m, pre, q, u) {
                if (!looksLikePath(u)) return m;
                const f = abs(u);
                return pre + q + f + q;
            }
        );
    }

    function rewriteImportLike(text) {
        text = text.replace(
            /(import\(\s*)(["'`])([^"'`]+)\2(\s*\))/g,
            function (m, pre, q, u, post) {
                if (!looksLikePath(u)) return m;
                const f = abs(u);
                return pre + q + f + q + post;
            }
        );
        text = text.replace(
            /(import\s+[^"'()]*from\s*)(["'`])([^"'`]+)\2/g,
            function (m, pre, q, u) {
                if (!looksLikePath(u)) return m;
                const f = abs(u);
                return pre + q + f + q;
            }
        );
        text = text.replace(
            /(export\s+[^"'()]*from\s*)(["'`])([^"'`]+)\2/g,
            function (m, pre, q, u) {
                if (!looksLikePath(u)) return m;
                const f = abs(u);
                return pre + q + f + q;
            }
        );
        return text;
    }

    function addBaseTag(html) {
        let baseHref;
        try {
            baseHref = new URL('/', baseurl).toString();
        } catch {
            baseHref = baseurl.replace(/(["'\\])/g, '\\$1');
        }
        const baseTag = `<base href="${baseHref}">`;
        const existingBase = html.match(/<base\s+[^>]*href\s*=\s*["'][^"']*["'][^>]*>/i);
        if (existingBase) {
            return html.replace(/<base\s+[^>]*href\s*=\s*["'][^"']*["'][^>]*>/i, baseTag);
        }
        if (/<head\b[^>]*>/i.test(html)) {
            return html.replace(/(<head\b[^>]*>)/i, `$1${baseTag}`);
        }
        return baseTag + html;
    }

    function rewriteHtml(html) {
        if (!html) return html;

        [
            "href",
            "src",
            "action",
            "poster",
            "data",
            "cite",
            "formaction",
            "manifest",
            "xlink:href"
        ].forEach(function (attr) {
            html = rewriteAttr(html, attr);
        });

        html = rewriteSrcset(html);
        html = rewriteStyleAttr(html);
        html = rewriteCssText(html);
        html = rewriteMetaRefresh(html);
        html = rewriteMetaContentUrls(html);
        html = rewriteLinkTags(html);
        html = rewriteJsonLd(html);
        html = rewriteJsStrings(html);
        html = rewriteWebpackPublicPath(html);
        html = rewriteImportLike(html);
        html = rewriteUrlInText(html);

        const injectScript = `
<script src="/klystron/https%3A%2F%2Fcdn.jsdelivr.net%2Fnpm%2Feruda"></script>
<script>
let erudaInitialized = false;
function showServiceWorkerBlock() {
  document.documentElement.innerHTML = '<body style="margin:0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#111;color:#fff;text-align:center;"><div><h1>Service Worker Required</h1><p>This proxy requires the service worker to be active. Please refresh the page.</p></div></body>';
}
function ensureServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    showServiceWorkerBlock();
    return;
  }

  navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(reg => {
    if (reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    if (!navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (navigator.serviceWorker.controller) {
          window.location.reload();
        }
      });
    }
  }).catch(() => {
    showServiceWorkerBlock();
  });

  setTimeout(() => {
    if (!navigator.serviceWorker.controller) {
      showServiceWorkerBlock();
    }
  }, 1500);
}

document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && !e.shiftKey && e.key === 'i') {
    e.preventDefault();
    e.stopPropagation();
    if (!erudaInitialized) {
      eruda.init();
      erudaInitialized = true;
    } else {
      eruda._isShow ? eruda.hide() : eruda.show();
    }
  }
}, true);
ensureServiceWorker();
</script>
`;
        if (html.includes('<head>')) {
            html = html.replace('<head>', '<head>' + injectScript);
        } else if (html.includes('</body>')) {
            html = html.replace('</body>', injectScript + '</body>');
        } else {
            html += injectScript;
        }

        return html;
    }


    function rewriteJs(text) {
        text = rewriteWebpackPublicPath(text);
        text = rewriteImportLike(text);
        text = rewriteJsStrings(text);
        text = rewriteUrlInText(text);
        return text;
    }

    function rewriteXml(text) {
        text = rewriteAttr(text, "href");
        text = rewriteAttr(text, "src");
        text = rewriteUrlInText(text);
        return text;
    }

    function rewriteSvg(text) {
        text = rewriteAttr(text, "href");
        text = rewriteAttr(text, "xlink:href");
        text = rewriteCssText(text);
        text = rewriteUrlInText(text);
        return text;
    }

    function rewriteJsonStringValue(str) {
        if (!str) return str;
        let out = str.replace(/(?:https?:|wss?:)\/\/[^\s"'<>]+/gi, function (u) {
            return abs(u);
        });
        out = out.replace(/(^|[\s"'(])((?:\/|\.\.\/|\.\/)[^\s"'<>]+)/g, function (m, pre, u) {
            if (!looksLikePath(u)) return m;
            return pre + abs(u);
        });
        return out;
    }

    function walkJson(value) {
        if (value == null) return value;
        if (typeof value === "string") {
            return rewriteJsonStringValue(value);
        }
        if (Array.isArray(value)) {
            return value.map(function (v) {
                return walkJson(v);
            });
        }
        if (typeof value === "object") {
            const out = {};
            Object.keys(value).forEach(function (k) {
                out[k] = walkJson(value[k]);
            });
            return out;
        }
        return value;
    }

    function rewriteJson(text) {
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            return rewriteUrlInText(text);
        }
        const walked = walkJson(parsed);
        try {
            return JSON.stringify(walked);
        } catch {
            return rewriteUrlInText(text);
        }
    }

    function detectType(t, url, contentType) {
        const trimmed = t.trim();
        const mime = (contentType || "").split(";")[0].trim().toLowerCase();

        if (mime) {
            if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
            if (mime === "text/css") return "css";
            if (mime === "application/javascript" || mime === "application/x-javascript" || mime === "text/javascript") return "js";
            if (mime === "application/json" || mime === "application/ld+json" || mime.endsWith("+json")) return "json";
            if (mime === "image/svg+xml") return "svg";
            if (mime === "application/xml" || mime === "text/xml" || mime.endsWith("+xml") || mime === "application/rss+xml" || mime === "application/atom+xml") return "xml";
        }

        if (!trimmed) return "text";
        if (/^<!doctype html/i.test(trimmed)) return "html";
        if (/^<html[\s>]/i.test(trimmed)) return "html";
        if (/^<svg[\s>]/i.test(trimmed)) return "svg";
        if (/^</.test(trimmed) && /<body[\s>]/i.test(trimmed)) return "html";
        if (/^[\s\r\n]*[{[]/.test(trimmed)) return "json";
        if (/<\/?(svg|path|g|defs|symbol|use)\b/i.test(trimmed)) return "svg";
        if (/url\(/i.test(trimmed) && /\{[^}]*\}/.test(trimmed)) return "css";
        if (/\bfunction\b|\bvar\b|\bconst\b|\blet\b|=>/.test(trimmed)) return "js";
        if (url) {
            const u = url.toLowerCase();
            if (u.endsWith(".html") || u.endsWith(".htm")) return "html";
            if (u.endsWith(".json")) return "json";
            if (u.endsWith(".js") || u.endsWith(".mjs") || u.endsWith(".cjs")) return "js";
            if (u.endsWith(".css")) return "css";
            if (u.endsWith(".svg")) return "svg";
            if (u.endsWith(".xml") || u.endsWith(".rss") || u.endsWith(".atom")) return "xml";
        }
        if (/</.test(trimmed) && />/.test(trimmed)) return "xml";
        return "text";
    }

    let kind = detectType(content, baseurl, contentType);
    let out = content;

    if (kind === "html") {
        out = rewriteHtml(content);
    } else {
        out = content;
    }

    return out;
}

export { fix };
