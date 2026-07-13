import { createRealtimeClient } from "/_shared/realtime-client.js";
import { createMultiplayerRooms, normalizeName, normalizeRoomCode } from "/_shared/multiplayer-room.js";
import { PHASE, createRound, privateRoles, tallyVotes, normalizeGuess, resultForAccusation } from "./rules.js";

const rt = createRealtimeClient({ namespace: "liargame" });
const rooms = createMultiplayerRooms({ realtime: rt, gameId: "liargame", minPlayers: 4, maxPlayers: 10 });
const app = document.getElementById("app");
const toastEl = document.getElementById("toast");
const playerId = rooms.playerId();

let playerName = rooms.playerName();
let roomCode = "";
let room = null;
let privateData = null;
let ownReady = false;
let ownVote = null;
let hostActions = {};
let hostSecret = null;
let selectedVote = "";
let previousPhase = "";
let processingHost = false;
let phaseTimer = null;
let timerInterval = null;
let unsubscribers = [];
let hostUnsubscribers = [];

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

function toast(message) {
  toastEl.textContent = message; toastEl.hidden = false;
  clearTimeout(toastEl._timer); toastEl._timer = setTimeout(() => { toastEl.hidden = true; }, 2800);
}

function stopTimers() {
  clearTimeout(phaseTimer); phaseTimer = null;
  clearInterval(timerInterval); timerInterval = null;
}

function stopUiTimer() { clearInterval(timerInterval); timerInterval = null; }

function cleanupRoom() {
  stopTimers();
  unsubscribers.forEach((unsubscribe) => unsubscribe?.()); unsubscribers = [];
  hostUnsubscribers.forEach((unsubscribe) => unsubscribe?.()); hostUnsubscribers = [];
  room = null; privateData = null; hostActions = {}; hostSecret = null;
  ownReady = false; ownVote = null; selectedVote = ""; previousPhase = "";
}

function validName(value) {
  const name = normalizeName(value);
  if (!name || name.length > 12) { toast("닉네임은 1~12자로 입력해주세요."); return ""; }
  return name;
}

function currentInviteCode() {
  return normalizeRoomCode(new URL(location.href).searchParams.get("room") || "");
}

function setRoomUrl(code = "") {
  const url = new URL(location.href);
  code ? url.searchParams.set("room", code) : url.searchParams.delete("room");
  history.replaceState(null, "", url);
}

function renderHome(prefillCode = currentInviteCode()) {
  cleanupRoom(); roomCode = "";
  app.innerHTML = `<section class="screen center">
    <div class="brand"><div class="brand-icon">🕵️</div><h1>라이어 게임</h1>
      <p>한 명만 제시어를 모릅니다.<br>각자의 휴대폰으로 정체를 숨겨보세요.</p></div>
    <form class="panel stack" id="createForm">
      <h2>새 방 만들기</h2>
      <input id="createName" maxlength="12" autocomplete="nickname" placeholder="닉네임" value="${esc(playerName)}">
      <button class="primary" type="submit">방 만들기</button>
    </form>
    <form class="panel stack" id="joinForm">
      <h2>방 참가하기</h2>
      <input id="joinCode" maxlength="6" inputmode="text" autocomplete="off" placeholder="방 코드 6자리" value="${esc(prefillCode)}">
      <input id="joinName" maxlength="12" autocomplete="nickname" placeholder="닉네임" value="${esc(playerName)}">
      <button type="submit">참가하기</button>
    </form>
    <p class="muted" style="text-align:center;font-size:.78rem">4~10명 · 라이어 1명 · 실제 대화로 진행</p>
  </section>`;
  document.getElementById("joinCode").addEventListener("input", (event) => {
    event.target.value = normalizeRoomCode(event.target.value).slice(0, 6);
  });
  document.getElementById("createForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const name = validName(document.getElementById("createName").value); if (!name) return;
    const button = event.submitter; button.disabled = true; button.textContent = "생성 중…";
    try {
      playerName = name; rooms.savePlayerName(name);
      const code = await rooms.createRoom(playerId, name, { explanationSeconds: 90, discussionSeconds: 60 });
      await enterRoom(code, name);
    } catch (error) { toast(error.message || "방을 만들지 못했습니다."); button.disabled = false; button.textContent = "방 만들기"; }
  });
  document.getElementById("joinForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const code = normalizeRoomCode(document.getElementById("joinCode").value);
    const name = validName(document.getElementById("joinName").value); if (!name) return;
    if (code.length !== 6) { toast("6자리 방 코드를 입력해주세요."); return; }
    const button = event.submitter; button.disabled = true; button.textContent = "참가 중…";
    try { playerName = name; rooms.savePlayerName(name); await enterRoom(code, name); }
    catch (error) { toast(error.message || "방에 참가하지 못했습니다."); button.disabled = false; button.textContent = "참가하기"; }
  });
}

