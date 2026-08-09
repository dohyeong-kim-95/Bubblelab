import test from "node:test";
import assert from "node:assert/strict";
import {
  PADS, averageFrames, blendBackground, createStepTracker, denoise, foreground,
  footPoints, frameChannels, padCoords, panelAt, pressedPanels,
} from "../games/stepcam/vision.js";
import {
  DIFFICULTIES, HIT_WINDOW, JUDGES, MAX_SCORE, SONGS, buildChart, computeScore,
  difficultyOf, judgeOf, rankOf, songOf,
} from "../games/stepcam/chart.js";

/* ---------- 가짜 카메라 프레임 ---------- */
// paint(x, y) → [r, g, b] | null(=바닥 그대로)
function frame(width, height, floor, paint = () => null) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y) ?? floor;
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return frameChannels({ data, width, height });
}
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

const FLOOR = [150, 148, 140];

/* ---------- 전경 분리 ---------- */

test("빈 바닥끼리는 전경이 하나도 안 잡힌다", () => {
  const bg = frame(20, 15, FLOOR);
  const mask = foreground(bg, frame(20, 15, FLOOR));
  assert.equal(mask.reduce((a, b) => a + b, 0), 0);
});

test("바닥 위의 물체는 전경으로 잡힌다", () => {
  const bg = frame(20, 15, FLOOR);
  const cur = frame(20, 15, FLOOR, (x, y) => (inRect(x, y, 5, 5, 9, 9) ? [40, 44, 60] : null));
  const mask = foreground(bg, cur);
  assert.equal(mask[7 * 20 + 7], 1, "물체 한가운데가 안 잡혔다");
  assert.equal(mask[1 * 20 + 1], 0, "빈 바닥이 잡혔다");
});

test("그림자(밝기만 내려가고 색조는 그대로)는 걸러낸다 — 끄면 다시 잡힌다", () => {
  const bg = frame(20, 15, FLOOR);
  // 바닥과 같은 색조로 70%만 어두워진 영역 = 그림자
  const shade = FLOOR.map((v) => Math.round(v * 0.7));
  const cur = frame(20, 15, FLOOR, (x, y) => (inRect(x, y, 5, 5, 9, 9) ? shade : null));
  assert.equal(foreground(bg, cur)[7 * 20 + 7], 0, "그림자가 발로 잡혔다");
  assert.equal(foreground(bg, cur, { shadow: false })[7 * 20 + 7], 1);
});

test("배경 갱신은 전경으로 표시된 자리를 건드리지 않는다", () => {
  const bg = frame(4, 1, [100, 100, 100]);
  const cur = frame(4, 1, [200, 200, 200]);
  const mask = Uint8Array.from([1, 0, 0, 0]);
  blendBackground(bg, cur, mask, 0.5);
  assert.equal(bg[0], 100, "발 밑 배경이 스며들었다");
  assert.equal(bg[3], 150, "빈 바닥은 따라와야 한다");
});

test("여러 장 평균으로 기준 프레임을 만든다", () => {
  const avg = averageFrames([frame(2, 1, [100, 100, 100]), frame(2, 1, [140, 140, 140])]);
  assert.equal(avg[0], 120);
});

test("혼자 떠 있는 점은 지우고 덩어리는 남긴다", () => {
  const cols = 8, rows = 8;
  const mask = new Uint8Array(cols * rows);
  mask[2 * cols + 2] = 1;                                  // 외톨이
  for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) mask[y * cols + x] = 1;
  const out = denoise(mask, cols, rows);
  assert.equal(out[2 * cols + 2], 0);
  assert.equal(out[5 * cols + 5], 1);
});

/* ---------- 발 찾기 ---------- */

