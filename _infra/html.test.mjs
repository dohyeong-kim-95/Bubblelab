import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "./html.js";

test("escapeHtml 은 속성값을 끊는 따옴표까지 바꾼다", () => {
  assert.equal(escapeHtml(`"따옴표" 게임 & <b>'굵게'</b>`),
    "&quot;따옴표&quot; 게임 &amp; &lt;b&gt;&#39;굵게&#39;&lt;/b&gt;");
  const attribute = `<a title="${escapeHtml('그 "게임"')}">`;
  assert.equal(attribute, '<a title="그 &quot;게임&quot;">');
});
