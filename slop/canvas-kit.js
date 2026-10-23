// 러시 토이 몇 개가 같이 쓰는 캔버스 도구 — 쓰는 토이가 본 스크립트보다 먼저 불러온다:
//   <script src="../canvas-kit.js"></script>
// 토이 고유 로직은 넣지 않는다(토이는 여전히 index.html 한 장이 본체다).

// 구형 모바일 브라우저(iOS 15 이하 등)엔 roundRect가 없다 — 없으면 폴리필
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(Array.isArray(r) ? r[0] : (r ?? 0), w / 2, h / 2);
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}

// 팁 문장을 폭에 맞춰 단어 단위로 줄바꿈해 그린다. 글꼴·색·정렬은 부르는 쪽이 정한다.
// Args: ctx — 2D 컨텍스트, text — 팁 문장, x·top — 첫 줄 위치, maxWidth — 줄 폭, lineHeight — 줄 간격
function drawWrappedTip(ctx, text, x, top, maxWidth, lineHeight) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  lines.push(line);
  lines.forEach((text2, i) => ctx.fillText(text2, x, top + i * lineHeight));
}
