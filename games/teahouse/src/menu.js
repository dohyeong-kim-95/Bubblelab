// "기록" 메뉴: 이어하기 코드(내보내기·가져오기) + 크레딧.
// 이어하기 코드는 다른 기기·다른 주소(예: 게임이 새 주소로 이사할 때)로 진행을 옮기는 수단이다.

import { CAT_GIFTS } from './data.js';
import { bakeIcon } from './sprites.js';

const $ = (s, root = document) => root.querySelector(s);

/** 선물함: 받은 건 아이콘·이름·설명, 아직이면 빈 칸 */
function paintGifts(sheet, progress) {
  const list = $('#gift-list', sheet);
  const got = CAT_GIFTS.filter((g) => progress.hasGift(g.id));
  $('#gift-count', sheet).textContent = `${got.length} / ${CAT_GIFTS.length}`;
  list.replaceChildren(...CAT_GIFTS.map((g) => {
    const li = document.createElement('li');
    if (!progress.hasGift(g.id)) { li.className = 'empty'; li.textContent = '?'; li.title = '아직 받지 못한 선물'; return li; }
    try { const ic = bakeIcon(g.id, 3); ic.classList.add('gift-icon'); li.append(ic); } catch { /* 아이콘 없이 */ }
    const b = document.createElement('b'); b.textContent = g.name;
    const p = document.createElement('span'); p.textContent = g.body;
    li.append(b, p);
    return li;
  }));
}

export function setupMenu({ progress, ui, onChange, canImport = () => true }) {
  const sheet = $('#menu');
  const out = $('#code-out', sheet);
  const input = $('#code-in', sheet);
  const msg = $('#code-msg', sheet);

  const open = () => {
    out.value = progress.started ? progress.exportCode() : '';
    out.placeholder = '아직 저장된 진행이 없어요';
    input.value = '';
    msg.textContent = '';
    // 밤 도중에 진행을 바꾸면 지금 판과 섞인다 → 불러오기는 타이틀에서만
    const ok = canImport();
    input.disabled = !ok;
    $('#code-load', sheet).disabled = !ok;
    input.placeholder = ok ? '여기에 코드를 붙여 넣어요' : '불러오기는 타이틀 화면에서 할 수 있어요';
    paintGifts(sheet, progress);
    sheet.hidden = false;
  };
  const close = () => { sheet.hidden = true; };

  $('#menu-btn').addEventListener('click', open);
  $('[data-close]', sheet).addEventListener('click', close);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });

  $('#code-copy', sheet).addEventListener('click', async () => {
    if (!out.value) return;
    try {
      await navigator.clipboard.writeText(out.value);
      msg.textContent = '복사했어요. 새 기기나 새 주소에서 붙여 넣어 주세요.';
    } catch {
      out.select();
      msg.textContent = '자동 복사가 안 돼요. 글자를 길게 눌러 복사해 주세요.';
    }
  });

  $('#code-load', sheet).addEventListener('click', () => {
    if (!canImport()) return;
    if (progress.importCode(input.value)) {
      msg.textContent = '불러왔어요! 닫고 이어하기를 눌러 주세요.';
      ui.toast('🍵 진행을 불러왔어요');
      onChange();
    } else {
      msg.textContent = '코드가 맞지 않아요. 처음부터 끝까지 그대로 붙여 넣었는지 확인해 주세요.';
    }
  });
}
