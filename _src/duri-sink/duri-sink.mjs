#!/usr/bin/env node
// Duri 데스크톱 싱크 — 사용자 PC에서 상주하며 대화·사진을 로컬 디스크에 보존한다.
//
// "엣지는 중계소, 원본은 내 PC" 설계의 진실의 원천 쪽. 하는 일:
//   1. /_duri 에 싱크 토큰으로 WebSocket 접속 (커서 이후 항목을 받는다)
//   2. 공유 패스프레이즈로 E2E 복호화 → 로컬 DuriStorage/ 에 기록 (store.mjs)
//   3. 디스크에 확실히 쓴 뒤에만 ack → 서버는 그 항목을 버퍼·R2에서 폐기
//
// 서버·R2는 암호블롭만 갖고 있으므로, 패스프레이즈를 아는 이 데몬만 평문을 만든다.
// 의존성 없음 — Node 22+ 의 전역 WebSocket·crypto 만 쓴다.
//
// 실행:  DURI_URL=… DURI_TOKEN=… DURI_PASSPHRASE=… DURI_DIR=… node duri-sink.mjs
//        또는 같은 폴더의 duri-sink.config.json 에 값을 넣고  node duri-sink.mjs

import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveKey, createStore, atomicWrite } from "./store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fatal = (msg) => { console.error("✖", msg); process.exit(1); };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

if (typeof WebSocket === "undefined") fatal("Node 22+ 가 필요합니다 (전역 WebSocket 없음).");

// ── 설정 (env 우선, 없으면 config 파일) ──────────────────────
function loadConfig() {
  let file = {};
  const path = join(HERE, "duri-sink.config.json");
  if (existsSync(path)) {
    try { file = JSON.parse(readFileSync(path, "utf8")); }
    catch { fatal(`설정 파일을 읽을 수 없습니다: ${path}`); }
  }
  const cfg = {
    url: process.env.DURI_URL || file.url,
    token: process.env.DURI_TOKEN || file.token,
    passphrase: process.env.DURI_PASSPHRASE || file.passphrase,
    dir: process.env.DURI_DIR || file.dir || join(HERE, "DuriStorage"),
  };
  for (const k of ["url", "token", "passphrase"]) {
    if (!cfg[k]) fatal(`설정 누락: ${k} (env DURI_${k.toUpperCase()} 또는 duri-sink.config.json)`);
  }
  cfg.url = cfg.url.replace(/\/+$/, "");
  return cfg;
}

const cfg = loadConfig();
const cursorPath = join(cfg.dir, ".duri-cursor");
const loadCursor = () => {
  try { return Number(readFileSync(cursorPath, "utf8").trim()) || 0; } catch { return 0; }
};

async function downloadPhoto(r2key) {
  const res = await fetch(`${cfg.url}/_duri/photo/${r2key}`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!res.ok) throw new Error(`photo ${r2key} HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ── 순차 처리 큐 + ack ───────────────────────────────────────
// 엔트리는 seq 순으로 도착한다. 하나씩 디스크에 쓰고 커서를 전진시킨다.
// 실패(예: 사진 다운로드 일시 오류)하면 커서를 멈추고 재시도 — ack 하지 않으므로
// 서버가 폐기하지 않아 데이터가 유실되지 않는다.
let store, cursor = loadCursor();
const queue = [];
let draining = false, ackTimer = null, socket = null;

function enqueue(entry) {
  if (entry.seq <= cursor) return; // 이미 보존됨
  queue.push(entry);
  queue.sort((a, b) => a.seq - b.seq);
  drain();
}

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const entry = queue[0];
    if (entry.seq <= cursor) { queue.shift(); continue; }
    if (entry.seq !== cursor + 1) break; // 선행 항목 대기
    try {
      await store.persist(entry);
    } catch (e) {
      if (e?.name === "OperationError" || /decrypt/i.test(String(e))) {
        fatal("복호화 실패 — 패스프레이즈가 상대와 다릅니다. 데이터 보존을 위해 중단합니다.");
      }
      log("⏳ 보존 재시도:", entry.seq, String(e?.message || e));
      break; // 커서 전진 안 함 → ack 안 함 → 서버 유지
    }
    queue.shift();
    cursor = entry.seq;
    atomicWrite(cursorPath, String(cursor));
    scheduleAck();
  }
  draining = false;
  if (queue.length && queue[0].seq > cursor + 1) setTimeout(drain, 3000); // 빠진 항목 대기 후 재시도
}

function scheduleAck() {
  if (ackTimer) return;
  ackTimer = setTimeout(() => {
    ackTimer = null;
    if (socket?.readyState === 1) socket.send(JSON.stringify({ type: "ack", seq: cursor }));
  }, 800);
}

// ── WebSocket 접속 루프 ──────────────────────────────────────
let backoff = 1000;
function connect() {
  const wsUrl = `${cfg.url.replace(/^http/, "ws")}/_duri?token=${encodeURIComponent(cfg.token)}`;
  const ws = new WebSocket(wsUrl);
  socket = ws;
  ws.addEventListener("open", () => {
    backoff = 1000;
    log("접속됨. 커서", cursor, "이후 수신");
    ws.send(JSON.stringify({ type: "hello", since: cursor }));
  });
  ws.addEventListener("message", (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === "ping") { ws.send(JSON.stringify({ type: "pong" })); return; }
    if (m.type === "entry") { enqueue(m); return; }
    if (m.type === "backfill-done") { log("백필 완료. head", m.head); drain(); return; }
    if (m.type === "welcome") { log("welcome. head", m.head); return; }
    if (m.type === "error") { log("서버 오류:", m.error); return; }
  });
  ws.addEventListener("close", () => {
    log("연결 끊김. 재연결", backoff, "ms 후");
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30000);
  });
  ws.addEventListener("error", () => { try { ws.close(); } catch { /* 이미 닫힘 */ } });
}

// ── 시작 ─────────────────────────────────────────────────────
const key = await deriveKey(cfg.passphrase);
store = createStore({ dir: cfg.dir, key, fetchPhoto: downloadPhoto });
mkdirSync(cfg.dir, { recursive: true });
log(`Duri 싱크 시작 — 저장 위치: ${cfg.dir}`);
connect();
