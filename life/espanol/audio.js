// 음원. 기기에서 고른 파일 하나를 곡에 붙여 두고 줄마다 그 구간만 반복 재생한다.
// 외부 호스트는 CSP 가 전부 막고 있어(유튜브·스트리밍 임베드 불가) 이 방법뿐이고,
// 그래서 소리도 그 기기 밖으로 나가지 않는다.
//
// **왜 Blob 이 아니라 data: 문자열로 담나** — life/backup 의 내보내기가 JSON 이라
// Blob 은 `{}` 로 굳어 조용히 사라진다. 서재 표지와 같은 방식(data: 문자열)으로
// 담아야 백업 파일에 그대로 실리고, PC 로 보내는 쪽은 큰 data: 를 알아서 뺀다.

const DB_NAME = "bl_espanol_audio";
const STORE = "clips";
// 4~5분짜리 노래 한 곡이 보통 4~8MB 다. 이보다 큰 파일은 대개 무손실 음원이라
// 브라우저 저장소를 통째로 잡아먹는다.
export const AUDIO_MAX_BYTES = 24 * 1024 * 1024;

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

export async function saveClip(songId, file) {
  if (!file) throw new Error("파일을 고르지 못했어요");
  if (!/^audio\//.test(file.type)) throw new Error("소리 파일이 아니에요");
  if (file.size > AUDIO_MAX_BYTES) {
    throw new Error(`${Math.round(AUDIO_MAX_BYTES / 1024 / 1024)}MB 까지만 넣을 수 있어요`);
  }
  const clip = { id: songId, name: file.name, size: file.size, data: await readFile(file) };
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