test("두 다리 + 몸통에서 발 두 개의 접지점을 집어낸다", () => {
  const cols = 40, rows = 30;
  const mask = new Uint8Array(cols * rows);
  const on = (x, y) => { mask[y * cols + x] = 1; };
  for (let y = 4; y <= 12; y++) for (let x = 6; x <= 30; x++) on(x, y);   // 몸통
  for (let y = 10; y <= 24; y++) {
    for (let x = 8; x <= 12; x++) on(x, y);                               // 왼다리
    for (let x = 24; x <= 28; x++) on(x, y);                              // 오른다리
  }

  const feet = footPoints(mask, cols, rows);
  assert.equal(feet.length, 2, "발이 둘로 안 잡혔다");
  assert.deepEqual(feet.map((f) => f.y), [24, 24], "접지점은 실루엣의 가장 아래여야 한다");
  const xs = feet.map((f) => f.x).sort((a, b) => a - b);
  assert.ok(Math.abs(xs[0] - 10) <= 1, `왼발 x=${xs[0]}`);
  assert.ok(Math.abs(xs[1] - 26) <= 1, `오른발 x=${xs[1]}`);
});

test("몸통만 있고 다리가 없으면 몸통 아래를 발로 오해하지 않게 가까운 것부터 준다", () => {
  const cols = 20, rows = 20;
  const mask = new Uint8Array(cols * rows);
  for (let y = 2; y <= 6; y++) for (let x = 2; x <= 8; x++) mask[y * cols + x] = 1;
  for (let y = 12; y <= 16; y++) for (let x = 12; x <= 16; x++) mask[y * cols + x] = 1;
  const feet = footPoints(mask, cols, rows);
  assert.equal(feet[0].y, 16, "카메라에 가까운(아래) 덩어리가 먼저 와야 한다");
});

/* ---------- 발판 좌표 ---------- */

const QUAD = [{ x: 0.2, y: 0.4 }, { x: 0.8, y: 0.4 }, { x: 0.95, y: 0.9 }, { x: 0.05, y: 0.9 }];
// 정방향 쌍선형 — 역함수가 맞는지 대조하는 기준
const forward = (u, v, [a, b, c, d]) => ({
  x: (1 - u) * (1 - v) * a.x + u * (1 - v) * b.x + u * v * c.x + (1 - u) * v * d.x,
  y: (1 - u) * (1 - v) * a.y + u * (1 - v) * b.y + u * v * c.y + (1 - u) * v * d.y,
});
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test("발판 네 귀퉁이는 (0,0) (1,0) (1,1) (0,1)로 돌아온다", () => {
  const expected = [[0, 0], [1, 0], [1, 1], [0, 1]];
  QUAD.forEach((p, i) => {
    const c = padCoords(p.x, p.y, QUAD);
    assert.ok(close(c.u, expected[i][0], 1e-6) && close(c.v, expected[i][1], 1e-6),
      `${i}번 귀퉁이 → (${c.u}, ${c.v})`);
  });
});

test("사다리꼴 안 아무 점이나 넣어도 원래 (u, v)가 나온다", () => {
  for (const [u, v] of [[0.3, 0.7], [0.85, 0.15], [0.5, 0.5], [0.05, 0.95]]) {
    const p = forward(u, v, QUAD);
    const c = padCoords(p.x, p.y, QUAD);
    assert.ok(close(c.u, u, 1e-6) && close(c.v, v, 1e-6),
      `(${u}, ${v}) → (${c.u.toFixed(4)}, ${c.v.toFixed(4)})`);
  }
});

test("발판 밖은 단위정사각형 밖으로 나간다", () => {
  const c = padCoords(0.5, 0.1, QUAD);   // 발판보다 위(멀리)
  assert.ok(c.v < 0, `발판 위쪽인데 v=${c.v}`);
});

test("펌프는 네 귀퉁이와 가운데만, 나머지 칸은 빈 틈", () => {
  const pad = PADS.pump;
  assert.equal(panelAt(0.1, 0.1, pad), "ul");
  assert.equal(panelAt(0.9, 0.1, pad), "ur");
  assert.equal(panelAt(0.5, 0.5, pad), "c");
  assert.equal(panelAt(0.1, 0.9, pad), "dl");
  assert.equal(panelAt(0.9, 0.9, pad), "dr");
  assert.equal(panelAt(0.5, 0.1, pad), null, "펌프에 위쪽 가운데 패널은 없다");
  assert.equal(panelAt(1.4, 0.5, pad), null, "발판 밖");
});

