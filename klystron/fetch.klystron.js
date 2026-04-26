import axios from 'axios';
import { CookieJar } from 'tough-cookie';

async function collectSetCookieHeaders(response, jar, url) {
    const setCookieHeader = response.headers?.['set-cookie'];
    if (!setCookieHeader) return;

    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const value of cookies) {
        try {
            await jar.setCookie(value, url, { ignoreError: true });
        } catch (e) {
        }
    }
}

function decodeProxyReferer(value) {
    if (!value) return value;
    try {
        const url = new URL(value, 'http://localhost');
        if (url.pathname.startsWith('/klystron/')) {
            const encoded = url.pathname.slice('/klystron/'.length);
            return decodeURIComponent(encoded);
        }
    } catch (e) {
    }
    return value;
}

function cleanRequestHeaders(headers) {
    const safeHeaders = {};
    const ignored = new Set([
        'cookie',
        'host',
        'connection',
        'content-length'
    ]);
    for (const [name, value] of Object.entries(headers || {})) {
        const lower = name.toLowerCase();
        if (ignored.has(lower)) continue;
        if (lower === 'origin') continue;
        if (lower === 'referer') {
            safeHeaders['Referer'] = decodeProxyReferer(value);
            continue;
        }
        safeHeaders[name] = value;
    }
    return safeHeaders;
}

async function get(url, options = {}, jar = new CookieJar()) {
    let { method = 'GET', headers = {}, body } = options;
    headers = cleanRequestHeaders(headers);

    const requestHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "max-age=0",
        "Pragma": "no-cache",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-User": "?1",
        "Sec-Fetch-Dest": "document",
        ...headers
    };

    if (method !== 'GET') {
        requestHeaders['Origin'] = url;
    }

    const updateCookieHeader = async (currentUrl) => {
        const cookieHeader = await jar.getCookieString(currentUrl);
        if (cookieHeader) {
            requestHeaders['Cookie'] = cookieHeader;
        } else {
            delete requestHeaders['Cookie'];
        }
    };

    await updateCookieHeader(url);

    const executeRequest = async (requestUrl) => {
        return axios.request({
            url: requestUrl,
            method,
            headers: requestHeaders,
            data: body,
            maxRedirects: 0,
            validateStatus: null,
            responseType: 'stream'
        });
    };

    let response = await executeRequest(url);
    await collectSetCookieHeaders(response, jar, url);

    let redirectCount = 0;
    let currentUrl = url;

    while (response.status >= 300 && response.status < 400 && response.headers?.location && redirectCount < 10) {
        const location = response.headers.location;
        const nextUrl = new URL(location, currentUrl).toString();
        const previousUrl = currentUrl;
        redirectCount += 1;

        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
            method = 'GET';
            body = undefined;
        }

        currentUrl = nextUrl;
        requestHeaders['Referer'] = previousUrl;
        if (method !== 'GET') {
            requestHeaders['Origin'] = currentUrl;
        } else {
            delete requestHeaders['Origin'];
        }
        await updateCookieHeader(currentUrl);

        response = await executeRequest(currentUrl);
        await collectSetCookieHeaders(response, jar, currentUrl);
    }

    const headersObject = {};
    for (const [name, value] of Object.entries(response.headers || {})) {
        const lower = name.toLowerCase();
        if (headersObject[lower] === undefined) {
            headersObject[lower] = value;
        } else if (Array.isArray(headersObject[lower])) {
            headersObject[lower].push(value);
        } else {
            headersObject[lower] = [headersObject[lower], value];
        }
    }

    const stream = response.data;
    const consumeStream = async () => {
        if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
            return Buffer.from([]);
        }
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
    };

    const raw = {
        status: response.status,
        headers: response.headers || {},
        stream,
        arrayBuffer: async () => {
            const buffer = await consumeStream();
            return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        },
        text: async () => {
            const buffer = await consumeStream();
            return buffer.toString('utf8');
        }
    };

    return {
        raw,
        contentType: response.headers?.['content-type'] || "application/octet-stream",
        status: response.status,
        headers: headersObject
    };
}

export { get };