async function enterRoom(code, name) {
  code = normalizeRoomCode(code);
  await rooms.joinRoom(code, playerId, name);
  cleanupRoom(); roomCode = code; setRoomUrl(code);
  await rooms.setupPresence(code, playerId);
  unsubscribers.push(
    rooms.subscribeRoom(code, (value) => {
      if (!value) { toast("방이 종료되었습니다."); setRoomUrl(); renderHome(); return; }
      room = value;
      rooms.watchHostMigration(code, playerId, room);
      const phase = room.gameState?.phase || "";
      if (phase !== previousPhase) { previousPhase = phase; selectedVote = ""; }
      ensureHostEngine(); render(); scheduleHostDeadline();
    }),
    rt.subscribe(`privateData/${code}/${playerId}`, (value) => { privateData = value; render(); }),
    rt.subscribe(`actions/${code}/ready/${playerId}`, (value) => { ownReady = !!value; render(); }),
    rt.subscribe(`actions/${code}/votes/${playerId}`, (value) => { ownVote = value?.targetId || null; render(); }),
  );
}

function ensureHostEngine() {
  const isHost = room?.meta?.hostId === playerId;
  if (!isHost) {
    hostUnsubscribers.forEach((unsubscribe) => unsubscribe?.()); hostUnsubscribers = [];
    hostActions = {}; hostSecret = null; clearTimeout(phaseTimer); phaseTimer = null; return;
  }
  if (hostUnsubscribers.length) return;
  hostUnsubscribers.push(
    rt.subscribe(`actions/${roomCode}`, (value) => { hostActions = value || {}; processHost(); }),
    rt.subscribe(`secrets/${roomCode}`, (value) => { hostSecret = value; processHost(); }),
  );
}

async function rootUpdate(values) { await rt.update("", values); }

async function startGame() {
  const players = Object.keys(room?.players || {});
  if (room?.meta?.hostId !== playerId || players.length < 4) return;
  const round = createRound(players), roles = privateRoles(round), updates = {};
  for (const [id, data] of Object.entries(roles)) updates[`privateData/${roomCode}/${id}`] = data;
  updates[`secrets/${roomCode}`] = { liarId: round.liarId, category: round.category, word: round.word };
  updates[`actions/${roomCode}`] = null;
  updates[`rooms/${roomCode}/gameState`] = {
    phase: PHASE.ROLE_REVEAL, playerOrder: round.order, moderatorId: round.moderatorId,
    phaseDeadline: 0, voteResult: null, tiedIds: [], accusedId: null, guess: "", result: null,
  };
  updates[`rooms/${roomCode}/publicProgress`] = { ready: 0, votes: 0, total: players.length };
  updates[`rooms/${roomCode}/meta/status`] = "playing";
  updates[`rooms/${roomCode}/meta/updatedAt`] = Date.now();
  await rootUpdate(updates);
}

async function setPhase(patch, clearActions = {}) {
  const updates = {};
  for (const [key, value] of Object.entries(patch)) updates[`rooms/${roomCode}/gameState/${key}`] = value;
  for (const [path, value] of Object.entries(clearActions)) updates[`actions/${roomCode}/${path}`] = value;
  updates[`rooms/${roomCode}/meta/updatedAt`] = Date.now();
  await rootUpdate(updates);
}

