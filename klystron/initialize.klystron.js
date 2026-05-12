import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import http from 'http';
import https from 'https';
import { CookieJar } from 'tough-cookie';
import proxy from './main.klystron.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

const app = fastify({
    routerOptions: { maxParamLength: 500000 }
});
const server = app.server;

const jars = new Map();
const SESSION_COOKIE_NAME = 'klystron_session';

app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
});

app.addContentTypeParser('*', { parseAs: 'buffer' }, (req, body, done) => {
    done(null, body);
});

function parseCookies(cookieHeader = '') {
    return String(cookieHeader)
        .split(';')
        .map(c => c.trim())
        .filter(Boolean)
        .reduce((acc, cookie) => {
            const idx = cookie.indexOf('=');
            if (idx < 0) return acc;
            const name = cookie.slice(0, idx).trim();
            const value = cookie.slice(idx + 1).trim();
            acc[name] = value;
            return acc;
        }, {});
}

function setSessionCookie(reply, sessionId) {
    const cookieValue = `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`;
    reply.header('Set-Cookie', cookieValue);
}

function getSessionJar(req, reply) {
    const cookies = parseCookies(req.headers.cookie);
    let sessionId = cookies[SESSION_COOKIE_NAME];
    if (!sessionId || !jars.has(sessionId)) {
        sessionId = crypto.randomUUID?.() ?? crypto.randomBytes(16).toString('hex');
        const jar = new CookieJar(undefined, { looseMode: true });
        jars.set(sessionId, jar);
        setSessionCookie(reply, sessionId);
    }
    return jars.get(sessionId);
}

function copyResponseHeaders(reply, headers = {}) {
    const allowed = new Set([
        'cache-control', 'expires', 'last-modified', 'etag', 'pragma', 'vary',
        'content-language', 'content-disposition', 'content-range', 'accept-ranges',
        'content-length', 'referrer-policy', 'permissions-policy',
        'x-content-type-options', 'x-frame-options'
    ]);
    for (const [name, value] of Object.entries(headers)) {
        const lower = name.toLowerCase();
        if (!allowed.has(lower) || value == null) continue;
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) reply.header(name, item);
    }
}

app.all('/klystron/:encoded', async (req, reply) => {
    try {
        const url = decodeURIComponent(req.params.encoded);
        const jar = getSessionJar(req, reply);

        const cookieHeader = await jar.getCookieString(url);
        const headers = { ...req.headers, cookie: cookieHeader };
        delete headers.host;

        const options = {
            method: req.method,
            headers,
            body: req.rawBody && req.rawBody.length > 0 ? req.rawBody : undefined
        };

        const { contentType, body, status, headers: resHeaders } = await proxy(url, options, jar);

        if (body && typeof body.pipe === 'function') {
            const rawRes = reply.raw;
            rawRes.statusCode = status || 200;
            copyResponseHeaders(reply, resHeaders);
            rawRes.setHeader('Content-Type', contentType);

            return new Promise((resolve, reject) => {
                const onError = err => {
                    if (!rawRes.writableEnded) rawRes.destroy(err);
                    reject(err);
                };
                body.on('error', onError);
                rawRes.on('error', onError);
                rawRes.on('close', resolve);
                rawRes.on('finish', resolve);
                body.pipe(rawRes);
            });
        }

        reply.status(status || 200);
        copyResponseHeaders(reply, resHeaders);
        reply.header('Content-Type', contentType);
        reply.send(body);
    } catch (err) {
        reply.status(500).send(err.message);
    }
});

function parseProxyUpgradeUrl(reqUrl) {
    if (!reqUrl) return null;
    const prefix = '/klystron/';
    const idx = reqUrl.indexOf('?');
    const pathPart = idx >= 0 ? reqUrl.slice(0, idx) : reqUrl;
    if (!pathPart.startsWith(prefix)) return null;
    let target;
    try {
        target = decodeURIComponent(pathPart.slice(prefix.length));
    } catch {
        return null;
    }
    if (idx >= 0) target += reqUrl.slice(idx);
    return target;
}

server.on('upgrade', (req, socket, head) => {
    const targetUrl = parseProxyUpgradeUrl(req.url);
    if (!targetUrl) return socket.destroy();

    let remote;
    try { remote = new URL(targetUrl); } catch { return socket.destroy(); }

    const isSecure = remote.protocol === 'wss:';
    const requestHeaders = { ...req.headers, host: remote.host, connection: 'Upgrade', upgrade: 'websocket' };

    const proxyRequest = (isSecure ? https : http).request({
        protocol: isSecure ? 'https:' : 'http:',
        hostname: remote.hostname,
        port: remote.port || (isSecure ? 443 : 80),
        path: remote.pathname + remote.search,
        method: req.method,
        headers: requestHeaders
    });

    proxyRequest.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
        socket.write(`HTTP/${proxyRes.httpVersion} 101 ${proxyRes.statusMessage}\r\n`);
        for (const [name, value] of Object.entries(proxyRes.headers)) socket.write(`${name}: ${value}\r\n`);
        socket.write('\r\n');
        if (proxyHead?.length) proxySocket.write(proxyHead);
        if (head?.length) proxySocket.write(head);
        proxySocket.pipe(socket).pipe(proxySocket);
    });

    proxyRequest.on('error', () => socket.destroy());
    proxyRequest.end();
});

const PORT = process.env.PORT || 3000;
app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
    console.log(`LISTENING ON PORT ${PORT}`);
});