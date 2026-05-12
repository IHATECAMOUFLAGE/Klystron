import { fetch, Headers, Request, Response } from 'undici';
import { CookieJar } from 'tough-cookie';
import { promisify } from 'util';

const setCookie = promisify(CookieJar.prototype.setCookie.bind(CookieJar.prototype));
const getCookieString = promisify(CookieJar.prototype.getCookieString.bind(CookieJar.prototype));

function normalizeHeaders(headers = {}) {
    const h = new Headers();

    for (const [k, v] of Object.entries(headers)) {
        const key = k.toLowerCase();

        if (['host', 'content-length'].includes(key)) continue;

        if (key === 'cookie') continue;

        if (key === 'referer') {
            h.set('referer', decodeProxyReferer(v));
            continue;
        }

        h.set(k, v);
    }

    return h;
}

function decodeProxyReferer(value) {
    if (!value) return value;
    try {
        const url = new URL(value, 'http://localhost');
        if (url.pathname.startsWith('/klystron/')) {
            return decodeURIComponent(url.pathname.slice('/klystron/'.length));
        }
    } catch {}
    return value;
}

async function attachCookies(jar, url, headers) {
    const cookie = await getCookieString(jar, url);
    if (cookie) headers.set('cookie', cookie);
}

async function storeCookies(jar, url, response) {
    const setCookieHeader = response.headers.getSetCookie?.() || [];
    for (const c of setCookieHeader) {
        try {
            await setCookie(jar, c, url);
        } catch {}
    }
}

async function request(url, options = {}, jar = new CookieJar()) {
    let currentUrl = url;
    let method = (options.method || 'GET').toUpperCase();
    let body = options.body;

    const maxRedirects = 10;

    for (let i = 0; i <= maxRedirects; i++) {
        const headers = normalizeHeaders(options.headers);

        await attachCookies(jar, currentUrl, headers);

        if (method !== 'GET') {
            headers.set('origin', new URL(currentUrl).origin);
        }

        const res = await fetch(currentUrl, {
            method,
            headers,
            body,
            redirect: 'manual'
        });

        await storeCookies(jar, currentUrl, res);

        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get('location');
            if (!location) break;

            const nextUrl = new URL(location, currentUrl).toString();

            if (res.status === 303 || (res.status === 302 && method === 'POST')) {
                method = 'GET';
                body = undefined;
            }

            currentUrl = nextUrl;
            continue;
        }

        return new BrowserResponse(res);
    }

    throw new Error('Too many redirects');
}

class BrowserResponse {
    constructor(res) {
        this._res = res;
        this.status = res.status;
        this.ok = res.ok;
        this.headers = res.headers;
        this.url = res.url;
    }

    async text() {
        return await this._res.text();
    }

    async json() {
        return await this._res.json();
    }

    async arrayBuffer() {
        return await this._res.arrayBuffer();
    }

    async blob() {
        return await this._res.blob();
    }
}

export { request as get };