async function finishResult(result, voteResult = null) {
  const updates = {
    [`rooms/${roomCode}/gameState/phase`]: PHASE.RESULT,
    [`rooms/${roomCode}/gameState/result`]: result,
    [`rooms/${roomCode}/gameState/phaseDeadline`]: 0,
    [`rooms/${roomCode}/meta/status`]: "finished",
    [`rooms/${roomCode}/meta/updatedAt`]: Date.now(),
  };
  if (voteResult) updates[`rooms/${roomCode}/gameState/voteResult`] = voteResult;
  await rootUpdate(updates);
}

async function resolveAccused(accusedId, voteResult) {
  if (!hostSecret) return;
  if (accusedId !== hostSecret.liarId) {
    await finishResult(resultForAccusation({ accusedId, liarId: hostSecret.liarId, word: hostSecret.word }), voteResult);
  } else {
    await setPhase({ phase: PHASE.LIAR_GUESS, accusedId, voteResult, phaseDeadline: 0 });
  }
}

async function processHost() {
  if (processingHost || room?.meta?.hostId !== playerId || !room?.gameState) return;
  processingHost = true;
  try {
    const state = room.gameState, ids = state.playerOrder || [], now = Date.now();
    if (state.phase === PHASE.ROLE_REVEAL) {
      const ready = hostActions.ready || {}, count = ids.filter((id) => ready[id]).length;
      if (room.publicProgress?.ready !== count) await rt.set(`rooms/${roomCode}/publicProgress/ready`, count);
      if (ids.length && count === ids.length) await setPhase({ phase: PHASE.EXPLANATION_READY, phaseDeadline: 0 });
    } else if (state.phase === PHASE.EXPLANATION_READY && hostActions.startExplanation) {
      const seconds = room.meta?.config?.explanationSeconds || 90;
      await setPhase({ phase: PHASE.EXPLANATION, phaseDeadline: now + seconds * 1000 }, { startExplanation: null });
    } else if (state.phase === PHASE.EXPLANATION) {
      const advance = hostActions.advance?.phase === PHASE.EXPLANATION;
      if (advance || now >= state.phaseDeadline) {
        const seconds = room.meta?.config?.discussionSeconds || 60;
        await setPhase({ phase: PHASE.DISCUSSION, phaseDeadline: now + seconds * 1000 }, { advance: null });
      }
    } else if (state.phase === PHASE.DISCUSSION) {
      const advance = hostActions.advance?.phase === PHASE.DISCUSSION;
      if (advance || now >= state.phaseDeadline) {
        await setPhase({ phase: PHASE.VOTING, phaseDeadline: 0 }, { advance: null, votes: null });
      }
    } else if (state.phase === PHASE.VOTING) {
      const votes = hostActions.votes || {}, count = ids.filter((id) => votes[id]?.targetId).length;
      if (room.publicProgress?.votes !== count) await rt.set(`rooms/${roomCode}/publicProgress/votes`, count);
      if (ids.length && count === ids.length) {
        const tally = tallyVotes(votes, ids), voteResult = { counts: tally.counts };
        if (tally.leaders.length > 1) {
          await setPhase({ phase: PHASE.TIE_BREAK, tiedIds: tally.leaders, voteResult, phaseDeadline: 0 });
        } else if (tally.leaders.length === 1) await resolveAccused(tally.leaders[0], voteResult);
      }
    } else if (state.phase === PHASE.TIE_BREAK) {
      const targetId = hostActions.tieDecision?.targetId;
      if (state.tiedIds?.includes(targetId)) await resolveAccused(targetId, state.voteResult);
    } else if (state.phase === PHASE.LIAR_GUESS) {
      const guess = normalizeGuess(hostActions.guess?.text);
      if (guess) await setPhase({ phase: PHASE.JUDGMENT, guess, phaseDeadline: 0 });
    } else if (state.phase === PHASE.JUDGMENT && typeof hostActions.judgment?.correct === "boolean") {
      await finishResult(resultForAccusation({ accusedId: state.accusedId, liarId: hostSecret.liarId,
        word: hostSecret.word, guess: state.guess, correct: hostActions.judgment.correct }));
    }
  } catch (error) { console.error("host engine", error); }
  finally { processingHost = false; }
}

