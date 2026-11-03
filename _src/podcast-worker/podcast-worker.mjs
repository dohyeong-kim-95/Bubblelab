#!/usr/bin/env node
// 집 PC 팟캐스트 생성기 — podcast.bubblelab.dev 큐에서 일감을 가져가 당이로 대본을 쓰고
// Supertonic(tts.py)으로 녹음해 WAV 를 올린다. 외부 AI API 는 쓰지 않는다.
//
//   node podcast-worker.mjs                    # 상주(systemd user 서비스가 이렇게 띄운다)
//   node podcast-worker.mjs --once             # 일감 하나만 처리하고 끝
//   node podcast-worker.mjs --preview a.pdf …  # 서버 없이 로컬 파일로 대본·녹음만 (품질 확인)
//
// 설정: 같은 폴더의 podcast-worker.config.json (예시는 podcast-worker.config.example.json).
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScript, llamaClient } from "./pipeline.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const POLL_MS = 60_000;
const FAIL_BACKOFF_MS = 5 * 60_000;
// 03~06시(KST)는 당이 쪽 정비 시간이라 손대지 않는다. 06:40 cron 일감은 그 뒤에 가져간다.
const QUIET_HOURS_KST = [3, 6];

const log = (...args) => console.log(new Date().toISOString(), ...args);

function loadConfig() {
  const file = join(HERE, "podcast-worker.config.json");
  const raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  return {
    server: (process.env.PODCAST_SERVER || raw.server || "https://podcast.bubblelab.dev").replace(/\/+$/, ""),
    token: process.env.PODCAST_WORKER_TOKEN || raw.token || "",
    llama: process.env.LLAMA_URL || raw.llama || "http://127.0.0.1:8090",
    python: process.env.PODCAST_PYTHON || raw.python || join(HERE, "venv", "bin", "python"),
    voiceA: raw.voiceA || "F1",
    voiceB: raw.voiceB || "M1",
  };
}

