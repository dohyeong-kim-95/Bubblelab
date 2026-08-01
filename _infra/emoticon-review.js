// work/emoticon 컷별 사람 검수 댓글 보드 (Durable Object 하나).
//
// 왜 필요한가: 자동 게이트는 기술 결함만 잡는다. "지시한 대로 움직였는가"는
// 픽셀 지표가 볼 수 없어서(lesson_learned §31) 사람이 판정해야 하는데, 그
// 판정이 채팅에만 남으면 다음 반복에서 찾을 수가 없다. 컷 id에 붙여서 남긴다.
//
// 읽기는 공개, 쓰기는 work 마스터 세션만 — 내용이 만화 토끼 피드백이라
// 비밀이 아니고, 공개 읽기여야 GitHub Actions가 새 secret 없이 끌어가
// 리포에 커밋할 수 있다(에이전트가 리포에서 읽는 경로).
const KEY = "emoticon:reviews";
const MAX_ITEMS = 500;
const MAX_NOTE = 2000;

export const REVIEW_VERDICTS = new Set(["good", "revise", "reject", "note"]);
const ID_RE = /^[a-z0-9-]{1,32}$/;

const clean = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

// 순수 함수로 분리해 워커 없이 테스트한다.
export function buildReviewItem(body, now) {
  // id는 자르지 않고 그대로 검사한다 — 잘라서 통과시키면 다른 컷의 댓글이 된다.
  const character = String(body?.character ?? "").trim();
  const cut = String(body?.cut ?? "").trim();
  if (!ID_RE.test(character)) throw new Error("invalid character");
  if (!ID_RE.test(cut)) throw new Error("invalid cut");
  const verdict = clean(body?.verdict, 16) || "note";
  if (!REVIEW_VERDICTS.has(verdict)) throw new Error("invalid verdict");
  const note = String(body?.note ?? "").trim().slice(0, MAX_NOTE + 1);
  if (note.length > MAX_NOTE) throw new Error("note too long");
  if (!note && verdict === "note") throw new Error("empty note");
  return { id: crypto.randomUUID(), character, cut, verdict, note, at: now };
}

export class EmoticonReviewDO {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const items = (await this.storage.get(KEY)) ?? [];

    if (request.method === "GET") {
      return Response.json({ version: 1, items }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await request.json().catch(() => ({}));

    if (url.pathname === "/add") {
      let item;
      try { item = buildReviewItem(body, new Date().toISOString()); } catch (error) {
        return new Response(String(error.message), { status: 400 });
      }
      items.unshift(item);
      await this.storage.put(KEY, items.slice(0, MAX_ITEMS));
      return Response.json({ saved: true, item });
    }
    // 판정만 바꾸기 — 처음 남길 때와 다시 볼 때의 판단이 달라진다.
    // 지우고 새로 쓰면 남긴 시각이 사라지므로 제자리에서 고친다.
    if (url.pathname === "/verdict") {
      const index = items.findIndex((item) => item.id === body?.id);
      if (index < 0) return new Response("review not found", { status: 404 });
      const verdict = String(body?.verdict ?? "").trim();
      if (!REVIEW_VERDICTS.has(verdict)) return new Response("invalid verdict", { status: 400 });
      items[index] = { ...items[index], verdict, editedAt: new Date().toISOString() };
      await this.storage.put(KEY, items);
      return Response.json({ saved: true, item: items[index] });
    }
    if (url.pathname === "/delete") {
      const index = items.findIndex((item) => item.id === body?.id);
      if (index < 0) return new Response("review not found", { status: 404 });
      items.splice(index, 1);
      await this.storage.put(KEY, items);
      return Response.json({ saved: true });
    }
    return new Response("not found", { status: 404 });
  }
}
