// 의존성 없는 최소 PNG 코덱 (Node 내장 zlib만 사용).
// _infra/sticker-pack.mjs가 스티커 시트를 자르고 저장할 때 쓴다.
// 지원 범위: 8-bit 비인터레이스 PNG (그레이·RGB·팔레트·알파 포함) — AI 생성
// 이미지와 일반 업로드 이미지는 전부 여기에 들어온다. 그 밖의 형식은
// 명확한 에러를 던져서 호출자가 원본을 PNG로 다시 저장하게 안내한다.
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]);

// PNG 청크 무결성용 CRC32 (zlib.crc32는 Node 20.15+라 직접 구현이 더 안전)
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(...buffers) {
  let c = 0xffffffff;
  for (const buf of buffers) {
    for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// PNG 바이트 → { width, height, data(RGBA Uint8Array) }
export function decodePng(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length < 8 + 25 || !SIGNATURE.every((byte, i) => buf[i] === byte)) {
    throw new Error("PNG 파일이 아닙니다 — 원본을 PNG로 저장한 뒤 다시 시도하세요");
  }

  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];
  for (let pos = 8; pos + 12 <= buf.length; ) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    if (pos + 12 + length > buf.length) throw new Error(`손상된 PNG: ${type} 청크가 잘렸습니다`);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "tRNS") trns = Buffer.from(data);
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + length;
  }

  if (!ihdr || !idat.length) throw new Error("손상된 PNG: IHDR 또는 IDAT가 없습니다");
  const { width, height, bitDepth, colorType, compression, filter, interlace } = ihdr;
  if (!width || !height || width > 16384 || height > 16384) {
    throw new Error(`지원하지 않는 PNG 크기: ${width}x${height}`);
  }
  if (bitDepth !== 8) throw new Error(`8-bit PNG만 지원합니다 (현재 ${bitDepth}-bit)`);
  if (interlace !== 0) throw new Error("인터레이스 PNG는 지원하지 않습니다");
  if (compression !== 0 || filter !== 0) throw new Error("지원하지 않는 PNG 압축/필터 방식입니다");
  const channels = CHANNELS.get(colorType);
  if (!channels) throw new Error(`지원하지 않는 PNG color type: ${colorType}`);
  if (colorType === 3 && !palette) throw new Error("팔레트 PNG에 PLTE 청크가 없습니다");

  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw new Error("손상된 PNG: 픽셀 데이터 길이 불일치");

  // 스캔라인 필터 복원 (None/Sub/Up/Average/Paeth)
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    const prev = out - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[out + x - channels] : 0;
      const b = y > 0 ? pixels[prev + x] : 0;
      const c = y > 0 && x >= channels ? pixels[prev + x - channels] : 0;
      let value = row[x];
      if (filterType === 1) value += a;
      else if (filterType === 2) value += b;
      else if (filterType === 3) value += (a + b) >> 1;
      else if (filterType === 4) value += paeth(a, b, c);
      else if (filterType !== 0) throw new Error(`지원하지 않는 스캔라인 필터: ${filterType}`);
      pixels[out + x] = value & 0xff;
    }
  }

  // 모든 color type을 RGBA로 통일
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const src = i * channels;
    const dst = i * 4;
    if (colorType === 0) {
      rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = pixels[src];
      rgba[dst + 3] = 255;
    } else if (colorType === 2) {
      rgba[dst] = pixels[src];
      rgba[dst + 1] = pixels[src + 1];
      rgba[dst + 2] = pixels[src + 2];
      rgba[dst + 3] = 255;
    } else if (colorType === 3) {
      const index = pixels[src];
      if (index * 3 + 2 >= palette.length) throw new Error("손상된 PNG: 팔레트 범위를 벗어난 색인");
      rgba[dst] = palette[index * 3];
      rgba[dst + 1] = palette[index * 3 + 1];
      rgba[dst + 2] = palette[index * 3 + 2];
      rgba[dst + 3] = trns && index < trns.length ? trns[index] : 255;
    } else if (colorType === 4) {
      rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = pixels[src];
      rgba[dst + 3] = pixels[src + 1];
    } else {
      rgba[dst] = pixels[src];
      rgba[dst + 1] = pixels[src + 1];
      rgba[dst + 2] = pixels[src + 2];
      rgba[dst + 3] = pixels[src + 3];
    }
  }
  return { width, height, data: rgba };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(head.subarray(4), data), 0);
  return Buffer.concat([head, data, tail]);
}

// { width, height, data(RGBA) } → PNG 바이트.
// 완전 불투명이면 RGB로 저장해 용량을 줄인다. filterType 옵션은 디코더
// 테스트용(0–4 강제)이며 기본값 0이면 필터 없이 저장한다.
export function encodePng({ width, height, data }, { filterType = 0 } = {}) {
  if (data.length !== width * height * 4) throw new Error("encodePng: RGBA 데이터 길이 불일치");
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) { opaque = false; break; }
  }
  const channels = opaque ? 3 : 4;
  const stride = width * channels;

  const pixels = Buffer.alloc(stride * height);
  for (let i = 0; i < width * height; i++) {
    pixels[i * channels] = data[i * 4];
    pixels[i * channels + 1] = data[i * 4 + 1];
    pixels[i * channels + 2] = data[i * 4 + 2];
    if (!opaque) pixels[i * channels + 3] = data[i * 4 + 3];
  }

  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filterType;
    const out = y * (stride + 1) + 1;
    const cur = y * stride;
    const prev = cur - stride;
    for (let x = 0; x < stride; x++) {
      const value = pixels[cur + x];
      const a = x >= channels ? pixels[cur + x - channels] : 0;
      const b = y > 0 ? pixels[prev + x] : 0;
      const c = y > 0 && x >= channels ? pixels[prev + x - channels] : 0;
      let encoded = value;
      if (filterType === 1) encoded = value - a;
      else if (filterType === 2) encoded = value - b;
      else if (filterType === 3) encoded = value - ((a + b) >> 1);
      else if (filterType === 4) encoded = value - paeth(a, b, c);
      raw[out + x] = encoded & 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;                    // bit depth
  ihdr[9] = opaque ? 2 : 6;       // color type: RGB | RGBA
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
