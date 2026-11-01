// 당이 터미널 하네스 — 두리 채팅 없이 데몬과 **같은 당이**(createAssistant)를 불러 본다.
// 모델은 진짜(llama-server)지만 바깥으로는 아무것도 나가지 않는다: 답은 화면에만 찍히고, 일정 변경은 메모리에만
// 반영된다(서버·events.json 에 쓰지 않는다). 새 기능을 두리에 켜기 전 리허설용이다. 테스트(npm test)가 아니다.
//
//   node _src/duri-sink/dangi.mjs "이번 주 일정"          한 번 묻고 끝(앞에 @당이 는 붙여도 되고 안 붙여도 된다)
//   node _src/duri-sink/dangi.mjs                       대화형 — "빵: …" 처럼 쓰면 그 사람이 말한 것
//   --real            진짜 캘린더·대화 백업(DuriStorage)을 **읽기만** 한다. 없으면 가짜 캘린더(fixtures.mjs)에
//                     오늘을 2026-10-25 로 고정 — bench.mjs 와 같은 세상이라 날짜 답을 맞춰 볼 수 있다
//   --as 빵           말하는 사람(기본 쫑)
//   --url http://…    모델 서버(기본 LLAMA_URL 또는 http://127.0.0.1:8090)
//   -q                당이 내부 로그(모델 JSON → op)를 숨긴다
//
// 대화형 명령: /as 이름 · /yes /no(카드 버튼 누르기) · /cal(지금 일정) · /reset(일정 처음대로) · /quit. "브리핑" 이라고 하면 아침 브리핑.
// 데몬과 모델 서버를 같이 쓰므로, 누가 두리에서 당이를 부르면 그쪽이 잠깐 기다린다(겹쳐 부르진 않는다).
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createAssistant, llamaAsk, parseTrigger, BOT_NAME } from "./assistant.mjs";
import { FAKE_TODAY, FAKE_EVENTS } from "./fixtures.mjs";

/**
 * 하네스 본체. 바깥으로 나가는 io 를 전부 메모리·out 콜백으로 바꾼 당이.
 * out({ type: "say" | "apply" | "log", … }) 로 화면에 찍을 것을 넘긴다.
 */
export function createHarness({ ask, events, archive = null, weather = null, now = () => Date.now(), out = () => {} }) {
  const fresh = () => new Map(structuredClone(events).map((e) => [e.id, e]));
  let cal = fresh(), lastAsk = null; // 앱 카드처럼 마지막으로 되물은 부탁 — /yes /no 가 누른다
  const assistant = createAssistant({
    ask,
    events: () => [...cal.values()],
    apply: async ({ puts, dels }) => {
      for (const { id, rev, content } of puts) cal.set(id, { id, rev, deleted: false, ...content });
      for (const { id, rev } of dels) cal.set(id, { id, rev, deleted: true });
      out({ type: "apply", puts: puts.map((p) => p.content), dels: dels.map((d) => d.id) });
    },
    say: async (text, sticker, photos, meta) => {
      if (meta?.ask) lastAsk = meta.ask;
      if (meta?.done && lastAsk?.id === meta.done) lastAsk = null;
      out({ type: "say", text, sticker, photos, ask: meta?.ask, done: meta?.done });
    },
    archive,
    ...(weather && { weather }),
    log: (...a) => out({ type: "log", text: a.map(String).join(" ") }),
  }, { now });
  return {
    /** name 이 text 를 말했다. "@당이" 가 없으면 붙인다. 당이가 다 답할 때까지 기다린다. */
    send(name, text) {
      const t = parseTrigger(text) === null ? `@당이 ${text}` : text;
      return assistant.onMessage({ name, text: t, at: now() });
    },
    /** 앱 카드의 [승인]/[취소] 를 name 이 누른다(앱이 보내는 것과 같은 메시지). 누를 카드가 없으면 false. */
    async tap(name, ok) {
      if (!lastAsk) return false;
      await assistant.onMessage({ name, text: ok ? "@당이 응" : "@당이 취소", at: now(), answer: { id: lastAsk.id, ok } });
      return true;
    },
    events: () => [...cal.values()],
    reset() { cal = fresh(); },
  };
}