function scheduleHostDeadline() {
  clearTimeout(phaseTimer); phaseTimer = null;
  if (room?.meta?.hostId !== playerId) return;
  const deadline = room?.gameState?.phaseDeadline;
  if (deadline) phaseTimer = setTimeout(() => processHost(), Math.max(0, deadline - Date.now()) + 80);
}

function topbar() {
  return `<header class="topbar"><button id="leaveRoom" aria-label="나가기">‹</button>
    <div class="topbar-title">🕵️ <span class="room-code">${esc(roomCode)}</span></div><span></span></header>`;
}

function playersHtml(kickable = false) {
  const hostId = room?.meta?.hostId;
  return Object.entries(room?.players || {}).sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0)).map(([id, player]) => `
    <div class="player ${player.online === false ? "offline" : ""}">
      <div class="player-name"><span>${esc(player.name)}</span></div>
      <div class="badges">${id === hostId ? '<span class="badge host">방장</span>' : ""}
        ${id === playerId ? '<span class="badge me">나</span>' : ""}
        ${player.online === false ? '<span class="badge">접속 끊김</span>' : ""}</div>
      ${kickable && id !== playerId ? `<button class="kick danger" data-kick="${id}">내보내기</button>` : ""}
    </div>`).join("");
}

function renderLobby() {
  const isHost = room.meta?.hostId === playerId, count = Object.keys(room.players || {}).length;
  const config = room.meta?.config || {};
  app.innerHTML = `<section class="screen">${topbar()}
    <div class="phase-head"><p class="phase-kicker">WAITING ROOM</p><h2>게임 준비</h2>
      <p>방 코드를 친구에게 알려주세요.</p></div>
    <div class="panel stack"><div class="grid-2"><button id="copyCode">코드 복사</button><button id="shareRoom">초대 링크</button></div></div>
    <section class="panel"><div class="player-summary"><strong>참가자</strong><span>${count} / 10</span></div>
      <div class="player-list">${playersHtml(isHost)}</div></section>
    <section class="panel"><h3>시간 설정</h3>
      <div class="config-row"><label for="explanationSeconds">모두 설명하는 시간</label><select id="explanationSeconds" ${isHost ? "" : "disabled"}>
        ${[60,90,120].map((v) => `<option value="${v}" ${Number(config.explanationSeconds || 90) === v ? "selected" : ""}>${v}초</option>`).join("")}</select></div>
      <div class="config-row"><label for="discussionSeconds">자유 토론 시간</label><select id="discussionSeconds" ${isHost ? "" : "disabled"}>
        ${[30,60,90].map((v) => `<option value="${v}" ${Number(config.discussionSeconds || 60) === v ? "selected" : ""}>${v}초</option>`).join("")}</select></div>
    </section>
    <div class="lobby-actions">${isHost
      ? `<button class="primary" id="startGame" ${count < 4 ? "disabled" : ""}>${count < 4 ? `4명부터 시작 가능 (${count}/4)` : "게임 시작"}</button>`
      : '<div class="panel muted" style="text-align:center">방장이 게임을 준비하고 있습니다<span class="waiting-dots"></span></div>'}
      <button class="ghost" id="leaveBottom">방 나가기</button></div>
  </section>`;
  bindCommonLeave();
  document.getElementById("copyCode").addEventListener("click", async () => {
    await navigator.clipboard.writeText(roomCode); toast("방 코드를 복사했습니다.");
  });
  document.getElementById("shareRoom").addEventListener("click", shareRoom);
  document.querySelectorAll("[data-kick]").forEach((button) => button.addEventListener("click", async () => {
    try { await rooms.kickPlayer(roomCode, playerId, button.dataset.kick); }
    catch (error) { toast(error.message); }
  }));
  for (const id of ["explanationSeconds", "discussionSeconds"]) {
    document.getElementById(id).addEventListener("change", async (event) => {
      await rt.set(`rooms/${roomCode}/meta/config/${id}`, Number(event.target.value)); await rooms.touch(roomCode);
    });
  }
  document.getElementById("startGame")?.addEventListener("click", async (event) => {
    event.target.disabled = true; event.target.textContent = "배정 중…";
    try { await startGame(); } catch (error) { toast(error.message || "게임을 시작하지 못했습니다."); event.target.disabled = false; }
  });
}

