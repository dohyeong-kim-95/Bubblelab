// 오프라인 실행용 서비스워커. 범위(scope)는 이 파일이 있는 폴더뿐이다 —
// games.bubblelab.dev/teahouse/ 에서도, 나중에 teahouse.bubblelab.dev/ 루트로 옮겨도 같은 코드로 동작한다.
//
// 전략: 묶음 단위 캐시 (cache-first).
//   설치 때 SHELL 전부를 새로(HTTP 캐시 무시) 받아 VERSION 캐시에 넣고, 이후엔 그 묶음만 쓴다.
//   게임 파일이 바뀌면 tools/sw-stamp.mjs 가 VERSION 과 SHELL 을 다시 쓴다 → 이 파일 내용이 바뀌어
//   브라우저가 새 워커를 설치하고, 묶음 전체가 한 번에 바뀐다. 옛 파일·새 파일이 섞이지 않는다.
// 아래 두 줄은 손으로 고치지 말 것: node tools/sw-stamp.mjs
const VERSION = 'teahouse-6374c12833';
const SHELL = [
  './',
  'art/face/cat-blink.webp',
  'art/face/cat-normal.webp',
  'art/face/harin-normal.webp',
  'art/face/harin-sleepy.webp',
  'art/face/harin-smile.webp',
  'art/face/harin-surprised.webp',
  'art/face/harin-teary.webp',
  'art/face/mother-normal.webp',
  'art/face/mother-smile.webp',
  'art/illust.json',
  'art/standing/cat-blink.webp',
  'art/standing/cat-normal.webp',
  'art/standing/harin-normal.webp',
  'art/standing/harin-sleepy.webp',
  'art/standing/harin-smile.webp',
  'art/standing/harin-surprised.webp',
  'art/standing/harin-teary.webp',
  'art/standing/mother-normal.webp',
  'art/standing/mother-smile.webp',
  'audio/ambience/rain.mp3',
  'audio/samples/cello/A3.mp3',
  'audio/samples/cello/B2.mp3',
  'audio/samples/cello/C2.mp3',
  'audio/samples/cello/C4.mp3',
  'audio/samples/cello/D3.mp3',
  'audio/samples/cello/E2.mp3',
  'audio/samples/cello/E4.mp3',
  'audio/samples/cello/F3.mp3',
  'audio/samples/cello/G2.mp3',
  'audio/samples/cello/G4.mp3',
  'audio/samples/glock/C6.mp3',
  'audio/samples/glock/C7.mp3',
  'audio/samples/glock/G5.mp3',
  'audio/samples/glock/G6.mp3',
  'audio/samples/kalimba/B3.mp3',
  'audio/samples/kalimba/Cs4.mp3',
  'audio/samples/kalimba/Ds4.mp3',
  'audio/samples/kalimba/Ds5.mp3',
  'audio/samples/kalimba/G4.mp3',
  'audio/samples/piano/C2_mf.mp3',
  'audio/samples/piano/C2_pp.mp3',
  'audio/samples/piano/C3_mf.mp3',
  'audio/samples/piano/C3_pp.mp3',
  'audio/samples/piano/C4_mf.mp3',
  'audio/samples/piano/C4_pp.mp3',
  'audio/samples/piano/C5_mf.mp3',
  'audio/samples/piano/C5_pp.mp3',
  'audio/samples/piano/C6_mf.mp3',
  'audio/samples/piano/C6_pp.mp3',
  'audio/samples/piano/C7_mf.mp3',
  'audio/samples/piano/C7_pp.mp3',
  'audio/samples/piano/G1_mf.mp3',
  'audio/samples/piano/G1_pp.mp3',
  'audio/samples/piano/G2_mf.mp3',
  'audio/samples/piano/G2_pp.mp3',
  'audio/samples/piano/G3_mf.mp3',
  'audio/samples/piano/G3_pp.mp3',
  'audio/samples/piano/G4_mf.mp3',
  'audio/samples/piano/G4_pp.mp3',
  'audio/samples/piano/G5_mf.mp3',
  'audio/samples/piano/G5_pp.mp3',
  'audio/samples/piano/G6_mf.mp3',
  'audio/samples/piano/G6_pp.mp3',
  'audio/samples.json',
  'audio/sfx/bell.mp3',
  'audio/songs.json',
  'fonts/Galmuri11.woff2',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'manifest.webmanifest',
  'src/audio.js',
  'src/blend.js',
  'src/brewgames.js',
  'src/data.js',
  'src/illust.js',
  'src/install.js',
  'src/main.js',
  'src/menu.js',
  'src/pour.js',
  'src/roam.js',
  'src/save.js',
  'src/scene.js',
  'src/settings.js',
  'src/snapshot.js',
  'src/sprites.js',
  'src/story.js',
  'src/ui.js',
  'style.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('teahouse-') && k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // 게임 폴더 밖(/_shared, 방문 집계 등)은 건드리지 않는다 — 집계가 캐시에 먹히면 안 된다
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    // 묶음에 없던 파일(새로 추가된 것 등)은 받아 두되, 이 버전 묶음 안에만
    if (res.ok && res.type === 'basic') e.waitUntil(cache.put(req, res.clone()));
    return res;
  })());
});
