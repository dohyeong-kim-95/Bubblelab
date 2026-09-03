// DRAM 커맨드·타이밍 규칙의 공통 뼈대. 세대 파일(ddr5.js·lpddr5.js …)이 이 모양을 채운다.
// **여기에 숫자는 없다** — 있는 것은 "무엇을 적을 수 있는가"의 정의뿐이다.
//
// 이 화면이 답하려는 질문은 하나다: "지금 이 커맨드를 낼 수 있는가, 없다면 무엇이
// 몇 클럭 남았는가." 그래서 데이터의 중심은 파라미터 표가 아니라 **규칙 표**다 —
// (선행 커맨드, 후행 커맨드, 범위) → 최소 간격. 파라미터는 그 규칙이 참조하는 값이고,
// 커맨드는 그 규칙이 오가는 꼭짓점이다.

/* 규칙이 걸리는 범위. 뱅크그룹이 왜 생겼는지가 여기 다 들어 있다 —
 * 같은 그룹 안에서는 센스앰프·IO 를 나눠 쓰므로 간격이 길고(_L), 그룹이 다르면 짧다(_S). */
export const SCOPES = {
  bank: { label: "같은 뱅크", test: (a, b) => a.bg === b.bg && a.bank === b.bank },
  bg: { label: "같은 뱅크그룹", test: (a, b) => a.bg === b.bg },
  "bg-other": { label: "같은 그룹의 다른 뱅크", test: (a, b) => a.bg === b.bg && a.bank !== b.bank },
  diffbg: { label: "다른 뱅크그룹", test: (a, b) => a.bg !== b.bg },
  rank: { label: "랭크 전체", test: () => true },
};

/* 뱅크가 가질 수 있는 상태. JEDEC 의 state diagram 을 이 화면에 필요한 만큼만 줄인 것 —
 * 파워다운·셀프리프레시는 아직 없다(2단계). */
export const BANK_STATES = {
  idle: { label: "Idle", hint: "행이 닫혀 있다. ACT 로 열 수 있다." },
  active: { label: "Active", hint: "행 하나가 센스앰프에 올라와 있다. RD/WR 가능." },
};

/* 커맨드 하나의 모양.
 *   op       화면과 규칙 표에서 쓰는 이름
 *   target   "bank" 한 뱅크를 고른다 | "all" 랭크 전체 | "none" 대상 없음
 *   needs    낼 수 있으려면 대상 뱅크가 있어야 하는 상태
 *   makes    낸 뒤 대상 뱅크의 상태
 *   bus      "read" | "write" | null — DQ 버스를 언제 쓰는지(RL/WL 로 계산)
 *   ca       커맨드 버스(CA)를 몇 클럭 붙잡는가. **커맨드 버스는 직렬이다** —
 *            한 클럭에 두 커맨드를 낼 수 없고, 주소가 큰 커맨드는 여러 클럭에 나눠 보낸다.
 */
export function command(op, fields) {
  return { op, target: "bank", needs: null, makes: null, bus: null, ca: 1, ...fields };
}

/* 규칙 하나. terms 는 클럭으로 더해질 항의 목록이다.
 * 파라미터 이름이거나 "BL/2" 같은 파생 항이며, 화면이 이걸 그대로 펼쳐 보여 준다 —
 * "왜 이 간격이 38클럭인가"에 답하는 것이 이 배열이다. */
export function rule(from, to, scope, terms, why) {
  return { from, to, scope, terms: [].concat(terms), why };
}

/* 굴러가는 창 제약(tFAW). 앞의 규칙들과 달리 "직전 하나"가 아니라
 * "최근 N 개"를 본다 — 짧은 시간에 행을 여러 개 여는 순간 전류가 몰리기 때문이다. */
export function window_(op, count, param, why) {
  return { op, count, param, why };
}

/* 파라미터 값. JEDEC 는 대부분 max(x nCK, y ns) 꼴로 준다 —
 * 코어는 물리(ns)에 묶여 있고 인터페이스는 클럭에 묶여 있어서, 속도를 올리면
 * 둘 중 하나가 이긴다. 이 두 칸을 나눠 둔 이유가 그것이다.
 *   ns      나노초 하한 (없으면 null)
 *   ck      클럭 하한 (없으면 null)
 *   why     왜 이 제약이 존재하는가 — 한 줄
 *   verify  값의 출처가 대표값이라 스펙과 대조가 필요하면 true
 */
export function param(fields) {
  return { ns: null, ck: null, why: "", verify: false, ...fields };
}

/* ns → 클럭. 항상 올림이다. 클럭 경계 안쪽으로 값을 깎으면 스펙 위반이 된다. */
export const nsToCk = (ns, tCKns) => Math.ceil(ns / tCKns - 1e-9);

/* 데이터레이트(MT/s) → 클럭 주기(ns). DDR 은 클럭 양쪽 에지로 보내므로 클럭은 절반이다. */
export const tCKns = (mtps) => 2000 / mtps;