async function shareRoom() {
  const url = new URL(location.href); url.searchParams.set("room", roomCode);
  try {
    if (navigator.share) await navigator.share({ title: "Bubblelab 라이어 게임", text: `방 코드 ${roomCode}`, url: url.href });
    else { await navigator.clipboard.writeText(url.href); toast("초대 링크를 복사했습니다."); }
  } catch (error) { if (error?.name !== "AbortError") toast("초대 링크를 공유하지 못했습니다."); }
}

function roleReminder() {
  if (!privateData) return "";
  return `<details class="panel"><summary>내 정보 다시 보기</summary><div style="text-align:center;margin-top:.8rem">
    <strong style="color:${privateData.role === "liar" ? "var(--liar)" : "var(--citizen)"}">${privateData.role === "liar" ? "라이어" : "시민"}</strong>
    <div class="category">카테고리 · ${esc(privateData.category)}</div>
    ${privateData.word ? `<div class="secret-word" style="font-size:1.4rem">${esc(privateData.word)}</div>` : ""}</div></details>`;
}

function timerHtml(title, description) {
  return `<div class="phase-head"><p class="phase-kicker">LIVE ROUND</p><h2>${title}</h2><p>${description}</p></div>
    <div class="timer" id="phaseTimer"><strong id="timerText">--</strong></div>`;
}

function orderHtml() {
  const order = room.gameState?.playerOrder || [];
  return `<div class="order-list">${order.map((id, index) => `<span class="order-chip ${index === 0 ? "start" : ""}">${index + 1}. ${esc(room.players?.[id]?.name || "?")}</span>`).join("")}</div>`;
}

function progressHtml(kind) {
  const total = room.publicProgress?.total || Object.keys(room.players || {}).length;
  const count = room.publicProgress?.[kind] || 0, label = kind === "ready" ? "역할 확인" : "투표 완료";
  return `<div class="progress-wrap"><div class="progress-line"><div class="progress-fill" style="--progress:${total ? count / total * 100 : 0}%"></div></div>
    <div class="progress-label">${label} ${count} / ${total}</div></div>`;
}

function renderRoleReveal() {
  if (!privateData) return waitingScreen("역할을 배정하고 있습니다");
  const liar = privateData.role === "liar";
  return `${topbar()}<div class="phase-head"><p class="phase-kicker">SECRET ROLE</p><h2>내 역할 확인</h2><p>다른 사람에게 화면을 보여주지 마세요.</p></div>
    <div class="role-card ${liar ? "liar" : "citizen"}"><div class="role-icon">${liar ? "🤥" : "🕵️"}</div>
      <div class="role-name">${liar ? "당신은 라이어" : "당신은 시민"}</div>
      <div class="category">카테고리 · ${esc(privateData.category)}</div>
      ${liar ? '<p class="warning">제시어를 모릅니다.<br>다른 사람의 설명을 듣고 자연스럽게 섞이세요.</p>'
        : `<div class="secret-word">${esc(privateData.word)}</div><p class="warning">제시어를 직접 말하면 라이어가 쉽게 알아냅니다.</p>`}</div>
    ${progressHtml("ready")}
    <button class="primary" id="readyRole" ${ownReady ? "disabled" : ""}>${ownReady ? "확인 완료 · 기다리는 중" : "역할을 확인했습니다"}</button>`;
}

function waitingScreen(text) {
  return `${topbar()}<div class="screen center" style="min-height:auto;flex:1"><div class="brand"><div class="brand-icon">⏳</div><h2>${text}<span class="waiting-dots"></span></h2></div></div>`;
}

