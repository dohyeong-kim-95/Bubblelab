// PC 로 보내기. LIFE 본체는 이 파일을 평소에 받지 않는다 — 보낼 때가 됐는지는
// `life/app.js` 가 먼저 보고, 그때만 동적 import 하므로 여는 속도에 섞이지 않는다.
import { collectAll } from "./collect.js";
import { slimEnvelope } from "./store.js";

export const PUSHED_AT_KEY = "bl_backup_pushed_at";

/** 지금 보낸다. 표지 같은 큰 이미지는 빼고 보낸다(서버로 사진을 올리지 않는다). */
export async function push() {
  const envelope = slimEnvelope(await collectAll());
  const response = await fetch("/_life/backup", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  });
  if (!response.ok) throw new Error(`PC 백업 실패 (${response.status})`);
  const result = await response.json().catch(() => ({}));
  localStorage.setItem(PUSHED_AT_KEY, String(Date.now()));
  return result;
}
