import { defineConfig } from 'vite';

export default defineConfig({
  // games.bubblelab.dev/avalon/ 로 배포된다. 예전에는 여기가 GitHub Pages
  // 시절의 '/ResistanceAvalon/'이고 rebuild.sh만 --base로 덮어써서, CI가
  // 검사하는 빌드와 실제 운영 산출물의 설정이 서로 달랐다. 한 곳으로 모은다.
  base: '/avalon/',
  build: {
    outDir: 'dist',
  },
});
