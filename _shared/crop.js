// 채우기(cover) 잘라내기 계산. 브라우저와 Node 양쪽에서 쓴다 —
// `_infra/wallpaper.mjs`(등록 CLI)와 `assets/item.js`(내 기기에 맞게 저장)가
// 같은 결과를 내야 해서 계산을 한 군데 둔다. DOM·Node API를 쓰지 않는다.

const ANCHORS = new Set(["center", "top", "bottom", "left", "right"]);

// 원본(width×height) 안에서 대상 비율(targetWidth:targetHeight)로 잡을 수 있는
// 가장 큰 상자. focus 는 잘려나가지 않고 남길 쪽.
export function coverCrop(width, height, targetWidth, targetHeight, focus = "center") {
  if (!ANCHORS.has(focus)) focus = "center";
  let cropWidth = width;
  let cropHeight = Math.round((width * targetHeight) / targetWidth);
  if (cropHeight > height) {
    cropHeight = height;
    cropWidth = Math.round((height * targetWidth) / targetHeight);
  }
  cropWidth = Math.min(width, Math.max(1, cropWidth));
  cropHeight = Math.min(height, Math.max(1, cropHeight));
  const spareX = width - cropWidth;
  const spareY = height - cropHeight;
  return {
    x: focus === "left" ? 0 : focus === "right" ? spareX : Math.round(spareX / 2),
    y: focus === "top" ? 0 : focus === "bottom" ? spareY : Math.round(spareY / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

// 잘라낸 상자를 대상 크기로 낼 때의 실제 출력 크기.
// **확대는 하지 않는다** — 원본이 작으면 비율만 맞춘 원본 해상도로 낸다.
export function outputSize(crop, targetWidth, targetHeight) {
  const scale = Math.min(1, targetWidth / crop.width, targetHeight / crop.height);
  if (scale >= 1) return { width: crop.width, height: crop.height, upscaled: false };
  return { width: targetWidth, height: targetHeight, upscaled: false };
}
