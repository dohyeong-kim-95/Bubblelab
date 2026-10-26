// 당이가 읽는 PC 백업(DuriStorage) — **읽기 전용**. 이 모듈엔 쓰거나 지우는 함수가 없다.
//
// 정본은 달마다 timeline/YYYY/YYYY-MM/metadata.json 의 logs 다(messages.md 는 거기서 다시
// 만드는 뷰). 날짜는 at(epoch)을 이 PC 로컬 시각으로 바꿔 쓴다 — messages.md 의 "## 날짜" 는
// UTC 라 KST 00~09시가 전날로 들어가 있다(duri/CLAUDE.md 「로케일」).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const pad2 = (n) => String(n).padStart(2, "0");
const ymdOf = (at) => { const d = new Date(at); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const LINE_MAX = 200;
const JOSA = /(에서|에게|한테|으로|이랑|하고|까지|부터|처럼|에|로|은|는|이|가|을|를|도|랑|와|과)$/;

/** 찾을 낱말 하나 → 맞는 걸로 볼 꼴들. 조사를 뗀 것·끝 한 글자를 뗀 것도("어니언에서"·"제주도" 로 물어도 걸리게). */
export function wordVariants(t) {
  const w = String(t).trim().toLowerCase();
  if (!w) return null;
  const bare = w.replace(JOSA, "");
  return [...new Set([w, ...(bare.length >= 2 ? [bare] : []), ...(w.length >= 3 ? [w.slice(0, -1)] : [])])];
}

/** 한 줄 요약. 당이가 근거로 읽을 수 없는 것(이모티콘)은 null. 좌표는 place 가 있으면 지역 이름으로. */
function lineOf(l, place) {
  if (l.type === "message" && typeof l.text === "string" && l.text.trim()) return l.text.trim();
  const where = l.loc && place ? place(Number(l.loc.lat), Number(l.loc.lng)) : null;
  if (l.type === "photo") return `🖼️ 사진${l.photo?.caption ? ` "${l.photo.caption}"` : ""}${where ? ` 📍${where}` : ""}`;
  if (l.type === "location" && where) return `📍 위치 공유 — ${where}`;
  return null;
}

/**
 * dir: 싱크 저장 위치(DuriStorage). skip(name, text) 이 참인 줄은 뺀다(당이 자신의 답·명령).
 * place(lat, lng): 좌표 → 지역 이름(places.mjs). 없으면 사진은 장소 없이 읽는다.
 * search({ terms, from, to, limit }) → 시간순 줄 배열 "10/12 (일) 14:03 도경: …"
 *   terms 가 있으면 낱말이 많이 맞는 줄 + 앞뒤 한 줄씩, 없으면 기간의 마지막 limit 줄.
 * day(ymd) → { photos, places } 그날 사진 수와 찍은 곳(아침 브리핑의 "1년 전 오늘").
 * photos({ terms, from, to }) → 낱말이 찍은 곳·캡션에 맞는 사진(낱말이 없으면 기간의 전부), 시간순
 *   [{ seq, at, date, where }]. 당이가 채팅에 "가져오는" 사진 — 앱이 seq 로 자기 캐시에서 꺼내 그린다.
 */
export function createArchive(dir, { skip = () => false, place = null } = {}) {
  const cache = new Map(); // 파일 → { mtimeMs, rows }

  function monthFiles(from, to) {
    const root = join(dir, "timeline");
    if (!existsSync(root)) return [];
    const out = [];
    for (const y of readdirSync(root).sort()) {
      if (!/^\d{4}$/.test(y)) continue;
      for (const m of readdirSync(join(root, y)).sort()) {
        // 폴더는 UTC 달이라 로컬(KST) 1일 새벽 말은 전달 폴더에 있다 — 한 달 앞부터 고르고 줄에서 다시 거른다.
        if (!/^\d{4}-\d{2}$/.test(m) || m < prevMonth(from) || m > to.slice(0, 7)) continue;
        const f = join(root, y, m, "metadata.json");
        if (existsSync(f)) out.push(f);
      }
    }
    return out;
  }
  const prevMonth = (s) => { const d = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 2, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };

  function rowsOf(file) {
    const { mtimeMs } = statSync(file);
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.rows;
    let logs = [];
    try { logs = JSON.parse(readFileSync(file, "utf8")).logs ?? []; } catch { /* 쓰는 중이면 다음에 */ }
    const rows = [];
    for (const l of logs) {
      const text = lineOf(l, place);
      if (!text || !Number.isFinite(l.at) || skip(l.name, text)) continue;
      const where = l.type === "photo" && l.loc && place ? place(Number(l.loc.lat), Number(l.loc.lng)) : null;
      rows.push({ seq: l.seq, at: l.at, date: ymdOf(l.at), name: l.name ?? "?", text, photo: l.type === "photo", where, caption: l.photo?.caption ?? "" });
    }
    cache.set(file, { mtimeMs, rows });
    return rows;
  }

  function fmt(r) {
    const d = new Date(r.at);
    const text = r.text.length > LINE_MAX ? `${r.text.slice(0, LINE_MAX)}…` : r.text;
    return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]}) ${pad2(d.getHours())}:${pad2(d.getMinutes())} ${r.name}: ${text}`;
  }

  const rowsIn = (from, to) => monthFiles(from, to).flatMap(rowsOf)
    .filter((r) => r.date >= from && r.date <= to)
    .sort((a, b) => a.at - b.at);

  function search({ terms = [], from, to, limit = 14 }) {
    const rows = rowsIn(from, to);
    const words = terms.map(wordVariants).filter(Boolean);
    if (!words.length) return rows.slice(-limit * 2).map(fmt); // 기간 요약: 마지막 몇 줄
    const scored = rows.map((r, i) => ({ i, score: words.filter((vs) => vs.some((w) => r.text.toLowerCase().includes(w))).length }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || b.i - a.i) // 많이 맞는 것, 같으면 최근
      .slice(0, limit);
    const keep = new Set();
    for (const { i } of scored) for (const j of [i - 1, i, i + 1]) if (rows[j]) keep.add(j);
    return [...keep].sort((a, b) => a - b).map((j) => fmt(rows[j]));
  }

  function day(ds) {
    const photos = rowsIn(ds, ds).filter((r) => r.photo);
    return { photos: photos.length, places: [...new Set(photos.map((r) => r.where).filter(Boolean))] };
  }

  function photos({ terms = [], from, to }) {
    const words = terms.map(wordVariants).filter(Boolean);
    return rowsIn(from, to)
      .filter((r) => r.photo && Number.isInteger(r.seq))
      .filter((r) => !words.length || words.some((vs) => vs.some((w) => `${r.where ?? ""} ${r.caption}`.toLowerCase().includes(w))))
      .map((r) => ({ seq: r.seq, at: r.at, date: r.date, where: r.where }));
  }

  return { search, day, photos };
}
