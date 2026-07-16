const MARKET = {
  NVDA: { name: "NVIDIA Corporation", exchange: "NASDAQ", price: 183.72, change: 2.84, sector: "Semiconductors", cap: "4.48T", pe: "45.8", high52: 195.62, low52: 86.62, volume: "142.8M", beta: "2.12", dividend: "0.02%", description: "가속 컴퓨팅 플랫폼과 GPU, 데이터센터용 네트워킹 솔루션을 설계하는 반도체 기업입니다.", revenue: "130.5B", margin: "55.9%", eps: "4.02" },
  TSM: { name: "Taiwan Semiconductor", exchange: "NYSE", price: 341.18, change: 1.36, sector: "Semiconductors", cap: "1.77T", pe: "31.4", high52: 352.90, low52: 167.21, volume: "18.4M", beta: "1.19", dividend: "0.95%", description: "세계 최대 규모의 전용 반도체 파운드리로 첨단 공정과 패키징 서비스를 제공합니다.", revenue: "102.3B", margin: "46.8%", eps: "10.87" },
  AVGO: { name: "Broadcom Inc.", exchange: "NASDAQ", price: 412.44, change: -0.62, sector: "Semiconductors", cap: "1.94T", pe: "67.2", high52: 429.10, low52: 153.32, volume: "21.6M", beta: "1.11", dividend: "0.58%", description: "반도체, 네트워킹, 맞춤형 가속기 및 인프라 소프트웨어 솔루션을 공급합니다.", revenue: "62.9B", margin: "39.4%", eps: "6.14" },
  AMZN: { name: "Amazon.com, Inc.", exchange: "NASDAQ", price: 241.32, change: 0.91, sector: "Consumer / Cloud", cap: "2.57T", pe: "37.9", high52: 252.14, low52: 151.61, volume: "39.2M", beta: "1.28", dividend: "—", description: "전자상거래, AWS 클라우드, 광고와 디지털 미디어 사업을 운영합니다.", revenue: "690.2B", margin: "12.1%", eps: "6.37" },
  GOOGL: { name: "Alphabet Inc.", exchange: "NASDAQ", price: 211.08, change: 1.72, sector: "Internet Services", cap: "2.58T", pe: "24.5", high52: 218.66, low52: 140.53, volume: "27.1M", beta: "1.03", dividend: "0.39%", description: "Google 검색, YouTube, 광고, 클라우드와 AI 제품을 제공하는 기술 기업입니다.", revenue: "371.4B", margin: "32.2%", eps: "8.62" },
  META: { name: "Meta Platforms, Inc.", exchange: "NASDAQ", price: 708.55, change: -1.14, sector: "Internet Services", cap: "1.78T", pe: "27.1", high52: 740.91, low52: 442.65, volume: "14.8M", beta: "1.19", dividend: "0.30%", description: "Facebook, Instagram, WhatsApp와 AI 기반 광고 플랫폼을 운영합니다.", revenue: "178.8B", margin: "41.2%", eps: "26.17" },
  QQQM: { name: "Invesco NASDAQ 100 ETF", exchange: "NASDAQ", price: 268.31, change: 0.58, sector: "ETF", cap: "58.4B", pe: "33.2", high52: 273.42, low52: 183.40, volume: "4.2M", beta: "1.10", dividend: "0.49%", description: "NASDAQ-100 지수를 추종하는 저비용 상장지수펀드입니다.", revenue: "—", margin: "—", eps: "—" },
  "BRK.B": { name: "Berkshire Hathaway", exchange: "NYSE", price: 498.16, change: -0.21, sector: "Diversified", cap: "1.08T", pe: "13.6", high52: 542.07, low52: 420.12, volume: "3.6M", beta: "0.82", dividend: "—", description: "보험, 철도, 에너지와 제조업을 보유한 다각화 지주회사입니다.", revenue: "371.2B", margin: "18.7%", eps: "36.63" },
  GLDM: { name: "SPDR Gold MiniShares", exchange: "NYSE ARCA", price: 72.48, change: 0.34, sector: "Gold ETF", cap: "13.1B", pe: "—", high52: 75.20, low52: 45.18, volume: "5.8M", beta: "0.13", dividend: "—", description: "금 현물 가격에서 비용을 차감한 성과를 추종하는 상장지수펀드입니다.", revenue: "—", margin: "—", eps: "—" },
  AAPL: { name: "Apple Inc.", exchange: "NASDAQ", price: 224.71, change: -0.48, sector: "Technology Hardware", cap: "3.35T", pe: "34.7", high52: 260.10, low52: 169.21, volume: "51.7M", beta: "1.18", dividend: "0.44%", description: "iPhone, Mac, 웨어러블과 디지털 서비스를 설계하고 판매합니다.", revenue: "411.8B", margin: "31.5%", eps: "6.48" },
  MSFT: { name: "Microsoft Corporation", exchange: "NASDAQ", price: 526.40, change: 0.76, sector: "Software / Cloud", cap: "3.91T", pe: "38.1", high52: 548.63, low52: 385.58, volume: "18.9M", beta: "0.99", dividend: "0.63%", description: "클라우드, 생산성 소프트웨어, 운영체제와 AI 플랫폼을 제공합니다.", revenue: "281.7B", margin: "45.6%", eps: "13.82" }
};

