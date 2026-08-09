// 카메라 한 장에서 "발이 지금 어디를 밟고 있는지"를 뽑아내는 순수 함수 모음.
// 모델도 라이브러리도 쓰지 않는다 — 폰 앞에서 도는 게 목적이라 저해상도(96×72)
// 프레임 하나에 배경 차분 몇 줄이면 충분하다.
//
// 흐름:
//   frameChannels(ImageData)  저해상도 RGB로 편다
//   foreground(bg, frame)     빈 바닥(bg)과 달라진 픽셀 = 사람
//   denoise(mask)             혼자 떠 있는 점 제거
//   footPoints(mask)          열마다 가장 아래 전경 픽셀 = 바닥에 닿은 지점,
//                             이어지는 것끼리 묶어 발 하나로 (최대 두 발)
//   padCoords(x, y, quad)     화면에 그린 발판 사각형 안의 좌표 (u, v)로
//   panelAt(u, v, pad)        3×3 칸 중 어느 패널인지
//
// 좌표계: 이미지 픽셀은 y=0이 위. 카메라가 사람을 비스듬히 보므로 아래쪽일수록
// 카메라에 가깝다 — 사람 실루엣에서 가장 아래 픽셀이 곧 발이다.

const lumaOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** ImageData(이미 작게 그려진 프레임) → [r,g,b, r,g,b, …] Float32Array */
export function frameChannels({ data, width, height }) {
  const out = new Float32Array(width * height * 3);
  for (let i = 0, p = 0; i < out.length; i += 3, p += 4) {
    out[i] = data[p];
    out[i + 1] = data[p + 1];
    out[i + 2] = data[p + 2];
  }
  return out;
}

/** 여러 장을 평균 낸 "빈 바닥" 기준 프레임 */
export function averageFrames(frames) {
  const out = new Float32Array(frames[0].length);
  for (const f of frames) for (let i = 0; i < out.length; i++) out[i] += f[i];
  for (let i = 0; i < out.length; i++) out[i] /= frames.length;
  return out;
}

/**
 * 배경을 아주 천천히 현재 프레임 쪽으로 끌어당긴다. 전경(발·사람)으로 판정된
 * 픽셀은 건드리지 않는다 — 안 그러면 가만히 서 있는 발이 배경에 스며든다.
 * 조명이 변하거나 그림자가 옮겨가도 보정이 유지되는 이유.
 */
export function blendBackground(bg, frame, mask, rate = 0.02) {
  const n = mask.length;
  for (let i = 0; i < n; i++) {
    if (mask[i]) continue;
    const p = i * 3;
    bg[p] += (frame[p] - bg[p]) * rate;
    bg[p + 1] += (frame[p + 1] - bg[p + 1]) * rate;
    bg[p + 2] += (frame[p + 2] - bg[p + 2]) * rate;
  }
  return bg;
}

/**
 * 배경과 달라진 픽셀 = 1. 그림자는 걸러낸다:
 * 그림자는 밝기만 고르게 내려가고 색조(r:g:b 비율)는 그대로라, 색조까지 같이
 * 변한 픽셀만 진짜 물체로 본다. shadow=false면 이 억제를 끈다 (어두운 신발이
 * 밝은 바닥 위에 있으면 그림자와 구분이 안 되므로 화면에서 끌 수 있게 했다).
 */
export function foreground(bg, frame, opts = {}) {
  const {
    lumaThreshold = 14,
    shadow = true,
    shadowLo = 0.5,
    shadowHi = 0.94,
    chromaThreshold = 0.035,
  } = opts;
  const n = frame.length / 3;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 3;
    const br = bg[p], bgn = bg[p + 1], bb = bg[p + 2];
    const cr = frame[p], cg = frame[p + 1], cb = frame[p + 2];
    const bl = Math.max(lumaOf(br, bgn, bb), 1);
    const cl = Math.max(lumaOf(cr, cg, cb), 1);
    if (Math.abs(cl - bl) < lumaThreshold) continue;
    if (shadow) {
      const ratio = cl / bl;
      if (ratio > shadowLo && ratio < shadowHi) {
        const chroma = Math.abs(cr / cl - br / bl) +
                       Math.abs(cg / cl - bgn / bl) +
                       Math.abs(cb / cl - bb / bl);
        if (chroma < chromaThreshold) continue;
      }
    }
    mask[i] = 1;
  }
  return mask;
}

