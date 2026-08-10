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

// 사진 형식은 **실제 바이트**로 판별한다. 웹앱이 보내는 메타에는 확장자가 없어서
// (예전 코드는 존재하지도 않는 meta.caption 에서 뽑으려 했다) 무엇을 보내든 .jpg 로
// 저장됐다 — 아이폰이 올리는 HEIC 도 마찬가지였다. 매직바이트는 메타에 아무것도
// 없는 옛 항목에도 그대로 통하고, 원본 보존이 원칙인 이 저장고에 맞다.
const ISO_BMFF_BRANDS = {
  avif: ".avif", avis: ".avif",
  heic: ".heic", heix: ".heic", hevc: ".heic", hevx: ".heic",
  heim: ".heic", heis: ".heic", hevm: ".heic", hevs: ".heic",
  mif1: ".heic", msf1: ".heic",
};
export function extOfBytes(b) {
  if (!b || b.length < 12) return ".bin";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return ".png";
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return ".jpg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ".gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return ".webp";
  if (b[0] === 0x42 && b[1] === 0x4D) return ".bmp";
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2A) ||
      (b[0] === 0x4D && b[1] === 0x4D && b[2] === 0x00)) return ".tif";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) { // ISO-BMFF: ....ftyp<brand>
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
    if (ISO_BMFF_BRANDS[brand]) return ISO_BMFF_BRANDS[brand];
  }
  return ".bin"; // 모르면 .jpg 라고 우기지 않는다 — 정체를 위장하느니 그대로 둔다
}

// metadata.json 에서 재생성되는 사람용 대화록 (View — 정본 아님)
export function renderMarkdown(month, logs) {
  let out = `# ${month}\n`;
  let day = "";
  for (const l of logs) {
    const d = new Date(l.at);
    const dayKey = d.toISOString().slice(0, 10);
    if (dayKey !== day) { day = dayKey; out += `\n## ${dayKey}\n`; }
    const hm = d.toISOString().slice(11, 16);
    const who = `**${l.name ?? "?"}** (${hm})`;
    if (l.type === "photo") {
      const where = l.loc ? ` 📍${l.loc.lat},${l.loc.lng}` : "";
      out += `\n${who} 🖼️ ${l.photo?.file ?? ""}${l.photo?.caption ? ` — ${l.photo.caption}` : ""}${where}\n`;
    } else if (l.type === "sticker") {
      out += `\n${who} 🧸 이모티콘 ${l.sticker?.pack ?? "?"}/${l.sticker?.n ?? "?"}\n`;
    } else if (l.type === "location") {
      out += `\n${who} 📍 위치 ${l.loc?.lat}, ${l.loc?.lng}\n`;
    } else {
      out += `\n${who}\n${l.text ?? ""}\n`;
    }
  }
  return out;
}

