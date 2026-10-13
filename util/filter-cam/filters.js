// 필터 카메라의 필터 정의와 픽셀 계산. 화면과 _infra/filter-cam.test.mjs 가 같이 쓴다.
//
// 필터 하나 = 색(채널별 톤 곡선 + 채도) + 겹(글로우·비네팅·플래시·레터박스·날짜 도장).
// 색은 픽셀 루프 한 번에 끝내고, 겹은 캔버스 2D 합성으로 그린다 — ctx.filter 는
// 사파리가 지원하지 않아 쓰지 않는다.

export const FILTERS = [
  { id: "original", name: "원본", tone: {} },
  {
    // 2000년대 컴팩트 디카 플래시: 날아간 하이라이트, 진한 그림자, 어두운 모서리, 날짜 도장.
    id: "flash", name: "플래시 디카",
    tone: { exposure: 1.12, contrast: 1.28, temp: -0.03 }, sat: 1.05,
    flash: 0.22, vignette: 0.5, stamp: true,
  },
  {
    // 로파이 더스크: 해 진 뒤처럼 어둡고 푸른 보랏빛, 빛 번짐과 고운 입자.
    id: "lofi", name: "로파이 더스크",
    tone: { exposure: 0.84, contrast: 0.92, fade: 0.07, shadows: [0.02, -0.01, 0.09], highlights: [0.05, 0.0, 0.06] },
    sat: 0.78, glow: 0.35, grain: 0.1, vignette: 0.35,
  },
  {
    // 2016 감성: 과포화·밝고 따뜻한 옛 인스타 피드.
    id: "y2016", name: "2016 쨍",
    tone: { exposure: 1.06, contrast: 1.1, temp: 0.05 }, sat: 1.45,
  },
  {
    // 필름 400: 따뜻한 피부, 들뜬 검정, 노르스름한 하이라이트, 입자.
    id: "film", name: "필름 400",
    tone: { exposure: 1.03, contrast: 0.95, fade: 0.06, temp: 0.04, highlights: [0.03, 0.02, -0.03] },
    sat: 0.9, grain: 0.07, vignette: 0.2,
  },
  {
    // 소프트 글로우: 밝고 뿌옇게 번지는 몽환 톤, 살짝 분홍.
    id: "soft", name: "소프트 글로우",
    tone: { exposure: 1.08, contrast: 0.86, fade: 0.03, highlights: [0.03, 0.0, 0.02] },
    sat: 0.94, glow: 0.5,
  },
  {
    // 하이콘 흑백: 대비가 센 모노와 입자.
    id: "mono", name: "하이콘 흑백",
    tone: { contrast: 1.35 }, sat: 0, grain: 0.05, vignette: 0.25,
  },
  {
    // 시네마: 청록 그림자 + 주황 하이라이트, 2.39:1 레터박스.
    id: "cinema", name: "시네마",
    tone: { contrast: 1.12, shadows: [-0.04, 0.02, 0.05], highlights: [0.06, 0.02, -0.05] },
    sat: 0.9, letterbox: true, vignette: 0.2,
  },
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