/** 이웃 없이 혼자 켜진 픽셀을 끈다 (센서 노이즈 제거) */
export function denoise(mask, cols, rows, minNeighbors = 2) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!mask[i]) continue;
      let n = 0;
      if (x > 0 && mask[i - 1]) n++;
      if (x < cols - 1 && mask[i + 1]) n++;
      if (y > 0 && mask[i - cols]) n++;
      if (y < rows - 1 && mask[i + cols]) n++;
      if (n >= minNeighbors) out[i] = 1;
    }
  }
  return out;
}

/**
 * 발 접지점 찾기. 열마다 아래에서 위로 훑어 minRun만큼 이어지는 전경이
 * 처음 나오는 지점을 그 열의 "바닥에 닿은 곳"으로 삼고, 옆 열과 높이가
 * 이어지면(gapY 이내) 같은 덩어리로 묶는다. 다리 위쪽 몸통은 훨씬 높은
 * 곳에서 끊기므로 자연히 다른 덩어리가 되고, 두 발 사이에는 바닥이 보여
 * 덩어리가 갈라진다.
 * 반환은 카메라에 가까운(=아래쪽) 순으로 최대 maxFeet개.
 */
export function footPoints(mask, cols, rows, opts = {}) {
  const { minRun = 2, minWidth = 2, gapY = 3, maxFeet = 2 } = opts;
  const bottom = new Int16Array(cols).fill(-1);
  for (let x = 0; x < cols; x++) {
    let run = 0;
    for (let y = rows - 1; y >= 0; y--) {
      if (mask[y * cols + x]) {
        if (++run >= minRun) { bottom[x] = y + run - 1; break; }
      } else {
        run = 0;
      }
    }
  }

  const segments = [];
  let cur = null;
  for (let x = 0; x < cols; x++) {
    const y = bottom[x];
    if (y < 0) { cur = null; continue; }
    if (cur && Math.abs(y - cur.lastY) <= gapY) {
      cur.sumX += x; cur.n++; cur.lastY = y;
      if (y > cur.maxY) cur.maxY = y;
    } else {
      cur = { sumX: x, n: 1, lastY: y, maxY: y };
      segments.push(cur);
    }
  }

  return segments
    .filter((s) => s.n >= minWidth)
    .map((s) => ({ x: s.sumX / s.n, y: s.maxY, width: s.n }))
    .sort((a, b) => b.y - a.y || b.width - a.width)
    .slice(0, maxFeet);
}

/* ---------- 화면에 그린 발판(사각형) 안의 좌표 ---------- */

const cross = (ax, ay, bx, by) => ax * by - ay * bx;

// 사각형 네 점은 [좌상, 우상, 우하, 좌하] 순서, 각각 0~1로 정규화된 {x, y}.
// u는 좌→우, v는 위→아래. 원근이 들어간 사다리꼴이라 단순 비율이 아니라
// 쌍선형 보간의 역함수를 푼다 (2차방정식 — 근이 둘이면 단위정사각형에
// 가까운 쪽을 고른다).
export function padCoords(px, py, quad) {
  const [a, b, c, d] = quad;
  const ex = b.x - a.x, ey = b.y - a.y;
  const fx = d.x - a.x, fy = d.y - a.y;
  const gx = a.x - b.x + c.x - d.x, gy = a.y - b.y + c.y - d.y;
  const hx = px - a.x, hy = py - a.y;

  const k2 = cross(gx, gy, fx, fy);
  const k1 = cross(ex, ey, fx, fy) + cross(hx, hy, gx, gy);
  const k0 = cross(hx, hy, ex, ey);

  const uAt = (v) => {
    // u(e + g·v) = h − f·v — 분모가 큰 축으로 나눠야 수치가 안정적이다
    const denomX = ex + gx * v, denomY = ey + gy * v;
    return Math.abs(denomX) > Math.abs(denomY)
      ? (hx - fx * v) / denomX
      : (hy - fy * v) / denomY;
  };
  const away = (u, v) => {
    const du = u < 0 ? -u : u > 1 ? u - 1 : 0;
    const dv = v < 0 ? -v : v > 1 ? v - 1 : 0;
    return du + dv;
  };

  const roots = [];
  if (Math.abs(k2) < 1e-9) {
    if (Math.abs(k1) > 1e-12) roots.push(-k0 / k1);
  } else {
    const disc = k1 * k1 - 4 * k0 * k2;
    if (disc < 0) return null;
    const w = Math.sqrt(disc);
    roots.push((-k1 - w) / (2 * k2), (-k1 + w) / (2 * k2));
  }

  let best = null;
  for (const v of roots) {
    if (!Number.isFinite(v)) continue;
    const u = uAt(v);
    if (!Number.isFinite(u)) continue;
    const d2 = away(u, v);
    if (!best || d2 < best.away) best = { u, v, away: d2 };
  }
  return best ? { u: best.u, v: best.v } : null;
}

