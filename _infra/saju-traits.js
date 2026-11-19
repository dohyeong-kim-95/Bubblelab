// 사주 → 공통 특성(M4 설계 §2). 순수 함수 — 같은 명식이면 같은 결과, LLM 없음.
// 입력은 buildChart()(fortune.js) 출력 그대로. 셈 기준은 사주 풀이(saju-reading.js)가 이미 계산한 값을 다시 써서
// 사주 화면 문장과 특성이 서로 다른 말을 하지 않게 한다: 오행 reading.elements · 십성 reading.tenGods ·
// 신강약 reading.strength · 신살 detail.shinsal.
//
// 어휘(id·표시명·축)의 원본은 fortune/lib/traits.js — 여기는 규칙표만 둔다. 표나 값을 바꾸면 version 을 올린다.
// 확신도 숫자는 모두 [추정]이고 순서만 근거가 있다: 일간 > 과다·많음 > 결핍·없음 > 신강약 > 신살.
import { TRAITS } from "../fortune/lib/traits.js";

export const SAJU_TRAIT_RULES = { version: "saju-traits-v2", cap: 0.6, min: 0.2, noHourPenalty: 0.05 };

// 일간(일주 천간) — 적천수 천간론의 물상 + 사주 풀이 DAY_MASTER 문장과 같은 방향으로만. [첫째 0.5, 둘째 0.4].
export const DAY_MASTER_TRAITS = {
  갑: ["temperament.principled", "work.leading"],      // 甲木參天 — 곧게 뻗음
  을: ["temperament.flexible", "work.together"],       // 乙木雖柔 — 덩굴, 기대어 감
  병: ["emotion.expressive", "relationship.warm_host"],// 丙火猛烈 — 해, 드러냄
  정: ["relationship.caring", "energy.immersive"],     // 丁火柔中 — 등불, 안으로 집중
  무: ["temperament.grounded", "relationship.caring"], // 戊土固重 — 산, 무겁고 품음
  기: ["work.results", "relationship.caring"],         // 己土卑濕 — 밭, 기르고 실속
  경: ["relationship.direct", "temperament.bold"],     // 庚金帶煞 — 원석, 결단
  신: ["thinking.detail", "temperament.principled"],   // 辛金軟弱(溫潤而淸) — 보석, 정교
  임: ["thinking.broad", "thinking.learner"],          // 壬水通河 — 큰 물, 넓게 흡수
  계: ["thinking.intuitive", "emotion.sensitive"],     // 癸水至弱 — 이슬비, 스며듦
};
export const DAY_MASTER_CONF = [0.5, 0.4];

// 오행 과다(전체의 3/8 이상)·결핍(0개) — readElements 와 같은 문턱. 토 결핍은 단점만 말하게 돼서 내지 않는다.
export const ELEMENT_TRAITS = {
  목: { excess: [["temperament.bold", 0.4]], missing: [["temperament.careful", 0.3]] },
  화: { excess: [["emotion.expressive", 0.4], ["emotion.vivid", 0.35]], missing: [["emotion.reserved", 0.3]] },
  토: { excess: [["temperament.grounded", 0.45]], missing: [] },
  금: { excess: [["temperament.principled", 0.4], ["relationship.direct", 0.35]], missing: [["temperament.careful", 0.3]] },
  수: { excess: [["thinking.deep", 0.45]], missing: [["energy.outgoing", 0.3]] },
};

// 십성 다섯 갈래 — readTenGods 와 같은 셈(겉글자, 지지 본기, 일간 제외). many: 3개면 기본값, 4개 이상 +0.1. none: 0개.
// 재성 없음('돈 관심 덜')은 금칙 근처라 내지 않는다.
export const GROUP_TRAITS = {
  비겁: { many: [["work.independent", 0.45]], none: [["work.together", 0.3]] },
  식상: { many: [["work.maker", 0.45], ["emotion.expressive", 0.35]], none: [["emotion.reserved", 0.3]] },
  재성: { many: [["work.results", 0.45]], none: [] },
  관성: { many: [["temperament.dutiful", 0.45]], none: [["temperament.free", 0.3]] },
  인성: { many: [["thinking.learner", 0.45]], none: [["work.hands_on", 0.3]] },
};
export const GROUP_MANY_BONUS = 0.1;

// 신강약은 간이 판정이라 혼자서는 특성을 내지 않고(최소 0.2 아래) 다른 근거를 거들기만 한다 — v2(2026-11-16).
// 근거: readStrength 는 다섯 오행 중 둘(같은 오행·나를 낳는 오행)만 받침으로 세서 구조적으로 '약'에 쏠린다
// (1940~2010 7일 간격 3,705개 중 58% 가 약). v1(약 0.3·강 0.35)에서는 work.together 가 명식의 61% 에 나왔고
// 그중 32%p 는 신약 하나뿐, 17.7%p 는 같은 것을 재는 '비겁 없음'과 겹쳐 0.51 로 카드까지 올라갔다(설계 §9-1 발견 5,
// 문턱 40%). 0.15 로 내린 뒤 work.together 30%(카드 24.8% → 7.3%), 40% 를 넘는 id 없음.
export const STRENGTH_TRAITS = { 강: [["work.independent", 0.15]], 약: [["work.together", 0.15]], 중: [] };

// 신살은 학파 차이가 커서 가장 낮게 — 혼자서는 화면 문턱(0.45)을 못 넘고 겹침 강화에만 쓰인다.
// 사고·다툼·건강 쪽 해석이 기본인 것(백호·양인·괴강·귀문·원진·공망)과 '돕는 사람'(천을귀인)은 쓰지 않는다.
export const SHINSAL_TRAITS = {
  역마살: [["temperament.change_seeking", 0.25]],
  화개살: [["relationship.selective", 0.25]],
  문창귀인: [["thinking.learner", 0.25]],
  도화살: [["relationship.warm_host", 0.2]],
};

