// 의존성 없는 최소 APNG 인코더 (Node 내장 zlib + _infra/png.mjs 헬퍼).
// _infra/emoticon.mjs가 움직이는 이모티콘 프레임을 APNG로 묶을 때 쓴다.
// APNG는 브라우저 <img>에서 네이티브 재생되고 LINE 애니메이션 스티커
// 규격이기도 하다. 모든 프레임은 같은 크기의 전체 캔버스 RGBA로 받아
// blend=source, dispose=none(전체 교체)으로 기록한다 — 부분 프레임
// 최적화는 하지 않는다 (용량은 프레임 수·팔레트 축소로 잡는 게 규격상 정석).
import { deflateSync } from "node:zlib";
import { chunk, crc32 } from "./png.mjs";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// RGBA 프레임 → Paeth 필터 + deflate 압축된 스캔라인 (IDAT/fdAT 본문)
function compressFrame({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 4; // Paeth — 애니메이션 프레임에 무난하게 최적
    const out = y * (stride + 1) + 1;
    const cur = y * stride;
    const prev = cur - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? data[cur + x - 4] : 0;
      const b = y > 0 ? data[prev + x] : 0;
      const c = y > 0 && x >= 4 ? data[prev + x - 4] : 0;
      raw[out + x] = (data[cur + x] - paeth(a, b, c)) & 0xff;
    }
  }
  return deflateSync(raw, { level: 9 });
}

// frames: [{ width, height, data(RGBA) }, ...] 전부 같은 크기여야 한다.
// fps → 프레임당 delay(1/1000초 단위). loops 0 = 무한 반복.
export function encodeApng(frames, { fps = 12, loops = 0 } = {}) {
  if (!frames?.length) throw new Error("encodeApng: 프레임이 없습니다");
  const { width, height } = frames[0];
  for (const [i, f] of frames.entries()) {
    if (f.width !== width || f.height !== height) {
      throw new Error(`encodeApng: ${i + 1}번째 프레임 크기가 다릅니다 (${f.width}x${f.height} ≠ ${width}x${height})`);
    }
    if (f.data.length !== width * height * 4) throw new Error("encodeApng: RGBA 데이터 길이 불일치");
  }
  const delayNum = Math.max(1, Math.round(1000 / fps));

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA — 프레임마다 알파 유무가 달라도 안전하게 고정

  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0);
  actl.writeUInt32BE(loops, 4);

  let seq = 0;
  const fctl = () => {
    const buf = Buffer.alloc(26);
    buf.writeUInt32BE(seq++, 0);
    buf.writeUInt32BE(width, 4);
    buf.writeUInt32BE(height, 8);
    // x/y offset 0, delay num/den, dispose 0(none), blend 0(source)
    buf.writeUInt16BE(delayNum, 20);
    buf.writeUInt16BE(1000, 22);
    return buf;
  };

  const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("acTL", actl)];
  frames.forEach((frame, i) => {
    parts.push(chunk("fcTL", fctl()));
    const compressed = compressFrame(frame);
    if (i === 0) parts.push(chunk("IDAT", compressed));
    else {
      const fdat = Buffer.alloc(4 + compressed.length);
      fdat.writeUInt32BE(seq++, 0);
      compressed.copy(fdat, 4);
      parts.push(chunk("fdAT", fdat));
    }
  });
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// 검증용 최소 파서: 프레임 수·크기·delay만 읽는다 (픽셀 디코드는 안 함 —
// 첫 프레임은 일반 PNG 디코더(decodePng)로 읽힌다).
export function inspectApng(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!SIGNATURE.every((b, i) => buf[i] === b)) throw new Error("PNG 파일이 아닙니다");
  let width = 0, height = 0, frames = 0, loops = 0, delays = [];
  for (let pos = 8; pos + 12 <= buf.length; ) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    const expected = crc32(buf.subarray(pos + 4, pos + 8), data);
    if (buf.readUInt32BE(pos + 8 + length) !== expected) throw new Error(`손상된 청크: ${type} (CRC 불일치)`);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    else if (type === "acTL") { frames = data.readUInt32BE(0); loops = data.readUInt32BE(4); }
    else if (type === "fcTL") delays.push(data.readUInt16BE(20) / data.readUInt16BE(22));
    else if (type === "IEND") break;
    pos += 12 + length;
  }
  return { width, height, frames, loops, delays, animated: frames > 0 };
}