/* ---------- 발판 배치 ---------- */

// 3×3 칸 위에 패널을 얹는다. 배열 순서 = 화면 레인 순서(왼→오른).
// 펌프는 네 귀퉁이+가운데, 나머지 네 칸은 실제 발판처럼 빈 틈이다.
export const PADS = {
  pump: {
    id: "pump",
    name: "펌프 5패널",
    panels: [
      { id: "ul", label: "◤", col: 0, row: 0, hue: 195 },
      { id: "dl", label: "◣", col: 0, row: 2, hue: 45 },
      { id: "c", label: "●", col: 1, row: 1, hue: 0 },
      { id: "ur", label: "◥", col: 2, row: 0, hue: 195 },
      { id: "dr", label: "◢", col: 2, row: 2, hue: 45 },
    ],
  },
  ddr: {
    id: "ddr",
    name: "DDR 4패널",
    panels: [
      { id: "l", label: "←", col: 0, row: 1, hue: 320 },
      { id: "d", label: "↓", col: 1, row: 2, hue: 200 },
      { id: "u", label: "↑", col: 1, row: 0, hue: 140 },
      { id: "r", label: "→", col: 2, row: 1, hue: 320 },
    ],
  },
};

export const padOf = (id) => PADS[id] ?? PADS.pump;

/** (u, v)가 어느 패널 위인지. 발판 밖이거나 빈 칸이면 null */
export function panelAt(u, v, pad) {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
  const col = Math.min(2, Math.floor(u * 3));
  const row = Math.min(2, Math.floor(v * 3));
  return pad.panels.find((p) => p.col === col && p.row === row)?.id ?? null;
}

/** 발 좌표(그리드 픽셀) 목록 → 지금 밟고 있는 패널 id 집합 */
export function pressedPanels(feet, { cols, rows, quad, pad }) {
  const on = new Set();
  for (const foot of feet) {
    const c = padCoords(foot.x / cols, foot.y / rows, quad);
    if (!c) continue;
    const panel = panelAt(c.u, c.v, pad);
    if (panel) on.add(panel);
  }
  return on;
}

/* ---------- 밟는 순간(누른 모서리) 잡아내기 ---------- */

/**
 * 패널 위에 발이 "새로 올라온" 순간만 스텝으로 친다.
 * releaseMs 동안 안 보여야 뗀 것으로 인정 — 한 프레임 깜빡임에 연타로
 * 오인되지 않게. repeatMs는 같은 패널 최소 재입력 간격.
 */
export function createStepTracker({ releaseMs = 70, repeatMs = 110 } = {}) {
  const state = new Map(); // panel → { down, lastSeen, lastStep }
  return {
    /** @returns {string[]} 이번 프레임에 새로 밟힌 패널들 */
    update(panels, now) {
      const steps = [];
      for (const id of panels) {
        const s = state.get(id) ?? { down: false, lastSeen: -1e9, lastStep: -1e9 };
        if (!s.down && now - s.lastStep >= repeatMs) {
          s.down = true;
          s.lastStep = now;
          steps.push(id);
        }
        s.lastSeen = now;
        state.set(id, s);
      }
      for (const [id, s] of state) {
        if (s.down && !panels.has(id) && now - s.lastSeen >= releaseMs) s.down = false;
      }
      return steps;
    },
    reset() { state.clear(); },
  };
}
