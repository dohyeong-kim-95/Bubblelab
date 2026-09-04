import test from "node:test";
import assert from "node:assert/strict";

const {
  GENERATIONS, findGen, isRunnable,
} = await import("../life/dram/spec/index.js");
const {
  advance, busSpan, canIssue, createState, findBin, issue, paramClocks, refreshStatus, resolveTerms, stateError, tCK,
} = await import("../life/dram/engine.js");

const ddr5 = findGen("ddr5");
const bin = findBin(ddr5, "4800B");
const fresh = () => createState(ddr5, "4800B");
const run = (state, ...cmds) => cmds.reduce((s, c) => {
  const r = issue(ddr5, bin, s, c);
  assert.equal(r.error, null, `${c.op} 가 거부됐다: ${r.error}`);
  return r.state;
}, state);
const last = (s) => s.history[s.history.length - 1];
const ACT = (bg, bank) => ({ op: "ACT", bg, bank });
const RD = (bg, bank) => ({ op: "RD", bg, bank });
const WR = (bg, bank) => ({ op: "WR", bg, bank });

test("클럭 환산은 데이터레이트의 절반이고, ns 하한은 항상 올림이다", () => {
  assert.equal(tCK(bin), 2000 / 4800);
  // tRCD 16.25ns / 0.4167ns = 38.99… → 39. 내림하면 스펙 위반이 된다.
  assert.equal(paramClocks(ddr5, bin, "tRCD"), 39);
});

test("max(nCK, ns) 는 둘 중 큰 쪽이 이긴다 — 빈이 빨라지면 이기는 쪽이 바뀐다", () => {
  // tRRD_L 은 5ns 또는 8클럭. 4800 에서 5ns = 12클럭이라 ns 가 이긴다.
  assert.equal(paramClocks(ddr5, bin, "tRRD_L"), 12);
  // tRRD_S 는 클럭만 있다 — 코어가 아니라 커맨드 버스의 사정이라서.
  assert.equal(paramClocks(ddr5, bin, "tRRD_S"), 8);
});

test("빈이 덮어쓴 값이 세대 값을 이긴다 (CL·tCCD_L)", () => {
  const fast = findBin(ddr5, "6400A");
  assert.equal(paramClocks(ddr5, bin, "CL"), 40);
  assert.equal(paramClocks(ddr5, fast, "CL"), 46);
  // ns 로 묶인 코어 타이밍은 빈이 바뀌면 클럭 수가 늘어난다 — 같은 물리 시간이므로.
  assert.ok(paramClocks(ddr5, fast, "tRCD") > paramClocks(ddr5, bin, "tRCD"));
});

test("ACT → RD 의 간격이 곧 tRCD 다", () => {
  const s = run(fresh(), ACT(0, 0), RD(0, 0));
  assert.equal(s.clk, paramClocks(ddr5, bin, "tRCD"));
  assert.deepEqual(last(s).waitedFor.map((w) => w.label), ["tRCD"]);
});

test("행이 열려 있지 않으면 읽을 수 없고, 열린 뱅크를 또 열 수도 없다", () => {
  const s0 = fresh();
  assert.match(stateError(ddr5, s0, RD(0, 0)), /ACT/);
  const s1 = run(s0, ACT(0, 0));
  assert.match(stateError(ddr5, s1, ACT(0, 0)), /PRE/);
  assert.equal(stateError(ddr5, s1, RD(0, 0)), null);
});

test("같은 그룹의 연속 읽기는 tCCD_L, 다른 그룹이면 tCCD_S — 뱅크그룹의 존재 이유", () => {
  // 행이 다 선 뒤에 재야 tRCD 가 아니라 tCCD 가 보인다.
  const base = advance(run(fresh(), ACT(0, 0), ACT(0, 1), ACT(1, 0)), paramClocks(ddr5, bin, "tRCD"));

  const sameBg = run(base, RD(0, 0), RD(0, 1));
  const diffBg = run(base, RD(0, 0), RD(1, 0));

  assert.equal(sameBg.clk - sameBg.history.at(-2).clk, paramClocks(ddr5, bin, "tCCD_L"));
  assert.equal(diffBg.clk - diffBg.history.at(-2).clk, paramClocks(ddr5, bin, "tCCD_S"));
});

