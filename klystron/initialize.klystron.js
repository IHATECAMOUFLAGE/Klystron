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
    routerOptions: {
        maxParamLength: 10000
    }
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
        .map((cookie) => cookie.trim())
        .filter(Boolean)
        .reduce((cookies, cookie) => {
            const index = cookie.indexOf('=');
            if (index < 0) return cookies;
            const name = cookie.slice(0, index).trim();
            const value = cookie.slice(index + 1).trim();
            cookies[name] = value;
            return cookies;
        }, {});
}

function setSessionCookie(reply, sessionId) {
    const cookieValue = `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`;
    reply.header('Set-Cookie', cookieValue);
}

function getSessionJar(req, reply) {
    const cookies = parseCookies(req.headers.cookie);
    let sessionId = cookies[SESSION_COOKIE_NAME];
    let jar = sessionId && jars.get(sessionId);
    if (!jar) {
        sessionId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
        jar = new CookieJar();
        jars.set(sessionId, jar);
        setSessionCookie(reply, sessionId);
    }
    return jar;
}

function copyResponseHeaders(reply, headers = {}) {
    const allowed = new Set([
        'cache-control',
        'expires',
        'last-modified',
        'etag',
        'pragma',
        'vary',
        'content-language',
        'content-disposition',
        'content-range',
        'accept-ranges',        'content-length',        'referrer-policy',
        'permissions-policy',
        'x-content-type-options',
        'x-frame-options'
    ]);

    for (const [name, value] of Object.entries(headers)) {
        const lower = name.toLowerCase();
        if (!allowed.has(lower)) continue;
        if (value == null) continue;
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
            reply.header(name, item);
        }
    }
}

app.all('/klystron/:encoded', async (req, reply) => {
    try {
        const url = decodeURIComponent(req.params.encoded);
        const jar = getSessionJar(req, reply);
        const options = {
            method: req.method,
            headers: { ...req.headers },
            body: req.rawBody && req.rawBody.length > 0 ? req.rawBody : undefined
        };

        delete options.headers.host;

        const { contentType, body, status, headers } = await proxy(url, options, jar);

        if (body && typeof body.pipe === 'function') {
            const rawRes = reply.raw;
            rawRes.statusCode = status || 200;
            copyResponseHeaders(reply, headers);
            rawRes.setHeader('Content-Type', contentType);

            return new Promise((resolve, reject) => {
                const onError = (err) => {
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
        copyResponseHeaders(reply, headers);
        reply.header('Content-Type', contentType);
        reply.send(body);
    } catch (err) {
        reply.status(500).send(err.message);
    }
});

function parseProxyUpgradeUrl(reqUrl) {
    if (!reqUrl) return null;
    const prefix = '/klystron/';
    const index = reqUrl.indexOf('?');
    const pathPart = index >= 0 ? reqUrl.slice(0, index) : reqUrl;
    if (!pathPart.startsWith(prefix)) return null;
    const encoded = pathPart.slice(prefix.length);
    if (!encoded) return null;
    let target;
    try {
        target = decodeURIComponent(encoded);
    } catch {
        return null;
    }
    if (index >= 0) {
        target += reqUrl.slice(index);
    }
    return target;
}

server.on('upgrade', (req, socket, head) => {
    const targetUrl = parseProxyUpgradeUrl(req.url);
    if (!targetUrl) {
        socket.destroy();
        return;
    }

    let remote;
    try {
        remote = new URL(targetUrl);
    } catch {
        socket.destroy();
        return;
    }

    const isSecure = remote.protocol === 'wss:';
    const requestHeaders = { ...req.headers };
    requestHeaders.host = remote.host;
    requestHeaders.connection = 'Upgrade';
    requestHeaders.upgrade = 'websocket';

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
        for (const [name, value] of Object.entries(proxyRes.headers)) {
            socket.write(`${name}: ${value}\r\n`);
        }
        socket.write('\r\n');

        if (proxyHead && proxyHead.length) proxySocket.write(proxyHead);
        if (head && head.length) proxySocket.write(head);

        proxySocket.pipe(socket).pipe(proxySocket);
    });

    proxyRequest.on('error', () => {
        socket.destroy();
    });

    proxyRequest.end();
});

const PORT = process.env.PORT || 3000;

app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
    console.log(`LISTENING ON PORT ${PORT}`);
});