// ── 화면 ─────────────────────────────────────────────────────
const dim = (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const brown = (s) => (process.stdout.isTTY ? `\x1b[38;5;137m${s}\x1b[0m` : s);
function printer(quiet) {
  return (e) => {
    if (e.type === "log") { if (!quiet) console.log(dim(`  · ${e.text}`)); return; }
    if (e.type === "apply") {
      const add = e.puts.map((c) => c.title ?? c.kind ?? "?"), del = e.dels.length;
      console.log(dim(`  📅 (메모리에만) ${add.length ? `저장 ${add.length}: ${add.slice(0, 5).join(", ")}${add.length > 5 ? " …" : ""}` : ""}${del ? ` 지움 ${del}` : ""}`));
      return;
    }
    const extra = [e.sticker && `[이모티콘 ${e.sticker.pack} #${e.sticker.n}]`, e.photos?.length && `[사진 ${e.photos.length}장]`].filter(Boolean).join(" ");
    console.log(brown(`${BOT_NAME} │ `) + String(e.text).replace(/\n/g, `\n${" ".repeat(BOT_NAME.length + 1)}│ `) + (extra ? ` ${dim(extra)}` : ""));
    if (e.ask) console.log(dim(`${" ".repeat(BOT_NAME.length + 1)}│ [승인] [취소] — ${e.ask.by}만 누를 수 있음 · /yes /no`));
  };
}
function calText(events) {
  const live = events.filter((e) => !e.deleted && !e.kind).sort((a, b) => `${a.date}${a.start ?? ""}`.localeCompare(`${b.date}${b.start ?? ""}`));
  return live.length ? live.map((e) => `  ${e.date}${e.start ? ` ${e.start}` : ""}${e.endDate ? `~${e.endDate}` : ""} ${e.title}${e.who ? ` (${e.who})` : ""}`).join("\n") : "  (일정 없음)";
}

// ── 실행 ─────────────────────────────────────────────────────
async function main(argv) {
  const opt = { real: false, as: "쫑", url: process.env.LLAMA_URL || "http://127.0.0.1:8090", quiet: false, words: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--real") opt.real = true;
    else if (a === "--as") opt.as = argv[++i];
    else if (a === "--url") opt.url = argv[++i];
    else if (a === "-q") opt.quiet = true;
    else if (a === "-h" || a === "--help") { console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\nimport ")[0]); return; }
    else opt.words.push(a);
  }
  try { await fetch(`${opt.url.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(3000) }); }
  catch { console.error(`✖ 모델 서버(${opt.url})에 닿지 않습니다 — systemctl --user status llama-server`); process.exit(1); }

  let events = FAKE_EVENTS, archive = null, weather = null, now;
  if (opt.real) {
    const home = join(homedir(), "duri-sink");
    let dir = process.env.DURI_DIR;
    if (!dir) { try { dir = JSON.parse(readFileSync(join(home, "duri-sink.config.json"), "utf8")).dir; } catch { /* 기본값 */ } }
    dir = resolve(home, dir || "DuriStorage"); // 설정의 dir 은 설치 폴더 기준 상대 경로일 수 있다
    const calPath = join(dir, "calendar", "events.json");
    if (!existsSync(calPath)) { console.error(`✖ ${calPath} 가 없습니다 — DURI_DIR 로 저장 위치를 알려 주세요`); process.exit(1); }
    events = JSON.parse(readFileSync(calPath, "utf8")).events ?? [];
    const { createArchive } = await import("./archive.mjs"), { createPlaces } = await import("./places.mjs");
    const { weatherLines, DEFAULT_PLACES } = await import("./weather.mjs");
    archive = createArchive(dir, { skip: (name, text) => name === BOT_NAME || parseTrigger(text) !== null, place: createPlaces() });
    weather = (today) => weatherLines(DEFAULT_PLACES, today);
    now = () => Date.now();
    console.log(dim(`진짜 기록을 읽기만 합니다 — ${dir} (일정 ${events.filter((e) => !e.deleted && !e.kind).length}건). 바꾼 일정은 메모리에만.`));
  } else {
    const start = Date.now(), base = Date.parse(`${FAKE_TODAY}T09:00:00+09:00`);
    now = () => base + (Date.now() - start);
    console.log(dim(`가짜 캘린더 · 오늘 ${FAKE_TODAY} (일) 09:00 KST — 진짜 기록으로 하려면 --real`));
  }
  const h = createHarness({ ask: llamaAsk({ url: opt.url }), events, archive, weather, now, out: printer(opt.quiet) });
  const run = async (name, text) => {
    const s = Date.now();
    await h.send(name, text);
    console.log(dim(`  (${((Date.now() - s) / 1000).toFixed(1)}초)`));
  };

  if (opt.words.length) { await run(opt.as, opt.words.join(" ")); return; }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  let who = opt.as;
  const prompt = () => { rl.setPrompt(`${who}> `); rl.prompt(); };
  console.log(dim(`"빵: 이번 주 일정" 처럼 이름을 앞에 쓰면 그 사람이 말한 것 · /as /yes /no /cal /reset /quit`));
  prompt();
  for await (const raw of rl) { // 줄을 쌓아 두고 하나씩 꺼낸다 — 파이프로 여러 줄을 넣어도 차례대로 답한다
    const line = raw.trim();
    if (line === "/quit" || line === "/q") break;
    if (!process.stdin.isTTY && line) console.log(line); // 파이프 입력은 화면에 안 보이니 따라 적는다
    if (line.startsWith("/as ")) who = line.slice(4).trim() || who;
    else if (line === "/yes" || line === "/no") { if (!(await h.tap(who, line === "/yes"))) console.log(dim("  누를 카드가 없어요")); }
    else if (line === "/cal") console.log(calText(h.events()));
    else if (line === "/reset") { h.reset(); console.log(dim("  일정을 처음대로 돌렸어요")); }
    else if (line) {
      const m = line.match(/^([^\s:@]{1,8}):\s*(.+)$/);
      await run(m ? m[1] : who, m ? m[2] : line);
    }
    prompt();
  }
  rl.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
