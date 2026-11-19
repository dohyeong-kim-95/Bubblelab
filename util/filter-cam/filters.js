// 필터 카메라의 필터 정의와 픽셀 계산. 화면과 _infra/filter-cam.test.mjs 가 같이 쓴다.
//
// 필터 하나 = 색(채널별 톤 곡선 + 채도) + 겹(글로우·비네팅·플래시·레터박스·날짜 도장).
// 색은 픽셀 루프 한 번에 끝내고, 겹은 캔버스 2D 합성으로 그린다 — ctx.filter 는
// 사파리가 지원하지 않아 쓰지 않는다.

// group: "mood"(감성 — 색과 겹) · "fun"(장난 — effect 가 픽셀을 비틀거나 바꾼다).
export const FILTERS = [
  { id: "original", name: "원본", group: "mood", tone: {} },
  {
    // 2000년대 컴팩트 디카 플래시: 날아간 하이라이트, 진한 그림자, 어두운 모서리, 날짜 도장.
    id: "flash", group: "mood", name: "플래시 디카",
    tone: { exposure: 1.12, contrast: 1.28, temp: -0.03 }, sat: 1.05,
    flash: 0.22, vignette: 0.5, stamp: true,
  },
  {
    // 로파이 더스크: 해 진 뒤처럼 어둡고 푸른 보랏빛, 빛 번짐과 고운 입자.
    id: "lofi", group: "mood", name: "로파이 더스크",
    tone: { exposure: 0.84, contrast: 0.92, fade: 0.07, shadows: [0.02, -0.01, 0.09], highlights: [0.05, 0.0, 0.06] },
    sat: 0.78, glow: 0.35, grain: 0.1, vignette: 0.35,
  },
  {
    // 2016 감성: 과포화·밝고 따뜻한 옛 인스타 피드.
    id: "y2016", group: "mood", name: "2016 쨍",
    tone: { exposure: 1.06, contrast: 1.1, temp: 0.05 }, sat: 1.45,
  },
  {
    // 필름 400: 따뜻한 피부, 들뜬 검정, 노르스름한 하이라이트, 입자.
    id: "film", group: "mood", name: "필름 400",
    tone: { exposure: 1.03, contrast: 0.95, fade: 0.06, temp: 0.04, highlights: [0.03, 0.02, -0.03] },
    sat: 0.9, grain: 0.07, vignette: 0.2,
  },
  {
    // 소프트 글로우: 밝고 뿌옇게 번지는 몽환 톤, 살짝 분홍.
    id: "soft", group: "mood", name: "소프트 글로우",
    tone: { exposure: 1.08, contrast: 0.86, fade: 0.03, highlights: [0.03, 0.0, 0.02] },
    sat: 0.94, glow: 0.5,
  },
  {
    // 하이콘 흑백: 대비가 센 모노와 입자.
    id: "mono", group: "mood", name: "하이콘 흑백",
    tone: { contrast: 1.35 }, sat: 0, grain: 0.05, vignette: 0.25,
  },
  {
    // 시네마: 청록 그림자 + 주황 하이라이트, 2.39:1 레터박스.
    id: "cinema", group: "mood", name: "시네마",
    tone: { contrast: 1.12, shadows: [-0.04, 0.02, 0.05], highlights: [0.06, 0.02, -0.05] },
    sat: 0.9, letterbox: true, vignette: 0.2,
  },
  // ── 장난 ── (얼굴 인식 없이 화면 가운데를 기준으로 비튼다)
  { id: "bulge", name: "왕코 볼록거울", group: "fun", effect: "bulge", hint: "얼굴을 화면 가운데에 맞춰 보세요" },
  { id: "swirl", name: "소용돌이", group: "fun", effect: "swirl", hint: "얼굴을 화면 가운데에 맞춰 보세요" },
  { id: "mirror", name: "데칼코마니", group: "fun", effect: "mirror", hint: "코끝을 화면 한가운데 세로선에 맞춰 보세요" },
  // 타임 워프는 시간이 걸리는 촬영이라 화면(index.html)이 직접 돌린다. 여기서는 그대로 둔다.
  { id: "timewarp", name: "타임 워프 스캔", group: "fun", effect: "timewarp", hint: "셔터를 누르면 파란 선이 내려가요. 선이 지나간 줄은 그대로 굳어요" },
  { id: "pixel", name: "8비트 게임", group: "fun", effect: "pixel" },
  { id: "thermal", name: "열화상", group: "fun", effect: "thermal" },
  { id: "comic", name: "만화", group: "fun", effect: "comic" },
  { id: "popart", name: "팝아트 4분할", group: "fun", effect: "popart" },
];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 채널별 256칸 룩업표. 톤 곡선은 이 표 안에서만 계산한다. */
export function buildLuts({ exposure = 1, contrast = 1, fade = 0, temp = 0, shadows = [0, 0, 0], highlights = [0, 0, 0] } = {}) {
  const gain = [1 + temp, 1, 1 - temp];
  return [0, 1, 2].map((ch) => {
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      let x = (v / 255) * exposure * gain[ch];
      x = (x - 0.5) * contrast + 0.5;
      const t = clamp01(x);
      x += shadows[ch] * (1 - t) * (1 - t) + highlights[ch] * t * t;
      x = fade + clamp01(x) * (1 - fade);
      lut[v] = Math.round(clamp01(x) * 255);
    }
    return lut;
  });
}

