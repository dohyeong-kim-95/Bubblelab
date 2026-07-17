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

// 시간 블록: 07:00–21:00 사이 10분 단위, 같은 트랙 안에서 겹침 금지
const blockMinutes = (time) =>
  /^\d{2}:[0-5]0$/.test(time ?? "") ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : NaN;

function validBlockRange(startTime, endTime) {
  const start = blockMinutes(startTime), end = blockMinutes(endTime);
  return start >= 7 * 60 && end <= 21 * 60 && start < end;
}

function overlapsTrack(blocks, startTime, endTime, excludeId) {
  const start = blockMinutes(startTime), end = blockMinutes(endTime);
  return blocks.some((block) => block.id !== excludeId &&
    start < blockMinutes(block.endTime) && end > blockMinutes(block.startTime));
}

function applyBlockAction(day, body) {
  if (!["plan", "real"].includes(body.track)) return new Response("invalid track", { status: 400 });
  day[body.track] ??= [];
  const blocks = day[body.track];

  if (body.action === "block-add") {
    const title = String(body.title ?? "").trim().replace(/\s+/g, " ");
    if (!title || title.length > 200) return new Response("invalid block title", { status: 400 });
    if (!validBlockRange(body.startTime, body.endTime)) return new Response("invalid block time", { status: 400 });
    if (blocks.length >= 40) return new Response("track is full", { status: 409 });
    if (overlapsTrack(blocks, body.startTime, body.endTime)) return new Response("block overlap", { status: 409 });
    const color = /^#[0-9a-fA-F]{6}$/.test(body.color ?? "") ? body.color : "#E5E7EB";
    const block = { id: crypto.randomUUID(), startTime: body.startTime, endTime: body.endTime, title, color };
    blocks.push(block);
    return Response.json({ saved: true, block });
  }

  if (typeof body.id !== "string" || body.id.length > 100) return new Response("invalid block id", { status: 400 });
  const index = blocks.findIndex((block) => block.id === body.id);
  if (index < 0) return new Response("block not found", { status: 404 });

  if (body.action === "block-delete") {
    blocks.splice(index, 1);
    return Response.json({ saved: true });
  }

  const next = { ...blocks[index] };
  if (body.title !== undefined) {
    next.title = String(body.title).trim().replace(/\s+/g, " ");
    if (!next.title || next.title.length > 200) return new Response("invalid block title", { status: 400 });
  }
  if (body.startTime !== undefined) next.startTime = body.startTime;
  if (body.endTime !== undefined) next.endTime = body.endTime;
  if (body.color !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(body.color)) return new Response("invalid block color", { status: 400 });
    next.color = body.color;
  }
  if (!validBlockRange(next.startTime, next.endTime)) return new Response("invalid block time", { status: 400 });
  if (overlapsTrack(blocks, next.startTime, next.endTime, body.id)) return new Response("block overlap", { status: 409 });
  blocks[index] = next;
  return Response.json({ saved: true, block: next });
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
      const BLOCK_ACTIONS = ["block-add", "block-update", "block-delete"];
      if (!new RegExp(`^${month}-\\d{2}$`).test(body.date ?? "") ||
          !["add", "toggle", "delete", ...BLOCK_ACTIONS].includes(body.action)) {
        return new Response("invalid todo update", { status: 400 });
      }
      const data = prunePlannerData((await this.storage.get(DATA_KEY)) ?? {}, month);
      data[body.date] ??= { plan: [], real: [], todo: [] };

      if (BLOCK_ACTIONS.includes(body.action)) {
        const response = applyBlockAction(data[body.date], body);
        if (response.status === 200) await this.storage.put(DATA_KEY, data);
        return response;
      }

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
