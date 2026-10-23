// 빌드가 만드는 HTML 에 텍스트를 넣을 때 쓴다. 속성값(title="…"·aria-label·alt)에도
// 쓰므로 따옴표까지 바꾼다 — toyTitle() 이 &quot; 를 " 로 되돌린 제목이 속성을 끊었다.
export function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
