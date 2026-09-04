// 파라미터 하나를 **설명하는 데 필요한 것들을 데이터에서 뽑아낸다.**
//
// 손으로 쓴 설명문을 따로 두지 않는 것이 요점이다. 규칙 표에 이미
// (선행, 후행, 범위, 항, 왜)가 있으므로 "어느 커맨드 사이인가"는 거기서 나오고,
// "빈이 바뀌면 어떻게 되나"는 ns/ck 중 무엇에 묶였는지에서 나온다. 규칙이나 값을
// 고치면 설명이 저절로 따라온다 — 따로 적어 두면 반드시 어긋난다.
//
// engine.js 와 마찬가지로 순수 함수만 두고, 화면과 테스트가 같은 모듈을 쓴다.

import { FAMILIES, SCOPES } from "./spec/common.js";
import { lookupParam, paramClocks, resolveTerms } from "./engine.js";

/* 이 파라미터가 **어느 자리에 걸리는가**. 규칙과 창(tFAW)을 모두 본다. */
export function placesOf(gen, name) {
  const out = gen.rules
    .filter((r) => r.terms.includes(name))
    .map((r) => ({
      kind: "rule", from: r.from, to: r.to, scope: r.scope,
      scopeLabel: SCOPES[r.scope]?.label ?? r.scope,
      terms: r.terms, why: r.why, alone: r.terms.length === 1,
    }));
  for (const w of gen.windows ?? []) {
    if (w.param !== name) continue;
    out.push({
      kind: "window", from: w.op, to: w.op, scope: "rank", scopeLabel: "랭크 전체",
      terms: [name], why: w.why, alone: true, count: w.count,
    });
  }
  return out;
}

/* 무엇에 묶여 있는가. 빈이 바뀔 때 클럭 수가 늘어나는지 그대로인지가 여기서 갈린다 —
 * 코어는 물리(ns)에, 인터페이스는 클럭에 묶여 있다는 것이 이 화면의 큰 배움 하나다. */
export function bindingOf(gen, bin, name) {
  const p = lookupParam(gen, bin, name);
  if (!p) return null;
  if (p.ns != null && p.ck != null) {
    return { kind: "both", text: "ns 하한과 클럭 하한을 둘 다 갖는다 — 빈에 따라 이기는 쪽이 바뀐다." };
  }
  if (p.ns != null) return { kind: "ns", text: "ns 에 묶여 있다 — 물리적 시간이라 빈이 빨라지면 클럭 수가 늘어난다." };
  if (p.ck != null) return { kind: "ck", text: "클럭에 묶여 있다 — 빈이 바뀌어도 클럭 수는 그대로다." };
  return { kind: "none", text: "아직 값이 없다." };
}

export const acrossBins = (gen, name) =>
  gen.bins.map((b) => ({ bin: b, clocks: paramClocks(gen, b, name), winner: winnerIn(gen, b, name) }));

/* max(x nCK, y ns) 에서 어느 쪽이 이겼는가. 둘 다 있을 때만 뜻이 있다. */
function winnerIn(gen, bin, name) {
  const p = lookupParam(gen, bin, name);
  if (!p || p.ns == null || p.ck == null) return null;
  const fromNs = paramClocks(gen, bin, name);
  return fromNs === p.ck ? "ck" : "ns";
}

/* 같은 무리의 다른 파라미터들. 설명이 막히는 지점은 거의 항상 비슷한 것끼리
 * 헷갈릴 때라, 하나를 볼 때 이웃을 함께 보여 준다. */
export function siblingsOf(gen, bin, name) {
  const me = lookupParam(gen, bin, name);
  if (!me?.family) return [];
  const names = [...Object.keys(gen.params), ...gen.bins.flatMap((b) => Object.keys(b.params ?? {}))];
  return [...new Set(names)]
    .filter((n) => n !== name && lookupParam(gen, bin, n)?.family === me.family)
    .map((n) => ({
      name: n,
      clocks: paramClocks(gen, bin, n),
      why: lookupParam(gen, bin, n).why,
      places: placesOf(gen, n),
      pairedBy: pairedScope(gen, name, n),
    }));
}

/* **짝**: 커맨드 쌍이 똑같고 범위만 다른 둘. tCCD_L/tCCD_S, tRRD_L/tRRD_S,
 * tWTR_L/tWTR_S 가 그렇다. 이 둘을 가르는 것이 범위 하나뿐이라는 사실이
 * 뱅크그룹을 이해하는 핵심이라, 자동으로 찾아 표시한다. */
export function pairedScope(gen, a, b) {
  const pa = placesOf(gen, a);
  const pb = placesOf(gen, b);
  for (const x of pa) {
    for (const y of pb) {
      // 굴러가는 창(tFAW)은 쌍 제약과 성격이 달라 짝이 될 수 없다.
      // 커맨드 쌍이 같다는 이유로 묶으면 "tFAW 는 tRRD 의 범위 변형"이라는 오해를 준다.
      if (x.kind !== "rule" || y.kind !== "rule") continue;
      if (x.from === y.from && x.to === y.to && x.scope !== y.scope) {
        return { from: x.from, to: x.to, mine: x.scopeLabel, theirs: y.scopeLabel };
      }
    }
  }
  return null;
}

/* 화면이 그대로 그릴 수 있는 한 장. */
export function explain(gen, bin, name) {
  const p = lookupParam(gen, bin, name);
  if (!p) return null;
  return {
    name,
    param: p,
    clocks: paramClocks(gen, bin, name),
    places: placesOf(gen, name).map((place) => ({
      ...place,
      total: place.alone ? null : resolveTerms(gen, bin, place.terms),
    })),
    binding: bindingOf(gen, bin, name),
    bins: acrossBins(gen, name),
    family: p.family ? { id: p.family, ...FAMILIES[p.family] } : null,
    siblings: siblingsOf(gen, bin, name),
  };
}
