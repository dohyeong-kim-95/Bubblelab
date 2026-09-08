import { deviceStatus, calculate, remainingSeconds } from '../core.js';
import { parseAnswerKey, gradeAnswers } from './core.js';

const $ = selector => document.querySelector(selector);
const fmt = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
let count = 100, answers = Array(count).fill(null), state = 'ready', key = null;
let deadline = 0, left = 900, elapsed = 0, startedAt = 0, timerMode = 15;
let pdf = null, loading = null, pageNumber = 1, zoom = 1, renderTask = null, renderVersion = 0, fileVersion = 0;
let strokes = [], stroke = null, drawingMode = false;

function gate() {
  const status = deviceStatus(navigator, innerWidth, screen.width);
  $('#workbook').hidden = status !== 'desktop';
  $('#device-gate').hidden = status === 'desktop';
  $('#gate-title').textContent = status === 'narrow' ? '브라우저 창을 넓혀 주세요.' : 'PC에서 만나요.';
  if (status !== 'desktop') document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  return status === 'desktop';
}

function renderOMR() {
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    if (i % 20 === 0) {
      const heading = document.createElement('div');
      heading.className = 'omr-group'; heading.textContent = `${i + 1}–${Math.min(count, i + 20)}번`;
      fragment.append(heading);
    }
    const row = document.createElement('div'); row.className = 'omr-row';
    if (key) row.classList.add(answers[i] === null ? 'skipped' : answers[i] === key[i] ? 'correct' : 'wrong');
    const number = document.createElement('strong'); number.textContent = i + 1; row.append(number);
    for (let value = 1; value <= 5; value++) {
      const button = document.createElement('button'); button.textContent = value;
      button.dataset.question = i; button.dataset.answer = value;
      button.setAttribute('aria-label', `${i + 1}번 답 ${value}`);
      button.setAttribute('aria-pressed', answers[i] === value);
      button.disabled = ['paused', 'ended', 'graded'].includes(state);
      if (key?.[i] === value) button.classList.add('key-answer');
      row.append(button);
    }
    fragment.append(row);
  }
  const scroll = $('#omr').scrollTop; $('#omr').replaceChildren(fragment); $('#omr').scrollTop = scroll;
  $('#answered').textContent = `${answers.filter(value => value !== null).length} / ${count}`;
}

function controls() {
  $('#count').disabled = state !== 'ready'; $('#duration').disabled = state !== 'ready';
  $('#timer-start').disabled = !['ready', 'paused'].includes(state);
  $('#timer-start').textContent = state === 'paused' ? '계속하기' : '시작';
  $('#timer-pause').disabled = state !== 'running';
  $('#timer').classList.toggle('expired', state === 'ended');
}

function tick() {
  if (state === 'running') {
    if (timerMode) left = remainingSeconds(deadline);
    if (timerMode && left === 0) {
      state = 'ended'; $('#session-status').textContent = '시간 종료 · 답안이 잠겼습니다. 정답표로 채점하세요.';
      controls(); renderOMR();
    }
  }
  const seconds = timerMode ? left : Math.floor((elapsed + (state === 'running' ? Date.now() - startedAt : 0)) / 1000);
  $('#timer').textContent = fmt(seconds);
}

function reset() {
  state = 'ready'; key = null; answers = Array(count).fill(null);
  timerMode = Number($('#duration').value); left = timerMode * 60; elapsed = 0;
  $('#book-memo').value = ''; strokes = []; stroke = null; redraw();
  $('#answer-key').value = ''; $('#grade-result').hidden = true; $('#grade-error').textContent = '';
  $('#session-status').textContent = '새 연습 준비 · PDF는 그대로 유지합니다.';
  controls(); tick(); renderOMR();
}

