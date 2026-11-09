/* ── SERVICE WORKER ──
   Shows schedule notifications pushed by the server (lib/push-notify.js) and
   opens My Schedule when one is tapped. It caches nothing: every page still
   comes straight from the server. Served from the site root so its scope
   covers every page. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { body: event.data ? event.data.text() : '' };
    }
    event.waitUntil(self.registration.showNotification(data.title || 'MSI', {
        body: data.body || '',
        icon: '/icons/app-icon-192.png',
        badge: '/icons/badge-96.png',
        tag: data.tag || undefined,
        // A changed schedule replaces its earlier notification but still buzzes.
        renotify: Boolean(data.tag),
        data: { url: data.url || '/user_account#schedule' }
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = new URL(event.notification.data && event.notification.data.url || '/user_account#schedule', self.location.origin).href;
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        // Reuse an open tab of the site; reload it so the new schedule shows.
        const open = windows.find(client => new URL(client.url).origin === self.location.origin);
        if (open) {
            await open.focus();
            return open.navigate(target).catch(() => null);
        }
        return self.clients.openWindow(target);
    })());
});