const NEWS = {
  NVDA: ["AI 인프라 투자 확대가 데이터센터 수요를 지지", "차세대 가속기 공급망과 패키징 생산능력에 관심", "클라우드 사업자들의 자본지출 전망 점검"],
  TSM: ["첨단 공정 가동률과 해외 팹 램프업에 시장 주목", "AI 칩 수요가 고급 패키징 증설을 견인", "파운드리 가격과 제품 믹스가 마진 변수"],
  AVGO: ["맞춤형 AI 가속기와 네트워킹 매출 기대 지속", "인프라 소프트웨어 통합 성과 점검", "고속 연결 솔루션 수요가 실적의 핵심 변수"],
  DEFAULT: ["미국 증시, 기술주 중심으로 혼조세", "장기 국채금리 움직임에 성장주 변동성 확대", "이번 주 주요 기업 실적과 경제지표 발표 예정"]
};

const INDICES = [
  ["S&P 500", "6,927.18", 0.42], ["NASDAQ 100", "25,114.08", 0.71], ["DOW", "49,226.14", -0.11],
  ["VIX", "16.42", -2.08], ["US 10Y", "4.18%", 0.03], ["GOLD", "3,382.6", 0.35], ["BTC", "118,420", 1.24]
];

const ranges = { "1D": 42, "1W": 55, "1M": 72, "3M": 90, "1Y": 120, "5Y": 150 };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const money = (v) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
let selected = localStorage.getItem("bi:selected") || "NVDA";
let watch = JSON.parse(localStorage.getItem("bi:watch") || 'null') || ["NVDA", "TSM", "AVGO", "AMZN", "GOOGL", "META", "QQQM", "BRK.B", "GLDM"];
let currentRange = "1M";
let orderSide = "buy";
let chartPoints = [];

function seeded(symbol, count) {
  let seed = [...symbol].reduce((a, c) => a * 31 + c.charCodeAt(0), count * 97) >>> 0;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const item = MARKET[symbol];
  const drift = item.change / 900;
  let value = item.price * (1 - item.change / 100) * (1 - count / 1100);
  const values = [];
  for (let i = 0; i < count; i++) {
    value *= 1 + drift + (rand() - .48) * (symbol === "GLDM" ? .006 : .018);
    values.push(value);
  }
  const scale = item.price / values.at(-1);
  return values.map((v, i) => ({ value: v * scale, volume: .15 + rand() * .85, index: i }));
}

function renderTicker() {
  const html = [...INDICES, ...INDICES].map(([name, value, delta]) => `<span class="ticker-item"><b>${name}</b><span>${value}</span><span class="${delta >= 0 ? "up" : "down"}">${signed(delta)}</span></span>`).join("");
  $("#tickerTrack").innerHTML = html;
}

