#!/usr/bin/env node
// 팟캐스트 생성 파이프라인 로컬 검증 CLI. 실서비스와 같은 podcast-ai.js
// 프로바이더 코드를 그대로 실행해서 대본·오디오 품질을 배포 전에 확인한다.
//
//   GEMINI_API_KEY=... node _infra/podcast-pipeline.mjs 자료.pdf [자료2.png ...]
//   node _infra/podcast-pipeline.mjs --gen-vapid   # 푸시용 VAPID 키쌍 생성
//
// 프로바이더 교체도 env로 실서비스와 동일하게 시험할 수 있다:
//   PODCAST_LLM_PROVIDER=openai PODCAST_LLM_BASE_URL=https://openrouter.ai/api/v1 ...
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { createScriptProvider, createTtsProvider } from "./podcast-ai.js";
import { generateVapidKeys } from "./webpush.js";

const MIME_BY_EXT = {
  ".pdf": "application/pdf", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
};

const args = process.argv.slice(2);

if (args.includes("--gen-vapid")) {
  const keys = await generateVapidKeys();
  console.log("wrangler.jsonc vars   → VAPID_PUBLIC_KEY:", keys.publicKey);
  console.log("worker secret         → VAPID_PRIVATE_KEY:", keys.privateKey);
  console.log("worker secret(선택)   → VAPID_SUBJECT: mailto:you@example.com");
  process.exit(0);
}

if (args.length === 0) {
  console.error("사용법: node _infra/podcast-pipeline.mjs <pdf|png|jpg|webp>... | --gen-vapid");
  process.exit(1);
}

const sources = await Promise.all(args.map(async (path) => {
  const mime = MIME_BY_EXT[extname(path).toLowerCase()];
  if (!mime) throw new Error(`지원하지 않는 파일: ${path}`);
  return { name: basename(path), mime, bytes: new Uint8Array(await readFile(path)) };
}));

const env = process.env;
const dateKst = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

const scriptProvider = createScriptProvider(env);
console.log(`[1/2] 대본 생성 — ${scriptProvider.name}`);
const started = Date.now();
const script = await scriptProvider.generate({
  sources, memory: env.PODCAST_MEMORY ?? "", dateKst,
});
const scriptChars = script.turns.reduce((sum, t) => sum + t.text.length, 0);
console.log(`  제목: ${script.title}`);
console.log(`  ${script.turns.length}턴 · ${scriptChars}자 · ${((Date.now() - started) / 1000).toFixed(1)}초`);
await writeFile("podcast-preview.json", JSON.stringify(script, null, 2));

const ttsProvider = createTtsProvider(env);
console.log(`[2/2] 음성 합성 — ${ttsProvider.name}`);
const ttsStarted = Date.now();
const audio = await ttsProvider.synthesize(script.turns);
console.log(`  ${audio.durationSeconds}초 분량 · ${(audio.wav.length / 1e6).toFixed(1)}MB · 합성 ${((Date.now() - ttsStarted) / 1000).toFixed(1)}초`);
await writeFile("podcast-preview.wav", audio.wav);
console.log("\n결과: podcast-preview.json / podcast-preview.wav");
