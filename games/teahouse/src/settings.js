// 설정 (사용자 2026-11-18: "누를 게 너무 많다" 피드백 → 자동 진행 · 미니게임 끄기).
// 이 기기에만 저장한다 (진행 저장·이어하기 코드와 별개). 저장소가 막혀 있어도 기본값으로 돈다.

const KEY = 'teahouse.settings.v1';
export const DEFAULTS = { auto: false, minigames: true };

/** 글자 수로 읽을 시간을 잡는다 (자동 진행): 1.2초 + 글자당 45ms, 최대 5초 */
export function readTime(text) {
  return Math.min(5000, 1200 + 45 * [...String(text)].length);
}

export class Settings {
  constructor(storage = safe()) {
    this.storage = storage;
    this.data = { ...DEFAULTS };
    try {
      const raw = JSON.parse(this.storage?.getItem(KEY) ?? 'null');
      if (raw && typeof raw === 'object') for (const k of Object.keys(DEFAULTS)) if (typeof raw[k] === 'boolean') this.data[k] = raw[k];
    } catch { /* 기본값 */ }
    this.listeners = new Set();
  }
  get auto() { return this.data.auto; }
  get minigames() { return this.data.minigames; }
  set(key, value) {
    if (!(key in DEFAULTS)) return;
    this.data[key] = !!value;
    try { this.storage?.setItem(KEY, JSON.stringify(this.data)); } catch { /* 이번 판만 */ }
    for (const f of this.listeners) f(key, this.data[key]);
  }
  onChange(f) { this.listeners.add(f); }
}

function safe() { try { return globalThis.localStorage ?? null; } catch { return null; } }
