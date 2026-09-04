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
/*   why     왜 이 제약이 존재하는가
 *   breaks  **안 지키면 무슨 일이 나는가.** 설명이 막히는 자리가 대개 여기다 —
 *           "몇 클럭"은 외워도 "왜 그걸 지켜야 하나"는 말로 못 하는 경우가 많다.
 *   family  어느 무리인가. 헷갈리는 것끼리 나란히 놓기 위한 것이다(tRP↔tRTP↔tWR 처럼).
 */
export function param(fields) {
  return { ns: null, ck: null, why: "", breaks: "", family: null, verify: false, src: null, ...fields };
}

/* 파라미터의 무리. 설명이 막히는 지점은 거의 항상 **비슷한 것끼리 헷갈릴 때**라,
 * 하나를 볼 때 같은 무리를 함께 보여 준다. 같은 무리에서 커맨드 쌍까지 같고 범위만
 * 다른 것은 화면이 "짝"으로 표시한다 — tCCD_L/tCCD_S 처럼. */
export const FAMILIES = {
  row: { label: "행 여닫기", note: "한 행을 열고 쓰고 닫는 한 바퀴에 걸리는 것들." },
  spacing: { label: "연속 열기", note: "행을 잇달아 열 때 걸리는 것들. 전류가 몰리는 것을 막는다." },
  bus: { label: "버스 점유", note: "DQ 를 얼마나 촘촘히 이어 쓸 수 있는가." },
  turn: { label: "방향 전환·마무리", note: "읽기/쓰기를 끝내고 다음으로 넘어갈 때 걸리는 것들. 서로 가장 헷갈린다." },
  latency: { label: "레이턴시", note: "커맨드를 낸 뒤 데이터가 오가기까지. 클럭에 묶여 있다." },
  refresh: { label: "리프레시", note: "전하가 새기 전에 다시 써 넣는 일." },
};

/* ---------- 값의 출처 ----------
 *
 * 이 화면은 **두 층만 쓴다.**
 *
 *   1층 — 표준이 정하는 것: 커맨드 인코딩, 상태 머신, 규칙(어느 커맨드 쌍 사이에
 *          어느 파라미터가 걸리는가), 뱅크 구성, 파라미터의 정의와 max(x nCK, y ns)
 *          표기 형식. **구조 전부가 여기다.**
 *   3층 — 널리 알려진 원리: 전하공유 → 센싱 → 복원으로 이어지는 어레이 동작,
 *          워드라인을 VDD 위로 올리는 이유. **파형의 모양이 여기다.**
 *
 * 2층(부품 데이터시트의 실제 값)은 **쓰지 않는다.** 그래서 이 파일들에 적힌
 * **숫자는 전부 모의값이다** — 어떤 부품의 값도 아니고, 어떤 스피드빈의 값도 아니다.
 * 그림을 그리고 클럭을 세려면 숫자가 하나는 있어야 해서 둔 것뿐이다.
 *
 * 모의값을 고를 때 지킨 것은 **관계**다. tRC = tRAS + tRP 이고, tCCD_L ≥ tCCD_S 이고,
 * 쓰기 회복이 읽기보다 길고, tRFC 가 tRC 보다 훨씬 크다. 배우는 것은 이 관계이지
 * 절대값이 아니므로, 오히려 반올림된 수가 따라가기 쉽다.
 *
 * 실제 값이 필요하면 스펙 문서를 보고 spec/ 의 숫자를 직접 바꾼다. 바꾸는 순간
 * 화면·파형·테스트가 함께 따라온다.
 */
export const PROVENANCE = {
  standard: {
    label: "표준",
    note: "표준이 정하는 구조와 정의 — 커맨드, 상태 전이, 어느 커맨드 쌍에 어느 파라미터가 걸리는가.",
  },
  known: {
    label: "알려진 원리",
    note: "교과서와 공개 발표 수준으로 널리 알려진 동작 원리. 특정 업체의 회로가 아니다.",
  },
  mock: {
    label: "모의값",
    note: "그림을 그리고 클럭을 세기 위해 둔 가짜 숫자다. **어떤 부품의 값도 아니다.** 관계(tRC = tRAS + tRP 같은)만 실제와 맞춰 뒀다.",
  },
};