function renderWatchlist() {
  $("#watchlist").innerHTML = watch.map((symbol) => {
    const d = MARKET[symbol];
    return `<button class="watch-row ${symbol === selected ? "active" : ""}" data-symbol="${symbol}"><div><b>${symbol}</b><small>${d.name}</small></div><span>${d.price.toFixed(2)}</span><span class="delta ${d.change >= 0 ? "up" : "down"}">${signed(d.change)}</span></button>`;
  }).join("");
  $("#watchCount").textContent = `${watch.length} symbols`;
}

function stat(label, value) { return `<div class="stat"><span>${label}</span><b>${value}</b></div>`; }
function info(label, value, cls = "") { return `<div class="info-card"><span>${label}</span><b class="${cls}">${value}</b></div>`; }

function renderQuote() {
  const d = MARKET[selected];
  $("#symbol").textContent = selected;
  $("#companyName").textContent = d.name;
  $("#exchange").textContent = `${d.exchange} · USD · DEMO`;
  $("#price").textContent = d.price.toFixed(2);
  const direction = d.change >= 0 ? "up" : "down";
  const absolute = d.price * d.change / (100 + d.change);
  $("#priceChange").className = direction;
  $("#priceChange").textContent = `${absolute >= 0 ? "+" : ""}${absolute.toFixed(2)}  (${signed(d.change)})`;
  $("#statStrip").innerHTML = stat("시가총액", d.cap) + stat("P/E", d.pe) + stat("거래량", d.volume) + stat("52주 고가", money(d.high52)) + stat("52주 저가", money(d.low52)) + stat("배당수익률", d.dividend);
  $("#mobileSummary").innerHTML = info("섹터", d.sector) + info("베타", d.beta) + info("매출", d.revenue) + info("순이익률", d.margin);
  $("#orderSymbol").textContent = selected;
  updateOrderEstimate();
  renderChart();
  renderSection();
  renderInsight();
  renderPortfolio();
}

function renderChart() {
  chartPoints = seeded(selected, ranges[currentRange]);
  const vals = chartPoints.map(p => p.value);
  const min = Math.min(...vals), max = Math.max(...vals), pad = (max - min || 1) * .12;
  const x = i => 16 + i / (vals.length - 1) * 868;
  const y = v => 300 - (v - (min - pad)) / ((max + pad) - (min - pad)) * 275;
  const line = chartPoints.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  $("#linePath").setAttribute("d", line);
  $("#areaPath").setAttribute("d", `${line} L884,315 L16,315 Z`);
  $("#gridLines").innerHTML = [60, 120, 180, 240, 300].map(v => `<line x1="16" x2="884" y1="${v}" y2="${v}"></line>`).join("");
  $("#chartHigh").textContent = `H ${max.toFixed(2)}`;
  $("#chartLow").textContent = `L ${min.toFixed(2)}`;
  $("#volumeBars").innerHTML = chartPoints.map(p => `<i style="height:${Math.round(p.volume * 100)}%"></i>`).join("");
  $("#priceChart").dataset.min = min; $("#priceChart").dataset.max = max;
}

function renderSection(section = $(".section-tabs .active")?.dataset.section || "news") {
  const d = MARKET[selected];
  if (section === "news") {
    const items = NEWS[selected] || NEWS.DEFAULT;
    $("#sectionContent").innerHTML = items.map((title, i) => `<article class="news-row"><time>${["09:42", "08:15", "07:30"][i]}</time><div><h3>${title}</h3><p>${d.name} 및 ${d.sector} 업종의 주요 변수와 시장 기대를 정리한 데모 헤드라인입니다.</p></div><em>${i ? "MARKET" : "TOP"}</em></article>`).join("");
  } else if (section === "company") {
    $("#sectionContent").innerHTML = `<p class="company-copy">${d.description}</p><div class="info-grid">${info("거래소", d.exchange)}${info("섹터", d.sector)}${info("시가총액", d.cap)}${info("베타", d.beta)}${info("52주 범위", `${d.low52} — ${d.high52}`)}${info("배당수익률", d.dividend)}</div>`;
  } else if (section === "financials") {
    $("#sectionContent").innerHTML = `<div class="financial-grid">${info("매출 TTM", d.revenue)}${info("순이익률", d.margin)}${info("EPS TTM", d.eps)}${info("P/E", d.pe)}${info("분기 매출 성장", "+18.4%", "up")}${info("분기 EPS 성장", "+22.1%", "up")}</div><p class="company-copy">재무 수치는 UI 검증을 위한 데모 값입니다. 실제 공시 데이터 연동 전 투자 판단에 사용하지 마세요.</p>`;
  } else {
    $("#sectionContent").innerHTML = `<div class="macro-grid">${info("Fed 기준금리", "3.75–4.00%")}${info("미국 CPI YoY", "2.7%")}${info("미국 10Y", "4.18%")}${info("달러 인덱스", "97.42")}${info("VIX", "16.42", "down")}${info("금", "$3,382.60", "up")}</div><p class="company-copy">거시 지표도 현재는 고정 데모 데이터입니다.</p>`;
  }
}

