// 모바일 스모크 테스트 설정. 이 리포는 방문의 대부분이 휴대폰이고 토이가
// 바닐라 HTML이라, 화면이 깨지는 방식도 대개 같다 — 스크립트 예외로 화면이 통째로
// 비거나, 가로로 넘쳐 옆으로 밀리거나, 상단 진입 요소가 사라지거나.
// 그 세 가지만 핵심 화면에서 확인한다(기능 테스트는 _infra의 단위 테스트가 한다).
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = 8788;

const WEBKIT_LIBS = new URL("./.cache/webkit-libs/root/usr/lib/x86_64-linux-gnu", import.meta.url).pathname;
// Playwright 는 브라우저를 띄우기 전에 러너 프로세스의 환경으로 라이브러리를 검사하므로 러너(와
// 물려받는 워커)의 LD_LIBRARY_PATH 에 붙인다. 그런데 WebKit 실행 래퍼(minibrowser-wpe/MiniBrowser)는
// LD_LIBRARY_PATH 를 자기 경로로 덮어써서, 실제 실행에는 LD_PRELOAD 로 직접 올린다
// (의존 순서대로 — libavif 가 libgav1·libyuv 를 찾는다). 내려받은 브라우저 파일은 건드리지 않는다.
if (process.env.PLAYWRIGHT_IOS && existsSync(`${WEBKIT_LIBS}/libavif.so.16`)
  && !(process.env.LD_LIBRARY_PATH ?? "").includes(WEBKIT_LIBS)) {
  process.env.LD_LIBRARY_PATH = [WEBKIT_LIBS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
  process.env.LD_PRELOAD = [
    ...["libgav1.so.1", "libyuv.so.0", "libavif.so.16"].map((lib) => `${WEBKIT_LIBS}/${lib}`),
    process.env.LD_PRELOAD,
  ].filter(Boolean).join(":");
}

export default defineConfig({
  testDir: "./_infra/e2e",
  testMatch: /.*\.spec\.mjs/,
  // 산출물은 반드시 배포 제외 경로(_ 시작)에 둔다 — 리포 루트에 폴더가 생기면
  // 빌드가 그걸 새 서브도메인으로 보고 "랜딩에 카드가 없다"며 실패한다.
  outputDir: "./_infra/e2e/.results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    // GitHub's Ubuntu image already includes Chrome and its system libraries.
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  projects: [
    {
      name: "mobile",
      testIgnore: /sktest-workbook\.spec\.mjs/,
      use: {
        ...devices["Pixel 5"],
        // CI는 `playwright install chromium`으로 맞는 빌드를 받는다. 로컬·컨테이너에
        // 이미 크로미움이 있으면 PLAYWRIGHT_CHROMIUM_PATH로 그걸 쓰게 해서
        // 브라우저를 또 내려받지 않는다.
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
          : {}),
      },
    },
    {
      name: "desktop",
      testMatch: /sktest-workbook\.spec\.mjs/,
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
          : {}),
      },
    },
    // 아이폰(WebKit) — iOS 브라우저는 전부 WebKit 이다. CI 는 브라우저를 내려받지 않으므로
    // 로컬에서만 켠다: PLAYWRIGHT_IOS=1 npx playwright test --project=iphone
    // libavif16 이 시스템에 없으면 scripts/webkit-libs.sh 가 sudo 없이 .cache/ 에 풀어 둔다.
    ...(process.env.PLAYWRIGHT_IOS ? [{
      name: "iphone",
      testMatch: /yaksok\.spec\.mjs/,
      use: {
        ...devices["iPhone 13"],
      },
    }] : []),
  ],
  // dist/ 가 있어야 한다 — 없으면 node _infra/build.mjs 를 먼저 돌린다.
  webServer: {
    command: `node _infra/e2e/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
