// "이 장면 공유하기": 지금 찻집 화면을 픽셀 그대로 키운 그림 + 한 줄 + 주소로 공유한다.
// 공유 시트가 있으면(모바일) 그림까지, 없으면 글과 주소만, 그것도 없으면 그림을 내려받는다.

const SCALE = 6;   // 160×120 → 960×720

function upscale(src) {
  const c = document.createElement('canvas');
  c.width = src.width * SCALE;
  c.height = src.height * SCALE;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

const toBlob = (c) => new Promise((res) => c.toBlob(res, 'image/png'));

/** @returns {Promise<'shared'|'text'|'downloaded'|'cancelled'>} */
export async function shareScene(sceneCanvas, text) {
  const url = location.href.split('#')[0];
  const blob = await toBlob(upscale(sceneCanvas));
  const file = blob ? new File([blob], 'teahouse.png', { type: 'image/png' }) : null;
  try {
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: `${text}\n${url}` });
      return 'shared';
    }
    if (navigator.share) {
      await navigator.share({ text, url });
      return 'text';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  if (blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'teahouse.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  return 'downloaded';
}