function renderExplanationReady() {
  const moderatorId = room.gameState.moderatorId, canStart = moderatorId === playerId || room.meta.hostId === playerId;
  return `${topbar()}<div class="phase-head"><p class="phase-kicker">ROUND GUIDE</p><h2>설명 준비</h2>
    <p><strong>${esc(room.players?.[moderatorId]?.name)}</strong>님부터 순서대로 설명합니다.<br>제시어를 직접 말하지 마세요.</p></div>
    <div class="panel">${orderHtml()}</div>${roleReminder()}
    ${canStart ? '<button class="primary" id="startExplanation">모두 준비됨 · 설명 시작</button>'
      : `<div class="panel muted" style="text-align:center">${esc(room.players?.[moderatorId]?.name)}님이 타이머를 시작합니다<span class="waiting-dots"></span></div>`}`;
}

function renderExplanation() {
  const isHost = room.meta.hostId === playerId;
  return `${topbar()}${timerHtml("한 명씩 설명하세요", "화면의 순서대로 실제로 말합니다.")}
    <div class="panel">${orderHtml()}</div>${roleReminder()}
    ${isHost ? '<button id="advancePhase">설명 완료 · 바로 토론</button>' : ""}`;
}

function renderDiscussion() {
  const isHost = room.meta.hostId === playerId;
  return `${topbar()}${timerHtml("누가 라이어일까요?", "설명을 비교하고 자유롭게 토론하세요.")}
    ${roleReminder()}${isHost ? '<button class="primary" id="advancePhase">토론 완료 · 바로 투표</button>' : ""}`;
}

function renderVoting() {
  const ids = room.gameState.playerOrder || [], voted = !!ownVote;
  return `${topbar()}<div class="phase-head"><p class="phase-kicker">SECRET VOTE</p><h2>라이어를 지목하세요</h2>
    <p>선택은 투표가 끝날 때까지 공개되지 않습니다.</p></div>
    ${voted ? `<div class="panel" style="text-align:center"><h3>투표 완료</h3><p class="muted">다른 플레이어를 기다리고 있습니다<span class="waiting-dots"></span></p></div>`
      : `<div class="vote-list">${ids.filter((id) => id !== playerId).map((id) => `<button class="vote-target ${selectedVote === id ? "selected" : ""}" data-vote="${id}">${esc(room.players?.[id]?.name || "?")}</button>`).join("")}</div>
        <button class="primary" id="submitVote" ${selectedVote ? "" : "disabled"}>이 사람에게 투표</button>`}
    ${progressHtml("votes")}${roleReminder()}`;
}

function voteCountsHtml() {
  const counts = room.gameState.voteResult?.counts || {};
  return `<div class="vote-counts">${Object.entries(counts).sort((a,b) => b[1]-a[1]).map(([id, count]) => `
    <div class="vote-count"><span>${esc(room.players?.[id]?.name || "?")}</span><strong>${count}표</strong></div>`).join("")}</div>`;
}

function renderTieBreak() {
  const state = room.gameState, moderatorId = state.moderatorId;
  const moderatorOffline = room.players?.[moderatorId]?.online === false;
  const canChoose = playerId === moderatorId || (room.meta.hostId === playerId && moderatorOffline);
  return `${topbar()}<div class="phase-head"><p class="phase-kicker">TIE BREAK</p><h2>투표가 동률입니다</h2>
    <p>${esc(room.players?.[moderatorId]?.name)}님이 최종 지목자를 결정합니다.</p></div>
    <div class="panel">${voteCountsHtml()}</div>
    ${canChoose ? `<div class="vote-list">${state.tiedIds.map((id) => `<button class="vote-target" data-tie="${id}">${esc(room.players?.[id]?.name || "?")} 지목</button>`).join("")}</div>`
      : '<div class="panel muted" style="text-align:center">진행자가 결정하고 있습니다<span class="waiting-dots"></span></div>'}`;
}