// 공유 캘린더의 사람용 뷰. 일정은 날짜순, 표식(그 날짜에 붙는 이모지)은 따로 모은다.
// 툼스톤(deleted)과 팔레트(색 설정)는 기록에는 남기되 여기서는 뺀다.
export function renderCalendarMarkdown(events) {
  const live = events.filter((e) => !e.deleted);
  const marks = live.filter((e) => e.kind === "marker").sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const plans = live.filter((e) => !e.kind).sort((a, b) =>
    String(a.date).localeCompare(String(b.date)) || String(a.start ?? "").localeCompare(String(b.start ?? "")));

  let out = "# 공유 캘린더\n";
  let day = "";
  for (const e of plans) {
    if (e.date !== day) { day = e.date; out += `\n## ${day}\n`; }
    const when = e.start ? `${e.start}${e.end ? `–${e.end}` : ""}` : "종일";
    const span = e.endDate && e.endDate > e.date ? ` → ${e.endDate}` : "";
    const who = e.shared ? "공통" : (e.owner || "?");
    const rep = e.recur?.freq ? ` 🔁${e.recur.freq}` : "";
    out += `- (${when}${span}) **${e.title ?? ""}** — ${who}${rep}\n`;
  }
  if (marks.length) {
    out += `\n## 표식\n`;
    for (const m of marks) out += `- ${m.date} ${m.marker ?? ""}\n`;
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
      // 지도 핀 삭제(unpin)는 대화가 아니라 조용한 제어 항목이다 — 그대로 두면
      // 백업에 본문 없는 빈 줄로 쌓인다.
      if (p.unpin) return;
      const base = { seq: entry.seq, at: p.at ?? entry.at, name: p.name };
      // 스티커·위치는 text 가 없다. 예전엔 둘 다 text:undefined 인 message 로 남아
      // 대화록에 이름만 있고 내용은 빈 줄이었다 — 무엇이 오갔는지 알 수 있게 남긴다.
      if (p.sticker) logs.push({ ...base, type: "sticker", sticker: p.sticker });
      else if (p.here) logs.push({ ...base, type: "location", loc: p.here });
      else logs.push({ ...base, type: "message", text: p.text, ...(p.sys && { sys: true }) });
    } else if (entry.kind === "photo") {
      const meta = await decryptJson(entry.metaIv, entry.metaCt);
      const blob = await fetchPhoto(entry.r2key);
      const plain = await decryptBytes(entry.imgIv, blob.buffer ?? blob);
      const digest = await sha256hex(plain);
      const file = `${stampOf(entry.at)}_${String(entry.seq).padStart(12, "0")}${extOfBytes(plain)}`;
      atomicWrite(join(monthDir(month), "photos", file), plain);
      logs.push({
        seq: entry.seq, type: "photo", at: meta.at ?? entry.at, name: meta.name,
        photo: { file, original: meta.file, mime: meta.type, caption: meta.caption,
                 sha256: digest, bytes: plain.length, hashOk: digest === entry.sha256 },
        // 촬영 위치 — 지도의 재료다. 이게 없으면 백업만으로는 지도를 되살릴 수 없다.
        ...(meta.loc && { loc: meta.loc }),
        ...(entry.album && { album: entry.album }),
      });
    } else return;

    logs.sort((a, b) => a.seq - b.seq);
    saveMonth(month);
  }

  // ── 공유 캘린더 ────────────────────────────────────────────
  // 대화·사진과 성격이 다르다: 버퍼가 아니라 서버의 지속 상태라 ack 이 없고,
  // 접속할 때마다 cal-state 로 전체가 온다. 그래서 **덮어쓰지 않고 병합**한다 —
  // 방초기화로 서버가 비워진 뒤 빈 cal-state 가 오면 통째로 쓰다가 백업까지
  // 날아간다. 서버에 없는 항목은 그대로 두고, 같은 id 는 rev 가 큰 쪽을 남긴다.
  const calPath = join(dir, "calendar", "events.json");
  let calCache = null;
  function loadCalendar() {
    if (calCache) return calCache;
    let events = [];
    if (existsSync(calPath)) {
      try { events = JSON.parse(readFileSync(calPath, "utf8")).events ?? []; } catch { events = []; }
    }
    calCache = new Map(events.map((e) => [e.id, e]));
    return calCache;
  }

  // entries: [{ id, iv, ct, rev, deleted }] — cal-state 전체든 cal-put/cal-del 하나든 같다.
  async function persistCalendar(entries) {
    const cal = loadCalendar();
    let changed = false;
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry?.id || typeof entry.rev !== "number") continue;
      const cur = cal.get(entry.id);
      if (cur && cur.rev >= entry.rev) continue; // last-write-wins (웹앱·서버와 같은 규칙)
      if (entry.deleted || !entry.ct) {
        cal.set(entry.id, { id: entry.id, rev: entry.rev, deleted: true });
      } else {
        // 복호화 실패는 여기서 던진다 — 대화와 마찬가지로 문구가 다르면 멈춰야 한다.
        const content = await decryptJson(entry.iv, entry.ct);
        cal.set(entry.id, { id: entry.id, rev: entry.rev, deleted: false, ...content });
      }
      changed = true;
    }
    if (!changed) return 0;
    const events = [...cal.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    atomicWrite(calPath, JSON.stringify({ updatedAt: new Date().toISOString(), events }, null, 2));
    atomicWrite(join(dir, "calendar", "calendar.md"), renderCalendarMarkdown(events));
    return events.length;
  }

  return { persist, persistCalendar, decryptBytes };
}
