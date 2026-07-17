const DATA_KEY = "planner:data";
const MAX_BYTES = 512 * 1024;

export const validPlannerCode = (code) => /^\d{6}[A-Z]{2}$/.test(code);

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit",
  }).format(new Date()).slice(0, 7);
}

export function prunePlannerData(value, month = currentMonth()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith("_") || key.startsWith(`${month}-`)) clean[key] = item;
  }
  return clean;
}

export class PlannerDO {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    if (request.method === "GET") {
      const data = prunePlannerData((await this.storage.get(DATA_KEY)) ?? {});
      return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
    }

    if (request.method === "PUT") {
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > MAX_BYTES) {
        return new Response("planner data too large", { status: 413 });
      }
      let body;
      try { body = JSON.parse(text); } catch { return new Response("invalid json", { status: 400 }); }
      if (!body || typeof body.data !== "object" || Array.isArray(body.data)) {
        return new Response("invalid planner data", { status: 400 });
      }
      const data = prunePlannerData(body.data);
      await this.storage.put(DATA_KEY, data);
      return Response.json({ saved: true });
    }

    // 소유자 스스로 서버 데이터를 즉시 지울 수 있게 한다 (삭제 요청 정책).
    if (request.method === "DELETE") {
      await this.storage.delete(DATA_KEY);
      return Response.json({ deleted: true });
    }

    if (request.method === "PATCH") {
      const body = await request.json().catch(() => ({}));
      const month = currentMonth();
      if (!new RegExp(`^${month}-\\d{2}$`).test(body.date ?? "") ||
          !["add", "toggle", "delete"].includes(body.action)) {
        return new Response("invalid todo update", { status: 400 });
      }
      const data = prunePlannerData((await this.storage.get(DATA_KEY)) ?? {}, month);
      data[body.date] ??= { plan: [], real: [], todo: [] };
      data[body.date].todo ??= [];
      const todos = data[body.date].todo;

      if (body.action === "add") {
        const title = String(body.title ?? "").trim().replace(/\s+/g, " ");
        if (!title || title.length > 200) return new Response("invalid todo title", { status: 400 });
        if (todos.filter((item) => !item.done).length >= 7) {
          return new Response("todo list is full", { status: 409 });
        }
        const item = { id: crypto.randomUUID(), title, color: "#E5E7EB", done: false };
        todos.push(item);
        await this.storage.put(DATA_KEY, data);
        return Response.json({ saved: true, item });
      }

      if (typeof body.id !== "string" || body.id.length > 100) {
        return new Response("invalid todo id", { status: 400 });
      }
      const index = todos.findIndex((item) => item.id === body.id);
      if (index < 0) return new Response("todo not found", { status: 404 });
      if (body.action === "toggle") {
        if (typeof body.done !== "boolean") return new Response("invalid todo state", { status: 400 });
        todos[index].done = body.done;
      } else {
        todos.splice(index, 1);
      }
      await this.storage.put(DATA_KEY, data);
      return Response.json({ saved: true });
    }

    return new Response("method not allowed", { status: 405 });
  }
}
