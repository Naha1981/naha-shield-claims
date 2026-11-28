// Self-destruct service worker: replaces legacy workers cached on this origin.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',async e=>{e.waitUntil((async()=>{try{const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)))}catch{}try{await self.registration.unregister()}catch{}try{const cs=await self.clients.matchAll({type:'window'});for(const c of cs)c.navigate(c.url)}catch{}})())});