// 입자는 매 프레임 Math.random 을 부르지 않고 고정 표를 돌려 쓴다(빠르고, 테스트가 재현된다).
const NOISE = (() => {
  const table = new Float32Array(4096);
  let seed = 12345;
  for (let i = 0; i < table.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    table[i] = seed / 0xffffffff - 0.5;
  }
  return table;
})();

const lutCache = new Map();
const lutsOf = (filter) => {
  if (!lutCache.has(filter.id)) lutCache.set(filter.id, buildLuts(filter.tone));
  return lutCache.get(filter.id);
};

/** RGBA 픽셀 배열에 필터의 색(톤·채도·입자)을 제자리에서 입힌다. */
export function applyColor(data, filter, frame = 0) {
  if (filter.id === "original") return data;
  const [lr, lg, lb] = lutsOf(filter);
  const sat = filter.sat ?? 1;
  const grain = (filter.grain ?? 0) * 255;
  let n = (frame * 769) & 4095;
  for (let i = 0; i < data.length; i += 4) {
    let r = lr[data[i]], g = lg[data[i + 1]], b = lb[data[i + 2]];
    if (sat !== 1) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
    }
    if (grain) {
      const d = NOISE[n] * grain;
      n = (n + 1) & 4095;
      r += d; g += d; b += d;
    }
    data[i] = r; data[i + 1] = g; data[i + 2] = b; // Uint8ClampedArray 가 0~255 로 자른다
  }
  return data;
}

/** 디카 날짜 도장 문구. 예: '26 10 13 */
export function stampText(date = new Date()) {
  const p = (v) => String(v).padStart(2, "0");
  return `'${p(date.getFullYear() % 100)} ${p(date.getMonth() + 1)} ${p(date.getDate())}`;
}