function renderLiarGuess() {
  const state = room.gameState, isLiar = state.accusedId === playerId;
  return `${topbar()}<div class="phase-head"><p class="phase-kicker">LAST CHANCE</p><h2>라이어를 찾았습니다</h2>
    <p><strong>${esc(room.players?.[state.accusedId]?.name)}</strong>님에게 마지막 기회가 있습니다.</p></div>
    ${isLiar ? `<form class="panel stack" id="guessForm"><label for="guessInput" class="muted">제시어를 자유롭게 입력하세요</label>
      <input id="guessInput" maxlength="30" autocomplete="off" placeholder="정답 입력"><button class="primary" type="submit">이 답으로 제출</button></form>`
      : '<div class="panel muted" style="text-align:center">라이어가 제시어를 추측하고 있습니다<span class="waiting-dots"></span></div>'}`;
}

function renderJudgment() {
  const state = room.gameState, isHost = room.meta.hostId === playerId;
  return `${topbar()}<div class="phase-head"><p class="phase-kicker">HOST JUDGMENT</p><h2>방장이 판정합니다</h2>
    <p>유사어와 표현 차이는 양심에 따라 인정해주세요.</p></div>
    <div class="answer-box"><small>라이어의 답</small><strong>${esc(state.guess)}</strong></div>
    ${isHost ? `<div class="answer-box"><small>실제 제시어</small><strong>${esc(hostSecret?.word || privateData?.word || "확인 중…")}</strong></div>
      <div class="grid-2"><button class="danger" data-judge="false">오답</button><button class="primary" data-judge="true">정답 인정</button></div>`
      : '<div class="panel muted" style="text-align:center">방장이 판정하고 있습니다<span class="waiting-dots"></span></div>'}`;
}

function renderResult() {
  const result = room.gameState.result;
  if (!result) return waitingScreen("결과를 정리하고 있습니다");
  const liarWon = result.winner === "liar";
  const reason = result.reason === "citizen_accused" ? "시민을 잘못 지목해 라이어가 빠져나갔습니다."
    : result.reason === "guess_correct" ? "라이어가 마지막 추측에 성공했습니다."
    : "라이어를 찾고 마지막 추측도 막아냈습니다.";
  return `${topbar()}<div class="result-hero ${liarWon ? "liar" : "citizens"}"><div class="result-icon">${liarWon ? "🤥" : "🕵️"}</div>
    <h2>${liarWon ? "라이어 승리" : "시민 승리"}</h2><p>${reason}</p></div>
    <div class="reveal-grid"><div class="reveal-item"><small>라이어</small><strong>${esc(room.players?.[result.liarId]?.name || "?")}</strong></div>
      <div class="reveal-item"><small>제시어</small><strong>${esc(result.word)}</strong></div>
      ${result.guess ? `<div class="reveal-item" style="grid-column:1/-1"><small>라이어의 답</small><strong>${esc(result.guess)} · ${result.correct ? "정답 인정" : "오답"}</strong></div>` : ""}</div>
    <div class="panel"><h3>투표 결과</h3>${voteCountsHtml()}</div>
    ${room.meta.hostId === playerId ? '<button class="primary" id="replay">같은 방에서 한 판 더</button>'
      : '<div class="panel muted" style="text-align:center">방장이 다음 판을 준비할 수 있습니다.</div>'}
    <button class="ghost" id="leaveBottom">방 나가기</button>`;
}

function renderGame() {
  stopUiTimer(); const phase = room.gameState?.phase;
  let content = "";
  if (phase === PHASE.ROLE_REVEAL) content = renderRoleReveal();
  else if (phase === PHASE.EXPLANATION_READY) content = renderExplanationReady();
  else if (phase === PHASE.EXPLANATION) content = renderExplanation();
  else if (phase === PHASE.DISCUSSION) content = renderDiscussion();
  else if (phase === PHASE.VOTING) content = renderVoting();
  else if (phase === PHASE.TIE_BREAK) content = renderTieBreak();
  else if (phase === PHASE.LIAR_GUESS) content = renderLiarGuess();
  else if (phase === PHASE.JUDGMENT) content = renderJudgment();
  else if (phase === PHASE.RESULT) content = renderResult();
  else content = waitingScreen("게임 상태를 불러오고 있습니다");
  app.innerHTML = `<section class="screen">${content}</section>`;
  bindGameEvents();
  if (room.gameState?.phaseDeadline) startTimerDisplay(room.gameState.phaseDeadline);
}

