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