const noisyOr = (cs) => 1 - cs.reduce((p, c) => p * (1 - c), 1);
const r2 = (x) => Math.round(x * 100) / 100;

function candidateTraits(cand) {
  const hits = [];   // {id, c, ev:[기계용, 사람용]}
  const add = (list, machine, human) => { for (const [id, c] of list) hits.push({ id, c, ev: [machine, human] }); };
  const r = cand.reading;
  const dm = r.dayMaster.stem;
  const [a, b] = DAY_MASTER_TRAITS[dm];
  add([[a, DAY_MASTER_CONF[0]], [b, DAY_MASTER_CONF[1]]], `saju:dayMaster=${dm}`, `일간이 ${r.dayMaster.name}(${r.dayMaster.image})`);
  for (const e of r.elements.excess) add(ELEMENT_TRAITS[e].excess, `saju:element.excess=${e}`, `오행 중 ${e} 기운이 ${r.elements.counts[e]}개로 많음`);
  for (const e of r.elements.missing) add(ELEMENT_TRAITS[e].missing, `saju:element.missing=${e}`, `오행 중 ${e} 기운이 없음`);
  const tg = r.tenGods.counts;
  for (const g of r.tenGods.dominant) {
    const bonus = tg[g] >= 4 ? GROUP_MANY_BONUS : 0;
    add(GROUP_TRAITS[g].many.map(([id, c]) => [id, c + bonus]), `saju:tenGods.many=${g}:${tg[g]}`, `십성 중 ${g}이 ${tg[g]}개로 가장 많음`);
  }
  for (const g of r.tenGods.none) add(GROUP_TRAITS[g].none, `saju:tenGods.none=${g}`, `십성 중 ${g}이 없음`);
  add(STRENGTH_TRAITS[r.strength.level] ?? [], `saju:strength=${r.strength.level}`, `나를 받치는 기운이 ${r.strength.level === "강" ? "많은" : "적은"} 편`);
  for (const s of cand.detail?.shinsal ?? []) {
    if (SHINSAL_TRAITS[s.name]) add(SHINSAL_TRAITS[s.name], `saju:shinsal=${s.name}`, `${s.name}이 있음`);
  }

  // 같은 id 는 noisy-OR(1−∏(1−c)), 상한 0.6
  const byId = new Map();
  for (const h of hits) {
    if (!TRAITS[h.id]) throw new Error(`어휘에 없는 id: ${h.id}`);
    const o = byId.get(h.id) ?? { cs: [], ev: [] };
    o.cs.push(h.c); o.ev.push(...h.ev);
    byId.set(h.id, o);
  }
  const out = new Map();
  for (const [id, o] of byId) out.set(id, { c: Math.min(SAJU_TRAIT_RULES.cap, noisyOr(o.cs)), ev: o.ev });
  // 사주 안에서 같은 축 반대 극이 함께 나오면 센 쪽만 남긴다(센 쪽 값 − 약한 쪽 값의 절반) — 사주 혼자 모순 문장을 만들지 않게.
  for (const [id, o] of out) {
    const t = TRAITS[id];
    for (const [id2, o2] of out) {
      const t2 = TRAITS[id2];
      if (id2 !== id && t.pole && t2.axis === t.axis && t2.pole === -t.pole && o.c >= o2.c) {
        o.c = o.c - 0.5 * o2.c; o2.c = 0;
        o.ev.unshift(`saju:self_conflict=${id2}`);   // 기계용 표시는 앞에 — 사람용 근거가 늘 마지막(배지가 보여 준다)
      }
    }
  }
  return out;
}

// 시간 모름·자시처럼 후보가 여럿이면 모든 후보에서 나온 특성만, 확신도는 가장 낮은 값. 시주가 없으면 0.05 를 더 뺀다.
// 출력: [{trait, label, kind:"trait", evidence:[기계용…, 사람용(마지막)], confidence, source:"saju"}] — 확신도 내림차순, id 순.
export function sajuTraits(chart) {
  const per = chart.candidates.map(candidateTraits);
  const noHour = chart.candidates.some((c) => !c.pillars.hour);
  const out = [];
  for (const [id, o] of per[0]) {
    if (!per.every((m) => m.has(id))) continue;
    const c = Math.min(...per.map((m) => m.get(id).c)) - (noHour ? SAJU_TRAIT_RULES.noHourPenalty : 0);
    if (c < SAJU_TRAIT_RULES.min) continue;
    out.push({ trait: id, label: TRAITS[id].label, kind: "trait", evidence: o.ev, confidence: r2(c), source: "saju" });
  }
  return out.sort((x, y) => y.confidence - x.confidence || x.trait.localeCompare(y.trait));
}

// 노트(fortune/lib/note.js)가 받는 사주 칸 재료 — 생년월일·명식은 넣지 않는다.
// day_master.traits: 운세별 한 줄(타고난 바탕)이 먼저 고를 후보(일간 규칙의 두 특성, 그 순서).
export function sajuNoteInput(chart) {
  const dm = chart.candidates[0].reading.dayMaster;
  const sameStem = chart.candidates.every((c) => c.reading.dayMaster.stem === dm.stem);
  return {
    rules: SAJU_TRAIT_RULES.version,
    traits: sajuTraits(chart),
    day_master: sameStem ? { stem: dm.stem, name: dm.name, traits: [...DAY_MASTER_TRAITS[dm.stem]] } : null,
    hour_known: chart.candidates.length === 1 && Boolean(chart.candidates[0].pillars.hour),
  };
}
