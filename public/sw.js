// 빌드메이트 푸시 알림: 알림이 오면 서버에서 내용을 받아 보여 준다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let item = { id: 'bm', title: '빌드메이트', body: '새 알림이 있어요', url: '/admin' };
    try {
      const r = await fetch('/api/push/latest', { credentials: 'include', cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j && j.item) item = j.item; }
    } catch (e) { /* 내용을 못 받아도 기본 알림은 보여 준다 */ }
    await self.registration.showNotification(item.title, { body: item.body, tag: item.id, icon: '/icon.svg', data: { url: item.url } });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/admin';
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if ('focus' in c) { await c.focus(); if ('navigate' in c) { try { await c.navigate(url); } catch (e) { /* 다른 출처면 무시 */ } } return; }
    }
    await self.clients.openWindow(url);
  })());
});
