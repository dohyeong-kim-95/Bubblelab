// DDR6 (JESD79-6) — **아직 공개된 표준이 아니다.**
//
// 커맨드 인코딩도 타이밍 파라미터도 확정값이 존재하지 않는다. 업계 기사에 도는
// 데이터레이트 전망치는 스펙이 아니므로 여기에 옮기지 않는다. 값을 지어내면
// 이 화면의 존재 이유(스펙만큼 정확히 이해하기)가 무너진다.
//
// 스펙이 나오면 ddr5.js 와 같은 모양으로 채우기만 하면 된다 — 화면·엔진·테스트는
// 세대 파일의 모양만 알지 내용은 모른다.

import { ref } from "./common.js";

export default {
  id: "ddr6",
  label: "DDR6",
  status: "unpublished",
  status_note:
    "JEDEC 이 아직 발행하지 않았다. 확정된 커맨드·타이밍이 없어 시뮬레이터를 돌릴 수 없다. " +
    "표준이 공개되면 이 파일만 채우면 된다.",
  org: null,
  bins: [],
  params: {},
  commands: [],
  rules: [],
  windows: [],
  refresh: null,
  refs: [
    ref("표준", "DDR6 SDRAM", {
      doc: "JESD79-6",
      where: "**아직 발행되지 않았다.** 확정된 커맨드 인코딩도 타이밍 파라미터도 없다. 업계 기사에 도는 데이터레이트 전망치는 표준이 아니므로 여기에 옮기지 않았다.",
      url: "https://www.jedec.org/",
    }),
  ],

  sources: [],
};
