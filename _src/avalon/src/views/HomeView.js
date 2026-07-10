import { router } from '../router.js';
import { appState } from '../main.js';
import { RoomService } from '../services/RoomService.js';
import '../styles/home.css';

export class HomeView {
  constructor() {
    this.container = document.getElementById('app');
  }

  render() {
    this.container.innerHTML = `
      <div class="view home-view fade-in">
        <div class="home-hero">
          <div class="home-emblem">
            <svg viewBox="0 0 100 120" class="emblem-svg">
              <polygon points="50,5 95,30 95,90 50,115 5,90 5,30" fill="none" stroke="var(--color-gold)" stroke-width="2"/>
              <polygon points="50,15 85,35 85,85 50,105 15,85 15,35" fill="var(--color-bg-card)" stroke="var(--color-gold)" stroke-width="1" opacity="0.5"/>
              <text x="50" y="55" text-anchor="middle" fill="var(--color-gold)" font-size="20" font-weight="bold">A</text>
              <text x="50" y="75" text-anchor="middle" fill="var(--color-text-secondary)" font-size="8">AVALON</text>
            </svg>
          </div>
          <h1 class="home-title">The Resistance: Avalon</h1>
          <p class="home-subtitle">사회자 없이 플레이하는 아발론</p>
        </div>

        <div class="home-actions">
          <button class="btn btn-primary btn-full" id="btn-create">
            방 만들기
          </button>
          <button class="btn btn-outline btn-full" id="btn-join">
            방 참가하기
          </button>
        </div>

        <div class="home-info">
          <p>5~10명 | 약 30~45분</p>
        </div>

        <!-- 방 만들기 모달 -->
        <div class="modal-overlay" id="modal-create" style="display:none">
          <div class="modal">
            <h2 class="modal-title">방 만들기</h2>
            <div class="flex-col gap-md">
              <div>
                <label class="input-label">닉네임</label>
                <input class="input" id="input-create-name" type="text"
                  placeholder="닉네임 입력 (1~8자)" maxlength="8" autocomplete="off" />
              </div>
              <button class="btn btn-primary btn-full" id="btn-create-confirm">방 생성</button>
              <button class="btn btn-outline btn-full" id="btn-create-cancel">취소</button>
            </div>
          </div>
        </div>

        <!-- 방 참가 모달 -->
        <div class="modal-overlay" id="modal-join" style="display:none">
          <div class="modal">
            <h2 class="modal-title">방 참가하기</h2>
            <div class="flex-col gap-md">
              <div>
                <label class="input-label">방 코드</label>
                <input class="input room-code-input" id="input-room-code" type="text"
                  placeholder="6자리 코드 입력" maxlength="6" autocomplete="off"
                  style="text-transform: uppercase; letter-spacing: 0.2em; text-align: center;" />
              </div>
              <div>
                <label class="input-label">닉네임</label>
                <input class="input" id="input-join-name" type="text"
                  placeholder="닉네임 입력 (1~8자)" maxlength="8" autocomplete="off" />
              </div>
              <button class="btn btn-primary btn-full" id="btn-join-confirm">참가</button>
              <button class="btn btn-outline btn-full" id="btn-join-cancel">취소</button>
            </div>
          </div>
        </div>

        <!-- 에러 토스트 -->
        <div class="toast" id="toast" style="display:none">
          <span id="toast-message"></span>
        </div>
      </div>
    `;

    this.bindEvents();
    this.restoreName();
  }

  restoreName() {
    const savedName = appState.playerName || '';
    const createInput = document.getElementById('input-create-name');
    const joinInput = document.getElementById('input-join-name');
    if (createInput) createInput.value = savedName;
    if (joinInput) joinInput.value = savedName;
  }

  bindEvents() {
    // 방 만들기 모달
    document.getElementById('btn-create').addEventListener('click', () => {
      document.getElementById('modal-create').style.display = 'flex';
      document.getElementById('input-create-name').focus();
    });

    document.getElementById('btn-create-cancel').addEventListener('click', () => {
      document.getElementById('modal-create').style.display = 'none';
    });

    document.getElementById('btn-create-confirm').addEventListener('click', () => this.handleCreate());
    document.getElementById('input-create-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleCreate();
    });

    // 방 참가 모달
    document.getElementById('btn-join').addEventListener('click', () => {
      document.getElementById('modal-join').style.display = 'flex';
      document.getElementById('input-room-code').focus();
    });

    document.getElementById('btn-join-cancel').addEventListener('click', () => {
      document.getElementById('modal-join').style.display = 'none';
    });

    document.getElementById('btn-join-confirm').addEventListener('click', () => this.handleJoin());
    document.getElementById('input-join-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleJoin();
    });

    // 모달 외부 클릭으로 닫기
    document.getElementById('modal-create').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
      }
    });

    document.getElementById('modal-join').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
      }
    });

    // 방 코드 자동 대문자
    document.getElementById('input-room-code').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
    });
  }

  validateName(name) {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 1 || trimmed.length > 8) {
      this.showToast('닉네임은 1~8자로 입력해 주세요.');
      return null;
    }
    return trimmed;
  }

  async handleCreate() {
    const nameInput = document.getElementById('input-create-name');
    const name = this.validateName(nameInput.value);
    if (!name) return;

    const btn = document.getElementById('btn-create-confirm');
    btn.disabled = true;
    btn.textContent = '생성 중...';

    try {
      appState.playerName = name;
      localStorage.setItem('avalon_playerName', name);

      const roomCode = await RoomService.createRoom(appState.playerId, name);
      appState.roomCode = roomCode;
      router.navigate('/lobby/' + roomCode);
    } catch (error) {
      console.error('방 생성 실패:', error);
      this.showToast('방 생성에 실패했습니다. 다시 시도해 주세요.');
      btn.disabled = false;
      btn.textContent = '방 생성';
    }
  }

  async handleJoin() {
    const codeInput = document.getElementById('input-room-code');
    const nameInput = document.getElementById('input-join-name');

    const roomCode = codeInput.value.trim().toUpperCase();
    if (!roomCode || roomCode.length !== 6) {
      this.showToast('6자리 방 코드를 입력해 주세요.');
      return;
    }

    const name = this.validateName(nameInput.value);
    if (!name) return;

    const btn = document.getElementById('btn-join-confirm');
    btn.disabled = true;
    btn.textContent = '참가 중...';

    try {
      appState.playerName = name;
      localStorage.setItem('avalon_playerName', name);

      await RoomService.joinRoom(roomCode, appState.playerId, name);
      appState.roomCode = roomCode;
      router.navigate('/lobby/' + roomCode);
    } catch (error) {
      console.error('방 참가 실패:', error);
      this.showToast(error.message || '방 참가에 실패했습니다.');
      btn.disabled = false;
      btn.textContent = '참가';
    }
  }

  showToast(message) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');
    toastMsg.textContent = message;
    toast.style.display = 'flex';
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
  }

  destroy() {}
}
