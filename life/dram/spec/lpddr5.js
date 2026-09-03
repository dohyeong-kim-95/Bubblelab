// LPDDR5 (JESD209-5). 모바일 쪽 관점. 값은 공개 데이터시트 수준의 대표값이고,
// 레이턴시(RL/WL)는 동작 모드(DVFSC·WCK 비율·세트)마다 표가 달라 여기서는 비워 뒀다 —
// 지어내는 것보다 빈 칸이 낫다. 값을 아는 대로 채우면 화면이 그만큼 살아난다.

import { command, param, rule, window_ } from "./common.js";

export default {
  id: "lpddr5",
  label: "LPDDR5",
  status: "partial",
  status_note: "코어 타이밍은 채웠고 RL/WL 은 비어 있다. 데이터 버스트는 그려지지 않는다.",

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
    { id: "6400", label: "LPDDR5-6400", mtps: 6400, params: {} },
  ],

  params: {
    tRCD: param({ ns: 18, why: "행이 서기까지. DDR5 보다 길다 — 모바일은 속도보다 전력이 먼저다.", verify: true }),
    tRP: param({ ns: 18, why: "per-bank 프리차지. all-bank 는 이보다 길다.", verify: true }),
    tRAS: param({ ns: 42, why: "복원이 끝날 때까지 행을 열어 둬야 하는 시간.", verify: true }),
    tRC: param({ ns: 60, why: "같은 뱅크의 ACT → ACT.", verify: true }),
    tRRD: param({ ns: 10, why: "연속 ACT 간격. LPDDR5 는 _L/_S 를 나누지 않는다.", verify: true }),
    tFAW: param({ ns: 40, why: "어떤 창에서도 ACT 4번. 전류 제약은 모바일에서 더 빡빡하다.", verify: true }),
    tWR: param({ ns: 34, why: "쓰기 데이터가 끝난 뒤 PRE 까지.", verify: true }),
    tRTP: param({ ns: 7.5, why: "READ 뒤 같은 뱅크 PRE 까지.", verify: true }),
    tWTR: param({ ns: 10, why: "쓰기에서 읽기로 방향을 돌리는 시간.", verify: true }),
    tRFCab: param({ ns: 280, why: "all-bank 리프레시. 16Gb 기준.", verify: true }),
    tRFCpb: param({ ns: 140, why: "per-bank 리프레시. LPDDR 은 오래전부터 이걸 갖고 있었다.", verify: true }),
    tREFI: param({ ns: 3904, why: "리프레시 마감. 온도가 오르면 절반으로 줄어든다." }),
    BL: param({ ck: 16, why: "버스트 길이. LPDDR5 는 16/32 를 고른다." }),
    RL: param({ why: "READ 레이턴시. 모드마다 표가 달라 비워 뒀다." }),
    WL: param({ why: "WRITE 레이턴시. 모드마다 표가 달라 비워 뒀다." }),
  },

  commands: [
    command("ACT", { needs: "idle", makes: "active", ca: 2, label: "ACT", desc: "행을 연다. LPDDR5 도 두 클럭에 나눠 보낸다." }),
    command("RD", { needs: "active", makes: "active", bus: "read", label: "RD", desc: "버스트 하나를 읽는다." }),
    command("WR", { needs: "active", makes: "active", bus: "write", label: "WR", desc: "버스트 하나를 쓴다." }),
    command("PRE", { needs: "active", makes: "idle", label: "PRE", desc: "행을 닫는다." }),
    command("PREA", { target: "all", needs: null, makes: "idle", label: "PREA", desc: "모든 뱅크를 닫는다." }),
    command("REFab", { target: "all", needs: "idle", makes: "idle", label: "REFab", desc: "all-bank 리프레시." }),
    command("REFpb", { needs: "idle", makes: "idle", label: "REFpb", desc: "per-bank 리프레시. 한 뱅크씩 돌아가며 쉰다." }),
    command("MRW", { target: "none", label: "MRW", desc: "모드 레지스터를 쓴다." }),
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
  refresh: { param: "tREFI", command: "REFab", note: "고온에서는 마감이 절반으로 줄어든다." },
  sources: ["공개된 LPDDR5 부품 데이터시트 수준의 대표값", "RL/WL 은 동작 모드 의존이라 비워 둠"],
};