function bindCommonLeave() {
  const leave = async () => {
    if (!confirm("방에서 나갈까요?")) return;
    await rooms.leaveRoom(roomCode, playerId).catch(() => {}); cleanupRoom(); setRoomUrl(); renderHome("");
  };
  document.getElementById("leaveRoom")?.addEventListener("click", leave);
  document.getElementById("leaveBottom")?.addEventListener("click", leave);
}

function bindGameEvents() {
  bindCommonLeave();
  document.getElementById("readyRole")?.addEventListener("click", async (event) => {
    event.target.disabled = true; await rt.set(`actions/${roomCode}/ready/${playerId}`, true);
  });
  document.getElementById("startExplanation")?.addEventListener("click", async (event) => {
    event.target.disabled = true; await rt.set(`actions/${roomCode}/startExplanation`, { by: playerId, at: Date.now() });
  });
  document.getElementById("advancePhase")?.addEventListener("click", async (event) => {
    event.target.disabled = true; await rt.set(`actions/${roomCode}/advance`, { phase: room.gameState.phase, by: playerId });
  });
  document.querySelectorAll("[data-vote]").forEach((button) => button.addEventListener("click", () => {
    selectedVote = button.dataset.vote; renderGame();
  }));
  document.getElementById("submitVote")?.addEventListener("click", async (event) => {
    if (!selectedVote) return; event.target.disabled = true;
    await rt.set(`actions/${roomCode}/votes/${playerId}`, { targetId: selectedVote, submittedAt: Date.now() });
  });
  document.querySelectorAll("[data-tie]").forEach((button) => button.addEventListener("click", async () => {
    document.querySelectorAll("[data-tie]").forEach((item) => { item.disabled = true; });
    await rt.set(`actions/${roomCode}/tieDecision`, { targetId: button.dataset.tie, by: playerId });
  }));
  document.getElementById("guessForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const text = normalizeGuess(document.getElementById("guessInput").value);
    if (!text) { toast("추측한 제시어를 입력해주세요."); return; }
    event.submitter.disabled = true; await rt.set(`actions/${roomCode}/guess`, { text, by: playerId });
  });
  document.querySelectorAll("[data-judge]").forEach((button) => button.addEventListener("click", async () => {
    document.querySelectorAll("[data-judge]").forEach((item) => { item.disabled = true; });
    await rt.set(`actions/${roomCode}/judgment`, { correct: button.dataset.judge === "true", by: playerId });
  }));
  document.getElementById("replay")?.addEventListener("click", replay);
}

function startTimerDisplay(deadline) {
  const update = () => {
    const text = document.getElementById("timerText"), timer = document.getElementById("phaseTimer");
    if (!text) return;
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    text.textContent = seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : `${seconds}초`;
    timer?.classList.toggle("warning", seconds <= 10);
  };
  update(); timerInterval = setInterval(update, 250);
}

async function replay(event) {
  event.target.disabled = true;
  await rootUpdate({
    [`rooms/${roomCode}/meta/status`]: "waiting",
    [`rooms/${roomCode}/meta/updatedAt`]: Date.now(),
    [`rooms/${roomCode}/gameState`]: null,
    [`rooms/${roomCode}/publicProgress`]: null,
    [`privateData/${roomCode}`]: null,
    [`secrets/${roomCode}`]: null,
    [`actions/${roomCode}`]: null,
  });
}

function render() {
  if (!room) return;
  room.meta?.status === "waiting" ? renderLobby() : renderGame();
}

addEventListener("pagehide", () => rt.close());

async function init() {
  const inviteCode = currentInviteCode();
  if (inviteCode && playerName) {
    try { await enterRoom(inviteCode, playerName); return; }
    catch (_) {}
  }
  renderHome(inviteCode);
}

init();
