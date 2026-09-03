// "지금 이 커맨드를 낼 수 있는가, 없다면 무엇이 몇 클럭 남았는가."
// 이 화면의 전부가 이 파일이다. 화면(app.js)과 _infra/dram.test.mjs 가 같은 모듈을 쓴다 —
// 타이밍 판정을 화면 안에서 따로 만들지 않는다.
//
// 전부 순수 함수다. 상태를 바꾸지 않고 새 상태를 돌려준다.

import { SCOPES, nsToCk, tCKns } from "./spec/common.js";

const HISTORY_MAX = 64;   // 이보다 오래된 커맨드가 지금을 막는 일은 없다(tRFC 도 300ns 남짓)

export const findBin = (gen, binId) => gen.bins.find((b) => b.id === binId) ?? gen.bins[0];
export const tCK = (bin) => tCKns(bin.mtps);

/* 빈이 덮어쓴 값이 있으면 그것이 이긴다 — CL·CWL·tCCD_L 처럼 클럭에 묶인 것들이다. */
export function lookupParam(gen, bin, name) {
  const fromBin = bin?.params?.[name];
  if (fromBin) return { ...fromBin, name, scope: "bin" };
  const fromGen = gen.params?.[name];
  return fromGen ? { ...fromGen, name, scope: "gen" } : null;
}

/* 파라미터 → 클럭. JEDEC 의 max(x nCK, y ns) 를 그대로 옮긴 것이다.
 * 값이 아직 없는 파라미터(LPDDR5 의 RL 등)는 null 을 돌려준다 — 0 이 아니다. */
export function paramClocks(gen, bin, name) {
  const p = lookupParam(gen, bin, name);
  if (!p) return null;
  const fromNs = p.ns == null ? null : nsToCk(p.ns, tCK(bin));
  const fromCk = p.ck ?? null;
  if (fromNs == null && fromCk == null) return null;
  return Math.max(fromNs ?? 0, fromCk ?? 0);
}

/* 항 하나를 클럭으로. "BL/2" 는 버스트가 DQ 를 붙잡는 클럭 수다(DDR 이라 절반). */
export function termClocks(gen, bin, term) {
  if (term === "BL/2") {
    const bl = paramClocks(gen, bin, "BL");
    return bl == null ? null : bl / 2;
  }
  return paramClocks(gen, bin, term);
}

/* 규칙의 항들을 펼쳐서 더한다. 화면은 이 parts 를 그대로 보여 준다 —
 * "38클럭"이 아니라 "CWL 38 + BL/2 8 + tWTR_L 24" 라고 말해야 이해가 남는다. */
export function resolveTerms(gen, bin, terms) {
  const parts = terms.map((t) => ({ term: t, ck: termClocks(gen, bin, t) }));
  const unknown = parts.filter((p) => p.ck == null).map((p) => p.term);
  const total = parts.reduce((sum, p) => sum + (p.ck ?? 0), 0);
  return { total, parts, unknown };
}

export function createState(gen, binId) {
  const bin = findBin(gen, binId);
  const banks = [];
  for (let bg = 0; bg < gen.org.bankGroups; bg++) {
    for (let bank = 0; bank < gen.org.banksPerGroup; bank++) banks.push({ bg, bank, state: "idle", row: null });
  }
  return { genId: gen.id, binId: bin.id, clk: 0, banks, history: [], nextRow: 0, seq: 0, lastRefClk: null };
}

export const bankIndex = (gen, bg, bank) => bg * gen.org.banksPerGroup + bank;
export const bankAt = (gen, state, bg, bank) => state.banks[bankIndex(gen, bg, bank)];
const cmdDef = (gen, op) => gen.commands.find((c) => c.op === op);

/* 상태가 허락하지 않는 커맨드인가. 타이밍보다 먼저 걸리는 문 —
 * 열린 행을 닫지 않고 다른 행을 열 수는 없다. */
export function stateError(gen, state, cmd) {
  const def = cmdDef(gen, cmd.op);
  if (!def) return `모르는 커맨드: ${cmd.op}`;
  if (def.target === "none" || def.needs == null) return null;
  if (def.target === "all") {
    const bad = state.banks.filter((b) => b.state !== def.needs);
    if (bad.length) return `모든 뱅크가 ${def.needs} 여야 한다 — ${bad.length}개가 열려 있다`;
    return null;
  }
  const b = bankAt(gen, state, cmd.bg, cmd.bank);
  if (b.state !== def.needs) {
    return b.state === "active"
      ? `이 뱅크는 이미 행 ${b.row} 을 열어 두고 있다 — 먼저 PRE 로 닫아야 한다`
      : "이 뱅크는 닫혀 있다 — 먼저 ACT 로 행을 열어야 한다";
  }
  return null;
}

const isBankScoped = (gen, op) => cmdDef(gen, op)?.target === "bank";

/* 두 커맨드 사이에 이 범위의 규칙이 걸리는가. 한쪽이라도 뱅크를 안 고르는
 * 커맨드(PREA·REFab)면 랭크 전체 규칙만 본다. */
function scopeApplies(gen, scope, past, cmd) {
  if (!isBankScoped(gen, past.op) || !isBankScoped(gen, cmd.op)) return scope === "rank";
  return SCOPES[scope]?.test(past, cmd) ?? false;
}

