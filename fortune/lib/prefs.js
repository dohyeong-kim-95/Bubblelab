// 운세 화면 보기 설정 — 이 기기(localStorage)에만. 상담 노트(/)와 탭 화면(/note/)이 같은 키를 같이 쓴다.
// 값은 문자열 하나라 JSON 이 아니다. 읽기·쓰기 실패(사생활 보호 모드 등)는 여기서 삼키고 기본값(켜짐)으로 연다.
//
//   bl-fortune-dangi  "on" | "off"  — 다그당스(당이). 없거나 모르는 값이면 켜짐.
//
// 당이 끄기 = 당이 없는 화면 전체(2026-11-17): 곁 당이 그림도, 타로 카드 그림도(1909 옛 그림 덱) 하나의 값이 정한다.
// 타로 탭의 「1909년 옛 그림 카드로 보기」 체크도 이 값을 보여 주고 바꾼다 — 원본이 하나라 둘이 어긋날 수 없다.
// 예전에는 덱을 bl-tarot-pref.deck 에 따로 두었다 → 처음 읽을 때 옮긴다(classic 이었으면 당이 끔) 그리고 deck 칸은 지운다.
export const DANGI_KEY = "bl-fortune-dangi";
export const OLD_PREF_KEY = "bl-tarot-pref";   // lib/tarot-log.js 의 PREF_KEY(테스트가 맞춰 본다)
export const dangiOn = (raw) => raw !== "off";
export const dangiValue = (on) => (on ? "on" : "off");
/** 당이를 켜면 당이 덱, 끄면 1909 옛 그림 덱. 옛 그림이 아직 없으면(ready=false) 당이 덱. */
export const deckForDangi = (on, classicReady = true) => (on || !classicReady ? "dangi" : "classic");

/** 옛 저장(bl-tarot-pref.deck) → bl-fortune-dangi. 순수 함수: { dangi: 새 값|null(그대로), pref: 새 타로 설정|null(그대로) } */
export function migrateDeck(rawDangi, oldPref) {
  if (!oldPref || typeof oldPref !== "object" || !("deck" in oldPref)) return { dangi: null, pref: null };
  const { deck, ...rest } = oldPref;
  return { dangi: deck === "classic" && rawDangi !== "off" ? "off" : null, pref: rest };
}

/** 이 기기에서 당이가 켜져 있나 — 옛 덱 설정을 옮긴 뒤 읽는다. ls 는 localStorage 모양(테스트에서 바꿔 끼운다). */
export function loadDangi(ls = globalThis.localStorage) {
  try {
    const raw = ls.getItem(DANGI_KEY);
    let old = null;
    try { old = JSON.parse(ls.getItem(OLD_PREF_KEY) ?? "null"); } catch { /* 깨진 값은 옮길 것 없음 */ }
    const m = migrateDeck(raw, old);
    if (m.dangi) ls.setItem(DANGI_KEY, m.dangi);
    if (m.pref) ls.setItem(OLD_PREF_KEY, JSON.stringify(m.pref));
    return dangiOn(m.dangi ?? raw);
  } catch { return true; }
}
export function saveDangi(on, ls = globalThis.localStorage) {
  try { ls.setItem(DANGI_KEY, dangiValue(on)); } catch { /* 저장 못 해도 이번 화면은 바뀐다 */ }
}
