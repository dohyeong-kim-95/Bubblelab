// 의존성 없는 최소 GIF89a 인코더 (LZW 자체 구현).
// APNG는 첫 프레임이 평범한 PNG라, 공유 과정에서 재인코딩되면 애니메이션이
// 날아가고 정지 이미지만 남는다. 메신저·SNS에 실제로 전달되는 형식은 GIF다.
// 카카오 제안 규격도 "흰 배경 애니메이션 GIF"라 납품에도 이 경로가 필요하다.
//
// 한계(의도한 것): GIF는 색 256개와 1비트 투명만 지원한다. 반투명 경계는
// 배경색(기본 흰색)에 합성한다 — 카카오 제안이 흰 배경을 요구하므로 맞다.

const MAX_COLORS = 256;

// RGBA 프레임을 배경색에 합성해 RGB로 (알파 임계값 아래는 투명 인덱스)
function flatten(frame, background, alphaThreshold) {
  const { width, height, data } = frame;
  const rgb = new Uint8Array(width * height * 3);
  const transparent = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const a = data[i + 3] / 255;
    if (data[i + 3] < alphaThreshold) {
      transparent[p] = 1;
      rgb[p * 3] = background[0];
      rgb[p * 3 + 1] = background[1];
      rgb[p * 3 + 2] = background[2];
      continue;
    }
    for (let c = 0; c < 3; c++) {
      rgb[p * 3 + c] = Math.round(data[i + c] * a + background[c] * (1 - a));
    }
  }
  return { rgb, transparent };
}

// 중앙값 분할(median cut) 색 양자화. 캐릭터 아트는 색 수가 적어 대개
// 분할 없이 원색이 그대로 들어간다.
function quantize(samples, limit) {
  const unique = new Map();
  for (let i = 0; i < samples.length; i += 3) {
    const key = (samples[i] << 16) | (samples[i + 1] << 8) | samples[i + 2];
    unique.set(key, (unique.get(key) ?? 0) + 1);
  }
  if (unique.size <= limit) {
    return [...unique.keys()].map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
  }
  let boxes = [[...unique.keys()].map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255])];
  while (boxes.length < limit) {
    // 가장 넓은 채널 범위를 가진 상자를 그 채널의 중앙값에서 쪼갠다
    let target = -1;
    let targetChannel = 0;
    let widest = -1;
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let min = 255, max = 0;
        for (const color of box) { if (color[c] < min) min = color[c]; if (color[c] > max) max = color[c]; }
        if (max - min > widest) { widest = max - min; target = index; targetChannel = c; }
      }
    });
    if (target < 0) break;
    const box = boxes[target].sort((a, b) => a[targetChannel] - b[targetChannel]);
    const mid = box.length >> 1;
    boxes.splice(target, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.filter((b) => b.length).map((box) => {
    const sum = box.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]], [0, 0, 0]);
    return sum.map((v) => Math.round(v / box.length));
  });
}

function nearestIndex(palette, r, g, b) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const dr = palette[i][0] - r, dg = palette[i][1] - g, db = palette[i][2] - b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) { bestDistance = distance; best = i; }
  }
  return best;
}

// GIF 가변 길이 LZW 압축
function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dictionary = new Map();
  const resetDictionary = () => {
    dictionary = new Map();
    nextCode = endCode + 1;
    codeSize = minCodeSize + 1;
  };

  const out = [];
  let bitBuffer = 0;
  let bitCount = 0;
  const emit = (code) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  emit(clearCode);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    if (dictionary.has(key)) { prefix = dictionary.get(key); continue; }
    emit(prefix);
    dictionary.set(key, nextCode++);
    if (nextCode > (1 << codeSize)) {
      if (codeSize < 12) codeSize++;
      else { emit(clearCode); resetDictionary(); }
    }
    prefix = k;
  }
  emit(prefix);
  emit(endCode);
  if (bitCount > 0) out.push(bitBuffer & 0xff);
  return out;
}

