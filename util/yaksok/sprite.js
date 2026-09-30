// READY 창의 8비트 캐릭터. 16×16 픽셀을 코드로 그린다 — 원작 캐릭터를 베끼지 않고,
// 큰 머리·작은 몸의 오락실풍 꼬마를 사람마다 다르게 만든다(머리 모양·머리색·피부·옷을
// 닉네임에서 고른다). 같은 이름이면 언제 봐도 같은 캐릭터다.
const SIZE = 16;
const SKIN = ["#ffd9b8", "#f6c49c", "#e2a77c", "#c38a5f"];
const HAIR = ["#2b2330", "#5a3a22", "#8b5a2b", "#d9a441", "#e0e0e0", "#d24a6b", "#3b6fd8", "#3aa37a"];
const CLOTH = ["#ff5a5f", "#ffb400", "#28c2a0", "#4c8dff", "#a06bff", "#ff7fbf", "#ff8a3d", "#5cc94f"];
const OUTLINE = "#1d1a24";

function hash(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

// 칸마다 무엇을 칠할지 — "s" 피부, "h" 머리, "c" 옷, "p" 바지, "k" 신발, "e" 눈, "m" 볼, null 빈칸.
function layout(style) {
  const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const set = (x, y, v) => { if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) grid[y][x] = v; };
  // 머리(동그란 큰 머리) — 가운데 (7.5, 6), 반지름 5.6
  for (let y = 0; y < 12; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const d = Math.hypot(x - 7.5, (y - 6) * 1.05);
      if (d <= 5.6) set(x, y, "s");
    }
  }
  // 머리카락
  for (let y = 0; y < 12; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (grid[y][x] !== "s") continue;
      const top = y <= 3 || (y === 4 && (x <= 4 || x >= 11));
      const sides = style === 2 && (x <= 3 || x >= 12) && y <= 10;
      if (top || sides) set(x, y, "h");
    }
  }
  if (style === 1) for (const x of [4, 7, 10]) set(x, 0, "h");          // 삐죽 머리
  if (style === 3) {                                                     // 모자 + 챙
    for (let x = 2; x <= 13; x += 1) { set(x, 3, "c"); if (x <= 12) set(x, 2, "c"); }
    for (let x = 4; x <= 11; x += 1) set(x, 1, "c");
    for (let x = 1; x <= 5; x += 1) set(x, 4, "c");
  }
  // 얼굴
  set(5, 7, "e"); set(5, 6, "e"); set(10, 7, "e"); set(10, 6, "e");
  set(4, 9, "m"); set(11, 9, "m");
  // 몸·팔·다리
  for (let y = 11; y <= 13; y += 1) for (let x = 5; x <= 10; x += 1) set(x, y, "c");
  set(4, 12, "s"); set(11, 12, "s");
  for (const x of [5, 6, 9, 10]) set(x, 14, "p");
  for (const x of [5, 6, 9, 10]) set(x, 15, "k");
  return grid;
}

export function spriteColors(seed) {
  const h = hash(seed);
  return {
    style: h % 4,
    s: SKIN[(h >>> 3) % SKIN.length],
    h: HAIR[(h >>> 6) % HAIR.length],
    c: CLOTH[(h >>> 10) % CLOTH.length],
    p: "#3a3f5c", k: "#2a2530", e: "#1d1a24", m: "#ff9aa2",
  };
}

// silhouette: 한 번도 안 들어온 자리 — 모양만, 색과 얼굴은 없다.
export function drawSprite(canvas, seed, { silhouette = false } = {}) {
  const colors = spriteColors(seed);
  const grid = layout(silhouette ? 0 : colors.style);
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, SIZE, SIZE);
  const filled = (x, y) => grid[y]?.[x] != null;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const v = grid[y][x];
      let color = null;
      if (v) color = silhouette ? "#4a5263" : colors[v];
      else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
        color = silhouette ? "#2e3440" : OUTLINE;            // 바깥 테두리 한 칸
      }
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}
