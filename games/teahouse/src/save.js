// 진행 저장. 밤 하나가 끝날 때마다 저장한다 (밤 중간은 저장하지 않는다 — 한 밤은 10분 남짓).
//
// 이어하기 코드: 주소(origin)가 바뀌면 localStorage 가 따라오지 않는다 (D-012).
// 그래서 진행을 짧은 글자로 내보내고 새 주소에서 붙여 넣어 가져올 수 있게 한다.
// 저장 데이터에는 이야기의 비밀을 담지 않는다 — 소스와 저장값이 다 보이는 웹이다.

const KEY = 'teahouse.save.v1';
const PREFIX = 'TEA1';

export function blank() {
  return { v: 1, night: 1, clues: {}, items: [], gifts: [], updated: 0 };
}

export class Progress {
  /** @param {Storage|null} storage  테스트에서는 가짜 저장소를 넣는다 */
  constructor(storage = safeLocalStorage()) {
    this.storage = storage;
    this.data = this.#read() ?? blank();
  }

  get night() { return this.data.night; }
  get items() { return this.data.items; }
  get started() { return this.data.night > 1 || this.data.items.length > 0; }

  clues(key) { return this.data.clues[key] ?? []; }

  addClue(key, text) {
    const list = (this.data.clues[key] ??= []);
    if (!list.includes(text)) list.push(text);
  }

  addItem(id, title, body) {
    if (!this.data.items.some((i) => i.id === id)) this.data.items.push({ id, title, body });
  }

  hasItem(id) { return this.data.items.some((i) => i.id === id); }

  /** 고양이 선물 (id 만 저장 — 이름·설명은 data.js CAT_GIFTS) */
  get gifts() { return this.data.gifts; }
  addGift(id) { if (!this.data.gifts.includes(id)) { this.data.gifts.push(id); this.commit(); } }
  hasGift(id) { return this.data.gifts.includes(id); }

  /** 밤 n 을 마쳤다 → 다음에 열 밤은 n+1. 여기서 저장된다. */
  finishNight(n) {
    this.data.night = Math.max(this.data.night, n + 1);
    this.commit();
  }

  /**
   * 저장. 같은 기기에서 탭·앱 두 개가 동시에 돌 수 있으니, 저장소에 있는 것과 합친다
   * (도달한 밤은 큰 쪽, 꿈 조각·단서는 합집합). replace=true 면 덮어쓴다 (코드 가져오기).
   */
  commit({ replace = false } = {}) {
    if (!replace) this.data = merge(this.#read(), this.data);
    this.data.updated = Date.now();
    try { this.storage?.setItem(KEY, JSON.stringify(this.data)); } catch { /* 저장 공간 없음: 이번 판만 */ }
  }

  reset() {
    this.data = blank();
    try { this.storage?.removeItem(KEY); } catch { /* 무시 */ }
  }

  exportCode() {
    const json = JSON.stringify(this.data);
    const body = toBase64Url(new TextEncoder().encode(json));
    return `${PREFIX}.${body}.${checksum(body)}`;
  }

  /** @returns {boolean} 성공 여부. 실패하면 지금 진행은 그대로 둔다 */
  importCode(code) {
    const parsed = parseCode(code);
    if (!parsed) return false;
    this.data = parsed;
    this.commit({ replace: true });
    return true;
  }

  #read() {
    try {
      const raw = this.storage?.getItem(KEY);
      return raw ? validate(JSON.parse(raw)) : null;
    } catch { return null; }
  }
}

export function parseCode(code) {
  const m = String(code).trim().replace(/\s+/g, '').match(/^TEA1\.([A-Za-z0-9_-]+)\.([0-9a-z]{2})$/);
  if (!m || checksum(m[1]) !== m[2]) return null;
  try {
    return validate(JSON.parse(new TextDecoder().decode(fromBase64Url(m[1]))));
  } catch { return null; }
}

// 초기 저장본은 꿈 조각 id 로 제목을, 수첩 키로 밤 번호를 썼다 → 지금 이름으로 옮긴다
const OLD_ITEM_IDS = { '엄마의 손편지': 'letter', '이 빠진 머그잔': 'mug' };
const OLD_CLUE_KEYS = { 'night-1': 'harin-1', 'night-2': 'harin-2' };

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const isStr = (x) => typeof x === 'string';

/** 저장값·가져온 코드를 믿지 않는다: 모양이 틀리면 null, 맞으면 깨끗한 사본 */
function validate(d) {
  if (!isObj(d) || d.v !== 1 || !Number.isInteger(d.night) || d.night < 1 || d.night > 999) return null;
  if (!isObj(d.clues) || !Array.isArray(d.items)) return null;
  const clues = {};
  for (const [k, list] of Object.entries(d.clues)) {
    if (!Array.isArray(list) || !list.every(isStr)) return null;
    const key = OLD_CLUE_KEYS[k] ?? k;
    clues[key] = [...new Set([...(clues[key] ?? []), ...list])];
  }
  const items = [];
  for (const i of d.items) {
    if (!isObj(i) || !isStr(i.id) || !isStr(i.title) || !isStr(i.body ?? '')) return null;
    const id = OLD_ITEM_IDS[i.id] ?? i.id;
    if (!items.some((x) => x.id === id)) items.push({ id, title: i.title, body: i.body ?? '' });
  }
  // 선물함은 나중에 생겼다 → 없으면 빈 목록 (옛 저장값·코드도 그대로 읽힌다)
  if (d.gifts !== undefined && (!Array.isArray(d.gifts) || !d.gifts.every(isStr))) return null;
  const gifts = [...new Set(d.gifts ?? [])];
  return { v: 1, night: d.night, clues, items, gifts, updated: Number(d.updated) || 0 };
}

function merge(stored, mine) {
  if (!stored) return mine;
  const clues = { ...stored.clues };
  for (const [k, list] of Object.entries(mine.clues)) clues[k] = [...new Set([...(clues[k] ?? []), ...list])];
  const items = [...stored.items];
  for (const i of mine.items) if (!items.some((x) => x.id === i.id)) items.push(i);
  const gifts = [...new Set([...(stored.gifts ?? []), ...(mine.gifts ?? [])])];
  return { ...mine, night: Math.max(stored.night, mine.night), clues, items, gifts };
}

function checksum(s) {
  let h = 7;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 1296;
  return h.toString(36).padStart(2, '0');
}

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function safeLocalStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
