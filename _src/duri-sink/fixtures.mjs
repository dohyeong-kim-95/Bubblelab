// 당이 가짜 캘린더 — 벤치마크(bench.mjs)와 터미널 하네스(dangi.mjs)가 같이 쓴다. 날짜 계산이 맞는지 보려면
// "오늘"도 고정이어야 해서 FAKE_TODAY 와 한 묶음이다.
export const FAKE_TODAY = "2026-10-25"; // 일요일
const ev = (id, date, title, extra = {}) => ({ id, date, title, rev: 1, ...extra });
export const FAKE_EVENTS = [
  ev("a1", "2026-10-27", "회식", { start: "19:00" }), ev("a2", "2026-10-29", "PT", { start: "07:00" }),
  ev("a3", "2026-10-31", "임장", { start: "10:00" }), ev("a4", "2026-11-02", "테스트"),
  ev("a5", "2026-11-04", "치과", { start: "15:00" }), ev("a6", "2026-11-07", "결혼식", { start: "12:00" }),
  ev("a7", "2026-11-10", "엄마 생신"), ev("a8", "2026-11-12", "출장", { endDate: "2026-11-13" }),
  { id: "palettecolors", rev: 1, kind: "palette", byName: { 쫑: "#bcc900", 빵: "#9529e3" }, shared: "#ff5c5c" },
  { id: "bk1", rev: 1, kind: "bucket", title: "한강 피크닉", by: "쫑", at: 1 },
  { id: "bk2", rev: 1, kind: "bucket", title: "도자기 공방 원데이 클래스", by: "빵", at: 2 },
  { id: "bk3", rev: 1, kind: "bucket", title: "제주도 일출 보기", by: "빵", at: 3 },
  { id: "bk4", rev: 1, kind: "bucket", title: "방탈출 카페", by: "쫑", at: 4, done: true, doneAt: 5 },
];