/* 이 커맨드를 막고 있는 모든 제약. 하나도 없으면 지금 낼 수 있다. */
export function constraintsFor(gen, bin, state, cmd) {
  const out = [];
  const recent = state.history.slice(-HISTORY_MAX);

  for (const rule of gen.rules) {
    if (rule.to !== cmd.op) continue;
    for (const past of recent) {
      if (past.op !== rule.from) continue;
      if (!scopeApplies(gen, rule.scope, past, cmd)) continue;
      const { total, parts, unknown } = resolveTerms(gen, bin, rule.terms);
      out.push({
        kind: "rule", from: past, earliest: past.clk + total,
        need: total, parts, unknown, scope: rule.scope, why: rule.why,
        label: rule.terms.join(" + "),
      });
    }
  }

  /* 커맨드 버스는 직렬이다. 타이밍이 다 풀렸어도 앞 커맨드가 CA 를 놓아야 낼 수 있다 —
   * 이것 없이는 한 클럭에 두 커맨드가 겹쳐 버린다. */
  const prev = recent[recent.length - 1];
  if (prev) {
    const ca = cmdDef(gen, prev.op)?.ca ?? 1;
    out.push({
      kind: "cmdbus", from: prev, earliest: prev.clk + ca,
      need: ca, parts: [{ term: "CA", ck: ca }], unknown: [], scope: "rank",
      why: ca > 1
        ? `${prev.op} 는 주소가 커서 커맨드 버스를 ${ca}클럭 쓴다.`
        : "커맨드 버스는 한 클럭에 하나만 보낸다.",
      label: "커맨드 버스",
    });
  }

  for (const win of gen.windows ?? []) {
    if (win.op !== cmd.op) continue;
    const acts = recent.filter((h) => h.op === win.op);
    if (acts.length < win.count) continue;
    const anchor = acts[acts.length - win.count];
    const need = paramClocks(gen, bin, win.param);
    if (need == null) continue;
    out.push({
      kind: "window", from: anchor, earliest: anchor.clk + need,
      need, parts: [{ term: win.param, ck: need }], unknown: [], scope: "rank",
      why: win.why, label: `${win.param} (최근 ${win.count}번째 ${win.op} 부터)`,
    });
  }

  return out;
}

/* 가장 빠르게 낼 수 있는 클럭과, 그 시점을 정한 제약. */
export function earliest(gen, bin, state, cmd) {
  const all = constraintsFor(gen, bin, state, cmd);
  const clk = all.reduce((max, c) => Math.max(max, c.earliest), state.clk);
  const binding = all.filter((c) => c.earliest === clk && clk > state.clk);
  return { clk, binding, all };
}

/* 지금 이 클럭에 낼 수 있는가. 화면의 버튼이 이걸 그대로 쓴다. */
export function canIssue(gen, bin, state, cmd) {
  const err = stateError(gen, state, cmd);
  if (err) return { ok: false, stateError: err, wait: 0, binding: [] };
  const { clk, binding } = earliest(gen, bin, state, cmd);
  return { ok: clk <= state.clk, stateError: null, wait: clk - state.clk, binding, at: clk };
}

/* 커맨드를 낸다. 아직 못 낼 시점이면 **낼 수 있는 가장 빠른 클럭까지 시계를 민다** —
 * 기다린 이유(waitedFor)를 함께 적어 두므로 타임라인이 그 화살표를 그린다.
 * 이 화면에서 배움이 일어나는 지점이 바로 그 기다림이다. */
export function issue(gen, bin, state, cmd) {
  const err = stateError(gen, state, cmd);
  if (err) return { state, error: err };

  const { clk, binding } = earliest(gen, bin, state, cmd);
  const def = cmdDef(gen, cmd.op);
  const banks = state.banks.map((b) => ({ ...b }));
  let row = null;
  let nextRow = state.nextRow;

  if (def.target === "all") {
    if (def.makes) for (const b of banks) { b.state = def.makes; if (def.makes === "idle") b.row = null; }
  } else if (def.target === "bank") {
    const b = banks[bankIndex(gen, cmd.bg, cmd.bank)];
    if (cmd.op === "ACT") { row = nextRow; nextRow += 1; b.row = row; }
    if (def.makes) { b.state = def.makes; if (def.makes === "idle") b.row = null; }
  }

  const entry = {
    id: state.seq, clk, op: cmd.op, bg: cmd.bg ?? null, bank: cmd.bank ?? null,
    row, target: def.target,
    waitedFor: binding.map((c) => ({ label: c.label, fromId: c.from.id, need: c.need, parts: c.parts, why: c.why })),
  };

  return {
    state: {
      ...state, clk, banks, nextRow, seq: state.seq + 1,
      history: [...state.history, entry],
      lastRefClk: cmd.op.startsWith("REF") ? clk : state.lastRefClk,
    },
    error: null,
  };
}

export const advance = (state, by = 1) => ({ ...state, clk: state.clk + by });

/* DQ 버스를 언제 붙잡는가. 레이턴시를 모르는 세대(LPDDR5 의 RL/WL)는 null 이다. */
export function busSpan(gen, bin, entry) {
  const def = cmdDef(gen, entry.op);
  if (!def?.bus) return null;
  const latName = def.bus === "read" ? (lookupParam(gen, bin, "CL") ? "CL" : "RL") : (lookupParam(gen, bin, "CWL") ? "CWL" : "WL");
  const lat = paramClocks(gen, bin, latName);
  const len = termClocks(gen, bin, "BL/2");
  if (lat == null || len == null) return null;
  return { start: entry.clk + lat, len, kind: def.bus, latName, lat };
}

/* 리프레시 마감까지. 최소 간격이 아니라 마감이라 넘겨도 커맨드가 막히지는 않는다 —
 * 대신 화면이 빨갛게 말해 준다. 이 구분이 tREFI 를 이해하는 전부다. */
export function refreshStatus(gen, bin, state) {
  if (!gen.refresh) return null;
  const period = paramClocks(gen, bin, gen.refresh.param);
  if (period == null) return null;
  const since = state.clk - (state.lastRefClk ?? 0);
  return { period, since, remaining: period - since, overdue: since > period, note: gen.refresh.note };
}
