#!/usr/bin/env node
// 팟캐스트 운영 셋업용 일회성 CLI. 생성 품질 확인은 집 PC 생성기의
// `--preview` 로 한다(_src/podcast-worker/README.md).
//
//   node _infra/podcast-pipeline.mjs --gen-vapid   # 푸시용 VAPID 키쌍 생성
import { generateVapidKeys } from "./webpush.js";

if (!process.argv.includes("--gen-vapid")) {
  console.error("사용법: node _infra/podcast-pipeline.mjs --gen-vapid");
  process.exit(1);
}
const keys = await generateVapidKeys();
console.log("wrangler.jsonc vars   → VAPID_PUBLIC_KEY:", keys.publicKey);
console.log("worker secret         → VAPID_PRIVATE_KEY:", keys.privateKey);
console.log("worker secret(선택)   → VAPID_SUBJECT: mailto:you@example.com");