function subBlocks(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

// frames: [{width,height,data(RGBA)}] — 전부 같은 크기.
// delaysMs: 프레임별 지속시간(ms). loops 0 = 무한 반복.
export function encodeGif(frames, { fps = 12, delaysMs = null, loops = 0, background = [255, 255, 255], alphaThreshold = 128 } = {}) {
  if (!frames?.length) throw new Error("encodeGif: 프레임이 없습니다");
  if (delaysMs && delaysMs.length !== frames.length) {
    throw new Error(`encodeGif: delaysMs 길이(${delaysMs.length})가 프레임 수(${frames.length})와 다릅니다`);
  }
  const { width, height } = frames[0];
  for (const [i, f] of frames.entries()) {
    if (f.width !== width || f.height !== height) {
      throw new Error(`encodeGif: ${i + 1}번째 프레임 크기가 다릅니다 (${f.width}x${f.height} ≠ ${width}x${height})`);
    }
  }

  const flattened = frames.map((f) => flatten(f, background, alphaThreshold));
  const hasTransparency = flattened.some((f) => f.transparent.some((t) => t));
  // 투명 인덱스 한 칸을 남겨둔다
  const palette = quantize(
    Uint8Array.from(flattened.flatMap((f) => [...f.rgb])),
    hasTransparency ? MAX_COLORS - 1 : MAX_COLORS,
  );
  const transparentIndex = hasTransparency ? palette.length : -1;
  const fullPalette = [...palette];
  if (hasTransparency) fullPalette.push(background);

  let bits = 1;
  while ((1 << bits) < fullPalette.length) bits++;
  const paletteSize = 1 << bits;

  const bytes = [];
  const push = (...values) => bytes.push(...values);
  const pushShort = (v) => bytes.push(v & 0xff, (v >> 8) & 0xff);

  // 헤더 + 논리 화면 기술자 (전역 색표 사용)
  push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // GIF89a
  pushShort(width);
  pushShort(height);
  push(0x80 | (bits - 1), 0, 0);            // 전역 색표 있음, 해상도/정렬 기본
  for (let i = 0; i < paletteSize; i++) {
    const color = fullPalette[i] ?? [0, 0, 0];
    push(color[0], color[1], color[2]);
  }

  // NETSCAPE2.0 반복 확장
  push(0x21, 0xff, 0x0b);
  push(...[..."NETSCAPE2.0"].map((c) => c.charCodeAt(0)));
  push(0x03, 0x01);
  pushShort(loops);
  push(0x00);

  const minCodeSize = Math.max(2, bits);
  flattened.forEach((frame, index) => {
    const delayMs = delaysMs ? delaysMs[index] : 1000 / fps;
    // GIF 지속시간 단위는 1/100초. 0은 뷰어마다 제각각이라 최소 1로 올린다.
    const delay = Math.max(1, Math.round(delayMs / 10));
    push(0x21, 0xf9, 0x04);
    // dispose 2(배경 복원) + 투명 플래그
    push((2 << 2) | (transparentIndex >= 0 ? 1 : 0));
    pushShort(delay);
    push(transparentIndex >= 0 ? transparentIndex : 0, 0x00);

    push(0x2c);                              // 이미지 기술자
    pushShort(0); pushShort(0);
    pushShort(width); pushShort(height);
    push(0x00);                              // 지역 색표 없음

    const indices = new Uint8Array(width * height);
    const cache = new Map();
    for (let p = 0; p < indices.length; p++) {
      if (frame.transparent[p] && transparentIndex >= 0) { indices[p] = transparentIndex; continue; }
      const r = frame.rgb[p * 3], g = frame.rgb[p * 3 + 1], b = frame.rgb[p * 3 + 2];
      const key = (r << 16) | (g << 8) | b;
      let value = cache.get(key);
      if (value === undefined) { value = nearestIndex(palette, r, g, b); cache.set(key, value); }
      indices[p] = value;
    }
    push(minCodeSize);
    push(...subBlocks(lzwEncode(indices, minCodeSize)));
  });

  push(0x3b);                                // 트레일러
  return Buffer.from(bytes);
}

// 검증용 최소 파서: 크기·프레임 수·지속시간·반복 수를 읽는다.
export function inspectGif(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.toString("latin1", 0, 6) !== "GIF89a") throw new Error("GIF89a가 아닙니다");
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const flags = buf[10];
  let pos = 13;
  if (flags & 0x80) pos += 3 * (1 << ((flags & 0x07) + 1));
  let frames = 0;
  let loops = null;
  const delays = [];
  while (pos < buf.length) {
    const block = buf[pos];
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = buf[pos + 1];
      if (label === 0xf9) delays.push(buf.readUInt16LE(pos + 4) / 100);
      if (label === 0xff && buf.toString("latin1", pos + 3, pos + 14) === "NETSCAPE2.0") {
        loops = buf.readUInt16LE(pos + 17);
      }
      pos += 2;
      while (buf[pos]) pos += buf[pos] + 1;   // 서브블록 건너뛰기
      pos++;
    } else if (block === 0x2c) {
      frames++;
      const local = buf[pos + 9];
      pos += 10;
      if (local & 0x80) pos += 3 * (1 << ((local & 0x07) + 1));
      pos++;                                   // LZW 최소 코드 크기
      while (buf[pos]) pos += buf[pos] + 1;
      pos++;
    } else break;
  }
  return { width, height, frames, loops, delays, animated: frames > 1 };
}
