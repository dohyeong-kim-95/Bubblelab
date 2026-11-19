// 앱으로 설치하기 (PWA).
//
// 플랫폼마다 설치 방법이 달라서 버튼 하나로 모은다:
//   안드로이드·데스크톱 크롬 → beforeinstallprompt 를 붙잡아 두었다가 버튼을 누르면 띄운다
//   아이폰·아이패드 사파리   → 자동 설치 창이 없다 → "공유 → 홈 화면에 추가" 안내를 보여 준다
//   이미 앱으로 실행 중       → 버튼을 숨긴다
// 조르지 않는다: 버튼은 타이틀과 엔딩에만 있고, 팝업을 먼저 띄우지 않는다.

const standalone = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function setupInstall({ toast }) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 지원만 빠질 뿐 게임은 된다 */ });
  }

  const buttons = [...document.querySelectorAll('[data-install]')];
  const sheet = document.querySelector('#ios-install');
  let deferred = null;

  const paint = () => {
    const can = !standalone() && (deferred || isIOS());
    for (const b of buttons) b.hidden = !can;
  };

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();          // 브라우저 기본 배너 대신 우리 버튼으로
    deferred = e;
    paint();
  });

  addEventListener('appinstalled', () => {
    deferred = null;
    paint();
    toast('🍵 홈 화면에 찻집이 생겼어요. 다음 밤엔 거기서 열어 주세요.');
  });

  for (const b of buttons) {
    b.addEventListener('click', async () => {
      if (deferred) {
        deferred.prompt();
        await deferred.userChoice.catch(() => null);
        deferred = null;
        paint();
      } else if (isIOS()) {
        sheet.hidden = false;
      }
    });
  }
  sheet?.querySelector('button')?.addEventListener('click', () => { sheet.hidden = true; });
  sheet?.addEventListener('click', (e) => { if (e.target === sheet) sheet.hidden = true; });

  document.documentElement.classList.toggle('standalone', standalone());
  paint();
}
