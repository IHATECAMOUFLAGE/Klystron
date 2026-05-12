import { JSDOM } from "jsdom";

function fix(baseurl, content, contentType) {
    content ??= "";
    baseurl ??= "";
    contentType ??= "";

    if (typeof content !== "string") content = String(content);
    if (typeof baseurl !== "string") baseurl = String(baseurl);
    if (typeof contentType !== "string") contentType = String(contentType);

    const dom = new JSDOM(content, {
        url: baseurl,
        contentType: contentType.includes("xml") ? "text/xml" : "text/html"
    });

    const { document } = dom.window;

    const skipProtocols = [
        "data:",
        "javascript:",
        "mailto:",
        "tel:",
        "about:",
        "blob:",
        "chrome-extension:",
        "moz-extension:",
        "filesystem:",
        "ws:",
        "wss:"
    ];

    const shouldSkip = value => {
        if (!value) return true;

        const v = value.trim().toLowerCase();

        if (v.startsWith("#")) return true;
        if (v.startsWith("/klystron/")) return true;

        return skipProtocols.some(p => v.startsWith(p));
    };

    const resolve = value => {
        try {
            return new URL(value, baseurl).href;
        } catch {
            return value;
        }
    };

    const wrap = value => {
        if (shouldSkip(value)) return value;
        return "/klystron/" + encodeURIComponent(resolve(value));
    };

    const fixSrcset = value => {
        return value
            .split(",")
            .map(part => {
                const [url, descriptor] = part.trim().split(/\s+/, 2);
                return wrap(url) + (descriptor ? ` ${descriptor}` : "");
            })
            .join(", ");
    };

    const cssUrlRegex = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
    const cssImportRegex = /@import\s+(['"])(.*?)\1/gi;

    const fixCss = css => {
        return css
            .replace(cssUrlRegex, (_, q, url) => {
                return `url(${q}${wrap(url)}${q})`;
            })
            .replace(cssImportRegex, (_, q, url) => {
                return `@import ${q}${wrap(url)}${q}`;
            });
    };

    const jsUrlRegex =
        /(['"`])(https?:\/\/[^'"`]+|\/\/[^'"`]+|\/[^'"`]+|\.{1,2}\/[^'"`]+)\1/g;

    const fixJs = js => {
        return js.replace(jsUrlRegex, (_, q, url) => {
            return `${q}${wrap(url)}${q}`;
        });
    };

    document.querySelectorAll("*").forEach(el => {
        for (const attr of [...el.attributes]) {
            const name = attr.name.toLowerCase();
            const value = attr.value;

            if (!value) continue;

            if (name === "srcset" || name === "imagesrcset") {
                el.setAttribute(name, fixSrcset(value));
                continue;
            }

            if (name === "style") {
                el.setAttribute(name, fixCss(value));
                continue;
            }

            if (name.startsWith("on")) {
                el.setAttribute(name, fixJs(value));
                continue;
            }

            if (
                [
                    "href",
                    "src",
                    "action",
                    "formaction",
                    "poster",
                    "data",
                    "cite",
                    "background",
                    "ping",
                    "longdesc",
                    "xlink:href"
                ].includes(name)
            ) {
                el.setAttribute(name, wrap(value));
                continue;
            }

            if (name === "integrity" || name === "nonce") {
                el.removeAttribute(name);
            }
        }

        if (el.tagName === "STYLE" && el.textContent) {
            el.textContent = fixCss(el.textContent);
        }

        if (el.tagName === "SCRIPT" && !el.src && el.textContent) {
            el.textContent = fixJs(el.textContent);
        }
    });

    document.querySelectorAll("meta[property], meta[name]").forEach(meta => {
        const content = meta.getAttribute("content");
        if (!content) return;
        meta.setAttribute("content", wrap(content));
    });

    document.querySelectorAll("iframe[srcdoc]").forEach(iframe => {
        const srcdoc = iframe.getAttribute("srcdoc");
        if (!srcdoc) return;

        iframe.setAttribute(
            "srcdoc",
            fix(baseurl, srcdoc, "text/html")
        );
    });

    if (document.body) {
        const eruda = document.createElement("script");

        eruda.src =
            "/klystron/" +
            encodeURIComponent("https://cdn.jsdelivr.net/npm/eruda");

        document.body.appendChild(eruda);

        const init = document.createElement("script");
        init.textContent = `
window.addEventListener("load", () => {
    if (window.eruda) {
        try {
            eruda.init();
        } catch {}
    }
});
        `;

        document.body.appendChild(init);
    }

    return dom.serialize();
}

export { fix };