test("뱅크그룹의 이득은 빠른 빈에서 나온다 — tCCD_L 만 커지고 tCCD_S 는 그대로다", () => {
  // 느린 빈에서는 둘이 같아 그룹을 갈라도 읽기 간격이 달라지지 않는다.
  // 빈이 빨라지면 tCCD_L 이 벌어지고, 그때부터 그룹을 번갈아 써야 DQ 가 찬다.
  const fast = findBin(ddr5, "6400A");
  assert.equal(paramClocks(ddr5, bin, "tCCD_L"), paramClocks(ddr5, bin, "tCCD_S"));
  assert.ok(paramClocks(ddr5, fast, "tCCD_L") > paramClocks(ddr5, fast, "tCCD_S"));

  // 빠른 빈에서 같은 시퀀스를 돌리면 그룹을 가른 쪽이 실제로 먼저 끝난다.
  const fastRun = (state, ...cmds) => cmds.reduce((acc, c) => issue(ddr5, fast, acc, c).state, state);
  const seed = fastRun(createState(ddr5, "6400A"), ACT(0, 0), ACT(0, 1), ACT(1, 0));
  const ready = advance(seed, paramClocks(ddr5, fast, "tRCD"));
  const sameBg = fastRun(ready, RD(0, 0), RD(0, 1));
  const diffBg = fastRun(ready, RD(0, 0), RD(1, 0));
  assert.ok(diffBg.clk < sameBg.clk);
});

test("같은 그룹의 연속 쓰기는 읽기보다 훨씬 길다 (tCCD_L_WR)", () => {
  const base = advance(run(fresh(), ACT(0, 0), ACT(0, 1)), paramClocks(ddr5, bin, "tRCD"));
  const s = run(base, WR(0, 0), WR(0, 1));
  assert.equal(s.clk - s.history.at(-2).clk, paramClocks(ddr5, bin, "tCCD_L_WR"));
  assert.ok(paramClocks(ddr5, bin, "tCCD_L_WR") > paramClocks(ddr5, bin, "tCCD_L"));
});

test("WR → RD 는 커맨드가 아니라 데이터가 끝난 시점부터 센다", () => {
  const s = run(fresh(), ACT(0, 0), WR(0, 0), RD(0, 0));
  const wr = s.history[1];
  const expected = paramClocks(ddr5, bin, "CWL") + paramClocks(ddr5, bin, "BL") / 2 + paramClocks(ddr5, bin, "tWTR_L");
  assert.equal(s.clk - wr.clk, expected);
  // 화면이 "왜 이 숫자인가"를 펼쳐 보일 수 있어야 한다.
  assert.deepEqual(last(s).waitedFor[0].parts.map((p) => p.term), ["CWL", "BL/2", "tWTR_L"]);
});

test("tFAW — 어떤 창에서도 ACT 는 4번까지, 5번째가 밀린다", () => {
  const four = run(fresh(), ACT(0, 0), ACT(1, 0), ACT(2, 0), ACT(3, 0));
  const fifth = run(four, ACT(4, 0));
  const anchor = fifth.history[0];             // 최근 4번째 = 첫 ACT
  assert.equal(fifth.clk, anchor.clk + paramClocks(ddr5, bin, "tFAW"));
  assert.equal(last(fifth).waitedFor[0].label, "tFAW (최근 4번째 ACT 부터)");
  // 넷째까지는 tRRD_S 로만 밀린다 — 아직 창에 걸리지 않는다.
  assert.equal(four.clk, 3 * paramClocks(ddr5, bin, "tRRD_S"));
});

test("tRAS 를 채우기 전에는 행을 닫을 수 없고, PRE 뒤 tRP 를 채워야 다시 연다", () => {
  const s = run(fresh(), ACT(0, 0), { op: "PRE", bg: 0, bank: 0 }, ACT(0, 0));
  const [act, pre, act2] = s.history;
  assert.equal(pre.clk - act.clk, paramClocks(ddr5, bin, "tRAS"));
  // tRP 와 tRC 가 함께 걸리고, 늦은 쪽(tRC)이 이긴다.
  assert.ok(act2.clk - pre.clk >= paramClocks(ddr5, bin, "tRP"));
  assert.equal(act2.clk - act.clk, paramClocks(ddr5, bin, "tRC"));
});