function renderInsight() {
  const d = MARKET[selected];
  const positive = d.change >= 0;
  $("#insightText").textContent = `${selected}는 오늘 ${positive ? "시장 대비 견조한 흐름" : "단기 차익실현 압력"}을 보이고 있습니다. ${d.sector} 업종의 실적 기대와 금리 변화가 다음 변동성의 핵심 변수입니다.`;
  $("#momentumSignal").textContent = positive ? "POSITIVE" : "CAUTION";
  $("#momentumSignal").className = positive ? "up" : "down";
}

function getPortfolio() { return JSON.parse(localStorage.getItem("bi:portfolio") || '{}'); }
function savePortfolio(p) { localStorage.setItem("bi:portfolio", JSON.stringify(p)); }
function renderPortfolio() {
  const p = getPortfolio(); let total = 0, cost = 0;
  const rows = Object.entries(p).filter(([, v]) => v.qty > 0).map(([symbol, pos]) => {
    const value = pos.qty * MARKET[symbol].price; total += value; cost += pos.qty * pos.avg;
    const pnl = value - pos.qty * pos.avg;
    return `<div class="position-row"><div><b>${symbol}</b><small>${pos.qty}주 · 평균 ${money(pos.avg)}</small></div><span class="${pnl >= 0 ? "up" : "down"}">${money(value)}<small>${pnl >= 0 ? "+" : ""}${money(pnl)}</small></span></div>`;
  }).join("");
  const pnl = total - cost, pct = cost ? pnl / cost * 100 : 0;
  $("#portfolioValue").textContent = money(total);
  $("#portfolioPnl").textContent = `${pnl >= 0 ? "+" : ""}${money(pnl)} (${signed(pct)})`;
  $("#portfolioPnl").className = pnl >= 0 ? "up" : "down";
  $("#positions").innerHTML = rows || `<p class="order-note">모의 주문을 넣으면 여기에 표시됩니다.</p>`;
}

function updateOrderEstimate() {
  const qty = Math.max(0, Number($("#orderQty").value) || 0);
  $("#orderEstimate").textContent = money(qty * MARKET[selected].price);
}

function placeOrder() {
  const qty = Math.max(1, Math.floor(Number($("#orderQty").value) || 1));
  const price = MARKET[selected].price; const p = getPortfolio();
  const old = p[selected] || { qty: 0, avg: price };
  if (orderSide === "sell" && old.qty < qty) return toast("보유 수량이 부족합니다.");
  if (orderSide === "buy") {
    const nextQty = old.qty + qty;
    p[selected] = { qty: nextQty, avg: (old.qty * old.avg + qty * price) / nextQty };
  } else p[selected] = { ...old, qty: old.qty - qty };
  savePortfolio(p); renderPortfolio(); toast(`${selected} ${qty}주 모의 ${orderSide === "buy" ? "매수" : "매도"} 완료`);
}

function selectSymbol(symbol) {
  selected = symbol; localStorage.setItem("bi:selected", symbol);
  renderWatchlist(); renderQuote();
  if (innerWidth <= 780) setView("home");
}

