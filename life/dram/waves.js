// 커맨드 기록 → 파형. engine.js 와 마찬가지로 순수 함수만 두고,
// 화면(app.js)과 _infra/dram.test.mjs 가 같은 모듈을 쓴다.
//
// **두 묶음을 섞지 않는다.**
//   iface — CK·CS_n·CA·DQS·DQ. JEDEC 이 타이밍과 레벨을 정하는 핀이다.
//   array — WL·BL/BLB·SAE·CSL·Cell. **JEDEC 밖이다.** 소자 물리와 회로 설계 영역이라
//           업체·공정마다 다르고, 여기 그리는 것은 모식도다. 그럼에도 그리는 이유는
//           tRCD·tRAS·tRP 가 왜 그 길이인지가 이 그림으로만 보이기 때문이다.

import { busSpan, paramClocks } from "./engine.js";
import { ARRAY_SHAPE as S, VBLP } from "./spec/common.js";

export const IFACE = "iface";
export const ARRAY = "array";

/* 겹치거나 맞닿은 구간을 합친다. 커맨드 간격이 1클럭까지 좁아지므로
 * 합치지 않으면 계단이 뒤로 갔다 오며 선이 꼬인다. */
export function mergeRanges(ranges) {
  const sorted = [...ranges].filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/* 구간 목록 → 계단 파형. 가장자리(edge)만큼 기울여 실제 전이시간을 흉내 낸다. */
function stepWave(ranges, idle, active, end, edge = 0.4) {
  const pts = [[0, idle]];
  for (const [s, e] of mergeRanges(ranges)) {
    pts.push([Math.max(0, s - edge), idle], [s, active], [e, active], [e + edge, idle]);
  }
  pts.push([end, idle]);
  return pts.filter((p, i, a) => i === 0 || p[0] >= a[i - 1][0]);
}

/* 레인 하나. h 는 높이 배수다 — 비트라인 쌍처럼 작은 전압차가 중요한 신호는 넓게 준다.
 * **눈금은 레인마다 제 vmax 를 쓴다.** 어레이 전체를 VPP(1.8V) 하나로 재면 비트라인
 * 스윙이 몇 px 로 눌리고 ΔV 는 아예 사라진다 — 정작 봐야 할 것이 그것인데. */
/* 파형을 임의 시각에서 읽는다(선형 보간). 화면은 선을 그리기만 하지만,
 * 테스트는 "tRAS 에 셀이 복원돼 있는가" 처럼 한 점을 콕 집어 물어야 한다. */
export function sampleAt(points, clk) {
  if (!points.length) return null;
  if (clk <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [c0, v0] = points[i - 1];
    const [c1, v1] = points[i];
    if (clk <= c1) return c1 === c0 ? v1 : v0 + ((v1 - v0) * (clk - c0)) / (c1 - c0);
  }
  return points[points.length - 1][1];
}

const lane = (id, label, group, vmin, vmax, kind, extra = {}) =>
  ({ id, label, group, vmin, vmax, kind, h: 1, points: [], ranges: [], series: null, ...extra });

/* 고른 뱅크가 열려 있던 구간들. ACT 와 그것을 닫은 PRE 를 짝지어 둔다 —
 * 어레이 파형은 전부 이 구간에서 나온다. */
export function openIntervals(history, picked) {
  const mine = history.filter((e) =>
    (e.target === "bank" && e.bg === picked.bg && e.bank === picked.bank) ||
    (e.target === "all" && e.op.startsWith("PRE")));
  const opens = [];
  for (const e of mine) {
    if (e.op === "ACT") opens.push({ act: e.clk, pre: null });
    else if (e.op.startsWith("PRE")) {
      const last = opens[opens.length - 1];
      if (last && last.pre == null) last.pre = e.clk;
    }
  }
  return opens;
}

export function buildWaves(gen, bin, state, picked) {
  const r = gen.rails;
  if (!r) return null;

  const { VDD, VPP, VSS, dV } = r;
  const blp = VBLP(r);
  const R = paramClocks(gen, bin, "tRCD");
  const A = paramClocks(gen, bin, "tRAS");
  const P = paramClocks(gen, bin, "tRP");
  if (R == null || A == null || P == null) return null;

  const spans = state.history.map((e) => busSpan(gen, bin, e)).filter(Boolean);
  const end = Math.max(state.clk, ...spans.map((s) => s.start + s.len), 24) + 6;

  /* ---------- 인터페이스 ---------- */
  const cmds = state.history;
  const ck = lane("CK_t", "CK", IFACE, VSS, VDD, "clock", { note: "클럭. 양쪽 에지로 데이터를 보내므로 데이터레이트는 이 주파수의 두 배다." });
  const csn = lane("CS_n", "CS_n", IFACE, VSS, VDD, "wave", { note: "커맨드가 시작되는 클럭에 낮아진다 — 이 핀이 커맨드의 시작을 찍는다." });
  csn.points = stepWave(cmds.map((e) => [e.clk, e.clk + 1]), VDD, VSS, end);
  const ca = lane("CA", "CA", IFACE, VSS, VDD, "band", { note: "커맨드·주소가 실리는 구간. ACT 는 행 주소가 커서 두 클럭을 쓴다." });
  ca.ranges = mergeRanges(cmds.map((e) => {
    const def = gen.commands.find((c) => c.op === e.op);
    return [e.clk, e.clk + (def?.ca ?? 1)];
  }));
  const dqs = lane("DQS_t", "DQS", IFACE, VSS, VDD, "toggle", { note: "데이터와 함께 오는 스트로브. 버스트 동안만 토글한다." });
  dqs.ranges = mergeRanges(spans.map((s) => [s.start - 1, s.start + s.len]));
  const dq = lane("DQ", "DQ", IFACE, VSS, VDD, "band", { note: "데이터 버스. 읽기는 CL, 쓰기는 CWL 만큼 뒤에 열린다." });
  dq.ranges = spans.map((s) => [s.start, s.start + s.len, s.kind]);

  /* ---------- 어레이 내부 (모식도) ---------- */
  const wl = lane("WL", "WL", ARRAY, VSS, VPP, "wave", { note: "워드라인. 액세스 트랜지스터를 완전히 열려고 VDD 위(VPP)까지 올린다." });
  const pair = lane("BL", "BL/BLB", ARRAY, VSS, VDD, "pair", {
    h: 2,
    note: `비트라인 쌍. VDD/2 에서 출발해 전하공유로 ΔV(${Math.round(dV * 1000)}mV)만큼만 갈라진 뒤, 센스앰프가 그 차이를 양 레일까지 벌린다. 갈라지는 폭이 레일의 ${Math.round((dV / VDD) * 100)}% 밖에 안 되는 것이 DRAM 센싱이 어려운 이유다.`,
  });
  const bl = { points: [] };
  const blb = { points: [] };
  const sae = lane("SAE", "SAE", ARRAY, VSS, VDD, "wave", { note: "센스앰프 인에이블. 전하공유가 끝난 뒤에 켜야 한다 — 일찍 켜면 잘못된 쪽으로 증폭된다." });
  const csl = lane("CSL", "CSL", ARRAY, VSS, VDD, "wave", { note: "컬럼선택선. 센싱이 끝난 비트라인을 IO 로 잇는다." });
  const cell = lane("Cell", "Cell", ARRAY, VSS, VDD, "wave", { note: "셀 저장 노드. 읽는 순간 무너졌다가 센스앰프가 되살린다 — 그 복원이 끝나야 행을 닫을 수 있다(tRAS)." });

  wl.points = [[0, VSS]];
  bl.points = [[0, blp]];
  blb.points = [[0, blp]];
  cell.points = [[0, VDD]];

  const saeRanges = [];
  for (const { act, pre } of openIntervals(state.history, picked)) {
    const close = pre ?? end;
    wl.points.push([act, VSS], [act + S.wlRise * R, VPP], [close, VPP]);
    // 전하공유: 셀의 작은 전하가 큰 비트라인 용량과 섞여 ΔV 만큼만 갈라진다.
    bl.points.push([act + S.wlRise * R, blp], [act + S.shareEnd * R, blp + dV], [act + S.senseEnd * R, VDD], [close, VDD]);
    blb.points.push([act + S.wlRise * R, blp], [act + S.shareEnd * R, blp - dV], [act + S.senseEnd * R, VSS], [close, VSS]);
    // 셀은 읽히면서 무너지고, 센스앰프가 tRAS 에 걸쳐 원래 전위로 되돌린다.
    cell.points.push([act + S.wlRise * R, VDD], [act + S.shareEnd * R, blp + dV], [act + A, VDD]);
    saeRanges.push([act + S.saeOn * R, close]);
    if (pre != null) {
      wl.points.push([pre + S.preFall * P, VSS]);
      bl.points.push([pre + P, blp]);
      blb.points.push([pre + P, blp]);
    }
  }
  sae.points = stepWave(saeRanges, VSS, VDD, end, 0.6);

  const width = paramClocks(gen, bin, "BL") / 2;
  csl.points = stepWave(state.history.flatMap((e) => {
    const span = busSpan(gen, bin, e);
    if (!span) return [];
    const start = span.kind === "read" ? e.clk + S.cslDelay : span.start;
    return [[start, start + width]];
  }), VSS, VDD, end, 0.4);

  for (const l of [wl, bl, blb, cell]) {
    const last = l.points[l.points.length - 1];
    if (last[0] < end) l.points.push([end, last[1]]);
  }
  pair.series = [{ id: "BL", points: bl.points }, { id: "BLB", points: blb.points }];
  pair.guide = blp;   // VDD/2 기준선 — 여기서 갈라져 나가는 것이 이 그림의 전부다

  return {
    end,
    rails: { ...r, VBLP: blp },
    lanes: [ck, csn, ca, dqs, dq, wl, pair, sae, csl, cell],
    groups: [
      { id: IFACE, label: "인터페이스", note: "JEDEC 이 타이밍과 레벨을 정한다" },
      { id: ARRAY, label: `어레이 내부 — BG${picked.bg}/B${picked.bank}`, note: "모식도 — JEDEC 밖이다. 눈금은 신호마다 다르다" },
    ],
  };
}