test("REFab 은 모든 뱅크가 닫혀 있어야 하고, 그 뒤 tRFC 동안 어레이 전체가 잠긴다", () => {
  const open = run(fresh(), ACT(0, 0));
  assert.match(stateError(ddr5, open, { op: "REFab" }), /열려 있다/);
  const s = run(open, { op: "PREA" }, { op: "REFab" }, ACT(3, 2));
  const ref = s.history[2];
  assert.equal(s.clk - ref.clk, paramClocks(ddr5, bin, "tRFC1"));
});

test("REFsb 는 그 뱅크만 잠근다 — 다른 뱅크는 계속 쓴다", () => {
  const s = run(fresh(), { op: "REFsb", bg: 0, bank: 0 });
  const blocked = canIssue(ddr5, bin, s, ACT(0, 0));
  const free = canIssue(ddr5, bin, s, ACT(1, 0));
  assert.equal(blocked.wait, paramClocks(ddr5, bin, "tRFCsb"));
  // 다른 뱅크는 리프레시에 묶이지 않는다 — 남는 것은 커맨드 버스 한 클럭뿐이다.
  assert.equal(free.wait, 1);
  assert.deepEqual(free.binding.map((b) => b.label), ["커맨드 버스"]);
});

test("커맨드 버스는 직렬이다 — 한 클럭에 두 커맨드를 낼 수 없다", () => {
  // 타이밍이 다 풀린 상태에서도 커맨드끼리 겹치지 않는다.
  const ready = advance(run(fresh(), ACT(0, 0), ACT(1, 0)), paramClocks(ddr5, bin, "tRCD"));
  const s = run(ready, RD(0, 0), RD(1, 0));
  assert.ok(s.history.at(-1).clk > s.history.at(-2).clk, "두 RD 가 같은 클럭에 놓였다");
});

test("주소가 큰 커맨드는 CA 버스를 두 클럭 붙잡는다 (DDR5 의 ACT)", () => {
  const s = run(fresh(), ACT(0, 0), { op: "PREA" });
  // ACT 는 ca:2 라 바로 다음 클럭에는 아무 커맨드도 못 낸다.
  assert.equal(s.history[1].clk, 2);
  assert.equal(s.history[1].waitedFor[0].label, "커맨드 버스");
  assert.match(s.history[1].waitedFor[0].why, /두 클럭|2클럭/);
});

test("DQ 버스는 RD 뒤 CL 클럭에 열리고 버스트의 절반만큼 붙잡는다", () => {
  const s = run(fresh(), ACT(0, 0), RD(0, 0));
  const span = busSpan(ddr5, bin, last(s));
  assert.equal(span.start, last(s).clk + paramClocks(ddr5, bin, "CL"));
  assert.equal(span.len, 8);          // BL16 을 DDR 로 보내면 8클럭
  assert.equal(span.kind, "read");
});

test("tREFI 는 마감이지 최소 간격이 아니다 — 넘겨도 커맨드가 막히지는 않는다", () => {
  const s = { ...fresh(), clk: paramClocks(ddr5, bin, "tREFI") + 100 };
  const status = refreshStatus(ddr5, bin, s);
  assert.equal(status.overdue, true);
  assert.equal(canIssue(ddr5, bin, s, ACT(0, 0)).ok, true);
});

test("값이 없는 파라미터는 0 이 아니라 null 이다 — 모르는 것을 아는 척하지 않는다", () => {
  const lpddr5 = findGen("lpddr5");
  const lpBin = findBin(lpddr5, "6400");
  assert.equal(paramClocks(lpddr5, lpBin, "RL"), null);
  assert.equal(busSpan(lpddr5, lpBin, { op: "RD", clk: 0 }), null);
  const terms = resolveTerms(lpddr5, lpBin, ["RL", "BL/2"]);
  assert.deepEqual(terms.unknown, ["RL"]);
});

test("미공개 세대는 시뮬레이터를 돌리지 않는다", () => {
  assert.equal(isRunnable(findGen("ddr6")), false);
  assert.equal(isRunnable(findGen("lpddr6")), false);
  assert.equal(isRunnable(findGen("ddr5")), true);
});