function openCommand() {
  $("#commandDialog").showModal(); $("#commandInput").value = ""; renderCommandResults();
  requestAnimationFrame(() => $("#commandInput").focus());
}
function renderCommandResults(query = "") {
  const q = query.trim().toUpperCase();
  const list = Object.entries(MARKET).filter(([s, d]) => !q || s.includes(q) || d.name.toUpperCase().includes(q)).slice(0, 9);
  $("#commandResults").innerHTML = list.map(([s, d], i) => `<button type="button" class="command-result ${i === 0 ? "selected" : ""}" data-symbol="${s}"><b>${s}</b><span>${d.name}</span><em>${d.exchange}</em></button>`).join("");
}
function addToWatch(symbol) {
  if (!watch.includes(symbol)) { watch.push(symbol); localStorage.setItem("bi:watch", JSON.stringify(watch)); toast(`${symbol} 관심종목 추가`); }
  else toast(`${symbol}은 이미 관심종목입니다.`);
  renderWatchlist();
}
function setView(view) {
  document.body.dataset.view = view;
  $$(".mobile-nav button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  scrollTo({ top: 0, behavior: "smooth" });
}
let toastTimer;
function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2200); }

function updateClock() {
  const now = new Date();
  $("#clock").textContent = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now) + " KST";
  const ny = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(now));
  $("#marketState").textContent = ny >= 9 && ny < 16 ? "MARKET OPEN" : "MARKET CLOSED";
}

$("#watchlist").addEventListener("click", e => { const row = e.target.closest("[data-symbol]"); if (row) selectSymbol(row.dataset.symbol); });
$("#rangeTabs").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; currentRange = b.dataset.range; $$("#rangeTabs button").forEach(x => x.classList.toggle("active", x === b)); renderChart(); });
$("#sectionTabs").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; $$("#sectionTabs button").forEach(x => x.classList.toggle("active", x === b)); renderSection(b.dataset.section); });
$("#sideToggle").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; orderSide = b.dataset.side; $$("#sideToggle button").forEach(x => x.classList.toggle("active", x === b)); $("#orderButton").textContent = `모의 ${orderSide === "buy" ? "매수" : "매도"}`; $("#orderButton").classList.toggle("sell", orderSide === "sell"); });
$("#orderQty").addEventListener("input", updateOrderEstimate);
$("#orderButton").addEventListener("click", placeOrder);
$("#resetPortfolio").addEventListener("click", () => { localStorage.removeItem("bi:portfolio"); renderPortfolio(); toast("모의 포트폴리오를 초기화했습니다."); });
$("#commandTrigger").addEventListener("click", openCommand);
$("#addSymbolButton").addEventListener("click", openCommand);
$("#commandInput").addEventListener("input", e => renderCommandResults(e.target.value));
$("#commandResults").addEventListener("click", e => { const r = e.target.closest("[data-symbol]"); if (!r) return; addToWatch(r.dataset.symbol); $("#commandDialog").close(); selectSymbol(r.dataset.symbol); });
$(".mobile-nav").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setView(b.dataset.view); });
addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" || (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName))) { e.preventDefault(); openCommand(); } });
$("#chartHitbox").addEventListener("pointermove", e => {
  const svg = $("#priceChart"), rect = svg.getBoundingClientRect();
  const px = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const i = Math.round(px * (chartPoints.length - 1)), p = chartPoints[i], x = 16 + i / (chartPoints.length - 1) * 868;
  const vals = chartPoints.map(p => p.value), min = Math.min(...vals), max = Math.max(...vals), pad = (max - min || 1) * .12;
  const y = 300 - (p.value - (min - pad)) / ((max + pad) - (min - pad)) * 275;
  const cursor = $("#chartCursor"); cursor.hidden = false; cursor.setAttribute("transform", `translate(${x} 0)`); cursor.querySelector("circle").setAttribute("cy", y);
  const tip = $("#chartTooltip"); tip.hidden = false; tip.textContent = `${selected}  ${p.value.toFixed(2)}`; tip.style.left = `${Math.min(rect.width - 110, Math.max(5, e.clientX - rect.left + 12))}px`; tip.style.top = `${Math.max(8, e.clientY - rect.top - 20)}px`;
});
$("#chartHitbox").addEventListener("pointerleave", () => { $("#chartCursor").hidden = true; $("#chartTooltip").hidden = true; });

renderTicker(); renderWatchlist(); renderQuote(); updateClock(); setInterval(updateClock, 1000); setView("home");
