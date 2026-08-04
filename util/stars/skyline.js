// util/stars — 카메라 한 장에서 스카이라인(하늘과 건물의 경계) 모양만 뽑아낸다.
//
// 결과물에 사진을 넣지 않는 것이 이 토이의 규칙이다. 그래서 여기서 남기는 것은
// **열마다 경계가 어디였는지**를 적은 숫자 배열 하나뿐이다 — 색도, 질감도, 창문
// 불빛도 남지 않는다. 그 숫자로 배경화면에 실루엣만 그린다.
//
// 낮과 밤이 반대로 생겼다는 점이 이 문제의 핵심이다.
//   낮: 밝은 하늘 위 / 어두운 건물 아래  → 위에서 아래로 밝기가 **떨어진다**
//   밤: 어두운 하늘 위 / 불 켜진 도시 아래 → 밝기가 **올라간다**
// 그래서 밝기의 방향이 아니라 **변화가 가장 큰 자리**를 경계로 본다.

// 세로 경계는 몇 픽셀 단위로 흔들리므로 이 정도로 줄여도 모양은 남는다.
const COLUMNS = 96;
const ROWS = 72;

// {data(RGBA), width, height} → columns×rows 밝기 격자 (0~1)
export function downsampleLuma(image, columns = COLUMNS, rows = ROWS) {
  const { data, width, height } = image;
  const cells = new Float32Array(columns * rows);
  const counts = new Uint32Array(columns * rows);
  for (let y = 0; y < height; y++) {
    const ry = Math.min(rows - 1, (y * rows / height) | 0);
    for (let x = 0; x < width; x++) {
      const rx = Math.min(columns - 1, (x * columns / width) | 0);
      const i = (y * width + x) * 4;
      // Rec.601 — 사람이 느끼는 밝기에 가깝다
      const luma = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      cells[ry * columns + rx] += luma;
      counts[ry * columns + rx]++;
    }
  }
  for (let i = 0; i < cells.length; i++) if (counts[i]) cells[i] /= counts[i];
  return { cells, columns, rows };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : 0;
};

// 밝기 격자 → { profile, confidence }
//   profile[c] = 그 열의 경계 높이. 0 = 화면 맨 위, 1 = 맨 아래.
//   confidence = 이 경계를 믿을 만한 정도(0~1). 낮으면 실루엣을 그리지 않는다.
// 경계가 없는 장면(하늘만, 벽만, 안개)에서 억지로 선을 그으면 배경화면에
// 정체불명의 얼룩이 생긴다 — 그럴 바엔 아무것도 안 그리는 편이 낫다.
export function extractSkyline(grid) {
  const { cells, columns, rows } = grid;
  if (rows < 5 || columns < 4) return { profile: [], confidence: 0 };

  const at = (c, r) => cells[r * columns + c];
  const edges = new Float32Array(columns);
  const strength = new Float32Array(columns);

  for (let c = 0; c < columns; c++) {
    let bestRow = -1, bestGap = 0;
    // 위아래 3칸 평균의 차이 — 한 칸짜리 잡티(새·전선)에 흔들리지 않게
    for (let r = 2; r < rows - 2; r++) {
      const above = (at(c, r - 2) + at(c, r - 1)) / 2;
      const below = (at(c, r + 1) + at(c, r + 2)) / 2;
      const gap = Math.abs(above - below);
      if (gap > bestGap) { bestGap = gap; bestRow = r; }
    }
    edges[c] = bestRow < 0 ? rows / 2 : bestRow;
    strength[c] = bestGap;
  }

  // 얼마나 뚜렷한가 — 경계다운 밝기 차이가 있어야 한다
  const contrast = median(strength);
  // 얼마나 이어져 있는가 — 열마다 제각각이면 경계가 아니라 잡음이다
  const mid = median(edges);
  const spread = median([...edges].map((r) => Math.abs(r - mid))) / rows;
  const confidence = Math.max(0, Math.min(1, contrast * 6)) * Math.max(0, 1 - spread * 5);

  // 가로로 한 번 다듬는다. 창문 한 칸 때문에 실루엣이 톱니처럼 되는 걸 막는다.
  const profile = [];
  for (let c = 0; c < columns; c++) {
    const a = edges[Math.max(0, c - 1)], b = edges[c], d = edges[Math.min(columns - 1, c + 1)];
    profile.push((a + b + d) / 3 / (rows - 1));
  }
  return { profile, confidence };
}

// 화면 세로 화각을 알면 프로필의 행 위치를 고도로 옮길 수 있다.
// 폰 뒷면 카메라의 세로 화각은 대체로 55~70°다 — 기기가 알려주지 않아서 60°로 둔다.
// 실루엣은 어차피 0~10° 띠 안으로 잘라 넣으므로, 이 근삿값의 오차는 건물의
// "높이 비율"에만 남고 자리에는 남지 않는다.
export const CAMERA_FOV_V = 60;

// 가로 화각. 세로 60°에 4:3이면 가로는 대략 45°다(세로로 든 폰 기준).
// 배경화면의 가로 화각(약 50°)과 비슷해서, 프로필이 화면 폭을 거의 채운다.
export const CAMERA_FOV_H = 45;

// profile 값(0~1) → 고도(도). aimAlt는 화면 한가운데가 보고 있는 고도.
export const profileAltitude = (value, aimAlt, fov = CAMERA_FOV_V) =>
  aimAlt + (0.5 - value) * fov;

// 열 번호 → 방위(도). 화면 한가운데가 겨눈 방위다.
export const profileAzimuth = (index, count, aimAz, fov = CAMERA_FOV_H) =>
  aimAz + ((count > 1 ? index / (count - 1) : 0.5) - 0.5) * fov;

// 프로필 → 고도(도) 배열. 요청대로 실루엣은 **고도 0~10° 띠** 안에 앉는다.
//
// 추정한 카메라 화각으로 절대 고도를 구해 그대로 0~10°로 자르면, 겨눈 고도가
// 조금만 높아도 모든 열이 10°에 붙어 건물이 사라지고 평평한 판이 된다.
// 그래서 **가장 낮은 지점을 지평선(0°)에 앉히고 높이차만** 띠에 담는다.
//   - 자리는 지평선이 정한다 → 화각 추정 오차가 위치에 안 남는다
//   - 높이차는 화각으로 계산한 실제 각도 그대로, 10°를 넘으면 눌러 담는다
//   - 평평한 스카이라인은 평평하게 남는다(억지로 늘리지 않는다)
export function bandAltitudes(profile, aimAlt, topAlt = 10, fov = CAMERA_FOV_V) {
  if (!profile.length) return [];
  const alts = profile.map((v) => profileAltitude(v, aimAlt, fov));
  const base = Math.min(...alts);
  const raw = Math.max(...alts) - base;
  const scale = raw > 0 ? Math.min(topAlt, raw) / raw : 0;
  return alts.map((a) => (a - base) * scale);
}
