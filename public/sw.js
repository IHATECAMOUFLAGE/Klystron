self.addEventListener('install', event => {
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);
    const origin = self.location.origin;

    function getOriginalRemoteUrl(referrer) {
        if (!referrer || !referrer.startsWith(origin + '/klystron/')) return null;
        
        const encoded = referrer.slice((origin + '/klystron/').length);
        try {
            return decodeURIComponent(encoded);
        } catch (e) {
            return null;
        }
    }

    function proxyTo(urlString) {
        const encoded = encodeURIComponent(urlString);
        const proxyUrl = `${origin}/klystron/${encoded}`;

        const proxyRequest = new Request(proxyUrl, {
            method: event.request.method,
            headers: event.request.headers,
            body: event.request.body,
            mode: 'same-origin',
            credentials: 'same-origin',
            redirect: 'follow'
        });

        if (epoxy) {
            return epoxy.fetch(proxyRequest);
        }

        return fetch(proxyRequest);
    }

    if (requestUrl.origin === origin) {
        if (requestUrl.pathname.startsWith('/klystron/') || requestUrl.pathname === '/sw.js') {
            return; 
        }
    }

    const requestReferrer = event.request.referrer || event.request.headers.get('referer');
    const proxiedPageUrl = getOriginalRemoteUrl(requestReferrer);

    if (proxiedPageUrl) {
        if (requestUrl.origin === origin) {
            try {
                const remoteBase = new URL(proxiedPageUrl);
                const target = new URL(requestUrl.pathname + requestUrl.search, remoteBase);
                
                event.respondWith(proxyTo(target.toString()));
                return;
            } catch (err) {
                console.error('Failed to resolve relative URL for proxy', err);
            }
        }
    }
    if (requestUrl.origin !== origin) {
        event.respondWith(proxyTo(event.request.url));
        return;
    }

    return; 
});