test("모든 규칙이 실재하는 커맨드와 파라미터만 가리킨다", () => {
  for (const gen of GENERATIONS) {
    if (!isRunnable(gen)) continue;
    const ops = new Set(gen.commands.map((c) => c.op));
    const known = (n) => n === "BL/2" || gen.params[n] || gen.bins.some((b) => b.params?.[n]);
    for (const r of [...gen.rules]) {
      assert.ok(ops.has(r.from) && ops.has(r.to), `${gen.id}: 없는 커맨드 ${r.from}→${r.to}`);
      for (const t of r.terms) assert.ok(known(t), `${gen.id}: 없는 파라미터 ${t}`);
      assert.ok(r.why?.length, `${gen.id}: ${r.from}→${r.to} 에 설명이 없다`);
    }
    for (const w of gen.windows) assert.ok(known(w.param), `${gen.id}: 없는 파라미터 ${w.param}`);
    for (const [name, p] of Object.entries(gen.params)) {
      assert.ok(p.why?.length, `${gen.id}: ${name} 에 "왜"가 없다`);
    }
  }
});

/* ---------- 파형 ----------
 * 어레이 내부 파형은 모식도지만, **타이밍 파라미터와 어긋나면 안 된다** —
 * 셀 복원이 tRAS 에 끝나고 비트라인이 tRP 에 모이는 것이 그 파라미터의 뜻이기 때문이다.
 * 여기서 고정하는 것은 모양이 아니라 그 대응 관계다.
 */
const { ARRAY, IFACE, buildWaves, mergeRanges, sampleAt } = await import("../life/dram/waves.js");

const PICK = { bg: 0, bank: 0 };
const wavesOf = (state, picked = PICK) => {
  const w = buildWaves(ddr5, bin, state, picked);
  return { w, lane: (id) => w.lanes.find((l) => l.id === id) };
};
const RAILS = ddr5.rails;

test("맞닿은 구간은 하나로 합쳐진다 — 계단이 뒤로 갔다 오면 선이 꼬인다", () => {
  assert.deepEqual(mergeRanges([[0, 2], [2, 4], [10, 12]]), [[0, 4], [10, 12]]);
  assert.deepEqual(mergeRanges([[5, 9], [0, 6]]), [[0, 9]]);
});

test("워드라인은 ACT 에 VPP 까지 오르고 PRE 뒤에 내려온다", () => {
  const s = run(fresh(), ACT(0, 0), { op: "PRE", bg: 0, bank: 0 });
  const { lane } = wavesOf(s);
  const [act, pre] = s.history;
  const wl = lane("WL").points;
  assert.equal(sampleAt(wl, act.clk), RAILS.VSS);
  assert.equal(sampleAt(wl, act.clk + paramClocks(ddr5, bin, "tRCD")), RAILS.VPP);
  assert.equal(sampleAt(wl, pre.clk), RAILS.VPP);
  assert.equal(sampleAt(wl, pre.clk + paramClocks(ddr5, bin, "tRP")), RAILS.VSS);
});

test("셀 저장 노드는 읽히며 무너졌다가 **정확히 tRAS 에** 복원된다", () => {
  const s = run(fresh(), ACT(0, 0));
  const { lane } = wavesOf(s);
  const cell = lane("Cell").points;
  const A = paramClocks(ddr5, bin, "tRAS");
  const R = paramClocks(ddr5, bin, "tRCD");
  assert.equal(sampleAt(cell, 0), RAILS.VDD);
  // 전하공유가 끝난 시점에는 비트라인 전위 근처까지 무너져 있다
  assert.ok(sampleAt(cell, 0.35 * R) < RAILS.VDD / 2 + RAILS.dV * 1.01);
  // 그리고 tRAS 에 원래 전위로 돌아온다 — 이것이 tRAS 가 존재하는 이유다
  assert.ok(sampleAt(cell, A * 0.7) < RAILS.VDD - 1e-9, "복원이 너무 일찍 끝났다");
  assert.equal(sampleAt(cell, A), RAILS.VDD);
});

test("비트라인 쌍은 ΔV 만큼만 갈라졌다가 센스앰프가 양 레일까지 벌린다", () => {
  const s = run(fresh(), ACT(0, 0));
  const { lane } = wavesOf(s);
  const pair = lane("BL");
  const [bl, blb] = pair.series.map((x) => x.points);
  const R = paramClocks(ddr5, bin, "tRCD");
  const blp = RAILS.VDD / 2;

  assert.equal(pair.kind, "pair");
  assert.equal(sampleAt(bl, 0), blp);
  // 전하공유가 끝난 순간: VDD/2 를 사이에 두고 ΔV 만큼만 벌어져 있다
  assert.ok(Math.abs(sampleAt(bl, 0.35 * R) - (blp + RAILS.dV)) < 1e-9);
  assert.ok(Math.abs(sampleAt(blb, 0.35 * R) - (blp - RAILS.dV)) < 1e-9);
  // 증폭이 끝나면 양 레일에 닿고, tRCD 전에 끝나 있어야 컬럼이 읽어갈 수 있다
  assert.equal(sampleAt(bl, R), RAILS.VDD);
  assert.equal(sampleAt(blb, R), RAILS.VSS);
});

