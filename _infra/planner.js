const DATA_KEY = "planner:data";
const MAX_BYTES = 512 * 1024;

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

    return new Response("method not allowed", { status: 405 });
  }
}