test("DDR은 상하좌우 네 칸", () => {
  const pad = PADS.ddr;
  assert.equal(panelAt(0.5, 0.1, pad), "u");
  assert.equal(panelAt(0.1, 0.5, pad), "l");
  assert.equal(panelAt(0.9, 0.5, pad), "r");
  assert.equal(panelAt(0.5, 0.9, pad), "d");
  assert.equal(panelAt(0.1, 0.1, pad), null, "DDR에 모서리 패널은 없다");
});

test("이미지 속 발 좌표가 밟은 패널로 이어진다", () => {
  const cols = 96, rows = 72;
  const at = (u, v) => {
    const p = forward(u, v, QUAD);
    return { x: p.x * cols, y: p.y * rows };
  };
  const pressed = pressedPanels([at(0.16, 0.16), at(0.84, 0.84)],
    { cols, rows, quad: QUAD, pad: PADS.pump });
  assert.deepEqual([...pressed].sort(), ["dr", "ul"]);

  const outside = pressedPanels([{ x: 5, y: 2 }], { cols, rows, quad: QUAD, pad: PADS.pump });
  assert.equal(outside.size, 0, "발판 밖을 밟은 것으로 쳤다");
});

/* ---------- 밟는 순간 ---------- */

test("발이 올라온 순간에만 스텝이 나가고, 떼기 전에는 반복되지 않는다", () => {
  const tracker = createStepTracker();
  assert.deepEqual(tracker.update(new Set(["c"]), 0), ["c"]);
  assert.deepEqual(tracker.update(new Set(["c"]), 33), [], "밟고 있는 동안 또 나갔다");
  assert.deepEqual(tracker.update(new Set(["c"]), 400), []);
});

test("뗐다 다시 밟으면 새 스텝이 된다 — 한 프레임 깜빡임은 무시", () => {
  const tracker = createStepTracker();
  tracker.update(new Set(["ul"]), 0);
  tracker.update(new Set(), 33);                                  // 깜빡 (70ms 미만)
  assert.deepEqual(tracker.update(new Set(["ul"]), 66), [], "깜빡임이 연타가 됐다");
  tracker.update(new Set(), 100);
  tracker.update(new Set(), 200);                                 // 확실히 뗌
  assert.deepEqual(tracker.update(new Set(["ul"]), 233), ["ul"]);
});

/* ---------- 채보 ---------- */

const pad = PADS.pump;

test("같은 곡·난이도는 언제나 같은 채보", () => {
  const a = buildChart(SONGS[0], pad, difficultyOf("normal"));
  const b = buildChart(SONGS[0], pad, difficultyOf("normal"));
  assert.deepEqual(a.notes, b.notes);
});

test("노트는 시간순이고, 도입부 뒤에서 시작하며, 패널은 발판에 있는 것만 쓴다", () => {
  const ids = new Set(pad.panels.map((p) => p.id));
  for (const song of SONGS) {
    for (const diff of DIFFICULTIES) {
      const chart = buildChart(song, pad, diff);
      assert.ok(chart.notes.length > 20, `${song.id}/${diff.id} 노트가 너무 적다`);
      let prev = -1;
      for (const n of chart.notes) {
        assert.ok(n.t >= chart.leadIn - 1e-9, "도입부 안에 노트가 들어갔다");
        assert.ok(n.t >= prev, "시간순이 아니다");
        assert.ok(ids.has(n.panel), `모르는 패널 ${n.panel}`);
        assert.equal(pad.panels[n.lane].id, n.panel, "레인과 패널이 어긋난다");
        prev = n.t;
      }
      assert.ok(chart.duration > chart.notes.at(-1).t, "마지막 노트 뒤 여유가 없다");
    }
  }
});

test("난이도가 올라갈수록 촘촘해진다", () => {
  const counts = DIFFICULTIES.map((d) => buildChart(SONGS[0], pad, d).notes.length);
  assert.ok(counts[0] < counts[2], `쉬움 ${counts[0]} < 어려움 ${counts[2]}`);
});

