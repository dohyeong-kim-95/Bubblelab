#!/usr/bin/env node
// 저장한 여행사 페이지로 패키지 파서를 **교정**하는 도구.
//
// 여행사 사이트는 우리 배포 밖이고 구조가 자주 바뀐다. 그래서 셀렉터를 짐작해서
// 넣지 않고, 실제 페이지를 한 장 저장해서 무엇이 잡히는지 눈으로 보고 맞춘다.
//
//   1) 브라우저에서 모두투어 몽골 검색 결과를 연다
//   2) 페이지 저장(또는 개발자도구 → Copy outerHTML) → mongolia.html
//   3) node _infra/trip-package-parse.mjs mongolia.html --source modetour
//   4) 잡힌 상품·가격이 화면과 맞는지 확인. 안 맞으면 _infra/trip-packages.js 의
//      전략을 고치고 3) 을 다시 돌린다.
//   5) 맞으면 --json 으로 뽑아 /_trip/snapshot 에 그대로 밀어 넣을 수 있다.
//
// 이 도구는 네트워크를 쓰지 않는다 — 파일만 읽는다.
import { readFileSync } from "node:fs";
import { parsePackages, PACKAGE_SOURCE_KEYS } from "./trip-packages.js";

const args = process.argv.slice(2);
// `--name=값` 과 `--name 값` 을 모두 받는다. 값이 없는 스위치는 true.
const flag = (name, fallback = null) => {
  const index = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (index === -1) return fallback;
  const hit = args[index];
  if (hit.includes("=")) return hit.split("=").slice(1).join("=");
  const next = args[index + 1];
  return next && !next.startsWith("--") ? next : true;
};
// 플래그 값으로 소비된 인자는 파일 이름 후보에서 뺀다.
const consumed = new Set();
for (const name of ["source", "destination"]) {
  const index = args.findIndex((a) => a === `--${name}`);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith("--")) consumed.add(index + 1);
}
const file = args.find((a, i) => !a.startsWith("--") && !consumed.has(i));

if (!file) {
  console.error(`사용법: node _infra/trip-package-parse.mjs <저장한페이지.html> [--source ${PACKAGE_SOURCE_KEYS.join("|")}] [--destination <id>] [--json]`);
  process.exit(1);
}

const source = String(flag("source", "modetour"));
const destinationId = String(flag("destination", "") || "");
const html = readFileSync(file, "utf8");
const { observations, strategy, warnings } = parsePackages(html, { destinationId, source });

if (flag("json")) {
  console.log(JSON.stringify({ destinationId, source, packages: observations }, null, 2));
  process.exit(observations.length ? 0 : 2);
}

const won = (n) => (Number.isFinite(n) ? `${n.toLocaleString("ko-KR")}원` : "—");
console.log(`파일      ${file} (${(html.length / 1024).toFixed(0)} KB)`);
console.log(`전략      ${strategy}`);
console.log(`상품      ${observations.length}건\n`);

for (const o of observations) {
  const span = o.nights ? `${o.nights}박${o.days ? `${o.days}일` : ""}` : "";
  console.log(`· ${o.title || "(제목 없음)"}`);
  console.log(`  표시가 ${won(o.listedPrice)}  실질가 ${won(o.effectivePrice)}${o.floor ? " (하한)" : ""}` +
    `${span ? `  ${span}` : ""}${o.airline ? `  ${o.airline}` : ""}`);
  if (o.unknownCosts.length) console.log(`  확인 필요: ${o.unknownCosts.join(", ")}`);
  if (o.url) console.log(`  ${o.url}`);
}

if (warnings.length) {
  console.log("\n경고");
  for (const w of warnings) console.log(`  - ${w}`);
}

if (!observations.length) {
  console.log("\n하나도 못 읽었습니다. 페이지에 상품이 보이는데도 0건이면:");
  console.log("  · 목록이 스크립트로 나중에 그려지는 페이지일 수 있습니다 → 렌더 후 HTML 을 저장하세요");
  console.log("    (개발자도구 Elements 에서 <html> 을 Copy outerHTML)");
  console.log("  · 그래도 없으면 _infra/trip-packages.js 에 이 사이트용 전략을 추가해야 합니다");
  process.exit(2);
}
