// work.bubblelab.dev 외주 프로젝트용 QnA 보드. 프로젝트당 DO 하나.
// work 게이트 세션을 통과한 요청만 워커가 전달하므로 여기서는 내용만 검증한다.
const KEY = "qna:items";
const MAX_ITEMS = 500;

const clean = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max + 1);

export class WorkQnaDO {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const items = (await this.storage.get(KEY)) ?? [];

    if (request.method === "GET") {
      return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await request.json().catch(() => ({}));

    if (url.pathname === "/ask") {
      const nick = clean(body.nick, 20);
      const product = clean(body.product, 40);
      const question = String(body.question ?? "").trim().slice(0, 1001);
      if (!nick || nick.length > 20) return new Response("invalid nick", { status: 400 });
      if (!question || question.length > 1000) return new Response("invalid question", { status: 400 });
      if (product.length > 40) return new Response("invalid product", { status: 400 });
      const item = {
        id: crypto.randomUUID(), nick, product, question,
        answer: "", askedAt: new Date().toISOString(), answeredAt: null,
      };
      items.unshift(item);
      await this.storage.put(KEY, items.slice(0, MAX_ITEMS));
      return Response.json({ saved: true, item });
    }

    const index = items.findIndex((item) => item.id === body.id);
    if (typeof body.id !== "string" || index < 0) return new Response("question not found", { status: 404 });

    if (url.pathname === "/answer") {
      const answer = String(body.answer ?? "").trim().slice(0, 2001);
      if (answer.length > 2000) return new Response("invalid answer", { status: 400 });
      items[index].answer = answer;
      items[index].answeredAt = answer ? new Date().toISOString() : null;
      await this.storage.put(KEY, items);
      return Response.json({ saved: true, item: items[index] });
    }
    if (url.pathname === "/delete") {
      items.splice(index, 1);
      await this.storage.put(KEY, items);
      return Response.json({ saved: true });
    }
    return new Response("not found", { status: 404 });
  }
}