test("쉬움에는 양발 점프가 없다", () => {
  const chart = buildChart(SONGS[0], pad, difficultyOf("easy"));
  const times = chart.notes.map((n) => n.t);
  assert.equal(new Set(times).size, times.length, "같은 시각에 노트가 둘 이상 있다");
});

test("한 박을 쪼갠 최소 간격보다 촘촘하게는 나오지 않는다", () => {
  for (const diff of DIFFICULTIES) {
    const chart = buildChart(SONGS[1], pad, diff);
    const minGap = (chart.beat / diff.sub) * diff.gap - 1e-9;
    const times = [...new Set(chart.notes.map((n) => n.t))];
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i] - times[i - 1] >= minGap,
        `${diff.id}: ${times[i - 1]}→${times[i]} 간격이 너무 좁다`);
    }
  }
});

test("DDR 발판이면 레인이 넷", () => {
  const chart = buildChart(SONGS[0], PADS.ddr, difficultyOf("hard"));
  assert.ok(chart.notes.every((n) => n.lane >= 0 && n.lane < 4));
});

/* ---------- 판정·점수 ---------- */

test("판정 창은 좁은 것부터 넓은 순이고, 카메라 눈금(33ms)보다는 넓다", () => {
  for (let i = 1; i < JUDGES.length; i++) {
    assert.ok(JUDGES[i].window > JUDGES[i - 1].window, `${JUDGES[i].id} 창이 앞 판정보다 좁다`);
    assert.ok(JUDGES[i].weight < JUDGES[i - 1].weight, `${JUDGES[i].id} 가중치가 더 크다`);
  }
  assert.ok(JUDGES[0].window >= 0.05, "퍼펙트 창이 카메라 프레임 간격에 묻힌다");
});

test("시간차가 벌어질수록 판정이 내려간다", () => {
  assert.equal(judgeOf(0).id, "perfect");
  assert.equal(judgeOf(-JUDGES[0].window).id, "perfect", "이른 쪽도 대칭이어야 한다");
  assert.equal(judgeOf(JUDGES[0].window + 0.001).id, "great");
  assert.equal(judgeOf(JUDGES[1].window + 0.001).id, "good");
  assert.equal(judgeOf(HIT_WINDOW + 0.001).id, "miss");
});

test("전부 퍼펙트로 풀콤보면 만점 × 난이도 배수", () => {
  const total = 100;
  for (const diff of DIFFICULTIES) {
    const score = computeScore({
      counts: { perfect: total, great: 0, good: 0, miss: 0 },
      maxCombo: total, total, multiplier: diff.multiplier,
    });
    assert.equal(score, Math.round(MAX_SCORE * diff.multiplier));
  }
});

test("전부 미스면 0점, 판정이 좋을수록 점수가 는다", () => {
  const total = 50;
  const score = (counts, maxCombo) => computeScore({ counts, maxCombo, total, multiplier: 1 });
  assert.equal(score({ perfect: 0, great: 0, good: 0, miss: total }, 0), 0);
  const good = score({ perfect: 0, great: 0, good: total, miss: 0 }, total);
  const great = score({ perfect: 0, great: total, good: 0, miss: 0 }, total);
  const perfect = score({ perfect: total, great: 0, good: 0, miss: 0 }, total);
  assert.ok(good < great && great < perfect);
  assert.ok(perfect <= MAX_SCORE);
});

test("등급은 점수 순서를 지킨다", () => {
  const ranks = [0, 0.5, 0.7, 0.8, 0.9, 0.95, 1].map((r) => rankOf(MAX_SCORE * r));
  assert.deepEqual(ranks, ["D", "C", "B", "A", "S", "SS", "SSS"]);
});

test("곡·난이도 조회는 모르는 값이 와도 기본값으로 떨어진다", () => {
  assert.equal(songOf("없는곡").id, SONGS[0].id);
  assert.equal(difficultyOf("없는난이도").id, "normal");
});
