import {AREAS,QUESTIONS} from './questions.js';
import {deviceStatus,remainingSeconds,summarize,calculate} from './core.js';

const $=s=>document.querySelector(s);
const main=$('#main');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=s=>Math.floor(s/60).toString().padStart(2,'0')+':'+(s%60).toString().padStart(2,'0');
const areaName=id=>AREAS.find(a=>a.id===id)?.name||'';
const currentArea=()=>session.areas[session.section];
const currentQuestions=()=>QUESTIONS.filter(q=>q.area===currentArea());
let selection='all',mode='timed',view='home',session=null,interval=null,confirmation=null,toastTimer;

function gate(){
  const status=deviceStatus(navigator,innerWidth,screen.width);
  $('#app').hidden=status!=='desktop';$('#device-gate').hidden=status==='desktop';
  $('#gate-title').textContent=status==='narrow'?'브라우저 창을 넓혀 주세요.':'PC에서 만나요.';
  $('#gate-copy').innerHTML=status==='narrow'?'문제와 풀이 도구를 함께 보려면<br>브라우저 너비가 1,024px 이상이어야 합니다.':'이 연습실은 데스크톱과 노트북 전용입니다.<br>PC 브라우저에서 접속해 주세요.';
  if(status!=='desktop')document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  return status==='desktop';
}
function notify(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3000);}
function focusMain(){main.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});}
function home(){
  clearInterval(interval);view='home';session=null;
  main.innerHTML='<div class="intro"><div><p class="eyebrow">COGNITIVE PRACTICE</p><h1>인지역량 연습</h1><p>영역을 고르고, 나만의 속도로 시작하세요.</p></div><div class="intro-meta"><span><b>5</b>개 영역</span><span><b>30</b>개 연습문항</span></div></div>'+
  '<div class="workspace"><section class="panel"><div class="selection-head"><div><h2>오늘의 연습 선택</h2><p>전체 흐름을 익히거나 한 영역에 집중할 수 있어요.</p></div><span class="small-label">기초 유형 연습</span></div><div class="area-list" role="radiogroup" aria-label="연습 영역">'+
  areaOption('all','전체 영역','5개 영역을 순서대로 · 미니 모의고사','30','∑')+
  AREAS.map((a,i)=>areaOption(a.id,a.name,a.description,'6',String(i+1).padStart(2,'0'))).join('')+'</div></section>'+
  '<aside class="panel settings"><p class="eyebrow">YOUR SESSION</p><h2 id="selected-title"></h2><p class="settings-description" id="selected-description"></p><div class="settings-stats"><div><span>문항 수</span><strong id="selected-count"></strong></div><div><span id="time-label">전체 제한 시간</span><strong id="selected-time"></strong></div></div><p class="mode-title" id="mode-label">연습 방식</p><div role="radiogroup" aria-labelledby="mode-label">'+
  '<label class="mode-choice"><input type="radio" name="mode" value="timed" '+(mode==='timed'?'checked':'')+'><div><strong>시간 제한</strong><span>영역별 4분 30초 · 시간 종료 시 자동 제출</span></div></label>'+
  '<label class="mode-choice"><input type="radio" name="mode" value="free" '+(mode==='free'?'checked':'')+'><div><strong>자유 연습</strong><span>제한 없이 충분히 생각하며 풀기</span></div></label></div><button class="start-button" id="start">연습 시작하기 <span aria-hidden="true">→</span></button><p class="settings-bottom">제출 후 정답과 해설을 확인할 수 있어요.</p></aside></div>'+
  '<div class="content-note"><span class="note-badge">문항 안내</span><p><strong>직접 제작한 기초 유형 연습문항입니다.</strong> 실제 기출 및 실전 난도 검증 문항이 아닙니다. 전체 연습은 100문항 실전 시험의 축소판이 아닌, 30문항의 별도 연습 세트입니다.</p></div>'+
  '<section class="readiness"><div><h3>PC 응시 환경에 익숙해지기</h3><p>화면 오른쪽의 도구로 종이 없이 풀어보세요.</p></div><div class="ready-items"><span>메모장 · 그림판</span><span>사칙연산 계산기</span><span>채점 · 해설</span></div></section>'+
  '<section class="readiness"><div><h3>내 PDF로 실전 환경 연습</h3><p>문제집 PDF · 100문항 OMR · 타이머 · 정답표 채점을 한 화면에서.</p></div><a class="button primary" href="./workbook/">PDF 연습실 열기 →</a></section>'+
  '<section class="readiness"><div><h3>기출·복원 자료</h3><p>출처와 자료 성격을 확인한 뒤 원문에서 학습하세요.</p></div><button class="button secondary" id="sources-open">자료 목록 보기 ↗</button></section>';
  updateSettings();focusMain();
}
function areaOption(id,name,description,count,number){return '<label class="area-option '+(id==='all'?'all-option':'')+'"><input type="radio" name="area" value="'+id+'" '+(selection===id?'checked':'')+'><span class="area-number">'+number+'</span><div class="area-copy"><strong>'+name+'</strong><p>'+description+'</p></div><span class="area-count">'+count+'문항</span><span class="radio-indicator" aria-hidden="true"></span></label>';}
function updateSettings(){
  $('#selected-title').textContent=selection==='all'?'전체 영역 연습':areaName(selection);
  $('#selected-description').textContent=selection==='all'?'언어이해부터 수열추리까지, 차례대로.':'한 영역의 기초 유형을 짧게 풀어보세요.';
  $('#selected-count').innerHTML=(selection==='all'?'30':'6')+'<small>문항</small>';
  $('#selected-time').innerHTML=mode==='free'?'제한 없음':(selection==='all'?'22:30':'04:30');
  $('#time-label').textContent=mode==='free'?'제한 시간':'전체 제한 시간';
}
function start(){
  if(!gate())return;
  session={areas:selection==='all'?AREAS.map(a=>a.id):[selection],section:0,index:0,answers:{},flags:{},notes:{},drawings:{},tool:'memo',calc:'',mode,elapsed:0,started:0,deadline:0};
  beginSection();
}
function beginSection(){view='exam';session.index=0;session.started=Date.now();session.deadline=session.mode==='timed'?session.started+270000:0;renderExam();clearInterval(interval);interval=setInterval(tick,250);tick();focusMain();}
function tick(){
  if(view!=='exam')return;
  const seconds=session.mode==='timed'?remainingSeconds(session.deadline):Math.floor((Date.now()-session.started)/1000);
  const timer=$('#timer-value');if(timer)timer.textContent=fmt(seconds);
  $('#timer')?.classList.toggle('warning',session.mode==='timed'&&seconds<=60);
  if(session.mode==='timed'&&seconds===0)finishSection(true);
}
function canAnswer(){
  if(view!=='exam'||!gate())return false;
  if(session.mode==='timed'&&Date.now()>=session.deadline){finishSection(true);return false;}
  return true;
}
function tableHtml(t){return '<table class="question-table"><caption>'+esc(t.caption)+'</caption><thead><tr>'+t.headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+t.rows.map(row=>'<tr>'+row.map((x,i)=>i===0?'<th scope="row">'+esc(x)+'</th>':'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}
function material(q){return (q.passage?'<div class="passage '+(q.sequence?'sequence':'')+'">'+esc(q.passage)+'</div>':'')+(q.table?tableHtml(q.table):'');}
function renderExam(){
  const a=currentArea();
  main.innerHTML='<div class="exam-top"><div><p class="eyebrow">PRACTICE '+String(session.section+1).padStart(2,'0')+' / '+String(session.areas.length).padStart(2,'0')+'</p><h1>'+areaName(a)+' <span class="private-label">'+(session.mode==='timed'?'시간 제한':'자유 연습')+'</span></h1></div><div class="exam-meta"><button class="text-button" id="exit-session">연습 그만두기</button><div class="timer" id="timer"><span>'+(session.mode==='timed'?'남은 시간':'경과 시간')+'</span><strong id="timer-value" role="timer" aria-label="영역 시간">00:00</strong></div></div></div>'+
  '<div class="exam-layout"><section class="panel question-panel" id="question-panel"></section><aside class="exam-side">'+
  '<section class="panel"><div class="side-head"><span>답안 현황</span><small id="answer-count"></small></div><nav class="question-map" id="question-map" aria-label="문항 이동"></nav><div class="map-legend"><span><i class="filled"></i>답변</span><span><i></i>미응답</span><span><i class="marked"></i>다시 보기</span></div></section>'+
  '<section class="panel"><div class="tool-tabs" role="tablist" aria-label="풀이 도구"><button class="tool-tab" id="tab-memo" role="tab" aria-controls="memo-panel" aria-selected="'+(session.tool==='memo')+'" tabindex="'+(session.tool==='memo'?'0':'-1')+'" data-tool="memo">메모장</button><button class="tool-tab" id="tab-draw" role="tab" aria-controls="draw-panel" aria-selected="'+(session.tool==='draw')+'" tabindex="'+(session.tool==='draw'?'0':'-1')+'" data-tool="draw">그림판</button></div><div id="memo-panel" role="tabpanel" aria-labelledby="tab-memo" '+(session.tool==='memo'?'':'hidden')+'><textarea id="memo" class="memo" aria-label="영역별 풀이 메모" placeholder="조건과 계산 과정을 적어보세요." maxlength="10000"></textarea></div><div id="draw-panel" role="tabpanel" aria-labelledby="tab-draw" '+(session.tool==='draw'?'':'hidden')+'><canvas id="sketch" class="sketch" width="580" height="350" aria-label="마우스로 사용하는 풀이 그림판"></canvas></div><div class="tool-footer"><span>현재 영역에서 유지</span><button class="text-button" id="clear-tool">지우기</button></div></section>'+
  '<section class="panel"><div class="side-head"><span>계산기</span><small>사칙연산 · 괄호</small></div><div class="calc-area"><input id="calc-display" class="calc-display" aria-label="계산식" placeholder="0" maxlength="120" autocomplete="off" spellcheck="false"><div class="calc-keys">'+['C','(',')','⌫','7','8','9','÷','4','5','6','×','1','2','3','−','0','.','=','+'].map(k=>'<button data-calc="'+k+'" class="'+(k==='='?'equals':/[0-9.]/.test(k)?'':'operator')+'" aria-label="'+({'C':'계산기 초기화','⌫':'한 글자 지우기','=':'계산하기'}[k]||k)+'">'+k+'</button>').join('')+'</div></div></section>'+
  '<p class="shortcut-note"><kbd>1</kbd>–<kbd>5</kbd> 답 선택 &nbsp; <kbd>Alt</kbd> + <kbd>←</kbd> / <kbd>→</kbd> 이동<br>입력란에서는 문항 단축키가 작동하지 않아요.</p></aside></div>';
  $('#memo').value=session.notes[a]||'';$('#calc-display').value=session.calc;
  setupCanvas();renderQuestion();tick();
}
function renderQuestion(){
  const qs=currentQuestions(),q=qs[session.index];
  $('#question-panel').innerHTML='<div class="question-bar"><span class="question-label"><b>'+String(session.index+1).padStart(2,'0')+'</b> / '+qs.length+' &nbsp; · &nbsp; '+q.type+'</span><button class="flag-button" id="flag" aria-pressed="'+!!session.flags[q.id]+'">⚑ 다시 보기</button></div><div class="question-body"><h2 id="question-title">'+esc(q.prompt)+'</h2>'+material(q)+'<fieldset class="answers" aria-labelledby="question-title"><legend class="sr-only">답안 선택</legend>'+q.options.map((o,i)=>'<label class="answer-option"><input type="radio" name="answer" value="'+i+'" '+(session.answers[q.id]===i?'checked':'')+'><span class="option-index">'+(i+1)+'</span><span>'+esc(o)+'</span></label>').join('')+'</fieldset></div><div class="question-bottom"><button class="text-button" id="clear-answer" '+(session.answers[q.id]===undefined?'disabled':'')+'>답 선택 해제</button><div><button class="button secondary" id="prev" '+(session.index===0?'disabled':'')+'>← 이전</button>'+(session.index===qs.length-1?'<button class="button primary" id="submit-section">영역 제출하기</button>':'<button class="button primary" id="next">다음 문항 →</button>')+'</div></div>';
  renderMap();
}
function renderMap(){
  const qs=currentQuestions();
  $('#answer-count').textContent=qs.filter(q=>session.answers[q.id]!==undefined).length+' / '+qs.length+' 답변';
  $('#question-map').innerHTML=qs.map((q,i)=>'<button data-index="'+i+'" class="map-button '+(session.answers[q.id]!==undefined?'answered ':'')+(session.flags[q.id]?'flagged ':'')+(session.index===i?'current':'')+'" '+(session.index===i?'aria-current="step"':'')+' aria-label="'+(i+1)+'번, '+(session.answers[q.id]!==undefined?'답변함':'미응답')+(session.flags[q.id]?', 다시 보기 표시':'')+'">'+(i+1)+'</button>').join('');
}
function move(index){if(!canAnswer())return;const qs=currentQuestions();if(index<0||index>=qs.length)return;session.index=index;renderQuestion();$('#question-title').setAttribute('tabindex','-1');$('#question-title').focus({preventScroll:true});}
function answer(value){if(!canAnswer())return;const q=currentQuestions()[session.index];session.answers[q.id]=value;$('#clear-answer').disabled=false;renderMap();}
function confirmAction(title,copy,label,action){confirmation=action;$('#confirm-title').textContent=title;$('#confirm-copy').textContent=copy;$('#confirm-yes').textContent=label;$('#confirm-dialog').showModal();}
function requestSubmit(){
  if(!canAnswer())return;
  const skipped=currentQuestions().filter(q=>session.answers[q.id]===undefined).length;
  confirmAction('이 영역을 제출할까요?',(skipped?'아직 풀지 않은 문제가 '+skipped+'개 있습니다. ':'모든 문제에 답했습니다. ')+'제출하면 이 영역으로 돌아갈 수 없습니다.','제출하기',()=>finishSection(false));
}
function finishSection(expired){
  if(view!=='exam')return;clearInterval(interval);
  const end=session.mode==='timed'?Math.min(Date.now(),session.deadline):Date.now();
  session.elapsed+=Math.max(0,end-session.started);
  $('#confirm-dialog').close();confirmation=null;
  if(session.section===session.areas.length-1){results();if(expired)notify('제한 시간이 끝나 답안을 자동 제출했어요.');return;}
  view='between';const finished=areaName(currentArea());session.section++;
  main.innerHTML='<section class="panel transition-card"><p class="eyebrow">SECTION COMPLETE</p><h1>'+finished+' 영역을 마쳤어요.</h1><p>'+(expired?'제한 시간이 끝나 자동 제출했습니다.<br>':'답안이 제출되었습니다.<br>')+'다음은 <strong>'+areaName(currentArea())+'</strong> · 6문항'+(session.mode==='timed'?' · 4분 30초':'')+'입니다.<br>시작 버튼을 누르면 다음 영역이 열립니다.</p><button class="button primary" id="begin-section">다음 영역 시작 →</button></section>';focusMain();
}
function results(){
  clearInterval(interval);view='results';
  const qs=QUESTIONS.filter(q=>session.areas.includes(q.area)),r=summarize(qs,session.answers);
  main.innerHTML='<div class="intro"><div><p class="eyebrow">SESSION REVIEW</p><h1>연습을 마쳤어요.</h1><p>틀린 이유를 확인하는 것까지, 오늘의 연습입니다.</p></div><button class="button secondary" id="go-home">연습실로 돌아가기</button></div><div class="result-summary"><div><span>정답 수</span><strong>'+r.correct+' <small>/ '+r.total+'문항</small></strong></div><div><span>정답률</span><strong>'+r.percent+'<small>%</small></strong></div><div><span>오답 / 미응답</span><strong>'+r.wrong+' <small>/</small> '+r.skipped+'</strong></div><div><span>풀이 시간</span><strong>'+fmt(Math.floor(session.elapsed/1000))+'</strong></div></div><div class="result-sections">'+session.areas.map(a=>{const s=summarize(qs.filter(q=>q.area===a),session.answers);return '<div class="section-result"><strong>'+areaName(a)+'</strong><span>'+s.correct+' <small>/ '+s.total+' 정답</small></span><progress value="'+s.correct+'" max="'+s.total+'" aria-label="'+areaName(a)+' 정답 '+s.correct+'개"></progress></div>';}).join('')+'</div><div class="review-heading"><h2>정답과 해설</h2><label class="filter-label"><input type="checkbox" id="wrong-only">오답·미응답만 보기</label></div><div id="review-list"></div><div class="content-note"><span class="note-badge">채점 기준</span><p>전체 문항 대비 정답 비율입니다. 오답 감점이나 합격 가능성은 산정하지 않습니다. 실제 SKCT 성적을 예측하는 점수가 아닙니다.</p></div>';
  renderReview(false);focusMain();
}
function renderReview(wrongOnly){
  const qs=QUESTIONS.filter(q=>session.areas.includes(q.area));
  $('#review-list').innerHTML=qs.map((q,i)=>{
    const a=session.answers[q.id],correct=a===q.answer;if(wrongOnly&&correct)return '';
    return '<details class="review-item"><summary><span class="result-badge '+(correct?'correct':a===undefined?'skipped':'')+'">'+(correct?'정답':a===undefined?'미응답':'오답')+'</span><span class="review-area">'+areaName(q.area)+' · '+(i+1)+'</span><span>'+esc(q.prompt)+'</span></summary><div class="review-detail">'+material(q)+'<ol class="review-options">'+q.options.map((o,j)=>'<li class="'+(j===q.answer?'right-answer':j===a?'my-wrong':'')+'">'+(j+1)+'. '+esc(o)+(j===q.answer?' &nbsp; ✓ 정답':'')+(j===a?' &nbsp; ← 내 답':'')+'</li>').join('')+'</ol><div class="explanation"><strong>풀이 해설</strong>'+esc(q.explanation)+'</div></div></details>';
  }).join('')||'<div class="panel review-empty">모든 문제를 맞혔어요. 체크를 해제하면 전체 해설을 볼 수 있습니다.</div>';
}
function setTool(tool){session.tool=tool;for(const t of ['memo','draw']){const tab=$('#tab-'+t);tab.setAttribute('aria-selected',String(t===tool));tab.tabIndex=t===tool?0:-1;$('#'+(t==='draw'?'draw':'memo')+'-panel').hidden=t!==tool;}if(tool==='draw')redrawCanvas();}
function redrawCanvas(){
  const c=$('#sketch');if(!c)return;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.strokeStyle='#243b62';ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';
  for(const line of session.drawings[currentArea()]||[]){if(!line.length)continue;ctx.beginPath();ctx.moveTo(...line[0]);if(line.length===1)ctx.lineTo(line[0][0]+.1,line[0][1]+.1);else line.slice(1).forEach(p=>ctx.lineTo(...p));ctx.stroke();}
}
function setupCanvas(){
  const c=$('#sketch');let active=false;
  const point=e=>{const r=c.getBoundingClientRect();return [(e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height];};
  c.addEventListener('pointerdown',e=>{if(!canAnswer())return;active=true;c.setPointerCapture(e.pointerId);(session.drawings[currentArea()]??=[]).push([point(e)]);redrawCanvas();});
  c.addEventListener('pointermove',e=>{if(!active||view!=='exam')return;const lines=session.drawings[currentArea()];if(lines.at(-1).length<6000){lines.at(-1).push(point(e));redrawCanvas();}});
  for(const evt of ['pointerup','pointercancel','lostpointercapture'])c.addEventListener(evt,()=>{active=false;});redrawCanvas();
}
function calcKey(key){
  const input=$('#calc-display');if(!input)return;
  if(key==='C')input.value='';else if(key==='⌫')input.value=input.value.slice(0,-1);else if(key==='='){try{input.value=String(calculate(input.value));}catch(e){notify(e.message);}}else if(input.value.length<120)input.value+=key;
  session.calc=input.value;
}
function showSources(){
  if(!$('#sources-dialog')){
    const d=document.createElement('dialog');d.id='sources-dialog';d.setAttribute('aria-labelledby','sources-title');
    d.innerHTML='<div class="dialog-head"><h2 id="sources-title">기출·복원 자료 목록</h2><button class="icon-button" data-close="sources-dialog" aria-label="자료 목록 닫기">×</button></div><div class="dialog-body"><p>2026.09.07 확인. SK가 공개한 실제 시험 원문은 이번 수집에서 확인하지 못했습니다. 아래 자료는 성격을 구분해 참고하세요.</p><h3>에듀윌 · 2026 통합 기본서</h3><p>출판사 설명상 2025년 기출복원 100제 수록. 공개 미리보기 범위를 확인할 수 있습니다. SK 공식 기출 원문은 아닙니다.</p><a href="https://book.eduwill.net/goods/list.action?ClassCode=100108106" target="_blank" rel="noopener noreferrer">출판사 자료 보기 ↗</a><h3>위포트·스펙업 공개 자료 모음</h3><p>2022–2024년 회차별 문제·해설 링크. ‘기출’로 안내된 페이지에도 첨부 제목은 ‘실전 모의고사’로 표시됩니다. 원문 종류와 출처 확인이 필요합니다.</p><a href="https://sordid-dress-5d9.notion.site/SKCT-PDF-c8eae4e3565e4840a5210669077d1e03" target="_blank" rel="noopener noreferrer">자료 모음 열기 ↗</a><h3>해커스 · 무료 학습자료</h3><p>SKCT 교재용 계산 훈련서가 등록되어 있습니다. 기출문제가 아닌 연산 보조 자료입니다. 이용에 로그인이 필요할 수 있습니다.</p><a href="https://ejob.hackers.com/book/free_down" target="_blank" rel="noopener noreferrer">학습자료 열기 ↗</a><h3>렛유인 · 온라인 모의고사</h3><p>2026년 9월 실력측정 모의고사 안내. 출판사 모의고사이며, 현재 연습실의 자체 문항과 별개입니다.</p><a href="https://www.letuin.com/mock/list" target="_blank" rel="noopener noreferrer">모의고사 안내 열기 ↗</a></div><div class="dialog-footer"><button class="button primary" data-close="sources-dialog">확인</button></div>';
    document.body.append(d);
  }$('#sources-dialog').showModal();
}

document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.close){$('#'+b.dataset.close).close();return;}
  if(b.id==='guide-open'){$('#guide-dialog').showModal();return;}
  if(b.id==='confirm-yes'){const action=confirmation;confirmation=null;$('#confirm-dialog').close();action?.();return;}
  if(b.id==='sources-open'){showSources();return;}
  if(b.id==='start'){start();return;}
  if(b.id==='go-home'){home();return;}
  if(b.id==='begin-section'){if(gate())beginSection();return;}
  if(view!=='exam')return;
  if(b.id==='exit-session'){confirmAction('연습을 그만둘까요?','현재 답안과 메모가 사라집니다. 이 연습을 마치고 해설을 보려면 각 영역을 제출해 주세요.','그만두기',home);return;}
  if(!canAnswer())return;
  if(b.id==='next')move(session.index+1);
  if(b.id==='prev')move(session.index-1);
  if(b.dataset.index!==undefined)move(Number(b.dataset.index));
  if(b.id==='submit-section')requestSubmit();
  if(b.id==='flag'){const q=currentQuestions()[session.index];session.flags[q.id]=!session.flags[q.id];b.setAttribute('aria-pressed',String(session.flags[q.id]));renderMap();}
  if(b.id==='clear-answer'){delete session.answers[currentQuestions()[session.index].id];renderQuestion();}
  if(b.dataset.tool)setTool(b.dataset.tool);
  if(b.id==='clear-tool'){if(session.tool==='memo'){session.notes[currentArea()]='';$('#memo').value='';}else{session.drawings[currentArea()]=[];redrawCanvas();}}
  if(b.dataset.calc)calcKey(b.dataset.calc);
});
document.addEventListener('change',e=>{
  if(e.target.name==='area'){selection=e.target.value;updateSettings();}
  if(e.target.name==='mode'){mode=e.target.value;updateSettings();}
  if(e.target.name==='answer')answer(Number(e.target.value));
  if(e.target.id==='wrong-only')renderReview(e.target.checked);
});
document.addEventListener('input',e=>{if(view!=='exam')return;if(e.target.id==='memo')session.notes[currentArea()]=e.target.value;if(e.target.id==='calc-display')session.calc=e.target.value;});
document.addEventListener('keydown',e=>{
  if(e.target.matches('.tool-tab')&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const t=e.key==='Home'?'memo':e.key==='End'?'draw':session.tool==='memo'?'draw':'memo';setTool(t);$('#tab-'+t).focus();return;}
  if(view!=='exam'||document.querySelector('dialog[open]')||!gate())return;
  if(e.target.id==='calc-display'&&e.key==='Enter'){e.preventDefault();calcKey('=');return;}
  if(e.target.matches('input:not([type=radio]),textarea,[contenteditable=true]'))return;
  if(e.altKey&&e.key==='ArrowRight'){e.preventDefault();move(session.index+1);}
  if(e.altKey&&e.key==='ArrowLeft'){e.preventDefault();move(session.index-1);}
  if(!e.altKey&&!e.ctrlKey&&!e.metaKey&&/^[1-5]$/.test(e.key)){e.preventDefault();const value=Number(e.key)-1;answer(value);if(view==='exam')document.querySelectorAll('input[name=answer]')[value].checked=true;}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
window.addEventListener('resize',gate);
window.addEventListener('beforeunload',e=>{if(view==='exam'||view==='between'){e.preventDefault();e.returnValue='';}});
gate();home();
