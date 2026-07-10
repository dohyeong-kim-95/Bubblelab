import './styles/main.css';
import { router } from './router.js';
import { initAuth } from './firebase.js';
import { HomeView } from './views/HomeView.js';
import { LobbyView } from './views/LobbyView.js';
import { GameView } from './views/GameView.js';
import { ResultView } from './views/ResultView.js';

// 전역 상태
export const appState = {
  playerId: null,
  playerName: null,
  roomCode: null,
};

async function init() {
  try {
    appState.playerId = await initAuth();
  } catch (error) {
    console.error('Firebase 인증 실패:', error);
    document.getElementById('app').innerHTML = `
      <div class="view flex-center">
        <p>서버 연결에 실패했습니다. 페이지를 새로고침해 주세요.</p>
      </div>
    `;
    return;
  }

  // 로컬 스토리지에서 닉네임 복원
  const savedName = localStorage.getItem('avalon_playerName');
  if (savedName) {
    appState.playerName = savedName;
  }

  // 라우트 등록
  router.addRoute('/', () => new HomeView());
  router.addRoute('/lobby', (roomCode) => new LobbyView(roomCode));
  router.addRoute('/game', (roomCode) => new GameView(roomCode));
  router.addRoute('/result', (roomCode) => new ResultView(roomCode));

  router.start();
}

init();