const kstHour = () => Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "numeric", hourCycle: "h23" }).format(new Date()));
const kstToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** tts.py 로 녹음한다. 진행은 stderr 로 흘려 보내고 길이(초)만 돌려받는다. */
async function synthesize(config, script, outPath) {
  const dir = await mkdtemp(join(tmpdir(), "podcast-tts-"));
  try {
    const scriptPath = join(dir, "script.json");
    await writeFile(scriptPath, JSON.stringify({ turns: script.turns, voiceA: config.voiceA, voiceB: config.voiceB }));
    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(config.python, ["-I", join(HERE, "tts.py"), scriptPath, outPath], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      child.stdout.on("data", (chunk) => { out += chunk; });
      child.stderr.on("data", (chunk) => { err = (err + chunk).slice(-2000); });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`녹음 실패(${code}): ${err.trim().split("\n").pop()}`))));
    });
    return JSON.parse(stdout.trim().split("\n").pop()).durationSeconds;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function api(config) {
  const auth = { Authorization: `Bearer ${config.token}` };
  const call = async (path, init = {}) => {
    const res = await fetch(`${config.server}/_podcast/worker${path}`, {
      ...init, headers: { ...auth, ...init.headers }, signal: AbortSignal.timeout(5 * 60_000),
    });
    if (!res.ok && res.status !== 204) throw new Error(`서버 ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  };
  const postJson = (path, body) => call(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return {
    async claim() {
      const res = await postJson("/claim", {});
      return res.status === 204 ? null : res.json();
    },
    async source(key) {
      return new Uint8Array(await (await call(`/source?key=${encodeURIComponent(key)}`)).arrayBuffer());
    },
    progress: (job, stage, title) => postJson("/progress", { ...job, stage, title }),
    fail: (job, error) => postJson("/fail", { ...job, error }),
    async upload(job, wav, { title, durationSeconds }) {
      const query = new URLSearchParams({ user: job.userId, date: job.date, title, duration: String(durationSeconds) });
      await call(`/audio?${query}`, { method: "PUT", headers: { "Content-Type": "audio/wav" }, body: wav });
    },
  };
}

async function runJob(config, server, llm, claimed) {
  const { job, memory, sources } = claimed;
  log(`일감 ${job.date} (시도 ${job.attempt}) — 자료 ${sources.length}개`);
  const started = Date.now();
  const files = [];
  for (const source of sources) files.push({ ...source, bytes: await server.source(source.key) });
  const script = await buildScript({ sources: files, memory, dateKst: job.date, llm, log });
  const chars = script.turns.reduce((sum, t) => sum + t.text.length, 0);
  log(`대본 "${script.title}" ${script.turns.length}턴 ${chars}자 · ${Math.round((Date.now() - started) / 1000)}초`);
  await server.progress(job, "tts", script.title);
  const dir = await mkdtemp(join(tmpdir(), "podcast-out-"));
  try {
    const wavPath = join(dir, "episode.wav");
    const durationSeconds = await synthesize(config, script, wavPath);
    await server.progress(job, "store");
    const wav = await readFile(wavPath);
    await server.upload(job, wav, { title: script.title, durationSeconds });
    log(`완료 — ${durationSeconds}초 분량 · ${(wav.length / 1e6).toFixed(1)}MB · 총 ${Math.round((Date.now() - started) / 1000)}초`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function tick(config, server, llm) {
  const hour = kstHour();
  if (hour >= QUIET_HOURS_KST[0] && hour < QUIET_HOURS_KST[1]) return POLL_MS;
  // 당이가 꺼져 있으면(정비·YOUTUBE 녹음 중) 일감을 가져가지 않는다 — 시도 횟수를 헛되이 쓰지 않게.
  if (!(await llm.healthy())) return POLL_MS;
  const claimed = await server.claim();
  if (!claimed) return POLL_MS;
  try {
    await runJob(config, server, llm, claimed);
    return 1000;
  } catch (error) {
    log("실패:", error.message);
    await server.fail(claimed.job, error.message).catch((e) => log("실패 보고도 실패:", e.message));
    return FAIL_BACKOFF_MS;
  }
}

async function preview(config, paths) {
  const MIME = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".txt": "text/plain", ".md": "text/markdown" };
  const llm = llamaClient(config.llama);
  const sources = await Promise.all(paths.map(async (path) => {
    const mime = MIME[extname(path).toLowerCase()];
    if (!mime) throw new Error(`지원하지 않는 파일: ${path}`);
    return { name: basename(path), mime, bytes: new Uint8Array(await readFile(path)) };
  }));
  const started = Date.now();
  const script = await buildScript({ sources, memory: process.env.PODCAST_MEMORY ?? "", dateKst: kstToday(), llm, log });
  await writeFile("podcast-preview.json", JSON.stringify(script, null, 2));
  log(`대본 "${script.title}" ${script.turns.length}턴 · ${Math.round((Date.now() - started) / 1000)}초 → podcast-preview.json`);
  const ttsStarted = Date.now();
  const seconds = await synthesize(config, script, join(process.cwd(), "podcast-preview.wav"));
  log(`녹음 ${seconds}초 분량 · ${Math.round((Date.now() - ttsStarted) / 1000)}초 → podcast-preview.wav`);
}

const args = process.argv.slice(2);
const config = loadConfig();
if (args[0] === "--preview") {
  await preview(config, args.slice(1));
} else {
  if (!config.token) {
    console.error("토큰이 없습니다 — admin 🎙️ Podcast 화면에서 발급해 podcast-worker.config.json 의 token 에 넣으세요.");
    process.exit(1);
  }
  const server = api(config);
  const llm = llamaClient(config.llama);
  log(`시작 — ${config.server} · 당이 ${config.llama} · 목소리 ${config.voiceA}/${config.voiceB}`);
  if (args.includes("--once")) {
    await tick(config, server, llm);
  } else {
    for (;;) {
      const wait = await tick(config, server, llm).catch((error) => { log("오류:", error.message); return POLL_MS; });
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}
