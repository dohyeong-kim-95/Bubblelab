import { collectAll, restoreAll } from "./collect.js";
import { PREFIX, fileName, parseEnvelope, summarize } from "./store.js";
import { push } from "./push.js";

const $ = (id) => document.getElementById(id);

/* ── 화면 ──────────────────────────────────────────────────────────────── */
function renderList(target, envelope) {
  const items = summarize(envelope);
  target.replaceChildren(...items.map((item) => {
    const row = document.createElement("li");
    row.append(item.name.replace(PREFIX, ""));
    const meta = document.createElement("span");
    meta.className = "count";
    meta.textContent = item.count === null ? item.kind : `${item.kind} ${item.count}개`;
    row.append(meta);
    return row;
  }));
  return items.length;
}

async function refresh() {
  const envelope = await collectAll();
  const count = renderList($("current"), envelope);
  $("current-empty").hidden = count > 0;
  await refreshSink();
  return envelope;
}

/* PC 백업(sink) — 폰이 하루 한 번 자동으로 올리고, 집 PC 데몬이 받아 간다. */
async function refreshSink() {
  try {
    const response = await fetch("/_life/backup/status", { credentials: "same-origin" });
    if (!response.ok) throw new Error(String(response.status));
    const { savedAt, bytes } = await response.json();
    $("sink-state").textContent = savedAt
      ? `${new Date(savedAt).toLocaleString("ko-KR")} · ${Math.ceil(bytes / 1024)}KB`
      : "아직 올린 적 없음";
  } catch { $("sink-state").textContent = "확인할 수 없음"; }
}

let pending = null;

$("export-button").addEventListener("click", async () => {
  $("status").textContent = "모으는 중…";
  try {
    const envelope = await refresh();
    const blob = new Blob([JSON.stringify(envelope)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName();
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    $("status").textContent = `${link.download} 로 내보냈습니다.`;
  } catch (error) { $("status").textContent = `내보내지 못했습니다: ${error.message}`; }
});

$("sink-push").addEventListener("click", async () => {
  $("sink-state").textContent = "보내는 중…";
  try { await push(); } catch (error) { $("status").textContent = error.message; }
  await refreshSink();
});

$("sink-token").addEventListener("click", async () => {
  $("token-output").hidden = false;
  $("token-output").textContent = "발급 중…";
  try {
    const response = await fetch("/_life/sink-token", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw new Error(`발급 실패 (${response.status})`);
    $("token-output").textContent = (await response.json()).token ?? "응답에 토큰이 없습니다";
  } catch (error) { $("token-output").textContent = error.message; }
});

$("import-input").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    pending = parseEnvelope(await file.text());
    renderList($("incoming"), pending);
    $("incoming-when").textContent = pending.exportedAt
      ? `${new Date(pending.exportedAt).toLocaleString("ko-KR")} 에 내보낸 파일` : "";
    $("confirm").showModal();
  } catch (error) { $("status").textContent = `읽지 못했습니다: ${error.message}`; }
});

$("confirm-cancel").addEventListener("click", () => { pending = null; $("confirm").close(); });
$("confirm-ok").addEventListener("click", async () => {
  if (!pending) return;
  $("confirm").close();
  $("status").textContent = "되돌리는 중…";
  try {
    await restoreAll(pending);
    pending = null;
    await refresh();
    $("status").textContent = "가져왔습니다. 각 화면을 다시 열면 반영됩니다.";
  } catch (error) { $("status").textContent = `가져오지 못했습니다: ${error.message}`; }
});

refresh().catch(() => { $("current-empty").hidden = false; });
