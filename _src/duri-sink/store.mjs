// Duri 싱크의 복호화 + 로컬 저장 계층 (WebSocket·설정과 분리해 테스트 가능하게).
// 서버 항목(암호블롭)을 받아 공유 패스프레이즈로 복호화하고 DuriStorage/ 에 쓴다.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const enc = new TextEncoder();
const dec = new TextDecoder();

// 클라이언트(웹앱)와 반드시 동일해야 하는 파라미터.
export const SALT = enc.encode("duri:v1:pbkdf2:shared-passphrase");
export const ITER = 210_000;

const unb64 = (s) => Uint8Array.from(Buffer.from(s, "base64"));
const sha256hex = async (bytes) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");

export async function deriveKey(passphrase) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: SALT, iterations: ITER, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
  );
}

export function atomicWrite(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path); // 같은 파일시스템에서 원자적 교체
}

const monthOf = (at) => new Date(at).toISOString().slice(0, 7);
const stampOf = (at) => new Date(at).toISOString().slice(0, 19).replace(/:/g, "-");
const safeExt = (name) => {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name || "");
  return m ? "." + m[1].toLowerCase() : ".jpg";
};

// metadata.json 에서 재생성되는 사람용 대화록 (View — 정본 아님)
export function renderMarkdown(month, logs) {
  let out = `# ${month}\n`;
  let day = "";
  for (const l of logs) {
    const d = new Date(l.at);
    const dayKey = d.toISOString().slice(0, 10);
    if (dayKey !== day) { day = dayKey; out += `\n## ${dayKey}\n`; }
    const hm = d.toISOString().slice(11, 16);
    if (l.type === "photo") {
      out += `\n**${l.name ?? "?"}** (${hm}) 🖼️ ${l.photo?.file ?? ""}${l.photo?.caption ? ` — ${l.photo.caption}` : ""}\n`;
    } else {
      out += `\n**${l.name ?? "?"}** (${hm})\n${l.text ?? ""}\n`;
    }
  }
  return out;
}

// dir: DuriStorage 루트, key: AES-GCM 키, fetchPhoto: (r2key) => Promise<Uint8Array>(암호블롭).
// persist(entry) 는 항목을 디스크에 쓴다. 복호화 실패는 throw(패스프레이즈 불일치),
// 사진 전송 실패도 throw(상위에서 재시도). 이미 있는 seq 는 조용히 건너뛴다(멱등).
export function createStore({ dir, key, fetchPhoto }) {
  const monthCache = new Map();
  const monthDir = (m) => join(dir, "timeline", m.slice(0, 4), m);

  const decryptBytes = async (ivB64, ct) =>
    new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, key, ct));
  const decryptJson = async (iv, ct) => JSON.parse(dec.decode(await decryptBytes(iv, unb64(ct))));

  function loadMonth(month) {
    if (monthCache.has(month)) return monthCache.get(month);
    const path = join(monthDir(month), "metadata.json");
    let logs = [];
    if (existsSync(path)) { try { logs = JSON.parse(readFileSync(path, "utf8")).logs ?? []; } catch { logs = []; } }
    monthCache.set(month, logs);
    return logs;
  }
  function saveMonth(month) {
    const logs = monthCache.get(month);
    atomicWrite(join(monthDir(month), "metadata.json"), JSON.stringify({ month, logs }, null, 2));
    atomicWrite(join(monthDir(month), "messages.md"), renderMarkdown(month, logs));
  }

  async function persist(entry) {
    const month = monthOf(entry.at);
    const logs = loadMonth(month);
    if (logs.some((l) => l.seq === entry.seq)) return; // 멱등

    if (entry.kind === "msg") {
      const p = await decryptJson(entry.iv, entry.ct);
      logs.push({ seq: entry.seq, type: "message", at: p.at ?? entry.at, name: p.name, text: p.text });
    } else if (entry.kind === "photo") {
      const meta = await decryptJson(entry.metaIv, entry.metaCt);
      const blob = await fetchPhoto(entry.r2key);
      const plain = await decryptBytes(entry.imgIv, blob.buffer ?? blob);
      const digest = await sha256hex(plain);
      const file = `${stampOf(entry.at)}_${String(entry.seq).padStart(12, "0")}${safeExt(meta.caption)}`;
      atomicWrite(join(monthDir(month), "photos", file), plain);
      logs.push({
        seq: entry.seq, type: "photo", at: meta.at ?? entry.at, name: meta.name,
        photo: { file, caption: meta.caption, sha256: digest, bytes: plain.length,
                 hashOk: digest === entry.sha256 },
      });
    } else return;

    logs.sort((a, b) => a.seq - b.seq);
    saveMonth(month);
  }

  return { persist, decryptBytes };
}
