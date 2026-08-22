// 지난 다이제스트를 다시 보는 화면. 고르고 요약하는 일은 전부 서버(cron)가 하고
// 여기서는 보관본을 그리기만 한다.
//
// LIFE 도구 관례: ../styles.css 의 토큰을 그대로 쓰고 색을 새로 정하지 않는다.
// 저장소를 쓰지 않으므로 bl_ 접두사 규칙에 걸릴 것도 없다.

const FIELDS = ["한줄", "아이디어", "가정", "예산", "걸림돌"];
const feed = document.getElementById("feed");
const updated = document.getElementById("updated");

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function paperCard(paper) {
  const hit = paper.score >= 8;
  const card = element("article", `paper${hit ? " hit" : ""}`);

  const heading = element("h3");
  const link = element("a", null, `${hit ? "🎯" : "🔍"} ${paper.title}`);
  link.href = paper.link;
  link.rel = "noopener noreferrer";
  link.target = "_blank";
  heading.append(link);
  card.append(heading);

  const bits = [`${paper.score}점`, paper.categories.join(" · ")];
  if (paper.authors?.length) bits.push(`${paper.authors[0]} 외 ${Math.max(0, paper.authors.length - 1)}명`);
  card.append(element("p", "meta", bits.filter(Boolean).join("  |  ")));

  const summary = paper.summary_ko ?? {};
  const shown = FIELDS.filter((field) => summary[field]);
  if (shown.length) {
    const list = document.createElement("dl");
    for (const field of shown) {
      list.append(element("dt", null, field));
      list.append(element("dd", null, summary[field]));
    }
    card.append(list);
  } else if (paper.summary) {
    // 요약이 실패한 편은 초록을 그대로 보여준다 — 빈 카드보다 낫다.
    card.append(element("p", "abstract", paper.summary));
  }
  return card;
}

function dayBlock(digest) {
  const block = element("section", "day");
  const hits = digest.hits ?? [];
  const near = digest.near ?? [];
  const note = hits.length ? `🎯 ${hits.length}편` : "🎯 없음";
  block.append(element("h2", null, `${digest.date}  ·  ${note}${near.length ? ` · 🔍 ${near.length}편` : ""}`));
  for (const paper of [...hits, ...near]) block.append(paperCard(paper));
  return block;
}

async function load() {
  try {
    const response = await fetch("/_papers/archive?limit=21", { headers: { Accept: "application/json" } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      feed.replaceChildren(element("p", "empty", body.error ?? "불러오지 못했습니다."));
      return;
    }
    const digests = (body.digests ?? []).filter((d) => (d.hits?.length ?? 0) + (d.near?.length ?? 0) > 0);
    if (!digests.length) {
      feed.replaceChildren(element("p", "empty", "아직 쌓인 다이제스트가 없습니다. 내일 아침에 첫 편이 옵니다."));
      return;
    }
    feed.replaceChildren(...digests.map(dayBlock));
    updated.textContent = `${digests[0].date} 까지 · ${digests.length}일치`;
  } catch {
    feed.replaceChildren(element("p", "empty", "서버에 연결하지 못했습니다."));
  }
}

load();
