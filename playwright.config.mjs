// 모바일 스모크 테스트 설정. 이 리포는 방문의 대부분이 휴대폰이고 토이가
// 바닐라 HTML이라, 화면이 깨지는 방식도 대개 같다 — 스크립트 예외로 화면이 통째로
// 비거나, 가로로 넘쳐 옆으로 밀리거나, 상단 진입 요소가 사라지거나.
// 그 세 가지만 핵심 화면에서 확인한다(기능 테스트는 _infra의 단위 테스트가 한다).
import { defineConfig, devices } from "@playwright/test";

const PORT = 8788;

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
  },
  projects: [
    {
      name: "mobile",
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
  ],
  // dist/ 가 있어야 한다 — 없으면 node _infra/build.mjs 를 먼저 돌린다.
  webServer: {
    command: `node _infra/e2e/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
