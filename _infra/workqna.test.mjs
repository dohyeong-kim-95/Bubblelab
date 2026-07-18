import test from "node:test";
import assert from "node:assert/strict";
import { WorkQnaDO } from "./workqna.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  async get(key) { return this.data.get(key); }
  async put(key, value) { this.data.set(key, value); }
}

const post = (qna, action, payload) => qna.fetch(new Request(`https://workqna.internal/${action}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
}));

test("accepts questions, answers, and deletion", async () => {
  const qna = new WorkQnaDO({ storage: new MemoryStorage() });

  let response = await post(qna, "ask", { nick: " 골댕이  아빠 ", product: "비상키함", question: "  검정색도  되나요? " });
  assert.equal(response.status, 200);
  const item = (await response.json()).item;
  assert.equal(item.nick, "골댕이 아빠");
  assert.equal(item.question, "검정색도  되나요?"); // 본문은 줄바꿈·공백 보존
  assert.equal(item.answer, "");

  response = await post(qna, "answer", { id: item.id, answer: "네, 검정 필라멘트로 제작 가능합니다." });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).item.answeredAt);

  // 빈 답변으로 저장하면 미답변 상태로 되돌아간다
  response = await post(qna, "answer", { id: item.id, answer: "" });
  assert.equal((await response.json()).item.answeredAt, null);

  response = await post(qna, "delete", { id: item.id });
  assert.equal(response.status, 200);
  const list = await (await qna.fetch(new Request("https://workqna.internal/"))).json();
  assert.equal(list.items.length, 0);
});

test("rejects invalid input and unknown ids", async () => {
  const qna = new WorkQnaDO({ storage: new MemoryStorage() });
  assert.equal((await post(qna, "ask", { nick: "", question: "hi" })).status, 400);
  assert.equal((await post(qna, "ask", { nick: "a", question: "" })).status, 400);
  assert.equal((await post(qna, "ask", { nick: "a", question: "x".repeat(1001) })).status, 400);
  assert.equal((await post(qna, "answer", { id: "missing", answer: "x" })).status, 404);
  assert.equal((await post(qna, "delete", { id: "missing" })).status, 404);
  assert.equal((await qna.fetch(new Request("https://workqna.internal/", { method: "PUT" }))).status, 405);
});

test("keeps only the latest 500 questions", async () => {
  const qna = new WorkQnaDO({ storage: new MemoryStorage() });
  for (let i = 0; i < 502; i++) await post(qna, "ask", { nick: "n", question: `q${i}` });
  const list = await (await qna.fetch(new Request("https://workqna.internal/"))).json();
  assert.equal(list.items.length, 500);
  assert.equal(list.items[0].question, "q501");
});
