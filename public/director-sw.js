const CACHE='lightflow-director-4z4xIqwYxjX72N5WTNkM-';
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const response=await fetch('/director-cache.json',{cache:'no-store'});if(!response.ok)throw Error('Offline manifest unavailable');
 const assets=await response.json();const cache=await caches.open(CACHE);await cache.addAll(['/director',...assets]);await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('lightflow-director-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(url.origin!==location.origin||event.request.method!=='GET')return;
 if(event.request.mode==='navigate'&&url.pathname.startsWith('/director')){event.respondWith(fetch(event.request).catch(()=>caches.match('/director')));return;}
 if(url.pathname.startsWith('/_next/static/')||url.pathname.startsWith('/models/')||url.pathname.startsWith('/ort/')||url.pathname==='/director-capture.js'||url.pathname==='/icon.svg')event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