/* 표의 값에 출처를 채운다. 기본을 주고 예외만 값에 직접 적는다 —
 * 열일곱 줄에 같은 글자를 반복하면 오히려 빠뜨린 것이 눈에 안 띈다. */
export function withSrc(fallback, params) {
  return Object.fromEntries(Object.entries(params)
    .map(([name, p]) => [name, { ...p, src: p.src ?? (p.ns == null && p.ck == null ? null : fallback) }]));
}

/* ns → 클럭. 항상 올림이다. 클럭 경계 안쪽으로 값을 깎으면 스펙 위반이 된다. */
export const nsToCk = (ns, tCKns) => Math.ceil(ns / tCKns - 1e-9);

/* 데이터레이트(MT/s) → 클럭 주기(ns). DDR 은 클럭 양쪽 에지로 보내므로 클럭은 절반이다. */
export const tCKns = (mtps) => 2000 / mtps;

/* ---------- 파형 ----------
 *
 * **JEDEC 은 내부 회로 노드의 전압 파형을 규정하지 않는다.** 스펙이 정하는 것은
 * 핀(CK·CS_n·CA·DQ·DQS)의 타이밍과 로직 레벨까지고, 워드라인·비트라인·센스앰프는
 * 소자 물리와 회로 설계 영역이라 업체·공정마다 다르다. 그래서 어레이 내부 파형은
 * **모식도**로만 그린다 — 값을 아는 척하지 않되, 타이밍 파라미터가 왜 그 길이인지는
 * 이 그림으로만 보이기 때문에 그린다.
 */

/* 전압 레일. 공개 자료 기준 대표값이다. */
export function rails(fields) {
  return { VSS: 0, VDD: null, VPP: null, dV: null, note: "", src: {}, ...fields };
}
export const VBLP = (r) => r.VDD / 2;   // 비트라인 프리차지 전위는 두 레일의 가운데다

/* 어레이 내부 사건이 tRCD·tRP 안 어디쯤에서 일어나는가 — **비율**로만 적는다.
 * 절대 시간을 지어내지 않으려는 것이고, 그래서 빈이 바뀌어도 그림이 함께 늘어난다.
 * 이 비율 자체가 모식도의 전부이므로 한 곳에 모아 둔다. */
export const ARRAY_SHAPE = {
  wlRise: 0.15,     // tRCD 의 이만큼 지나 워드라인이 VPP 에 닿는다
  shareEnd: 0.35,   // 전하공유가 끝나 비트라인 쌍이 ΔV 만큼 갈라진다
  saeOn: 0.40,      // 센스앰프가 켜진다
  senseEnd: 0.85,   // 증폭이 끝나 비트라인이 양 레일에 닿는다 (tRCD 전에 끝나야 한다)
  preFall: 0.10,    // PRE 후 tRP 의 이만큼 지나 워드라인이 내려간다
  cslDelay: 2,      // RD 뒤 컬럼선택선이 열리기까지 (클럭)
  note: "내부 사건의 위치는 모식도다 — JEDEC 이 정하지 않는다.",
};

/* ---------- 참고문헌 ----------
 *
 * 이 화면의 숫자가 어디서 왔는지 밝히는 자리다. 값이 대표값인 이상 **어디를 보면
 * 확인할 수 있는지**가 값 자체만큼 중요하다.
 *
 * 링크는 문서로 바로 가는 깊은 주소 대신 **발행처의 대문**을 건다. 표준 문서의 주소는
 * 개정판마다 바뀌어 금방 깨지는데, 끊긴 링크는 없느니만 못하다. 대신 문서번호를
 * 적어 두면 그 사이트에서 바로 찾을 수 있다.
 *
 *   kind   "표준" | "값" | "모식도"
 *   doc    문서번호 (있으면)
 *   where  어디서 어떻게 구하는가
 *   url    발행처 (없으면 null — 출처가 문서가 아닌 경우)
 */
export function ref(kind, title, fields = {}) {
  return { kind, title, doc: null, where: "", url: null, ...fields };
}
