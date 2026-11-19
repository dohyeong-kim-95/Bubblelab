// 일러스트(Codex 가 만든 픽셀 PNG): 스탠딩(입식)과 얼굴 그래픽.
// 목록은 art/illust.json. 목록에 없거나 아직 안 그린 그림은 null → 화면은 코드 픽셀 초상화로 대신한다.
//   illust.json 예: { "harin": { "ext": "webp", "faces": ["normal","smile"], "standing": [512,768], "face": [192,192] } }
// 찻집 화면(위 네모)만 픽셀아트이고, 일러스트는 매끈한 원본 그대로 쓴다 (사용자 2026-11-17).

let manifest = {};
const cache = new Map();

export async function loadIllust() {
  try {
    const r = await fetch('art/illust.json');
    if (r.ok) manifest = await r.json();
  } catch { manifest = {}; }
  // 표정이 바뀔 때 깜빡이지 않게 미리 받아 둔다
  for (const [id, m] of Object.entries(manifest)) {
    for (const f of m.faces ?? []) { img('face', id, f); img('standing', id, f); }
  }
}

export function has(kind, id, face) {
  const m = manifest[id];
  return !!m && (m.faces ?? []).includes(face) && !!m[kind];
}

/** <img> (같은 그림은 같은 요소를 다시 쓴다). 없으면 null */
export function img(kind, id, face) {
  if (!has(kind, id, face)) return null;
  const key = `${kind}/${id}-${face}`;
  if (!cache.has(key)) {
    const el = new Image();
    el.src = `art/${kind}/${id}-${face}.${manifest[id].ext ?? 'png'}`;
    el.alt = '';
    el.decoding = 'async';
    el.className = `illust illust-${kind}`;
    el.dataset.id = id;
    const [w, h] = manifest[id][kind];
    el.width = w; el.height = h;
    cache.set(key, el);
  }
  return cache.get(key);
}