/** 색을 입힌 캔버스 위에 겹(글로우·플래시·비네팅·레터박스·도장)을 그린다. */
export function applyLayers(ctx, canvas, filter, scratch) {
  const { width: w, height: h } = canvas;
  if (filter.glow) {
    // 작게 줄였다 늘리면 값싼 흐림이 된다. 그걸 screen 으로 얹으면 빛 번짐.
    scratch.width = Math.max(1, Math.round(w / 12));
    scratch.height = Math.max(1, Math.round(h / 12));
    const s = scratch.getContext("2d");
    s.imageSmoothingEnabled = true;
    s.drawImage(canvas, 0, 0, scratch.width, scratch.height);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = filter.glow;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(scratch, 0, 0, w, h);
    ctx.restore();
  }
  if (filter.flash) {
    const g = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.55);
    g.addColorStop(0, `rgba(255,255,255,${filter.flash})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  if (filter.vignette) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${filter.vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  if (filter.letterbox) {
    const bar = Math.max(0, Math.round((h - w / 2.39) / 2 * 0.5));
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
  }
  if (filter.stamp) {
    const size = Math.round(w * 0.055);
    ctx.save();
    ctx.font = `bold ${size}px ui-monospace, "SF Mono", Consolas, monospace`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.shadowColor = "rgba(255,120,0,.9)";
    ctx.shadowBlur = size * 0.4;
    ctx.fillStyle = "#ffa13a";
    ctx.fillText(stampText(), w - size * 0.8, h - size * 0.7);
    ctx.restore();
  }
}

// ── 장난 필터의 픽셀 계산 ──────────────────────────────────────────────

// 비틀기는 "출력 칸마다 원본의 어느 칸을 가져올지" 표 하나로 끝난다. 화면 크기마다 한 번만 만든다.
const mapCache = new Map();
function sourceMap(kind, w, h) {
  const key = `${kind}:${w}x${h}`;
  if (mapCache.has(key)) return mapCache.get(key);
  const map = new Int32Array(w * h);
  const cx = w / 2, cy = h / 2, radius = Math.min(w, h) * 0.46;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = x, sy = y;
      if (kind === "mirror") {
        sx = x < cx ? x : w - 1 - x;
      } else if (kind === "popart") {
        sx = (x * 2) % w; sy = (y * 2) % h; // 2×2 로 같은 화면을 네 번
      } else {
        const dx = x - cx, dy = y - cy;
        const r = Math.hypot(dx, dy) / radius;
        if (r < 1) {
          if (kind === "bulge") {
            const k = r * 0.3 + r * r * 0.7; // 가운데일수록 좁은 곳을 넓게 펼친다
            const f = r ? k / r : 0.3;
            sx = cx + dx * f;
            sy = cy + dy * f;
          } else if (kind === "swirl") {
            const turn = 3.2 * (1 - r) * (1 - r);
            const cos = Math.cos(turn), sin = Math.sin(turn);
            sx = cx + dx * cos - dy * sin;
            sy = cy + dx * sin + dy * cos;
          }
        }
      }
      sx = Math.min(w - 1, Math.max(0, Math.round(sx)));
      sy = Math.min(h - 1, Math.max(0, Math.round(sy)));
      map[y * w + x] = sy * w + sx;
    }
  }
  mapCache.set(key, map);
  return map;
}

const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// 옛 휴대용 게임기 느낌의 16색.
const GAME_PALETTE = ["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
  "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa"].map(hex);

// 열화상: 차가운 남색 → 보라 → 빨강 → 노랑 → 흰색.
const THERMAL = (() => {
  const stops = [[0, "#000020"], [0.25, "#3a0ca3"], [0.5, "#d00000"], [0.75, "#ffba08"], [1, "#ffffff"]]
    .map(([t, c]) => [t, hex(c)]);
  const lut = new Uint8ClampedArray(256 * 3);
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1];
    const f = (t - t0) / (t1 - t0);
    for (let ch = 0; ch < 3; ch++) lut[v * 3 + ch] = c0[ch] + (c1[ch] - c0[ch]) * f;
  }
  return lut;
})();

// 팝아트 네 칸: [어두운 색, 중간 색, 밝은 색].
const POP = [["#1a1a6e", "#ff3d8b", "#ffe14d"], ["#0b3d2e", "#00c2a8", "#fff3b0"],
  ["#4a0d67", "#ff8c00", "#b8f2e6"], ["#7a0019", "#3ec1ff", "#fdfd96"]].map((q) => q.map(hex));

/** 장난 필터: src 픽셀을 읽어 dst 에 쓴다(둘은 같은 크기의 RGBA). effect 가 없으면 false. */
export function applyEffect(src, dst, filter) {
  const { width: w, height: h } = src;
  const s = src.data, d = dst.data;
  const effect = filter.effect;
  if (!effect || effect === "timewarp") { d.set(s); return Boolean(effect); }

  if (effect === "bulge" || effect === "swirl" || effect === "mirror" || effect === "popart") {
    const map = sourceMap(effect, w, h);
    for (let p = 0; p < map.length; p++) {
      const from = map[p] * 4, to = p * 4;
      if (effect === "popart") {
        const l = luma(s, from);
        const quad = POP[(p % w < w / 2 ? 0 : 1) + (p < (h / 2) * w ? 0 : 2)];
        const c = quad[l < 85 ? 0 : l < 170 ? 1 : 2];
        d[to] = c[0]; d[to + 1] = c[1]; d[to + 2] = c[2];
      } else {
        d[to] = s[from]; d[to + 1] = s[from + 1]; d[to + 2] = s[from + 2];
      }
      d[to + 3] = 255;
    }
    return true;
  }

  if (effect === "thermal") {
    for (let i = 0; i < s.length; i += 4) {
      const v = Math.round(luma(s, i)) * 3;
      d[i] = THERMAL[v]; d[i + 1] = THERMAL[v + 1]; d[i + 2] = THERMAL[v + 2]; d[i + 3] = 255;
    }
    return true;
  }

  if (effect === "pixel") {
    // 가로 48칸짜리 큰 픽셀. 칸마다 평균색을 16색 중 가장 가까운 색으로 바꾼다.
    const block = Math.max(2, Math.round(w / 48));
    for (let by = 0; by < h; by += block) {
      for (let bx = 0; bx < w; bx += block) {
        let r = 0, g = 0, b = 0, n = 0;
        const ey = Math.min(h, by + block), ex = Math.min(w, bx + block);
        for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4; r += s[i]; g += s[i + 1]; b += s[i + 2]; n++;
        }
        r /= n; g /= n; b /= n;
        let best = GAME_PALETTE[0], bestDist = Infinity;
        for (const c of GAME_PALETTE) {
          const dist = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
          if (dist < bestDist) { bestDist = dist; best = c; }
        }
        for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
          const i = (y * w + x) * 4; d[i] = best[0]; d[i + 1] = best[1]; d[i + 2] = best[2]; d[i + 3] = 255;
        }
      }
    }
    return true;
  }

  if (effect === "comic") {
    // 색을 채널당 4단계로 줄이고, 밝기 경계(소벨)가 센 곳은 검은 선으로 칠한다.
    const edge = 110;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let line = false;
        if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
          const at = (ox, oy) => luma(s, ((y + oy) * w + x + ox) * 4);
          const gx = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1);
          const gy = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1);
          line = gx * gx + gy * gy > edge * edge;
        }
        if (line) { d[i] = d[i + 1] = d[i + 2] = 20; }
        else for (let ch = 0; ch < 3; ch++) d[i + ch] = Math.min(255, Math.round(s[i + ch] / 64) * 85);
        d[i + 3] = 255;
      }
    }
    return true;
  }
  d.set(s);
  return false;
}
