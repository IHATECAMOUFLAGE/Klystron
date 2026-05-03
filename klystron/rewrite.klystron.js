import { JSDOM } from "jsdom";

async function fix(baseurl, content, contentType) {
    if (content == null) content = "";
    if (typeof content !== "string") content = String(content || "");
    if (typeof baseurl !== "string") baseurl = "";
    if (typeof contentType !== "string") contentType = "";

    function resolveUrl(url, baseUrlOverride) {
        try {
            return new URL(url, baseUrlOverride || baseurl).toString();
        } catch {
            return url;
        }
    }

    function wrap(url) {
        if (!url || url.startsWith("/klystron/")) return url;
        // List of schemes to ignore
        if (url.startsWith("data:") || 
            url.startsWith("javascript:") || 
            url.startsWith("mailto:") || 
            url.startsWith("tel:") || 
            url.startsWith("#") || 
            url.startsWith("about:") || 
            url.startsWith("blob:") || 
            url.startsWith("chrome-extension:") || 
            url.startsWith("moz-extension:") ||
            url.startsWith("filesystem:") ||
            url.startsWith("ws:") ||
            url.startsWith("wss:")) {
            return url;
        }
        return "/klystron/" + encodeURIComponent(url);
    }

    if (contentType.includes("text/html")) {
        const dom = new JSDOM(content, { url: baseurl });
        const doc = dom.window.document;

        // Handle Base Tag
        const baseTag = doc.querySelector("base[href]");
        let currentBaseUrl = baseurl;
        if (baseTag) {
            const originalHref = baseTag.getAttribute("href");
            const resolved = resolveUrl(originalHref);
            baseTag.setAttribute("href", wrap(resolved));
            currentBaseUrl = resolved;
        }

        // Comprehensive list of attributes to fix
        const attributes = [
            // Links & Navigation
            { selector: "a", attr: "href" },
            { selector: "a", attr: "ping" },
            { selector: "area", attr: "href" },
            { selector: "area", attr: "ping" },
            { selector: "link", attr: "href" }, // Stylesheets, favicons, preload, prefetch
            { selector: "link", attr: "imagesrcset", isSrcset: true }, // Preload hints for images
            
            // Frames & Embeds
            { selector: "iframe", attr: "src" },
            { selector: "iframe", attr: "longdesc" },
            { selector: "frame", attr: "src" },
            { selector: "frame", attr: "longdesc" },
            { selector: "embed", attr: "src" },
            
            // Objects & Applets
            { selector: "object", attr: "data" },
            { selector: "object", attr: "codebase" },
            { selector: "object", attr: "archive" },
            { selector: "object", attr: "usemap" },
            { selector: "applet", attr: "codebase" },
            { selector: "applet", attr: "archive" },
            { selector: "applet", attr: "code" }, // Relative URL
            
            // Scripts & Styles
            { selector: "script", attr: "src" },
            
            // Images
            { selector: "img", attr: "src" },
            { selector: "img", attr: "srcset", isSrcset: true },
            { selector: "img", attr: "longdesc" },
            { selector: "img", attr: "usemap" },
            
            // Media (Audio/Video)
            { selector: "audio", attr: "src" },
            { selector: "video", attr: "src" },
            { selector: "video", attr: "poster" },
            { selector: "source", attr: "src" },
            { selector: "source", attr: "srcset", isSrcset: true },
            { selector: "track", attr: "src" },
            
            // Forms
            { selector: "form", attr: "action" },
            { selector: "button", attr: "formaction" },
            { selector: "input", attr: "src" }, // Image inputs
            { selector: "input", attr: "formaction" },
            
            // Citations & Metadata
            { selector: "blockquote", attr: "cite" },
            { selector: "q", attr: "cite" },
            { selector: "ins", attr: "cite" },
            { selector: "del", attr: "cite" },
            { selector: "html", attr: "manifest" }, // Deprecated but used
            { selector: "head", attr: "profile" }, // Deprecated
            
            // Legacy Visuals
            { selector: "body", attr: "background" },
            { selector: "table", attr: "background" },
            { selector: "td", attr: "background" },
            { selector: "th", attr: "background" },
            { selector: "tr", attr: "background" },
            
            // SVG
            { selector: "svg", attr: "href" }, // SVG <a> and others
            { selector: "use", attr: "href" },
            { selector: "image", attr: "href" },
            { selector: "script", attr: "href" }, // SVG scripts
            { selector: "[xlink\\:href]", attr: "xlink:href" }, // Legacy SVG namespace
        ];

        attributes.forEach(({ selector, attr, isSrcset }) => {
            doc.querySelectorAll(selector).forEach(el => {
                let val = el.getAttribute(attr);
                if (!val) return;

                if (isSrcset) {
                    const parts = val.split(",").map(part => {
                        const [url, descriptor] = part.trim().split(/\s+/, 2);
                        const absolute = resolveUrl(url, currentBaseUrl);
                        return wrap(absolute) + (descriptor ? " " + descriptor : "");
                    });
                    el.setAttribute(attr, parts.join(", "));
                } else {
                    el.setAttribute(attr, wrap(resolveUrl(val, currentBaseUrl)));
                }
            });
        });

        // Handle <iframe srcdoc=""> by recursively parsing its content
        doc.querySelectorAll("iframe[srcdoc]").forEach(iframe => {
            const srcdoc = iframe.getAttribute("srcdoc");
            if (srcdoc) {
                iframe.setAttribute("srcdoc", fix(srcdoc, currentBaseUrl, "text/html"));
            }
        });

        // Param tags (Flash etc)
        doc.querySelectorAll("param[name='src'], param[name='data'], param[name='movie'], param[name='href'], param[name='codebase'], param[name='archive']").forEach(param => {
            const val = param.getAttribute("value");
            if (val) param.setAttribute("value", wrap(resolveUrl(val, currentBaseUrl)));
        });

        // Meta tags
        doc.querySelectorAll("meta[property], meta[name]").forEach(meta => {
            const name = meta.getAttribute("property") || meta.getAttribute("name");
            const content = meta.getAttribute("content");
            if (!name || !content) return;

            const lowerName = name.toLowerCase();
            
            // List of meta tags that contain URLs
            const urlMetas = [
                "og:image", "og:image:url", "og:image:secure_url",
                "og:video", "og:video:url", "og:video:secure_url",
                "og:audio", "og:audio:url", "og:audio:secure_url",
                "og:url",
                "twitter:image", 
                "twitter:player", 
                "twitter:player:stream",
                "video",
                "thumbnail",
                "image",
                "msapplication-tileimage",
                "msapplication-square70x70logo",
                "msapplication-square150x150logo",
                "msapplication-wide310x150logo",
                "msapplication-square310x310logo",
                "apple-touch-icon",
                "apple-touch-startup-image"
            ];

            if (urlMetas.includes(lowerName)) {
                 meta.setAttribute("content", wrap(resolveUrl(content, currentBaseUrl)));
            }
        });

        // Meta Refresh
        doc.querySelectorAll("meta[http-equiv='refresh']").forEach(meta => {
            const content = meta.getAttribute("content");
            if (!content) return;
            const parts = content.split(/url=/i);
            if (parts.length > 1) {
                const url = parts[1];
                // Handle potential trailing semicolon or quotes in the url part
                const cleanUrl = url.split(/[;'" ]/)[0]; 
                meta.setAttribute("content", parts[0] + "url=" + wrap(resolveUrl(cleanUrl, currentBaseUrl)));
            }
        });

        // CSS Handling
        const cssUrlRegex = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
        const cssImportRegex = /@import\s+(['"])(.*?)\1/gi;
        const cssFontFaceRegex = /@font-face\s*{([^}]*?)src\s*:\s*([^;]*?)}/gi;

        function fixCssString(css) {
            return css.replace(cssUrlRegex, (match, quote, url) => {
                return `url(${quote}${wrap(resolveUrl(url, currentBaseUrl))}${quote})`;
            }).replace(cssImportRegex, (match, quote, url) => {
                return `@import ${quote}${wrap(resolveUrl(url, currentBaseUrl))}${quote}`;
            }).replace(cssFontFaceRegex, (match, preamble, srcValue) => {
                const fixedSrc = srcValue.replace(cssUrlRegex, (m, q, u) => `url(${q}${wrap(resolveUrl(u, currentBaseUrl))}${q})`);
                return `@font-face {${preamble}src : ${fixedSrc}}`;
            });
        }

        doc.querySelectorAll("style").forEach(style => {
            if (style.textContent) style.textContent = fixCssString(style.textContent);
        });

        doc.querySelectorAll("*[style]").forEach(el => {
            const style = el.getAttribute("style");
            if (style) el.setAttribute("style", fixCssString(style));
        });

        // JS Handling (Inline Scripts & Event Handlers)
        // Regex to catch strings that look like URLs
        const jsUrlRegex = /(['"`])(https?:\/\/[^'"`]+|\/\/[^'"`]+|\/[^'"`]*|\.{1,2}\/[^'"`]*)\1/gi;
        const jsImportRegex = /import\s*\(\s*(['"`])(.*?)\1\s*\)/g;
        const jsWorkerRegex = /new\s+(Worker|SharedWorker)\s*\(\s*(['"`])(.*?)\1\s*\)/g;
        const jsParentRegex = /(parent|top|window|self)\.location\s*=\s*(['"`])(https?:\/\/[^'"`]+|\/[^'"`]*|\.\/[^'"`]*|\.\.\/[^'"`]*)\2/gi;
        const jsLocationReplaceRegex = /location\.replace\s*\(\s*(['"`])(https?:\/\/[^'"`]+|\/[^'"`]*|\.\/[^'"`]*|\.\.\/[^'"`]*)\1\s*\)/gi;
        const jsLocationHrefRegex = /location\.href\s*=\s*(['"`])(https?:\/\/[^'"`]+|\/[^'"`]*|\.\/[^'"`]*|\.\.\/[^'"`]*)\1/gi;

        function fixJsString(js) {
            return js.replace(jsUrlRegex, (match, quote, url) => {
                return `${quote}${wrap(resolveUrl(url, currentBaseUrl))}${quote}`;
            }).replace(jsImportRegex, (match, quote, url) => {
                return `import(${quote}${wrap(resolveUrl(url, currentBaseUrl))}${quote})`;
            }).replace(jsWorkerRegex, (match, type, quote, url) => {
                return `new ${type}(${quote}${wrap(resolveUrl(url, currentBaseUrl))}${quote})`;
            }).replace(jsParentRegex, (match, obj, quote, url) => {
                return `${obj}.location = ${quote}${wrap(resolveUrl(url, currentBaseUrl))}${quote}`;
            }).replace(jsLocationReplaceRegex, (match, quote, url) => {
                return `location.replace(${quote}${wrap(resolveUrl(url, currentBaseUrl))}${quote})`;
            }).replace(jsLocationHrefRegex, (match, quote, url) => {
                return `location.href = ${quote}${wrap(resolveUrl(url, currentBaseUrl))}${quote}`;
            });
        }

        doc.querySelectorAll("script:not([src])").forEach(script => {
            if (script.textContent) script.textContent = fixJsString(script.textContent);
        });

        doc.querySelectorAll("*").forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                if (attr.name.startsWith("on")) {
                    el.setAttribute(attr.name, fixJsString(attr.value));
                }
            });
        });

        // Security: Remove integrity checks as proxying breaks them
        doc.querySelectorAll("script[integrity], link[integrity]").forEach(el => {
            el.removeAttribute("integrity");
        });
        
        doc.querySelectorAll("script[nonce], style[nonce]").forEach(el => {
            el.removeAttribute("nonce");
        });

        if (doc.body) {
            const erudaScript = doc.createElement("script");
            erudaScript.setAttribute("src", "/klystron/" + encodeURIComponent("https://cdn.jsdelivr.net/npm/eruda"));
            doc.body.appendChild(erudaScript);

            const initScript = doc.createElement("script");
            initScript.textContent = "eruda.init();";
            doc.body.appendChild(initScript);
        }

        return dom.serialize();
    } else if (contentType.includes("css")) {
        const css = content;
        const cssUrlRegex = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
        const cssImportRegex = /@import\s+(['"])(.*?)\1/gi;
        const cssFontFaceRegex = /@font-face\s*{([^}]*?)src\s*:\s*([^;]*?)}/gi;

        let fixedCss = css.replace(cssUrlRegex, (match, quote, url) => {
            return `url(${quote}${wrap(resolveUrl(url))}${quote})`;
        }).replace(cssImportRegex, (match, quote, url) => {
            return `@import ${quote}${wrap(resolveUrl(url))}${quote}`;
        }).replace(cssFontFaceRegex, (match, preamble, srcValue) => {
            const fixedSrc = srcValue.replace(cssUrlRegex, (m, q, u) => `url(${q}${wrap(resolveUrl(u))}${q})`);
            return `@font-face {${preamble}src : ${fixedSrc}}`;
        });

        return fixedCss;

    } else if (contentType.includes("javascript") || contentType.includes("application/json") || contentType.includes("application/xml") || contentType.includes("text/xml")) {
        const js = content;
        const jsUrlRegex = /(['"`])(https?:\/\/[^'"`]+|\/\/[^'"`]+|\/[^'"`]*|\.{1,2}\/[^'"`]*)\1/gi;
        const jsImportRegex = /import\s*\(\s*(['"`])(.*?)\1\s*\)/g;
        const jsWorkerRegex = /new\s+(Worker|SharedWorker)\s*\(\s*(['"`])(.*?)\1\s*\)/g;

        let fixedJs = js.replace(jsUrlRegex, (match, quote, url) => {
            return `${quote}${wrap(resolveUrl(url))}${quote}`;
        }).replace(jsImportRegex, (match, quote, url) => {
            return `import(${quote}${wrap(resolveUrl(url))}${quote})`;
        }).replace(jsWorkerRegex, (match, type, quote, url) => {
            return `new ${type}(${quote}${wrap(resolveUrl(url))}${quote})`;
        });

        return fixedJs;
    }

    return content;
}

export { fix };