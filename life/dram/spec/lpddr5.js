// LPDDR5 (JESD209-5). 모바일 쪽 관점.
//
// DDR5 와 같은 원칙이다 — 구조는 표준(1층), 파형은 알려진 원리(3층),
// **숫자는 전부 모의값**. 부품 데이터시트의 값은 쓰지 않는다.
//
// RL/WL 은 모의값조차 두지 않았다. 동작 모드에 따라 표가 갈라지는 구조 자체가
// 이 세대의 성격이라, 하나로 뭉뚱그린 가짜 숫자를 두면 그 성격이 지워진다.
// 그래서 데이터 버스트는 그려지지 않는다.

import { command, param, rails, ref, rule, window_, withSrc } from "./common.js";

export default {
  id: "lpddr5",
  label: "LPDDR5",
  status: "partial",
  status_note: "구조는 표준, 숫자는 모의값이다. RL/WL 은 비워 뒀으므로 데이터 버스트는 그려지지 않는다.",

  org: {
    bankGroups: 4,
    banksPerGroup: 4,
    label: "BG 모드 기준 4 뱅크그룹 × 4 뱅크 = 16 뱅크",
    note:
      "LPDDR5 는 뱅크 구성을 모드로 고른다 — BG(4×4)·8B(8뱅크)·16B(16뱅크). " +
      "대역폭이 필요하면 BG 모드, 뱅크 병렬성이 필요하면 16B 모드다. 여기서는 BG 모드만 다룬다. " +
      "데이터는 CK 가 아니라 별도의 WCK 에 실린다 — 클럭을 필요할 때만 돌려 전력을 아끼는 구조다.",
  },

  bins: [
    { id: "mock", label: "모의 빈", mtps: 8000, params: {} },   // tCK 0.25ns
  ],

  params: withSrc("mock", {
    tRCD: param({ ns: 12, why: "행이 서기까지. 모바일은 속도보다 전력이 먼저라 데스크톱 쪽보다 여유가 있다." }),
    tRP: param({ ns: 12, why: "per-bank 프리차지. all-bank 는 이보다 길다." }),
    tRAS: param({ ns: 25, why: "복원이 끝날 때까지 행을 열어 둬야 하는 시간." }),
    tRC: param({ ns: 37, why: "같은 뱅크의 ACT → ACT. 정의상 tRAS + tRP 다." }),
    tRRD: param({ ns: 6, why: "연속 ACT 간격. LPDDR5 는 _L/_S 를 나누지 않는다 — 뱅크그룹 구분이 규칙에 드러나지 않는다." }),
    tFAW: param({ ns: 30, why: "어떤 창에서도 ACT 4번. 연속 ACT 간격(tRRD)만으로 낼 수 있는 것보다 길어야 뜻이 있다." }),
    tWR: param({ ns: 18, why: "쓰기 데이터가 끝난 뒤 PRE 까지." }),
    tRTP: param({ ns: 5, why: "READ 뒤 같은 뱅크 PRE 까지." }),
    tWTR: param({ ns: 6, why: "쓰기에서 읽기로 방향을 돌리는 시간." }),
    tRFCab: param({ ns: 90, why: "all-bank 리프레시. 어레이 전체가 잠긴다." }),
    tRFCpb: param({ ns: 45, why: "per-bank 리프레시. LPDDR 은 오래전부터 이걸 갖고 있었다." }),
    tREFI: param({ ns: 2000, why: "리프레시 마감. 온도가 오르면 짧아진다." }),
    BL: param({ ck: 16, why: "버스트 길이. LPDDR5 는 16/32 를 고른다." }),
    RL: param({ why: "READ 레이턴시. 동작 모드마다 표가 갈라지는 것이 이 세대의 성격이라, 하나로 뭉뚱그린 모의값을 두지 않았다." }),
    WL: param({ why: "WRITE 레이턴시. 같은 이유로 비워 뒀다." }),
  }),

  rails: rails({
    VDD: 1.0, VPP: 2.0, dV: 0.05,
    src: { VDD: "mock", VPP: "mock", dV: "mock" },
    note: "모의값이다. LPDDR5 는 DDR5 처럼 VPP 핀을 두지 않고 내부 펌프로 부스트를 만들며 IO 는 코어와 다른 전원으로 따로 논다 — 그 구조가 요점이지 숫자가 아니다.",
  }),

  refs: [
    ref("표준", "LPDDR5 SDRAM", {
      doc: "JESD209-5",
      where: "JEDEC. DDR5 와 다른 계열의 표준이다 — 뱅크 구성을 모드로 고르고, 데이터는 별도의 WCK 에 실리며, 리프레시가 per-bank 로 나뉜다. 이 화면의 구조가 그것이다.",
      url: "https://www.jedec.org/",
    }),
    ref("알려진 원리", "어레이 동작", {
      where: "DDR5 와 같다. 다만 LPDDR5 는 VPP 핀 없이 내부 펌프로 워드라인 부스트를 만든다 — 이것도 널리 알려진 구조다.",
    }),
    ref("모의값", "이 화면의 모든 숫자", {
      where: "부품 데이터시트의 값은 쓰지 않는다. 여기 적힌 숫자는 실제 부품의 값이 아니다. RL/WL 은 모의값조차 두지 않았다 — 동작 모드마다 표가 갈라지는 구조 자체가 이 세대의 성격이라, 하나로 뭉뚱그리면 그 성격이 지워지기 때문이다.",
    }),
  ],

  commands: [
    command("ACT", { needs: "idle", makes: "active", ca: 2, label: "ACT", desc: "행을 연다. LPDDR5 도 두 클럭에 나눠 보낸다." }),
    command("RD", { needs: "active", makes: "active", bus: "read", label: "RD", desc: "버스트 하나를 읽는다." }),
    command("WR", { needs: "active", makes: "active", bus: "write", label: "WR", desc: "버스트 하나를 쓴다." }),
    command("PRE", { needs: "active", makes: "idle", label: "PRE", desc: "행을 닫는다." }),
    command("PREA", { target: "all", needs: null, makes: "idle", label: "PREA", desc: "모든 뱅크를 닫는다." }),
    command("REFab", { target: "all", needs: "idle", makes: "idle", label: "REFab", desc: "all-bank 리프레시." }),
    command("REFpb", { needs: "idle", makes: "idle", label: "REFpb", desc: "per-bank 리프레시. 한 뱅크씩 돌아가며 쉰다." }),
    command("MRW", { target: "none", ca: 2, label: "MRW", desc: "모드 레지스터를 쓴다." }),
  ],

  rules: [
    rule("ACT", "RD", "bank", "tRCD", "행이 서기 전에는 읽을 것이 없다."),
    rule("ACT", "WR", "bank", "tRCD", "행이 서기 전에는 쓸 곳이 없다."),
    rule("ACT", "PRE", "bank", "tRAS", "복원이 끝나기 전에 닫으면 값이 깨진다."),
    rule("PRE", "ACT", "bank", "tRP", "비트라인이 돌아와야 다음 판별이 된다."),
    rule("ACT", "ACT", "bank", "tRC", "한 뱅크가 한 바퀴 도는 시간."),
    rule("ACT", "ACT", "rank", "tRRD", "그룹을 나누지 않으므로 연속 ACT 는 하나의 간격만 본다."),
    rule("RD", "PRE", "bank", "tRTP", "읽던 버스트를 끝내야 닫는다."),
    rule("WR", "PRE", "bank", ["tWR"], "쓰기 데이터가 셀에 돌아가야 닫는다. (WL 이 없어 데이터 끝 시점은 근사다.)"),
    rule("WR", "RD", "rank", ["tWTR"], "방향 전환. (WL 이 없어 근사다.)"),
    rule("REFab", "ACT", "rank", "tRFCab", "리프레시 동안 어레이 전체가 잠긴다."),
    rule("REFpb", "ACT", "bank", "tRFCpb", "그 뱅크만 잠기고 나머지는 계속 쓴다."),
    rule("PREA", "ACT", "rank", "tRP", "전체를 닫아도 프리차지 시간은 같다."),
  ],

  windows: [window_("ACT", 4, "tFAW", "행 열기의 전류 제약.")],
  refresh: { param: "tREFI", command: "REFab", note: "고온에서는 마감이 짧아진다." },
  sources: ["구조는 표준(JESD209-5)", "숫자는 전부 모의값 — RL/WL 은 비워 둠"],
};
