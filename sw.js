const CACHE="kotoba-music-v1.6.7";
const ASSETS=["./","./index.html","./manifest.webmanifest","./recorder-worklet.js"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("kotoba-music-")&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET"||new URL(e.request.url).origin!==self.location.origin)return;
 // 更新したindexをオンラインで優先。オフラインではこの版のキャッシュを利用。
 e.respondWith(fetch(e.request).then(resp=>{if(resp.ok){const copy=resp.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(e.request,copy)))}return resp}).catch(async()=>{const cache=await caches.open(CACHE);const old=await cache.match(e.request);if(old)return old;if(e.request.mode==="navigate")return cache.match("./index.html");return Response.error()}));
});