test("PRE 뒤 비트라인은 tRP 에 걸쳐 VDD/2 로 다시 모인다", () => {
  const s = run(fresh(), ACT(0, 0), { op: "PRE", bg: 0, bank: 0 });
  const { lane } = wavesOf(s);
  const [bl, blb] = lane("BL").series.map((x) => x.points);
  const pre = s.history[1].clk;
  const P = paramClocks(ddr5, bin, "tRP");
  assert.equal(sampleAt(bl, pre), RAILS.VDD);
  assert.equal(sampleAt(bl, pre + P), RAILS.VDD / 2);
  assert.equal(sampleAt(blb, pre + P), RAILS.VDD / 2);
});

test("센스앰프는 전하공유가 끝난 뒤에 켜진다 — 일찍 켜면 엉뚱한 쪽으로 증폭된다", () => {
  const s = run(fresh(), ACT(0, 0));
  const { lane } = wavesOf(s);
  const R = paramClocks(ddr5, bin, "tRCD");
  assert.equal(sampleAt(lane("SAE").points, 0.3 * R), RAILS.VSS);
  assert.equal(sampleAt(lane("SAE").points, 0.5 * R), RAILS.VDD);
});

test("다른 뱅크를 고르면 어레이 파형은 조용하다 — 뱅크마다 따로 논다", () => {
  const s = run(fresh(), ACT(0, 0));
  const { lane } = wavesOf(s, { bg: 3, bank: 2 });
  assert.equal(Math.max(...lane("WL").points.map(([, v]) => v)), RAILS.VSS);
  assert.equal(new Set(lane("BL").series[0].points.map(([, v]) => v)).size, 1);
});

test("인터페이스는 실제 스펙 타이밍을 따른다 — CA 폭과 DQ 시작", () => {
  const s = run(fresh(), ACT(0, 0), RD(0, 0));
  const { lane } = wavesOf(s);
  const [act, rd] = s.history;
  // ACT 는 두 클럭짜리 커맨드라 CA 를 2클럭 붙잡는다
  assert.deepEqual(lane("CA").ranges[0], [act.clk, act.clk + 2]);
  // 읽기 데이터는 CL 뒤에 열려 BL/2 클럭 동안 버스를 쓴다
  const [start, stop, kind] = lane("DQ").ranges.at(-1);
  assert.equal(start, rd.clk + paramClocks(ddr5, bin, "CL"));
  assert.equal(stop - start, paramClocks(ddr5, bin, "BL") / 2);
  assert.equal(kind, "read");
});

test("두 묶음을 섞지 않는다 — 인터페이스는 스펙, 어레이는 모식도", () => {
  const { w } = wavesOf(run(fresh(), ACT(0, 0)));
  const groups = Object.fromEntries(w.lanes.map((l) => [l.id, l.group]));
  for (const id of ["CK_t", "CS_n", "CA", "DQS_t", "DQ"]) assert.equal(groups[id], IFACE);
  for (const id of ["WL", "BL", "SAE", "CSL", "Cell"]) assert.equal(groups[id], ARRAY);
  assert.match(w.groups.find((g) => g.id === ARRAY).note, /모식도/);
  for (const l of w.lanes) assert.ok(l.note?.length, `${l.id} 에 설명이 없다`);
});

test("전압 레일이 없는 세대는 파형을 그리지 않는다", () => {
  const ddr6 = findGen("ddr6");
  assert.equal(ddr6.rails, undefined);
  assert.equal(buildWaves(ddr6, null, fresh(), PICK), null);
});

/* ---------- 참고문헌 ----------
 * 값이 대표값인 이상 "어디를 보면 확인할 수 있는가"가 값만큼 중요하다.
 * 그래서 근거가 비어 있는 세대가 생기지 않게 여기서 막는다.
 */
