// 손금 선 이름표(알약) 자리 정하기 — 순수 함수(DOM 없음). 화면(palm.js)과 Node 테스트(_infra/fortune.test.mjs)가 같이 쓴다.
// 규칙: 선의 시작 쪽을 먼저 본다(line-drawing §5-4 "선 시작점 근처"). 시작점에서 선을 따라 조금씩 옮겨 가며
// 점마다 위·아래·오른쪽·왼쪽 자리를 차례로 대 보고, 사진 안에 들어가면서 이미 놓인 이름표와 겹치지 않는 첫 자리를 쓴다.
// 다 겹치면 겹침이 가장 적은 자리. 어떤 경우에도 사진 밖으로 나가지 않는다(가장자리 여백 안으로 당긴다).

const FRACTIONS = [0, 0.08, 0.16, 0.25, 0.35, 0.5, 0.65, 0.8];

/** pieces(0~1 좌표 조각들)에서 시작 쪽부터 고르게 고른 앵커 점(픽셀). */
export function anchorsOf(pieces, W, H) {
  const pts = (pieces || []).flat().filter((p) => Array.isArray(p) && p.length >= 2);
  if (!pts.length) return [];
  return FRACTIONS.map((f) => pts[Math.min(pts.length - 1, Math.round(f * (pts.length - 1)))]).map(([x, y]) => [x * W, y * H]);
}

const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * labels: [{ key, w, h, anchors: [[x,y], …] }] (픽셀, anchors 는 시작 쪽부터)
 * → [{ key, x, y, w, h }] 왼쪽 위 기준. gap 은 이름표끼리·선과 띄울 거리, margin 은 사진 가장자리 여백.
 */
export function placeLabels(labels, W, H, { gap = 6, margin = 4 } = {}) {
  const placed = [];
  const clamp = (r) => ({
    ...r,
    x: Math.min(Math.max(r.x, margin), Math.max(margin, W - r.w - margin)),
    y: Math.min(Math.max(r.y, margin), Math.max(margin, H - r.h - margin)),
  });
  const padded = (r) => ({ x: r.x - gap / 2, y: r.y - gap / 2, w: r.w + gap, h: r.h + gap });
  for (const l of labels) {
    const { w, h } = l;
    let best = null, bestCost = Infinity;
    for (const [ax, ay] of l.anchors.length ? l.anchors : [[W / 2, H / 2]]) {
      const spots = [
        { x: ax - w / 2, y: ay - h - gap },        // 위
        { x: ax - w / 2, y: ay + gap },            // 아래
        { x: ax + gap, y: ay - h / 2 },            // 오른쪽
        { x: ax - w - gap, y: ay - h / 2 },        // 왼쪽
      ];
      for (const s of spots) {
        const r = clamp({ x: s.x, y: s.y, w, h });
        const cost = placed.reduce((sum, p) => sum + overlap(padded(r), padded(p)), 0);
        if (cost < bestCost) { best = r; bestCost = cost; }
        if (cost === 0) break;
      }
      if (bestCost === 0) break;
    }
    placed.push({ key: l.key, ...best });
  }
  return placed;
}

export const labelsOverlap = (a, b) => overlap(a, b) > 0;
