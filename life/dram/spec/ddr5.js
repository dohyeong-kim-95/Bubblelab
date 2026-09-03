// DDR5 (JESD79-5). MVP 의 기준 세대 — 값이 가장 많이 채워져 있다.
//
// **값의 출처**: 공개된 벤더 데이터시트·스피드빈 표 수준의 대표값이다. JEDEC 문서를
// 옮겨 적은 것이 아니고, 부품·밀도·페이지 크기에 따라 달라지는 항목이 있다.
// `verify: true` 가 붙은 것은 표기 방식에 이견이 있을 수 있어 스펙과 대조가 필요한 값이다.
// 값이 틀렸다고 판단되면 이 파일 한 곳만 고치면 화면과 테스트가 함께 따라온다.

import { command, param, rule, window_ } from "./common.js";

export default {
  id: "ddr5",
  label: "DDR5",
  status: "published",
  status_note: "JESD79-5. 공개된 표준이고 부품도 흔하다.",

  org: {
    bankGroups: 8,
    banksPerGroup: 4,
    label: "x8 기준 8 뱅크그룹 × 4 뱅크 = 32 뱅크",
    note:
      "DDR4(4 BG × 4)에서 그룹이 두 배로 늘었다. 그룹을 늘리면 그룹이 다른 접근끼리는 " +
      "tCCD_S 로 붙일 수 있어, 코어를 빠르게 만들지 않고도 버스를 채울 수 있다. " +
      "x16 부품은 4 BG × 4 뱅크 = 16 뱅크다.",
  },

  /* 스피드빈. ns 로 묶인 코어 타이밍은 빈이 바뀌어도 그대로고,
   * 클럭으로 묶인 것(CL·CWL·tCCD_L)만 여기서 덮어쓴다 — 이 대비가 이 화면의 핵심이다. */
  bins: [
    {
      id: "4800B", label: "DDR5-4800B", mtps: 4800,
      params: {
        CL: param({ ck: 40, why: "READ 를 낸 뒤 첫 데이터가 DQ 에 나오기까지의 클럭." }),
        CWL: param({ ck: 38, why: "WRITE 를 낸 뒤 첫 데이터를 DQ 에 실어야 하는 클럭.", verify: true }),
        tCCD_L: param({ ck: 8, why: "같은 뱅크그룹 안의 연속 접근 간격. 이 빈에서는 tCCD_S 와 같아 그룹을 갈라도 읽기가 빨라지지 않는다.", verify: true }),
      },
    },
    {
      id: "6400A", label: "DDR5-6400A", mtps: 6400,
      params: {
        CL: param({ ck: 46, why: "READ 를 낸 뒤 첫 데이터가 DQ 에 나오기까지의 클럭." }),
        CWL: param({ ck: 44, why: "WRITE 를 낸 뒤 첫 데이터를 DQ 에 실어야 하는 클럭.", verify: true }),
        tCCD_L: param({ ck: 12, why: "빈이 빨라지면 클럭으로 센 tCCD_L 도 함께 커진다 — ns 가 그대로이기 때문.", verify: true }),
      },
    },
  ],

  /* 빈과 무관한 코어 타이밍. 전부 ns 다 — 셀·센스앰프의 물리이지 버스의 사정이 아니다. */
  params: {
    tRCD: param({ ns: 16.25, why: "ACT 로 워드라인을 올리고 센스앰프가 미세한 전하차를 판별해 행이 설 때까지." }),
    tRP: param({ ns: 16.25, why: "PRE 로 비트라인을 다시 Vdd/2 로 되돌려 다음 ACT 를 받을 수 있게 될 때까지." }),
    tRAS: param({ ns: 32, why: "행을 연 뒤 최소한 이만큼은 열어 둬야 한다 — 센스앰프가 셀을 원래 값으로 복원(restore)하는 시간." }),
    tRC: param({ ns: 48.25, why: "같은 뱅크의 ACT → ACT. 사실상 tRAS + tRP 이고, 한 뱅크의 최대 회전율을 정한다." }),
    tRRD_L: param({ ns: 5, ck: 8, why: "같은 그룹 안의 연속 ACT. 그룹 내부 자원이 겹친다." }),
    tRRD_S: param({ ck: 8, why: "다른 그룹의 연속 ACT. 그룹이 다르면 코어 자원이 겹치지 않아 짧다." }),
    tFAW: param({ ns: 32, why: "어떤 32ns 창에서도 ACT 는 4번까지. 행을 여는 것은 전류를 크게 쓰는 동작이라 전원이 못 버틴다.", verify: true }),
    tCCD_S: param({ ck: 8, why: "다른 그룹의 연속 접근. BL16 이 DQ 를 8클럭 쓰므로 이보다 짧아질 수 없다 — 버스가 꽉 찬 상태." }),
    tCCD_L_WR: param({ ck: 32, why: "같은 그룹의 연속 WRITE. 읽기(tCCD_L)보다 훨씬 길다 — 쓴 값을 셀에 돌려놓는 일이 남아서.", verify: true }),
    tWTR_L: param({ ns: 10, ck: 16, why: "쓰기 데이터가 DQ 에서 끝난 뒤 같은 그룹을 읽기까지. 내부 데이터 경로의 방향을 돌린다." }),
    tWTR_S: param({ ns: 2.5, ck: 4, why: "다른 그룹이면 돌릴 경로가 겹치지 않아 짧다." }),
    tRTP: param({ ns: 7.5, ck: 12, why: "READ 를 낸 뒤 같은 뱅크를 PRE 하기까지. 읽던 버스트를 끝내야 행을 닫을 수 있다." }),
    tWR: param({ ns: 30, why: "쓰기 데이터가 DQ 에서 끝난 뒤 PRE 까지. 센스앰프의 새 값이 셀에 실제로 써지는 시간이다." }),
    tRFC1: param({ ns: 295, why: "all-bank 리프레시 하나가 끝나기까지. 16Gb 기준이고 밀도가 커지면 함께 커진다.", verify: true }),
    tRFCsb: param({ ns: 130, why: "same-bank 리프레시. DDR5 가 새로 넣은 것 — 한 뱅크만 쉬게 하고 나머지는 계속 쓴다.", verify: true }),
    tREFI: param({ ns: 3900, why: "리프레시를 평균 이 간격으로 내야 한다. **최소 간격이 아니라 마감**이라 8번까지 미루거나 당길 수 있다." }),
    BL: param({ ck: 16, why: "한 번의 RD/WR 가 옮기는 비트 수. DDR 이라 DQ 를 쓰는 클럭 수는 그 절반인 8." }),
  },

  commands: [
    command("ACT", { needs: "idle", makes: "active", ca: 2, label: "ACT", desc: "행 하나를 열어 센스앰프에 올린다. 행 주소가 커서 CA 버스를 두 클럭 쓴다." }),
    command("RD", { needs: "active", makes: "active", bus: "read", label: "RD", desc: "열린 행에서 버스트 하나를 읽는다." }),
    command("WR", { needs: "active", makes: "active", bus: "write", label: "WR", desc: "열린 행에 버스트 하나를 쓴다." }),
    command("PRE", { needs: "active", makes: "idle", label: "PRE", desc: "행을 닫고 비트라인을 프리차지한다." }),
    command("PREA", { target: "all", needs: null, makes: "idle", label: "PREA", desc: "모든 뱅크를 한 번에 닫는다." }),
    command("REFab", { target: "all", needs: "idle", makes: "idle", label: "REFab", desc: "all-bank 리프레시. 모든 뱅크가 닫혀 있어야 한다." }),
    command("REFsb", { needs: "idle", makes: "idle", label: "REFsb", desc: "same-bank 리프레시. 그 뱅크만 닫혀 있으면 된다." }),
    command("MRW", { target: "none", ca: 2, label: "MRW", desc: "모드 레지스터를 쓴다(CL·버스트 등 설정). 두 클럭짜리 커맨드다." }),
  ],

  rules: [
    rule("ACT", "RD", "bank", "tRCD", "행이 서기 전에는 읽을 것이 없다."),
    rule("ACT", "WR", "bank", "tRCD", "행이 서기 전에는 쓸 곳이 없다."),
    rule("ACT", "PRE", "bank", "tRAS", "복원이 끝나기 전에 닫으면 셀의 값이 깨진다."),
    rule("PRE", "ACT", "bank", "tRP", "비트라인이 중간 전위로 돌아와야 다음 판별이 가능하다."),
    rule("ACT", "ACT", "bank", "tRC", "한 뱅크가 한 바퀴 도는 데 걸리는 시간."),
    rule("ACT", "ACT", "bg-other", "tRRD_L", "같은 그룹이라 내부 자원이 겹친다."),
    rule("ACT", "ACT", "diffbg", "tRRD_S", "그룹이 다르면 더 촘촘히 열 수 있다."),
    rule("RD", "RD", "bg", "tCCD_L", "같은 그룹 안에서는 버스를 붙여 쓸 수 없다."),
    rule("RD", "RD", "diffbg", "tCCD_S", "그룹을 번갈아 쓰면 DQ 를 빈틈없이 채운다 — 뱅크그룹의 존재 이유."),
    rule("WR", "WR", "bg", "tCCD_L_WR", "쓰기는 같은 그룹에서 특히 길다."),
    rule("WR", "WR", "diffbg", "tCCD_S", "그룹이 다르면 쓰기도 버스 속도로 붙는다."),
    rule("RD", "PRE", "bank", "tRTP", "읽던 버스트를 끝내야 행을 닫는다."),
    rule("WR", "PRE", "bank", ["CWL", "BL/2", "tWR"], "쓰기는 커맨드가 아니라 **데이터가 끝난 시점**부터 센다 — 그래서 CWL 과 버스트를 먼저 더한다."),
    rule("WR", "RD", "bg", ["CWL", "BL/2", "tWTR_L"], "쓰기 데이터가 끝나야 경로를 읽기 방향으로 돌린다."),
    rule("WR", "RD", "diffbg", ["CWL", "BL/2", "tWTR_S"], "그룹이 다르면 돌릴 것이 적다."),
    rule("REFab", "ACT", "rank", "tRFC1", "리프레시가 도는 동안 어레이 전체를 쓸 수 없다."),
    rule("REFab", "REFab", "rank", "tRFC1", "리프레시끼리도 겹치지 않는다."),
    rule("REFsb", "ACT", "bank", "tRFCsb", "그 뱅크만 잠기고 나머지는 계속 쓸 수 있다 — DDR5 가 얻은 것."),
    rule("PREA", "ACT", "rank", "tRP", "전체를 닫아도 프리차지 시간은 똑같이 든다."),
  ],

  windows: [
    window_("ACT", 4, "tFAW", "행 열기는 전류를 크게 쓴다. 4번을 넘기면 전원이 못 버틴다."),
  ],

  refresh: { param: "tREFI", command: "REFab", note: "마감이지 최소 간격이 아니다. 최대 8번까지 미루거나 당길 수 있다." },

  sources: [
    "공개된 DDR5 부품 데이터시트와 스피드빈 표 수준의 대표값",
    "밀도·페이지 크기·부품에 따라 tRFC1·tFAW 는 달라진다",
  ],
};
