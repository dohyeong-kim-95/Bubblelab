// 음원. 기기에서 고른 파일 하나를 곡에 붙여 두고 줄마다 그 구간만 반복 재생한다.
// 외부 호스트는 CSP 가 전부 막고 있어(유튜브·스트리밍 임베드 불가) 이 방법뿐이고,
// 그래서 소리도 그 기기 밖으로 나가지 않는다.
//
// mp4 같은 영상 파일도 받는다 — 소리만 뽑아 담는다(아래 prepare).
//
// **왜 Blob 이 아니라 data: 문자열로 담나** — life/backup 의 내보내기가 JSON 이라
// Blob 은 `{}` 로 굳어 조용히 사라진다. 서재 표지와 같은 방식(data: 문자열)으로
// 담아야 백업 파일에 그대로 실리고, PC 로 보내는 쪽은 큰 data: 를 알아서 뺀다.

const DB_NAME = "bl_espanol_audio";
const STORE = "clips";
// 담아 두는 크기의 상한. 4~5분짜리 노래 한 곡이 mp3 로 보통 4~8MB 다.
export const AUDIO_MAX_BYTES = 24 * 1024 * 1024;
// 받아 보는 크기의 상한. 뮤직비디오는 이보다 크기 쉬운데, 통째로 풀면 기기 메모리가
// 먼저 죽는다 — 그 전에 거절하고 이유를 말해 준다.
export const INPUT_MAX_BYTES = 100 * 1024 * 1024;
// 소리만 뽑을 때의 표본율. 따라 부르기용이라 22kHz 모노면 충분하고, 44kHz 스테레오로
// 두면 파일이 네 배가 된다(무압축이라 그대로 저장 용량이다).
const TARGET_RATE = 22050;

const ask = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

function openDb() {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE)) {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    }
  };
  return ask(request);
}

let dbPromise = null;
const db = () => (dbPromise ??= openDb());

async function transact(mode, run) {
  const handle = await db();
  return ask(run(handle.transaction(STORE, mode).objectStore(STORE)));
}

const readFile = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

/* ── 소리만 남기기 ────────────────────────────────────────────────────────
 * mp4(뮤직비디오)를 넣어도 되게 한다. 브라우저는 영상 트랙을 무시하고 소리만
 * 재생하므로 **재생에는 변환이 필요 없다** — 문제는 크기다. 영상이 붙은 파일은
 * 소리만 있는 파일의 열 배쯤 되고, 그걸 그대로 담으면 백업 파일까지 함께 커진다.
 *
 * 브라우저에는 mp3·aac 인코더가 없다(MediaRecorder 는 webm/opus 뿐이고 그것도
 * 실시간이라 4분짜리는 4분 걸린다). 그래서 풀어낸 소리를 무압축 WAV 로 다시 쓴다 —
 * 22kHz 모노면 4분에 10MB 쯤이라 뮤직비디오보다 훨씬 작다. 다만 **이미 소리만 든
 * 파일은 원본이 언제나 더 작으므로** 둘을 재 보고 작은 쪽을 담는다. */

async function decodeFile(file) {
  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const ctx = new Ctx();
  try { return await ctx.decodeAudioData(await file.arrayBuffer()); }
  finally { ctx.close(); }
}

/** 한 채널로 합치고 표본율을 낮춘다. 둘 다 OfflineAudioContext 가 해 준다. */
async function toMono(buffer, rate) {
  const frames = Math.max(1, Math.ceil(buffer.duration * rate));
  const offline = new OfflineAudioContext(1, frames, rate);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return offline.startRendering();
}

/** 16비트 PCM WAV. 헤더 44바이트 + 표본 그대로다. */
function encodeWav(buffer) {
  const samples = buffer.getChannelData(0);
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const text = (at, value) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(at + index, value.charCodeAt(index));
  };
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

const megabytes = (bytes) => `${Math.round(bytes / 1024 / 1024)}MB`;

/** 담을 것을 고른다. 원본과 "소리만" 중 작은 쪽이고, 둘 다 크면 거절한다. */
async function prepare(file) {
  const raw = { blob: file, kind: "raw" };
  // 소리만 든 파일이 상한 안에 들면 그게 최선이다 — 풀었다 다시 쓰면 커지기만 한다.
  if (file.type.startsWith("audio/") && file.size <= AUDIO_MAX_BYTES) return raw;

  let sound = null;
  try {
    sound = { blob: encodeWav(await toMono(await decodeFile(file), TARGET_RATE)), kind: "sound" };
  } catch {
    // 이 기기가 못 푸는 형식이다. 재생도 같은 코덱을 쓰므로 대개 못 듣지만,
    // 상한 안이면 원본을 담아 두고 재생 쪽 판단에 맡긴다.
  }
  const fits = [sound, raw].filter(Boolean)
    .filter((option) => option.blob.size <= AUDIO_MAX_BYTES)
    .sort((first, second) => first.blob.size - second.blob.size);
  if (!fits.length) {
    throw new Error(`${megabytes(AUDIO_MAX_BYTES)} 안에 담지 못했어요 — 소리만 있는 파일(mp3·m4a)로 넣어 주세요`);
  }
  return fits[0];
}

export async function saveClip(songId, file) {
  if (!file) throw new Error("파일을 고르지 못했어요");
  if (!/^(audio|video)\//.test(file.type)) throw new Error("소리나 영상 파일이 아니에요");
  if (file.size > INPUT_MAX_BYTES) {
    throw new Error(`${megabytes(INPUT_MAX_BYTES)} 까지만 열어 볼 수 있어요`);
  }
  const { blob, kind } = await prepare(file);
  const clip = { id: songId, name: file.name, size: blob.size, kind, data: await readFile(blob) };
  await transact("readwrite", (store) => store.put(clip));
  return clip;
}

export const loadClip = (songId) => transact("readonly", (store) => store.get(songId))
  .then((clip) => clip ?? null)
  .catch(() => null);

export const removeClip = (songId) => transact("readwrite", (store) => store.delete(songId));

export const clipIds = () => transact("readonly", (store) => store.getAllKeys()).catch(() => []);

/**
 * data: 문자열을 재생용 blob: 주소로 바꾼다. fetch 로 풀지 않는 이유는 CSP
 * connect-src 가 data: 를 막기 때문이다 — 손으로 푸는 편이 확실하다.
 */
export function clipUrl(dataUrl) {
  const [head, body] = String(dataUrl ?? "").split(",");
  if (!body) return null;
  const type = head.slice(5).replace(";base64", "") || "audio/mpeg";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type }));
}