$('#omr').addEventListener('click', event => {
  tick(); const button = event.target.closest('[data-question]');
  if (!button || !gate() || !['ready', 'running'].includes(state)) return;
  const index = Number(button.dataset.question), value = Number(button.dataset.answer);
  answers[index] = answers[index] === value ? null : value;
  renderOMR();
  $(`[data-question="${index}"][data-answer="${value}"]`).focus({ preventScroll: true });
});
$('#timer-start').onclick = () => {
  if (!gate() || !['ready', 'paused'].includes(state)) return;
  timerMode = Number($('#duration').value);
  if (state === 'ready') left = timerMode * 60;
  deadline = Date.now() + left * 1000; startedAt = Date.now(); state = 'running';
  $('#session-status').textContent = timerMode ? '연습 중 · 시간 종료 시 답안 잠금' : '자유 연습 중 · 경과 시간';
  controls(); renderOMR(); tick();
};
$('#timer-pause').onclick = () => {
  tick(); if (state !== 'running') return;
  elapsed += Date.now() - startedAt; state = 'paused';
  $('#session-status').textContent = '일시정지 · 계속하기를 눌러 답안을 작성하세요.';
  controls(); renderOMR(); tick();
};
$('#duration').onchange = () => { if (state !== 'ready') return; timerMode = Number($('#duration').value); left = timerMode * 60; elapsed = 0; tick(); };
$('#count').onchange = () => {
  if (answers.some(value => value !== null) && !confirm('문항 수를 바꾸면 현재 답안이 초기화됩니다. 변경할까요?')) { $('#count').value = count; return; }
  count = Number($('#count').value); reset();
};
$('#reset').onclick = () => { if (confirm('답안·메모·그림·타이머를 초기화할까요? PDF는 유지합니다.')) reset(); };

$('#grade-open').onclick = () => { $('#grade-dialog').showModal(); };
$('#grade').onclick = () => {
  try {
    const parsed = parseAnswerKey($('#answer-key').value, count);
    tick(); if (state === 'running') elapsed += Date.now() - startedAt;
    key = parsed; state = 'graded'; const result = gradeAnswers(answers, key);
    $('#grade-error').textContent = ''; $('#session-status').textContent = '채점 완료 · OMR의 초록 테두리가 정답입니다.';
    $('#grade-result').innerHTML = `<p class="grade-stats">정답 ${result.correct} · 오답 ${result.wrong} · 미응답 ${result.skipped}<br>정답률 ${result.percent}% (${result.correct}/${count})</p><table class="grade-rows"><thead><tr><th>번호</th><th>내 답</th><th>정답</th><th>결과</th></tr></thead><tbody>${result.rows.map(row => `<tr class="${row.state}"><td>${row.number}</td><td>${row.selected ?? '—'}</td><td>${row.answer}</td><td>${({ correct: '정답', wrong: '오답', skipped: '미응답' })[row.state]}</td></tr>`).join('')}</tbody></table>`;
    $('#grade-result').hidden = false; controls(); renderOMR(); tick();
  } catch (error) { $('#grade-error').textContent = error.message; }
};

for (const name of ['pdf', 'omr']) {
  $(`#toggle-${name}`).onclick = () => {
    const panel = $(`#${name}-panel`); panel.hidden = !panel.hidden;
    $('#book-layout').classList.toggle(`${name}-hidden`, panel.hidden);
    $(`#toggle-${name}`).textContent = `${name.toUpperCase()} ${panel.hidden ? '보이기' : '숨기기'}`;
    $(`#toggle-${name}`).setAttribute('aria-pressed', !panel.hidden);
    if (pdf && !$('#pdf-panel').hidden) renderPDF();
  };
}
$('#fullscreen').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { $('#session-status').textContent = '전체화면을 사용할 수 없습니다. 브라우저의 전체화면 메뉴를 사용하세요.'; }
};
document.addEventListener('fullscreenchange', () => { $('#fullscreen').textContent = document.fullscreenElement ? '전체화면 종료' : '전체화면'; });

