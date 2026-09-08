import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";
import { deviceStatus, remainingSeconds, summarize, calculate } from "../sktest/core.js";
import { AREAS, QUESTIONS } from "../sktest/questions.js";
import { parseAnswerKey, gradeAnswers } from "../sktest/workbook/core.js";
import { applySecurityHeaders } from "./security.js";

test("sktest routes through the wildcard without analytics or cached responses", async () => {
  for (const [url, path] of [
    ["https://sktest.bubblelab.dev/", "/sktest/"],
    ["https://sktest.bubblelab.dev/app.js", "/sktest/app.js"],
    ["http://localhost:8787/sktest/core.js", "/sktest/core.js"],
  ]) {
    const response = await worker.fetch(new Request(url, { headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Sec-Fetch-Dest": "document",
    } }), {
      ASSETS: { fetch(request) {
        assert.equal(new URL(request.url).pathname, path);
        return new Response("sktest", { headers: { "Content-Type": "text/html" } });
      } },
    }, { waitUntil() { assert.fail("personal practice must not record visits"); } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(await response.text(), "sktest");
  }
});

test("desktop gate rejects phones, desktop-UA iPads, and narrow windows", () => {
  const pc = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32" };
  assert.equal(deviceStatus(pc, 1280, 1920), "desktop");
  assert.equal(deviceStatus(pc, 1023, 1920), "narrow");
  assert.equal(deviceStatus({ userAgent: "Android", platform: "Linux" }, 1280, 1280), "mobile");
  assert.equal(deviceStatus({ userAgent: "iPhone" }, 1280, 390), "mobile");
  assert.equal(deviceStatus({ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 }, 1366, 1366), "mobile");
  assert.equal(deviceStatus({ ...pc, userAgentData: { mobile: true } }, 1280, 1280), "mobile");
});

test("question bank has complete answer keys and scoring separates skipped answers", () => {
  assert.equal(QUESTIONS.length, 30);
  assert.equal(new Set(QUESTIONS.map(q => q.id)).size, QUESTIONS.length);
  for (const area of AREAS) assert.equal(QUESTIONS.filter(q => q.area === area.id).length, 6);
  for (const q of QUESTIONS) {
    assert.equal(q.options.length, 5, q.id);
    assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 5, q.id);
    assert.ok(q.explanation?.length > 0, q.id);
  }
  const [a, b, c] = QUESTIONS;
  assert.deepEqual(summarize([a, b, c], { [a.id]: a.answer, [b.id]: (b.answer + 1) % 5 }),
    { total: 3, correct: 1, wrong: 1, skipped: 1, percent: 33 });
});

test("wall-clock timer and calculator handle expiration and invalid expressions", () => {
  assert.equal(remainingSeconds(270000, 269100), 1);
  assert.equal(remainingSeconds(270000, 300000), 0);
  assert.equal(calculate("(12 + 8) × 3 ÷ 4"), 15);
  assert.equal(calculate("−2.5 + 10"), 7.5);
  for (const expression of ["1/0", "alert(1)", "(2+3", "2**3"]) {
    assert.throws(() => calculate(expression));
  }
});

test("PDF OMR requires an exact answer key and counts blanks separately", () => {
  assert.deepEqual(parseAnswerKey("1, 2\n3 4,5", 5), [1, 2, 3, 4, 5]);
  for (const key of ["12345", "1,2,3,4", "1,2,3,4,6", "1,2,3,4,1.0"]) {
    assert.throws(() => parseAnswerKey(key, 5));
  }
  const grade = gradeAnswers([1, null, 4, 4, null], [1, 2, 3, 4, 5]);
  assert.deepEqual([grade.correct, grade.wrong, grade.skipped, grade.percent], [2, 1, 2, 40]);
});

test("PDF decoder WASM policy is scoped to sktest without opening external sources", () => {
  for (const url of ["https://sktest.bubblelab.dev/", "http://localhost:8788/sktest/workbook/"]) {
    const csp = applySecurityHeaders(new Response(), new Request(url)).headers.get("Content-Security-Policy");
    assert.match(csp, /'wasm-unsafe-eval'/);
    assert.doesNotMatch(csp, /'unsafe-eval'|jsdelivr|googleapis/);
  }
  const other = applySecurityHeaders(new Response(), new Request("https://slop.bubblelab.dev/")).headers.get("Content-Security-Policy");
  assert.doesNotMatch(other, /wasm-unsafe-eval/);
});
