// 지난 다이제스트를 다시 보는 화면. 고르고 요약하는 일은 전부 집 PC 데몬이 하고
// 여기서는 보관본을 그리고 내 댓글을 붙이기만 한다.
//
// LIFE 도구 관례: ../styles.css 의 토큰을 그대로 쓰고 색을 새로 정하지 않는다.
// 댓글은 브라우저가 아니라 서버에 둔다 — 폰에서 적은 것을 PC 에서도 봐야 한다.

const FIELDS = ["한줄", "아이디어", "가정", "예산", "걸림돌"];
const feed = document.getElementById("feed");
const updated = document.getElementById("updated");

/** 논문 ID → 댓글 배열. 화면을 그리기 전에 한 번 받아 둔다. */
let comments = {};

const REVIEW_ORDER = [
  "무엇을 한 논문인가", "핵심 방법", "전제와 가정", "실험 설계",
  "내 문제 적용", "따라 해볼 것", "한계와 의심",
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const stamp = (at) => new Date(at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });

async function send(path, body) {
  const response = await fetch(`/_papers/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(response.status === 401 ? "로그인이 풀렸습니다" : "저장하지 못했습니다");
  return response.json();
}

/* ── 댓글 ────────────────────────────────────────────────────────────────
 * 논문 카드마다 하나씩. 목록을 다시 그리는 함수를 돌려주고, 저장이 끝나면
 * 그것만 다시 그린다 — 화면 전체를 새로 그리면 펼쳐 둔 날이 도로 접힌다.
 */
function commentBox(paperId) {
  const box = element("div", "comments");
  const list = element("ul", "comment-list");

  const draw = () => {
    const items = comments[paperId] ?? [];
    list.replaceChildren(...items.map((item) => {
      const row = element("li");
      row.append(element("span", "comment-at", stamp(item.at)));
      row.append(element("span", "comment-text", item.text));
      const remove = element("button", "comment-drop", "×");
      remove.type = "button";
      remove.title = "지우기";
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          const result = await send("comments/delete", { paperId, id: item.id });
          comments[paperId] = result.comments;
          draw();
        } catch (error) {
          remove.disabled = false;
          status.textContent = error.message;
        }
      });
      row.append(remove);
      return row;
    }));
  };

  const form = element("form", "comment-form");
  const input = element("input");
  input.type = "text";
  input.placeholder = "메모 남기기";
  input.maxLength = 1000;
  const submit = element("button", null, "남기기");
  submit.type = "submit";
  const status = element("span", "comment-status");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    submit.disabled = true;
    status.textContent = "";
    try {
      const result = await send("comments", { paperId, text });
      comments[paperId] = result.comments;
      input.value = "";
      draw();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  form.append(input, submit);
  box.append(list, form, status);
  draw();
  return box;
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

  card.append(commentBox(paper.id));
  return card;
}

/**
 * 하루치 한 덩어리. `<details>` 라서 접기·펴기에 스크립트가 필요 없다.
 *
 * **맨 위 하루만 펴 둔다** — 매일 쌓이는 화면이라 전부 펼치면 오늘 것을 보려고
 * 매번 한참 스크롤하게 된다. 댓글을 단 날은 접혀 있어도 몇 개인지 보이게 한다.
 */
function dayBlock(digest, open) {
  const block = element("details", "day");
  block.open = open;

  const papers = [...(digest.hits ?? []), ...(digest.near ?? [])];
  const counted = papers.reduce((sum, paper) => sum + (comments[paper.id]?.length ?? 0), 0);
  const bits = [
    digest.hits?.length ? `🎯 ${digest.hits.length}편` : "🎯 없음",
    digest.near?.length ? `🔍 ${digest.near.length}편` : "",
    counted ? `💬 ${counted}` : "",
  ].filter(Boolean);

  const head = element("summary");
  head.append(element("span", "day-date", digest.date));
  head.append(element("span", "day-note", bits.join(" · ")));
  block.append(head);

  for (const paper of papers) block.append(paperCard(paper));
  return block;
}

/**
 * 리뷰 한 편. 다이제스트와 나란히 두지 않고 위에 따로 모은다 — 저쪽은 서버가
 * 매일 만든 목록이고, 이건 읽기로 하고 붙들어 쓴 글이라 성격이 다르다.
 */
function reviewBlock(row) {
  const block = element("details", "review");
  const head = element("summary");
  head.append(element("span", "review-title", row.title));
  head.append(element("span", "day-note", stamp(row.at)));
  block.append(head);

  const link = element("a", "review-link", row.link);
  link.href = row.link;
  link.rel = "noopener noreferrer";
  link.target = "_blank";
  block.append(link);

  const list = document.createElement("dl");
  for (const field of REVIEW_ORDER.filter((f) => row.review?.[f])) {
    list.append(element("dt", null, field));
    list.append(element("dd", null, row.review[field]));
  }
  block.append(list);
  block.append(commentBox(row.id));
  return block;
}

async function load() {
  try {
    const [archive, mine, written] = await Promise.all([
      fetch("/_papers/archive?limit=21", { headers: { Accept: "application/json" } }),
      // 로그인이 풀렸으면 댓글 없이 읽기만 한다 — 목록까지 못 보게 할 이유는 없다.
      fetch("/_papers/comments", { headers: { Accept: "application/json" } }).catch(() => null),
      fetch("/_papers/reviews", { headers: { Accept: "application/json" } }).catch(() => null),
    ]);
    const body = await archive.json().catch(() => ({}));
    if (!archive.ok) {
      feed.replaceChildren(element("p", "empty", body.error ?? "불러오지 못했습니다."));
      return;
    }
    if (mine?.ok) comments = (await mine.json().catch(() => ({}))).comments ?? {};

    const digests = (body.digests ?? []).filter((d) => (d.hits?.length ?? 0) + (d.near?.length ?? 0) > 0);
    if (!digests.length) {
      feed.replaceChildren(element("p", "empty", "아직 쌓인 다이제스트가 없습니다. 내일 아침에 첫 편이 옵니다."));
      return;
    }
    const reviews = written?.ok ? (await written.json().catch(() => ({}))).reviews ?? [] : [];
    const blocks = digests.map((digest, index) => dayBlock(digest, index === 0));
    if (reviews.length) {
      const section = element("section", "reviews");
      section.append(element("h2", "reviews-head", `📝 읽고 쓴 것 ${reviews.length}편`));
      // 맨 위 하나만 펴 둔다 — 날짜 목록과 같은 규칙이라 화면이 한결같다.
      for (const [index, row] of reviews.entries()) {
        const block = reviewBlock(row);
        block.open = index === 0;
        section.append(block);
      }
      blocks.unshift(section);
    }
    feed.replaceChildren(...blocks);
    updated.textContent = `${digests[0].date} 까지 · ${digests.length}일치`;
  } catch {
    feed.replaceChildren(element("p", "empty", "서버에 연결하지 못했습니다."));
  }
}

load();