// Local bytes only: PDF.js loads its code, CMaps and fonts from this same origin.
$('#pdf-file').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  if (!/\.pdf$/i.test(file.name) || file.size > 100 * 1024 * 1024) {
    $('#pdf-status').hidden = false; $('#pdf-status').textContent = '100MB 이하 PDF 파일을 선택해 주세요.'; return;
  }
  const version = ++fileVersion; renderVersion++; renderTask?.cancel();
  $('#pdf-canvas').hidden = true; $('#pdf-status').hidden = false; $('#pdf-status').textContent = 'PDF를 여는 중입니다…';
  $('#filename').textContent = file.name;
  try {
    if (loading) await loading.destroy(); loading = null; pdf = null;
    const pdfjs = await import('../vendor/pdf.mjs');
    if (version !== fileVersion) return;
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.mjs', import.meta.url).href;
    const data = new Uint8Array(await file.arrayBuffer());
    if (version !== fileVersion) return;
    const task = pdfjs.getDocument({ data, isEvalSupported: false,
      cMapUrl: new URL('../vendor/cmaps/', import.meta.url).href, cMapPacked: true,
      standardFontDataUrl: new URL('../vendor/standard_fonts/', import.meta.url).href,
      wasmUrl: new URL('../vendor/wasm/', import.meta.url).href });
    loading = task; const document = await task.promise;
    if (version !== fileVersion) { await task.destroy(); return; }
    pdf = document; pageNumber = 1; zoom = 1;
    $('#page-number').disabled = false; $('#page-number').max = pdf.numPages;
    $('#page-total').textContent = `/ ${pdf.numPages}`;
    await renderPDF();
  } catch (error) {
    if (version !== fileVersion) return;
    pdf = null; $('#page-number').disabled = true; $('#page-prev').disabled = true; $('#page-next').disabled = true;
    $('#page-total').textContent = '/ 0'; $('#pdf-status').hidden = false;
    $('#pdf-status').textContent = error.name === 'PasswordException' ? '비밀번호가 걸린 PDF입니다. 잠금을 해제한 파일을 선택해 주세요.' : 'PDF를 열지 못했습니다. 파일이 정상인지 확인하고 다시 선택해 주세요.';
  }
};

async function renderPDF() {
  if (!pdf || $('#pdf-panel').hidden) return;
  const version = ++renderVersion;
  if (renderTask) { renderTask.cancel(); try { await renderTask.promise; } catch {} }
  if (version !== renderVersion) return;
  try {
    const page = await pdf.getPage(pageNumber); if (version !== renderVersion) return;
    const original = page.getViewport({ scale: 1 });
    const fit = Math.max(200, $('#pdf-scroll').clientWidth - 28) / original.width;
    const viewport = page.getViewport({ scale: fit * zoom });
    const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height)));
    const canvas = $('#pdf-canvas');
    canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
    renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport,
      transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
    await renderTask.promise;
    if (version !== renderVersion) return;
    $('#pdf-status').hidden = true; canvas.hidden = false;
    $('#page-number').value = pageNumber; $('#page-prev').disabled = pageNumber <= 1;
    $('#page-next').disabled = pageNumber >= pdf.numPages; $('#zoom-label').textContent = `${Math.round(zoom * 100)}%`;
  } catch (error) {
    if (error.name === 'RenderingCancelledException' || version !== renderVersion) return;
    $('#pdf-status').hidden = false; $('#pdf-canvas').hidden = true;
    $('#pdf-status').textContent = '이 페이지를 표시하지 못했습니다. 다른 페이지나 PDF를 선택해 주세요.';
  }
}
function movePage(value) { if (!pdf) return; pageNumber = Math.min(pdf.numPages, Math.max(1, Number(value) || 1)); $('#pdf-scroll').scrollTop = 0; renderPDF(); }
$('#page-prev').onclick = () => movePage(pageNumber - 1); $('#page-next').onclick = () => movePage(pageNumber + 1);
$('#page-number').onchange = event => movePage(event.target.value);
$('#zoom-in').onclick = () => { zoom = Math.min(3, zoom + .25); renderPDF(); };
$('#zoom-out').onclick = () => { zoom = Math.max(.5, zoom - .25); renderPDF(); };
$('#zoom-fit').onclick = () => { zoom = 1; renderPDF(); };