test("모든 세대가 표준 문서를 밝힌다 — 미공개 세대도 문서번호는 있다", () => {
  for (const gen of GENERATIONS) {
    const std = gen.refs?.filter((r) => r.kind === "표준") ?? [];
    assert.equal(std.length, 1, `${gen.id}: 표준이 하나여야 한다`);
    assert.match(std[0].doc, /^JESD\d+/, `${gen.id}: 문서번호가 없다`);
    for (const r of gen.refs) {
      assert.ok(r.title?.length && r.where?.length, `${gen.id}: ${r.kind} 에 내용이 없다`);
      if (r.url) assert.match(r.url, /^https:\/\//, `${gen.id}: ${r.url} 는 https 가 아니다`);
    }
  }
});

test("돌아가는 세대는 값의 출처와 모식도의 경계를 함께 밝힌다", () => {
  for (const gen of GENERATIONS.filter(isRunnable)) {
    const kinds = gen.refs.map((r) => r.kind);
    assert.ok(kinds.includes("값"), `${gen.id}: 값의 출처가 없다`);
    const shape = gen.refs.find((r) => r.kind === "모식도");
    assert.ok(shape, `${gen.id}: 모식도 경계를 밝히지 않았다`);
    // 모식도는 문서가 아니므로 링크를 달면 안 된다 — 출처가 있는 척이 된다
    assert.equal(shape.url, null, `${gen.id}: 모식도에 링크가 붙었다`);
  }
});

test("링크는 발행처 대문이다 — 문서 깊은 주소는 개정판마다 바뀌어 끊긴다", () => {
  for (const gen of GENERATIONS) {
    for (const r of gen.refs.filter((x) => x.url)) {
      assert.match(r.url, /^https:\/\/[^/]+\/$/, `${gen.id}: ${r.url} 가 대문이 아니다`);
    }
  }
});

/* ---------- 값의 출처 ----------
 * "비공개 자료는 들어 있지 않다"는 말이 참이려면 **값마다 출처가 붙어 있어야** 한다.
 * 여기서 막지 않으면 나중에 값을 더할 때 출처 없는 숫자가 슬그머니 섞인다.
 */
const { PROVENANCE } = await import("../life/dram/spec/common.js");

test("값이 있는 파라미터는 모두 출처가 붙어 있다 — 넷 밖의 출처는 없다", () => {
  const kinds = new Set(Object.keys(PROVENANCE));
  for (const gen of GENERATIONS.filter(isRunnable)) {
    const rows = [...Object.entries(gen.params), ...gen.bins.flatMap((b) => Object.entries(b.params ?? {}))];
    for (const [name, p] of rows) {
      const hasValue = p.ns != null || p.ck != null;
      if (!hasValue) { assert.equal(p.src, null, `${gen.id}: ${name} 은 값이 없는데 출처가 붙었다`); continue; }
      assert.ok(kinds.has(p.src), `${gen.id}: ${name} 의 출처가 없거나 모르는 값이다 (${p.src})`);
    }
  }
});

test("전압 레일도 출처를 밝힌다 — ΔV 는 모식도용으로 고른 값이다", () => {
  for (const gen of GENERATIONS.filter(isRunnable)) {
    for (const key of ["VDD", "VPP", "dV"]) {
      assert.ok(PROVENANCE[gen.rails.src[key]], `${gen.id}: rails.${key} 의 출처가 없다`);
    }
    assert.equal(gen.rails.src.dV, "illustrative", `${gen.id}: ΔV 를 공개 값처럼 적으면 안 된다`);
  }
});

test("산술로 나온 값은 실제로 그 산술과 맞는다 — 라벨만 붙이면 거짓말이 된다", () => {
  // tRC 는 derived 라고 적혀 있다. 정말 tRAS + tRP 인지 확인한다.
  assert.equal(ddr5.params.tRC.src, "derived");
  assert.equal(ddr5.params.tRC.ns, ddr5.params.tRAS.ns + ddr5.params.tRP.ns);
});

test("출처 넷은 저마다 설명이 있다 — 라벨만으로는 무엇이 공개 자료인지 모른다", () => {
  for (const [key, meta] of Object.entries(PROVENANCE)) {
    assert.ok(meta.label?.length && meta.note?.length, `${key} 에 설명이 없다`);
  }
});
