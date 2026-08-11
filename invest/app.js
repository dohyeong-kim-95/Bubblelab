// 조회 전용 잔고 화면. 서버(/_invest/state)가 이미 합산해서 주므로 여기서는
// 숫자를 그리기만 한다. API 키·토큰은 브라우저로 내려오지 않는다.
//
// 화면은 그룹 한 장씩 좌우로 넘겨 보는 구조다. duri 는 화면이 세 장으로 고정이라
// 오버레이를 직접 드래그하지만, 여기는 그룹 수가 데이터에 따라 변해서 스크롤 스냅
// 캐러셀을 쓴다 — 손끝을 따라오는 감각은 브라우저 기본 스크롤이 그대로 준다.

const CURRENCY_COLOR = { KRW: "#3f9d6d", USD: "#5b8def" };
// 그룹 이름은 임의 문자열이라 색을 미리 정할 수 없다 — 순서대로 돌려쓴다.
const GROUP_PALETTE = ["#5b8def", "#3f9d6d", "#c2703d", "#8b5cc7", "#c04f6e", "#3f8f9d"];

const el = {
  notice: document.getElementById("notice"),
  updated: document.getElementById("updated"),
  refresh: document.getElementById("refresh"),
  tabs: document.getElementById("tabs"),
  track: document.getElementById("track"),
  chart: document.getElementById("chart"),
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

/* ── 그룹 화면 (증권사 자산 조회 화면처럼) ───────────────────────────────
 *
 * 한 그룹이 여러 통화를 담을 수 있어서 큰 숫자(총자산)는 **통화마다 한 장**이다.
 * 환율로 합치지 않기 때문인데, 그룹이 한 통화만 쓰는 보통의 경우에는 화면에
 * 카드가 하나만 떠서 증권사 앱과 같은 모양이 된다.
 */

// 메인 그룹을 맨 앞에 두고 나머지는 이름순. 첫 장이 메인이면 처음 열었을 때
// 스크롤을 옮길 필요가 없어 깜빡임도 없다.
function orderGroups(byGroup, mainGroup) {
  const names = Object.keys(byGroup ?? {});
  const rest = names.filter((name) => name !== mainGroup).sort();
  return names.includes(mainGroup) ? [mainGroup, ...rest] : rest;
}

/** 주식:현금 비중 막대. 증권사 화면의 자산 구성 바에 해당한다. */
function splitBar(value, cash, color) {
  const total = value + cash;
  const bar = element("div", "bar-split");
  if (total <= 0) return bar;
  const stock = element("i");
  stock.style.width = `${(value / total) * 100}%`;
  stock.style.background = color;
  const rest = element("i");
  rest.style.width = `${(cash / total) * 100}%`;
  rest.style.background = "currentColor";
  rest.style.opacity = ".28";
  bar.append(stock, rest);
  return bar;
}

function heroCard(currency, bucket, color) {
  const cash = bucket.cash ?? 0;
  const total = bucket.value + cash;
  const card = element("section", "hero");
  const holdsNothing = bucket.cost === 0 && bucket.value === 0;

  card.append(element("p", "label", holdsNothing ? `${currency} 예수금` : `${currency} 총자산 (평가금액 + 예수금)`));
  card.append(element("p", "total", money(total, currency)));

  // 현금만 있는 통화에 "매입원가 0 / 평가금액 0 / 수익률 —" 을 늘어놓으면
  // 읽을 것도 없이 자리만 차지한다. 한 줄로 끝낸다.
  if (holdsNothing) {
    card.append(element("p", "delta muted-line", "이 통화로 보유 중인 종목은 없습니다."));
    return card;
  }

  const delta = element("p", `delta ${toneOf(bucket.pnl)}`);
  delta.textContent = `${signed(bucket.pnl, currency)} · ${percent(bucket.rate)}`;
  card.append(delta);

  card.append(splitBar(bucket.value, cash, color));
  const legend = element("p", "split-legend");
  const stockTag = element("span", null, `주식 ${money(bucket.value, currency)}`);
  stockTag.style.color = color;
  legend.append(stockTag, element("span", null, `예수금 ${money(cash, currency)}`));
  card.append(legend);

  const list = document.createElement("dl");
  for (const [label, text, tone] of [
    ["매입원가", money(bucket.cost, currency), ""],
    ["평가금액", money(bucket.value, currency), ""],
    ["평가손익", bucket.cost > 0 ? signed(bucket.pnl, currency) : "—", toneOf(bucket.pnl)],
    ["수익률", bucket.cost > 0 ? percent(bucket.rate) : "—", toneOf(bucket.rate)],
  ]) {
    list.append(element("dt", null, label));
    list.append(element("dd", tone, text));
  }
  card.append(list);
  return card;
}

/** 그룹 안의 보유 종목. 평가금액 비중을 막대로 같이 보여준다. */
function holdingRows(positions, color) {
  if (!positions.length) return element("p", "empty", "이 그룹에는 보유 종목이 없습니다.");

  const total = positions.reduce((sum, p) => sum + p.value, 0);
  const rows = element("div", "rows");
  for (const position of positions) {
    const row = element("article", "row");

    const name = element("p", "name", position.name || position.symbol);
    name.title = `${position.symbol} · ${position.market}`;
    row.append(name);
    row.append(element("p", "val", money(position.value, position.currency)));
    row.append(element("p", "sub", `${position.quantity.toLocaleString("ko-KR")}주 · 평단 ${money(position.avgPrice, position.currency)}`));
    row.append(element("p", `pl ${toneOf(position.pnl)}`,
      `${signed(position.pnl, position.currency)} · ${percent(position.rate)}`));

    const weight = element("div", "weight");
    const fill = element("i");
    fill.style.width = total > 0 ? `${(position.value / total) * 100}%` : "0%";
    fill.style.background = color;
    weight.append(fill);
    row.append(weight);
    rows.append(row);
  }
  return rows;
}

function groupPane(group, byCurrency, positions, series, color) {
  const pane = element("article", "pane");
  pane.setAttribute("role", "tabpanel");
  pane.setAttribute("aria-label", `${group} 자산`);

  const currencies = Object.keys(byCurrency).sort();
  for (const currency of currencies) {
    pane.append(heroCard(currency, byCurrency[currency], color));
    // 종목이 없는 통화에 빈 목록 상자를 또 띄우지 않는다 — 카드가 이미 말했다.
    const held = positions.filter((p) => p.currency === currency);
    if (!held.length) continue;
    const box = element("section", "panel");
    box.append(element("h2", null, currencies.length > 1 ? `보유 종목 — ${currency}` : "보유 종목"));
    box.append(holdingRows(held, color));
    pane.append(box);
  }

  const chartBox = element("section", "panel");
  chartBox.append(element("h2", null, "수익률 추이"));
  const chart = element("div", "chart");
  chartBox.append(chart);
  pane.append(chartBox);
  renderChart(chart, flattenGroupSeries(series), {
    label: `${group} 누적 수익률 추이`,
    colorOf: (key, index) => (currencies.length > 1
      ? (CURRENCY_COLOR[key] ?? GROUP_PALETTE[index % GROUP_PALETTE.length])
      : color),
  });

  return pane;
}

function renderGroups(byGroup, positions, groupSeries, mainGroup) {
  const groups = orderGroups(byGroup, mainGroup);
  if (!groups.length) {
    replace(el.tabs);
    replace(el.track, element("p", "empty pane-empty", "보유 중인 종목도 예수금도 없습니다."));
    return;
  }

  const tabs = [];
  const panes = [];
  groups.forEach((group, index) => {
    const color = GROUP_PALETTE[index % GROUP_PALETTE.length];

    const tab = element("button", "tab", group);
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", index === 0 ? "true" : "false");
    tab.addEventListener("click", () => {
      panes[index].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    });
    tabs.push(tab);

    panes.push(groupPane(
      group,
      byGroup[group],
      positions.filter((p) => (p.group || "") === group),
      groupSeries?.[group] ?? {},
      color,
    ));
  });

  replace(el.tabs, ...tabs);
  replace(el.track, ...panes);

  // 스와이프로 넘어간 위치에 탭 표시를 맞춘다. 스크롤 위치로 가장 가까운 장을
  // 고르므로, 손가락으로 끌던 중에도 표시가 따라온다.
  //
  // 트랙 높이도 보고 있는 장에 맞춘다. 그리드 한 줄이라 그냥 두면 **가장 긴 장**의
  // 높이로 고정돼, 짧은 장을 볼 때 아래에 빈 공간이 크게 남는다.
  const syncTab = () => {
    const index = Math.min(tabs.length - 1, Math.max(0,
      Math.round(el.track.scrollLeft / Math.max(1, el.track.clientWidth))));
    tabs.forEach((tab, i) => {
      const active = i === index;
      tab.setAttribute("aria-selected", active ? "true" : "false");
      if (active) tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    el.track.style.height = `${panes[index].scrollHeight}px`;
  };
  el.track.onscroll = syncTab;
  el.track.scrollLeft = 0;   // 메인 그룹이 첫 장이다
  syncTab();
  // 폭이 바뀌면 장 높이도 달라진다(줄바꿈). 다시 재서 맞춘다.
  addEventListener("resize", syncTab);
}

/* ── 그래프 ────────────────────────────────────────────────────────────── */

// 그룹 안에서도 통화를 섞지 않으므로 시계열이 그룹 → 통화 2단으로 온다.
// 한 그룹이 한 통화만 쓰면 통화 표기를 빼서 라벨을 짧게 둔다.
function flattenGroupSeries(byCurrency) {
  const flat = {};
  const currencies = Object.keys(byCurrency ?? {});
  for (const [currency, points] of Object.entries(byCurrency ?? {})) {
    flat[currencies.length > 1 ? currency : "수익률"] = points;
  }
  return flat;
}

// 수익률(%)은 단위가 없어 통화가 달라도 한 축에 겹쳐 그릴 수 있다.
// 금액은 통화마다 자릿수가 달라 같은 축에 두면 한쪽이 뭉개지므로 그리지 않는다.
function renderChart(host, series, { label, colorOf }) {
  const entries = Object.entries(series ?? {}).filter(([, points]) => points?.length);
  if (!entries.length) {
    replace(host, element("p", "empty", "아직 기록된 스냅샷이 없습니다."));
    return;
  }
  const total = entries.reduce((sum, [, points]) => sum + points.length, 0);
  if (total < 2) {
    replace(host, element("p", "empty", "점이 하나뿐이라 아직 선을 그릴 수 없습니다. 내일 다시 확인해주세요."));
    return;
  }

  // 뷰박스를 실제 표시 폭(모바일 ~350px)에 가깝게 잡는다. 640 으로 두면 화면에
  // 0.55배로 줄어들어 10px 글씨가 5px 로 찍혀 축 라벨을 읽을 수 없다.
  const width = 360;
  const height = 180;
  const pad = { top: 14, right: 10, bottom: 22, left: 46 };
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
  svg.setAttribute("aria-label", label);

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
  // 0선 라벨을 먼저 두고, 위아래 끝 라벨은 0선과 충분히 떨어졌을 때만 그린다.
  // 수익률이 전부 음수면 max 가 0 바로 위라 두 글자가 겹쳐 뭉개진다.
  for (const [rate, anchor] of [[0, "middle"], [max, "hanging"], [min, "auto"]]) {
    if (rate !== 0 && Math.abs(y(rate) - y(0)) < 16) continue;   // 글씨 높이(11)보다 넉넉히
    draw("text", {
      x: pad.left - 8, y: y(rate), "text-anchor": "end", "dominant-baseline": anchor,
      "font-size": 11, fill: "currentColor", "fill-opacity": .6,
    }).textContent = percent(rate);
  }

  entries.forEach(([key, points], index) => {
    const color = colorOf(key, index);
    if (points.length === 1) {
      draw("circle", { cx: x(points[0].date), cy: y(points[0].rate), r: 3, fill: color });
      return;
    }
    draw("polyline", {
      points: points.map((p) => `${x(p.date)},${y(p.rate)}`).join(" "),
      fill: "none", stroke: color, "stroke-width": 2,
      "stroke-linejoin": "round", "stroke-linecap": "round",
    });
  });

  for (const [date, anchor] of [[dates[0], "start"], [dates.at(-1), "end"]]) {
    draw("text", {
      x: x(date), y: height - 6, "text-anchor": anchor,
      "font-size": 11, fill: "currentColor", "fill-opacity": .6,
    }).textContent = date.slice(2);
  }

  const legend = element("p", "legend");
  entries.forEach(([key, points], index) => {
    const item = element("span", null, `${key} ${percent(points.at(-1).rate)}`);
    item.style.color = colorOf(key, index);
    legend.append(item);
  });

  replace(host, svg, legend);
}

/* ── 상태·로딩 ─────────────────────────────────────────────────────────── */

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
  replace(el.tabs);
  replace(el.track, element("p", "empty pane-empty", "잔고를 불러오지 못했습니다."));
  replace(el.chart, element("p", "empty", "잔고를 불러오지 못했습니다."));
}

// quiet = 갱신을 기다리는 중의 재조회. 버튼과 안내 문구는 requestRefresh 가
// 쥐고 있으므로 여기서 건드리면 "요청함…" 이 매 3초마다 지워진다.
async function load({ quiet = false } = {}) {
  if (!quiet) el.refresh.disabled = true;
  try {
    const response = await fetch("/_invest/state", {
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
    if (!quiet) {
      // 화면을 새로 열었는데 아직 처리 안 된 갱신 요청이 남아 있을 수 있다.
      const pending = body.refreshPending ? "PC에 갱신을 요청해 둔 상태입니다 — 곧 반영됩니다." : "";
      showNotice(body.error ?? (body.stale ? staleNotice(body.updatedAt) : pending), body.detail);
    }
    el.updated.textContent = body.updatedAt
      ? `${new Date(body.updatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })} 기준`
      : "";
    lastUpdatedAt = body.updatedAt ?? null;

    renderGroups(body.byGroup ?? {}, body.positions ?? [], body.groupSeries ?? {}, body.mainGroup ?? "");
    renderChart(el.chart, body.series ?? {}, {
      label: "통화별 누적 수익률 추이",
      colorOf: (currency) => CURRENCY_COLOR[currency] ?? "#8b97a5",
    });
  } catch {
    showFailure("서버에 연결하지 못했습니다.");
  } finally {
    if (!quiet) el.refresh.disabled = false;
  }
}

/* ── "지금 갱신" ────────────────────────────────────────────────────────
 *
 * 엣지는 토스를 부를 수 없다(허용 IP). 그래서 이 버튼은 **엣지에 요청을 남기고**,
 * 집 PC 데몬이 다음 순회(1분)에 가져가 조회·업로드한다. 화면은 그동안 새 숫자가
 * 올라왔는지 지켜보다가 바뀌면 다시 그린다.
 *
 * PC 가 꺼져 있으면 영영 안 온다 — 그래서 기다림에 끝이 있어야 한다.
 */
const REFRESH_WAIT_MS = 90 * 1000;
const REFRESH_POLL_MS = 3000;
let lastUpdatedAt = null;
let waiting = false;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function requestRefresh() {
  if (waiting) return;
  waiting = true;
  const before = lastUpdatedAt;
  el.refresh.disabled = true;
  el.refresh.textContent = "요청함…";

  try {
    const response = await fetch("/_invest/refresh", { method: "POST" });
    if (response.status === 401) { location.href = "/login"; return; }
    if (response.status === 429) {
      showNotice("갱신 요청이 너무 잦습니다 — 잠시 후 다시 눌러주세요.");
      return;
    }
    if (!response.ok) { showNotice("갱신을 요청하지 못했습니다."); return; }

    showNotice("PC에 갱신을 요청했습니다 — 잠시만 기다려주세요.");
    const until = Date.now() + REFRESH_WAIT_MS;
    while (Date.now() < until) {
      await sleep(REFRESH_POLL_MS);
      await load({ quiet: true });
      if (lastUpdatedAt && lastUpdatedAt !== before) return;   // 새 숫자가 왔다
    }
    showNotice("PC가 아직 응답하지 않습니다 — 데몬이 도는지, PC가 켜져 있는지 확인해주세요.");
  } finally {
    waiting = false;
    el.refresh.disabled = false;
    el.refresh.textContent = "지금 갱신";
  }
}

el.refresh.addEventListener("click", requestRefresh);
load();
