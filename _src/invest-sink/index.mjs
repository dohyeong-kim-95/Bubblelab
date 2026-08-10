#!/usr/bin/env node
// invest-sink — 집 PC에서 토스 잔고를 읽어 엣지로 올린다.
//
// 왜 PC에서 도는가: 토스 Open API는 콘솔에 등록한 IP에서만 받아준다. Cloudflare
// Workers는 요청마다 다른 엣지에서 나가고 그 대역이 수천 개라 등록이 불가능하다.
// 이 PC의 IP 하나만 등록하면 되고, 덤으로 **API 키가 Cloudflare가 아니라 이 PC에만**
// 남는다.
//
// 의존성 0, Node 22+. 한 번 돌고 끝난다 — 반복은 cron/작업 스케줄러에 맡긴다.
// 자세한 설정은 같은 폴더의 README.md.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { fetchSnapshot } from "../../_infra/invest.js";

const DEFAULT_ENDPOINT = "https://invest.bubblelab.dev/_invest/snapshot";
const TOKEN_CACHE = process.env.INVEST_TOKEN_CACHE
  || join(homedir(), ".bubblelab", "invest-token.json");

function required(name) {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    console.error(`환경변수 ${name} 가 필요합니다. README.md 를 참고하세요.`);
    process.exit(2);
  }
  return value;
}

/**
 * 토큰을 파일에 캐시한다. 토스는 client당 유효 토큰이 1개라, 매번 새로 받으면
 * 다른 곳에서 쓰던 토큰이 죽는다. 24시간짜리를 재사용하는 게 맞다.
 */
function fileTokenCache(path) {
  return {
    read() {
      try {
        return JSON.parse(readFileSync(path, "utf8"));
      } catch {
        return null;
      }
    },
    write(value) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        // 토큰은 24시간짜리 자격증명이다 — 남이 읽지 못하게 0600으로 쓴다.
        writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
      } catch (error) {
        console.warn("토큰 캐시를 쓰지 못했습니다(계속 진행):", error.message);
      }
    },
  };
}

async function main() {
  const clientId = required("INVEST_CLIENT_ID");
  const clientSecret = required("INVEST_CLIENT_SECRET");
  const sinkSecret = required("INVEST_SINK_SECRET");
  const endpoint = (process.env.INVEST_ENDPOINT ?? "").trim() || DEFAULT_ENDPOINT;
  const accountSeq = process.env.INVEST_ACCOUNT_SEQ;
  // 토스 앱의 종목 그룹은 API 로 내려오지 않아 여기서 정한다. 비워 두면
  // 종목 기본정보(나라·종목유형)로 자동 분류한다.
  const groups = process.env.INVEST_GROUPS;
  // 예수금이 들어갈 그룹. 비우면 INVEST_GROUPS 의 `*` 그룹으로 간다.
  const cashGroup = process.env.INVEST_CASH_GROUP;

  const snapshot = await fetchSnapshot({
    clientId, clientSecret, accountSeq, groups, cashGroup, cache: fileTokenCache(TOKEN_CACHE),
  });

  const summary = Object.entries(snapshot.byCurrency)
    .map(([currency, b]) => `${currency} ${Math.round(b.value).toLocaleString("ko-KR")} (${(b.rate * 100).toFixed(2)}%)`)
    .join(" · ") || "보유 종목 없음";
  console.log(`${snapshot.date} 읽음: ${summary}`);

  // 예수금도 찍는다. 안 찍었더니 KRW 예수금이 화면에서 사라진 걸 한참 몰랐다.
  const cash = Object.entries(snapshot.cash)
    .map(([currency, amount]) => `${currency} ${Math.round(amount).toLocaleString("ko-KR")}`)
    .join(" · ") || "없음";
  console.log(`  예수금: ${cash}`);

  for (const [group, byCurrency] of Object.entries(snapshot.byGroup)) {
    const line = Object.entries(byCurrency)
      .map(([currency, b]) => {
        const held = `${currency} ${Math.round(b.value).toLocaleString("ko-KR")} (${(b.rate * 100).toFixed(2)}%)`;
        return b.cash ? `${held} + 예수금 ${Math.round(b.cash).toLocaleString("ko-KR")}` : held;
      })
      .join(" · ");
    console.log(`  [${group}] ${line}`);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sinkSecret}` },
    body: JSON.stringify(snapshot),
  });
  if (!response.ok) {
    console.error(`업로드 실패 (HTTP ${response.status}):`, (await response.text()).slice(0, 300));
    process.exit(1);
  }
  console.log("업로드 완료:", await response.text());
}

main().catch((error) => {
  // 토스가 IP를 거부하면 여기서 걸린다 — 이 PC의 공인 IP가 콘솔에 등록돼 있는지 본다.
  console.error("실패:", error.message);
  if (error.body) console.error("토스 응답 원문:", error.body);
  process.exit(1);
});
