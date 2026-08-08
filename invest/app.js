// 조회 전용 잔고 화면. 서버(/_invest/state)가 이미 합산해서 주므로 여기서는
// 숫자를 그리기만 한다. API 키·토큰은 브라우저로 내려오지 않는다.

const CURRENCY_COLOR = { KRW: "#3f9d6d", USD: "#5b8def" };

const el = {
  notice: document.getElementById("notice"),
  updated: document.getElementById("updated"),
  refresh: document.getElementById("refresh"),
  summary: document.getElementById("summary"),
  chart: document.getElementById("chart"),
  holdings: document.getElementById("holdings"),
};

function money(amount, currency) {
  const fraction = currency === "USD" ? 2 : 0;
  try {
    return new Intl.NumberFormat("ko-KR", {
      style: "currency", currency, maximumFractionDigits: fraction, minimumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString("ko-KR")} ${currency}`;
  }
}

function percent(rate) {
  return `${rate >= 0 ? "+" : ""}${(rate * 100).toFixed(2)}%`;
}

function signed(amount, currency) {
  return `${amount >= 0 ? "+" : "-"}${money(Math.abs(amount), currency)}`;
}

// 한국식 표기 — 이익이 빨강, 손실이 파랑.
function toneOf(value) {
  return value > 0 ? "up" : value < 0 ? "down" : "";
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function replace(host, ...children) {
  host.replaceChildren(...children);
}

function renderSummary(byCurrency, cash) {
  const currencies = Object.keys(byCurrency).sort();
  if (!currencies.length) {
    replace(el.summary, element("p", "empty", "보유 중인 종목이 없습니다."));
    return;
  }

  const cards = currencies.map((currency) => {
    const bucket = byCurrency[currency];
    const card = element("article", "money");
    card.append(element("h3", null, `${currency} 평가금액`));
    card.append(element("p", "total", money(bucket.value, currency)));

    const list = document.createElement("dl");
    const rows = [
      ["매입원가", money(bucket.cost, currency), ""],
      ["평가손익", signed(bucket.pnl, currency), toneOf(bucket.pnl)],
      ["수익률", percent(bucket.rate), toneOf(bucket.rate)],
    ];
    if (typeof cash?.[currency] === "number") rows.push(["예수금", money(cash[currency], currency), ""]);
    for (const [label, value, tone] of rows) {
      list.append(element("dt", null, label));
      list.append(element("dd", tone, value));
    }
    card.append(list);
    return card;
  });

  replace(el.summary, ...cards);
}

// 수익률(%)은 단위가 없어 통화가 달라도 한 축에 겹쳐 그릴 수 있다.
// 금액은 통화마다 자릿수가 달라 같은 축에 두면 한쪽이 뭉개지므로 그리지 않는다.
function renderChart(series) {
  const entries = Object.entries(series).filter(([, points]) => points.length);
  if (!entries.length) {
    replace(el.chart, element("p", "empty", "아직 기록된 스냅샷이 없습니다."));
    return;
  }
  const total = entries.reduce((sum, [, points]) => sum + points.length, 0);
  if (total < 2) {
    replace(el.chart, element("p", "empty", "점이 하나뿐이라 아직 선을 그릴 수 없습니다. 내일 다시 확인해주세요."));
    return;
  }

  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 12, bottom: 24, left: 52 };
  const dates = [...new Set(entries.flatMap(([, points]) => points.map((p) => p.date)))].sort();
  const rates = entries.flatMap(([, points]) => points.map((p) => p.rate));
  // 0선이 항상 보이게 범위에 0을 포함하고, 위아래로 약간 여유를 준다.
  let min = Math.min(0, ...rates);
  let max = Math.max(0, ...rates);
  if (min === max) { min -= 0.01; max += 0.01; }
  const margin = (max - min) * 0.1;
  min -= margin;
  max += margin;

  const x = (date) => {
    const span = Math.max(1, dates.length - 1);
    return pad.left + (dates.indexOf(date) / span) * (width - pad.left - pad.right);
  };
  const y = (rate) => pad.top + (1 - (rate - min) / (max - min)) * (height - pad.top - pad.bottom);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "통화별 누적 수익률 추이");

  const draw = (tag, attrs) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    svg.append(node);
    return node;
  };

  // 0% 기준선
  draw("line", {
    x1: pad.left, x2: width - pad.right, y1: y(0), y2: y(0),
    stroke: "currentColor", "stroke-opacity": .25, "stroke-dasharray": "3 3",
  });
  for (const [rate, anchor] of [[max, "hanging"], [0, "middle"], [min, "auto"]]) {
    draw("text", {
      x: pad.left - 8, y: y(rate), "text-anchor": "end", "dominant-baseline": anchor,
      "font-size": 10, fill: "currentColor", "fill-opacity": .55,
    }).textContent = percent(rate);
  }

  for (const [currency, points] of entries) {
    const color = CURRENCY_COLOR[currency] ?? "#8b97a5";
    if (points.length === 1) {
      draw("circle", { cx: x(points[0].date), cy: y(points[0].rate), r: 3, fill: color });
      continue;
    }
    draw("polyline", {
      points: points.map((p) => `${x(p.date)},${y(p.rate)}`).join(" "),
      fill: "none", stroke: color, "stroke-width": 2,
      "stroke-linejoin": "round", "stroke-linecap": "round",
    });
  }

  for (const [date, anchor] of [[dates[0], "start"], [dates.at(-1), "end"]]) {
    draw("text", {
      x: x(date), y: height - 6, "text-anchor": anchor,
      "font-size": 10, fill: "currentColor", "fill-opacity": .55,
    }).textContent = date.slice(2);
  }

  const legend = element("p", "legend");
  for (const [currency, points] of entries) {
    const item = element("span", null, `${currency} ${percent(points.at(-1).rate)}`);
    item.style.color = CURRENCY_COLOR[currency] ?? "inherit";
    legend.append(item);
  }

  replace(el.chart, svg, legend);
}

function renderHoldings(positions) {
  if (!positions.length) {
    replace(el.holdings, element("p", "empty", "보유 중인 종목이 없습니다."));
    return;
  }

  const table = document.createElement("table");
  const head = document.createElement("tr");
  for (const label of ["종목", "수량", "평단", "현재가", "평가금액", "손익", "수익률"]) {
    head.append(element("th", null, label));
  }
  const thead = document.createElement("thead");
  thead.append(head);
  table.append(thead);

  const body = document.createElement("tbody");
  for (const position of positions) {
    const row = document.createElement("tr");
    const name = element("td", null, position.name || position.symbol);
    name.title = `${position.symbol} · ${position.market}`;
    row.append(name);
    row.append(element("td", null, position.quantity.toLocaleString("ko-KR")));
    row.append(element("td", null, money(position.avgPrice, position.currency)));
    row.append(element("td", null, money(position.lastPrice, position.currency)));
    row.append(element("td", null, money(position.value, position.currency)));
    row.append(element("td", toneOf(position.pnl), signed(position.pnl, position.currency)));
    row.append(element("td", toneOf(position.rate), percent(position.rate)));
    body.append(row);
  }
  table.append(body);

  replace(el.holdings, table);
}

// detail = 토스가 돌려준 원문. 화면 문구는 원인을 요약할 뿐이라 판정이 어긋날 수
// 있어, 접어둔 채로 원문을 함께 보여준다 (본인만 보는 화면이다).
function showNotice(message, detail) {
  el.notice.replaceChildren();
  el.notice.hidden = !message;
  if (!message) return;

  el.notice.append(element("p", "notice-text", message));
  if (!detail) return;

  const box = document.createElement("details");
  box.append(element("summary", null, "토스 응답 원문"));
  box.append(element("pre", null, detail));
  el.notice.append(box);
}

function staleNotice(updatedAt) {
  const hours = Math.floor((Date.now() - updatedAt) / (60 * 60 * 1000));
  const since = hours >= 48 ? `${Math.floor(hours / 24)}일` : `${hours}시간`;
  return `${since}째 갱신되지 않았습니다 — PC 데몬이 도는지 확인해주세요`;
}

function showFailure(message, detail) {
  showNotice(message, detail);
  for (const host of [el.summary, el.chart, el.holdings]) {
    replace(host, element("p", "empty", "잔고를 불러오지 못했습니다."));
  }
}

async function load({ force = false } = {}) {
  el.refresh.disabled = true;
  try {
    const response = await fetch(`/_invest/state${force ? "?force=1" : ""}`, {
      headers: { Accept: "application/json" },
    });
    if (response.status === 401) {
      location.href = "/login";
      return;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      showFailure(body.error || "잔고를 불러오지 못했습니다.", body.detail);
      return;
    }

    // 잔고를 올리는 건 집 PC 데몬이다. error = 아직 아무것도 안 올라옴,
    // stale = 숫자는 있는데 오래됨(데몬이 멈췄을 수 있음).
    showNotice(body.error ?? (body.stale ? staleNotice(body.updatedAt) : ""), body.detail);
    el.updated.textContent = body.updatedAt
      ? `${new Date(body.updatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })} 기준`
      : "";

    renderSummary(body.byCurrency ?? {}, body.cash ?? {});
    renderChart(body.series ?? {});
    renderHoldings(body.positions ?? []);
  } catch {
    showFailure("서버에 연결하지 못했습니다.");
  } finally {
    el.refresh.disabled = false;
  }
}

el.refresh.addEventListener("click", () => load({ force: true }));
load();