function tab(draw) {
  drawingMode = draw; $('#memo-panel').hidden = draw; $('#draw-panel').hidden = !draw;
  $('#memo-tab').setAttribute('aria-selected', !draw); $('#draw-tab').setAttribute('aria-selected', draw);
  if (draw) redraw(); else $('#book-memo').focus();
}
$('#memo-tab').onclick = () => tab(false); $('#draw-tab').onclick = () => tab(true);
$('#clear-notes').onclick = () => {
  if (!confirm(drawingMode ? '그림판을 모두 지울까요?' : '메모를 모두 지울까요?')) return;
  if (drawingMode) { strokes = []; redraw(); } else $('#book-memo').value = '';
};
const canvas = $('#drawing'), context = canvas.getContext('2d');
function redraw() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (const item of [...strokes, ...(stroke ? [stroke] : [])]) {
    context.globalCompositeOperation = item.erase ? 'destination-out' : 'source-over';
    context.lineWidth = item.erase ? 30 : 4; context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = '#202c40';
    context.beginPath(); context.moveTo(...item.points[0]);
    if (item.points.length === 1) context.lineTo(item.points[0][0] + .1, item.points[0][1] + .1);
    else for (const point of item.points.slice(1)) context.lineTo(...point);
    context.stroke();
  }
  context.globalCompositeOperation = 'source-over';
}
function point(event) { const rect = canvas.getBoundingClientRect(); return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height]; }
canvas.onpointerdown = event => { if (event.button !== 0) return; canvas.setPointerCapture(event.pointerId); stroke = { erase: $('#eraser').checked, points: [point(event)] }; redraw(); };
canvas.onpointermove = event => { if (!stroke) return; stroke.points.push(point(event)); redraw(); };
canvas.onpointerup = canvas.onpointercancel = () => { if (stroke) strokes.push(stroke); stroke = null; redraw(); };
$('#undo-draw').onclick = () => { strokes.pop(); redraw(); };

const calc = $('#book-calc');
function calcKey(value) {
  try {
    $('#calc-error').textContent = '';
    if (value === 'C') calc.value = '';
    else if (value === '⌫') calc.value = calc.value.slice(0, -1);
    else if (value === '=') calc.value = String(calculate(calc.value));
    else if (value === '%') calc.value = String(calculate(calc.value) / 100);
    else if (value === '±') calc.value = String(-calculate(calc.value));
    else if (calc.value.length < 120) calc.value += value;
  } catch (error) { $('#calc-error').textContent = error.message; }
}
for (const value of ['C', '(', ')', '⌫', '7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '=', '+', '%', '±']) {
  const button = document.createElement('button'); button.textContent = value;
  button.setAttribute('aria-label', ({ C: '계산기 초기화', '⌫': '한 글자 지우기', '=': '계산하기', '±': '부호 변경', '%': '100으로 나누기' })[value] || value);
  button.onclick = () => calcKey(value); $('#calc-keys').append(button);
}
calc.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); calcKey('='); } else if (event.key === 'Escape') { event.preventDefault(); calcKey('C'); } };

$('#help-open').onclick = () => $('#help-dialog').showModal();
document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => $(`#${button.dataset.close}`).close(); });
document.addEventListener('visibilitychange', tick);
let resizeTimer;
window.addEventListener('resize', () => { gate(); clearTimeout(resizeTimer); resizeTimer = setTimeout(renderPDF, 180); });
window.addEventListener('beforeunload', event => { if (state === 'running' || answers.some(value => value !== null) || $('#book-memo').value || strokes.length) { event.preventDefault(); event.returnValue = ''; } });
setInterval(tick, 250); renderOMR(); controls(); tick();
if (gate()) {
  try { if (!sessionStorage.getItem('sktest-workbook-help')) { $('#help-dialog').showModal(); sessionStorage.setItem('sktest-workbook-help', 'seen'); } }
  catch { $('#help-dialog').showModal(); }
}
