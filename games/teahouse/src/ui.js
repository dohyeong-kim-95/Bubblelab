// 화면 아래쪽 DOM UI: 대화창, 선택지, 블렌딩 판, 단서 수첩, 획득 카드.
// CSP 때문에 인라인 style 을 쓰지 않는다 — 계산된 색은 style.setProperty(CSSOM)로 넣는다.
import { BASES, TEMPS, ADDITIONS, MAX_ADDITIONS } from './data.js';
import { bakeIcon } from './sprites.js';
import { brewColor } from './blend.js';
import { playBrewGame, pickGame } from './brewgames.js';
import { readTime } from './settings.js';
import * as illust from './illust.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const NIGHT_NAMES = ['첫 번째', '두 번째', '세 번째', '네 번째', '다섯 번째', '여섯 번째', '일곱 번째'];

export class UI {
  /** @param {import('./save.js').Progress} [progress]  단서 수첩·꿈 조각을 저장할 곳 */
  constructor(audio, progress = null) {
    this.audio = audio;
    this.progress = progress;
    this.noteKey = 'default';
    this.faceHint = {};      // 대본이 예약한 일러스트 표정 { id: { face, side, sceneFace } }
    this.speaking = null;    // 지금 일러스트가 떠 있는 인물
    this.localClues = [];
    this.pourEase = 0;       // 따르기를 연달아 빗나간 횟수 (0~2) — 판정 폭을 넓힌다
    this.dialog = $('#dialog');
    this.nameEl = $('#dialog .name');
    this.textEl = $('#dialog .text');
    this.choicesEl = $('#dialog .choices');
    this.nextEl = $('#dialog .next');
    this.blendEl = $('#blend');
    this.waiter = null;   // 탭을 기다리는 resolve
    this.skip = false;    // 타이핑 중 탭 → 한 번에 표시

    const advance = (e) => {
      if (e.target.closest('button')) return;
      if (this.typing) { this.skip = true; return; }
      if (this.waiter) { const w = this.waiter; this.waiter = null; w(); }
    };
    // 대사 넘기기: 화면 어디를 눌러도 된다 (엄지가 닿는 아래쪽 빈 곳 포함).
    // 버튼·입력칸·블렌딩 판·머리줄·창(시트·카드)은 제외.
    addEventListener('resize', () => this.#paintStand());
    new ResizeObserver(() => this.#paintStand()).observe(this.dialog);   // 선택지가 늘면 대화창이 커진다
    $('#app').addEventListener('click', (e) => {
      if (e.target.closest('button, input, textarea, a, #blend, .top, .sheet, .card')) return;
      advance(e);
    });
  }

  /** 한 줄 대사. 타이핑 → 탭하면 다음으로 */
  async say(name, text) {
    this.onLine?.(name, text);   // 대사 한 줄마다 (시계 진행 등)
    this.show('dialog');
    this.#speaker(name);
    this.dialog.classList.toggle('narration', !name);
    this.nameEl.textContent = name || '';
    this.choicesEl.replaceChildren();
    this.nextEl.hidden = true;
    this.textEl.textContent = '';
    this.typing = true;
    this.skip = false;
    for (const ch of text) {
      if (this.skip) { this.textEl.textContent = text; break; }
      this.textEl.textContent += ch;
      await wait(ch === ' ' ? 18 : /[.,…!?]/.test(ch) ? 120 : 32);
    }
    this.typing = false;
    this.nextEl.hidden = false;
    // 자동 진행: 읽을 시간만큼 기다렸다가 넘어간다. 그 사이 탭하면 바로 넘어간다
    let timer = 0;
    const tapped = await new Promise((r) => {
      this.waiter = () => r(true);
      this.autoKick = () => {
        clearTimeout(timer);
        if (this.settings?.auto) timer = setTimeout(() => { if (this.waiter) { this.waiter = null; r(false); } }, readTime(text));
      };
      this.autoKick();
    });
    clearTimeout(timer);
    this.autoKick = null;
    if (tapped) this.audio.sfx('tap');
  }

  /**
   * 스탠딩 일러스트를 찻집 화면 위로 올린다 (쯔꾸르 입식, D-018). 그림이 아직 없으면 조용히 넘어간다.
   * 같은 인물을 다시 부르면 표정만 바뀐다. side: 'left' | 'center' | 'right'
   */
stand(id, face = 'normal', { side = 'left' } = {}) {
    // 일러스트는 그 인물이 말하는 동안에만 보인다 (사용자 2026-11-17). 대본의 stand() 는 "다음에 말할 때 이 표정" 예약.
    // 예약 뒤에 장면 표정(scene.setFace)이 바뀌면 그쪽을 따른다.
    this.faceHint[id] = { face, side, sceneFace: this.standFor?.(this.#nameOf(id))?.face };
    if (this.speaking === id) this.#show(id, face, side);
  }

  #nameOf(id) { return { harin: '하린', mother: '엄마', cat: '고양이', taeo: '태오', dahui: '다희', sukyung: '수경' }[id]; }

  #show(id, face, side = 'left') {
    const layer = $('#stand');
    const el = illust.img('standing', id, face);
    for (const other of [...layer.children]) if (other.dataset.id !== id) other.remove();
    const old = layer.querySelector(`[data-id="${id}"]`);
    if (!el) { old?.remove(); this.#paintStand(); return false; }
    el.dataset.side = side;
    if (old && old !== el) { el.classList.add('in'); old.replaceWith(el); }
    else if (!old) { el.classList.remove('in'); layer.append(el); requestAnimationFrame(() => el.classList.add('in')); }
    this.#paintStand();
    return true;
  }

  /** 스탠딩을 내린다 (id 가 없으면 전부) */
  unstand(id) {
    if (id) delete this.faceHint[id]; else this.faceHint = {};
    const layer = $('#stand');
    for (const el of [...layer.children]) if (!id || el.dataset.id === id) el.remove();
    this.#paintStand();
  }

  /**
   * 쯔꾸르식 배치 (사용자 스케치 2026-11-17): 인물은 왼쪽에 크게, 머리는 찻집 그림(위 네모) 왼쪽 아래 모서리에 걸치고
   * 몸은 대화창 왼쪽을 덮는다. 레이어 위쪽 = 찻집 그림 아랫변 - 걸침.
   */
  #paintStand() {
    const layer = $('#stand');
    const on = layer.children.length > 0;
    document.body.classList.toggle('standing', on);
    if (!on) return;
    // 위: 찻집 그림 아랫변보다 조금 위 (머리가 모서리에 걸친다)
    // 아래: 대화창 윗변보다 조금 아래 (몸이 대화창 위에 살짝 걸친다) — 대사 글자는 가리지 않는다
    const app = $('#app').getBoundingClientRect();
    const stage = $('#stage').getBoundingClientRect();
    const box = (this.dialog.hidden ? $('#blend') : this.dialog).getBoundingClientRect();
    const top = stage.bottom - app.top - Math.min(56, stage.height * 0.2);
    const boxTop = box.height ? box.top - app.top : app.height * 0.7;
    // 대화창이 앞에서 아랫몸을 가린다: 보이는 칸(머리~대화창 윗변)에 상반신(그림 위쪽 약 60%)이 들어오게
    const visible = Math.max(80, boxTop - top);
    const h = Math.min(visible / 0.6, app.width * 0.85 * 1.5);
    layer.style.setProperty('--stand-top', `${Math.round(top)}px`);
    layer.style.setProperty('--img-h', `${Math.round(h)}px`);
  }

  /** 말하는 사람에 맞춰 스탠딩을 올리거나(말하는 중), 흐리게(듣는 중) 한다. 스탠딩 그림이 없으면 작은 초상화 */
  #speaker(name) {
    const st = name ? this.standFor?.(name) : null;
    let shown = false;
    if (st) {
      const hint = this.faceHint[st.id];
      const face = hint && hint.sceneFace === st.face ? hint.face : st.face;
      if (illust.has('standing', st.id, face)) shown = this.#show(st.id, face, hint?.side);
    }
    this.speaking = shown ? st.id : null;
    if (!shown) for (const el of [...$('#stand').children]) el.remove();   // 말하는 사람이 바뀌면 내린다
    this.#paintPortrait(shown ? null : name);
    this.#paintStand();
  }

  /** 말하는 사람의 초상화. this.portraitFor(name) → canvas | null (main.js 가 정한다) */
  #paintPortrait(name) {
    const slot = this.dialog.querySelector('.portrait');
    let c = null;
    try { c = name ? this.portraitFor?.(name) : null; } catch { c = null; }
    slot.hidden = !c;
    this.dialog.classList.toggle('has-portrait', !!c);
    if (c && slot.firstChild !== c) slot.replaceChildren(c);
  }

  /** 선택지. options: [{label, value}] → value */
  choose(prompt, options) {
    this.show('dialog');
    this.dialog.classList.remove('narration');
    this.#speaker(null);
    this.nameEl.textContent = '';
    this.textEl.textContent = prompt;
    this.nextEl.hidden = true;
    return new Promise((resolve) => {
      this.choicesEl.replaceChildren(...options.map((o) => {
        const b = el('button', 'choice' + (o.primary ? ' primary' : ''), o.label);
        b.addEventListener('click', () => { this.audio.sfx('tap'); this.choicesEl.replaceChildren(); resolve(o.value); });
        return b;
      }));
    });
  }

  /**
   * 단서 수첩 페이지를 고른다. 손님·밤마다 키를 나눈다 (예: 'harin-1').
   * 밤 3 처럼 예전 단서를 다시 펼칠 때는 그 밤의 키를 다시 고르면 된다 — 저장돼 있다.
   */
  notebook(key) { this.noteKey = key; }

  get clues() {
    return this.progress ? this.progress.clues(this.noteKey) : this.localClues;
  }

  addClue(text) {
    if (this.progress) this.progress.addClue(this.noteKey, text);
    else this.localClues.push(text);
    this.audio.sfx('page');
    this.toast(`📓 단서 수첩에 적었다 — ${text}`);
  }

  toast(text) {
    const t = el('div', 'toast', text);
    $('#app').append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  show(which) {
    this.dialog.hidden = which !== 'dialog';
    this.blendEl.hidden = which !== 'blend';
    // 블렌딩·따르기 판은 버튼이 많아 일러스트가 가리지 않게 잠시 내린다 (지우진 않는다)
    document.body.classList.toggle('panel-open', which === 'blend');
  }

  /**
   * 블렌딩 판. resolve: {action:'brew', brew} | {action:'ask'}
   * @param {{canAsk:boolean, last?:object, hint?:object}} opts  last = 직전에 내린 조합 (그대로 시작)
   *   hint = assistFor() — 정답 재료에 🐾 표시 (여러 번 틀렸을 때)
   */
  blend({ canAsk, last, hint }) {
    this.show('blend');
    const pick = last ? { base: last.base, temp: last.temp, additions: [...last.additions] }
      : { base: null, temp: null, additions: [] };
    const root = this.blendEl;
    root.replaceChildren();

    // 단서 수첩
    const book = el('details', 'notebook');
    book.open = true;
    book.addEventListener('toggle', () => this.audio.sfx('page'));
    book.append(el('summary', null, `📓 단서 수첩 (${this.clues.length})`));
    const ul = el('ul');
    for (const c of this.clues) ul.append(el('li', null, c));
    book.append(ul);
    root.append(book);

    const hintIds = new Set([hint?.base, hint?.temp, ...(hint?.additions ?? [])].filter(Boolean));
    const hinted = (id) => hintIds.has(id);
    const info = el('p', 'info', hintIds.size ? '🐾 고양이 발자국이 찍힌 게 있어요. …우연이겠죠?' : '재료를 누르면 설명이 보여요.');
    const brewBtn = el('button', 'primary brew', '🫖 차 내리기');

    const group = (title, items, isOn, onTap, kind) => {
      const sec = el('section', `group ${kind}`);
      sec.append(el('h3', null, title));
      const row = el('div', 'opts');
      for (const it of items) {
        const b = el('button', 'opt');
        if (it.color || it.tint) {
          const sw = el('span', 'swatch');
          sw.style.setProperty('--c', it.color || it.tint);
          b.append(sw);
        }
        b.append(el('span', null, it.name));
        b.addEventListener('click', () => { onTap(it); refresh(); });
        b.dataset.id = it.id;
        if (hinted(it.id)) b.classList.add('hint');
        row.append(b);
      }
      sec.append(row);
      sec.refresh = () => row.querySelectorAll('.opt').forEach((b) => b.classList.toggle('on', isOn(b.dataset.id)));
      return sec;
    };

    const bases = group('찻물', BASES, (id) => pick.base === id, (it) => {
      pick.base = it.id; info.textContent = `${it.name} — ${it.note}`; this.audio.sfx('tap');
    }, 'bases');
    const temps = group('온도', TEMPS, (id) => pick.temp === id, (it) => {
      pick.temp = it.id; this.audio.sfx('tap');
    }, 'temps');
    const adds = group(`넣을 것 (최대 ${MAX_ADDITIONS}가지)`, ADDITIONS, (id) => pick.additions.includes(id), (it) => {
      info.textContent = `${it.name} — ${it.note}`;
      const i = pick.additions.indexOf(it.id);
      if (i >= 0) { pick.additions.splice(i, 1); this.audio.sfx('untap'); return; }
      if (pick.additions.length >= MAX_ADDITIONS) { info.textContent = `한 잔에는 ${MAX_ADDITIONS}가지까지만 넣을 수 있어요.`; return; }
      pick.additions.push(it.id); this.audio.sfx('tap');
    }, 'adds');

    const refresh = () => {
      for (const s of [bases, temps, adds]) s.refresh();
      brewBtn.disabled = !pick.base || !pick.temp;
    };
    root.append(bases, temps, adds, info);

    const actions = el('div', 'actions');
    return new Promise((resolve) => {
      if (canAsk) {
        const ask = el('button', 'ghost', '💬 더 물어보기');
        ask.addEventListener('click', () => { this.audio.sfx('tap'); resolve({ action: 'ask' }); });
        actions.append(ask);
      }
      brewBtn.addEventListener('click', async () => {
        const brew = { ...pick, additions: [...pick.additions] };
        // 고른 대로 차를 우리고 → 잔에 따른다 (미니게임). 결과는 손님 반응 한마디에만 쓰인다
        const base = BASES.find((b) => b.id === brew.base);
        const tints = brew.additions.map((id) => ADDITIONS.find((a) => a.id === id).tint);
        brew.color = brewColor(base.color, tints);
        // 우유 붓기는 우유 빼고 우린 색에서 시작한다
        brew.teaColor = brewColor(base.color, brew.additions.filter((id) => id !== 'milk').map((id) => ADDITIONS.find((a) => a.id === id).tint));
        brew.pour = await this.pour(brew);
        resolve({ action: 'brew', brew });
      });
      actions.append(brewBtn);
      root.append(actions);
      refresh();
    });
  }

  /** 차 종류별 미니게임 (brewgames.js) → { result: 'perfect'|'good'|'under'|'over', level, game } */
  async pour(brew) {
    // 미니게임을 끈 경우: 바로 알맞게 담긴 잔
    if (this.settings && !this.settings.minigames) return { result: 'good', level: 0.78, game: pickGame(brew), skipped: true };
    this.show('blend');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.blendEl.classList.add('pouring');
    // 넘치거나 모자랄수록 다음 따르기는 선 둘레가 넓어진다 (최대 2배). 잘 따르면 원래대로
    const r = await playBrewGame(this.blendEl, brew, { audio: this.audio, reducedMotion: reduced, ease: this.pourEase });
    this.blendEl.classList.remove('pouring');
    this.pourEase = r.result === 'perfect' || r.result === 'good' ? 0 : Math.min(2, this.pourEase + 1);
    return r;
  }

  /** 꿈 조각 획득 카드. id 를 주면 그 이름으로 저장된다 (없으면 제목) */
  item(title, body, id = title) {
    this.progress?.addItem(id, title, body);
    return new Promise((resolve) => {
      this.audio.sfx('item');
      const card = el('div', 'card');
      let icon = null;
      try { icon = bakeIcon(id, 6); icon.classList.add('item-icon'); } catch { /* 아이콘 없이도 카드는 뜬다 */ }
      card.append(el('p', 'kicker', '✦ 꿈 조각을 얻었다'), ...(icon ? [icon] : []), el('h2', null, title), el('p', 'letter', body));
      const ok = el('button', 'primary', '간직하기');
      ok.addEventListener('click', () => { this.audio.sfx('tap'); card.remove(); resolve(); });
      card.append(ok);
      $('#app').append(card);
    });
  }

  /** 고양이 선물 카드. gift = CAT_GIFTS 의 한 줄 */
  gift(gift) {
    this.progress?.addGift(gift.id);
    return new Promise((resolve) => {
      this.audio.sfx('item');
      const card = el('div', 'card gift');
      let icon = null;
      try { icon = bakeIcon(gift.id, 6); icon.classList.add('item-icon'); } catch { /* 아이콘 없이도 */ }
      card.append(el('p', 'kicker', '🐾 고양이가 뭔가를 물어 왔다'), ...(icon ? [icon] : []), el('h2', null, gift.name), el('p', 'letter', gift.body));
      const ok = el('button', 'primary', '선물함에 넣기');
      ok.addEventListener('click', () => { this.audio.sfx('tap'); card.remove(); resolve(); });
      card.append(ok);
      $('#app').append(card);
    });
  }

  /** 밤이 끝났다는 표시 — 다음 화면(쉬는 화면·엔딩)은 main.js 가 고른다 */
  end() {
    this.show(null);
  }

  /** 밤과 밤 사이. resolve: 'next' | 'title' */
  between(n) {
    this.show(null);
    const box = $('#between');
    box.querySelector('.kicker').textContent = `✦ ${NIGHT_NAMES[n - 1] ?? `${n}번째`} 밤이 끝났어요`;
    box.hidden = false;
    return new Promise((resolve) => {
      const done = (v) => () => { this.audio.sfx('tap'); box.hidden = true; resolve(v); };
      box.querySelector('[data-next]').onclick = done('next');
      box.querySelector('[data-title]').onclick = done('title');
    });
  }
}
