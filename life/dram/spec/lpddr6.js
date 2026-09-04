// LPDDR6 (JESD209-6). 2025년에 발행된 실재하는 표준이지만, 부품 데이터시트가 아직
// 널리 풀리지 않아 **타이밍 값을 신뢰할 수 있게 채울 수 없다.**
//
// 그래서 구조만 적어 둔다. 구조는 그 자체로 배울 것이 있다 — 채널을 어떻게 쪼갰는지가
// 이 세대의 성격을 거의 다 말해 준다. 타이밍이 확인되는 대로 params/rules 를 채우면
// 그때부터 시뮬레이터가 돈다.

import { ref } from "./common.js";

export default {
  id: "lpddr6",
  label: "LPDDR6",
  status: "unpublished",
  status_note:
    "표준은 발행됐지만 여기 채울 만큼 확인된 타이밍 값이 없다. 구조만 적어 뒀다 — " +
    "값이 확인되면 lpddr5.js 와 같은 모양으로 채우면 된다.",
  org: {
    bankGroups: null,
    banksPerGroup: null,
    label: "채널 하나가 서브채널 둘로 갈린다",
    note:
      "LPDDR5 의 16비트 채널 대신 24비트 채널을 쓰고, 그것을 12비트 서브채널 둘로 나눈다. " +
      "서브채널이 좁아지면 한 번의 버스트가 옮기는 덩어리가 작아져, 같은 대역폭에서 " +
      "더 잘게 나눠 쓸 수 있다 — 접근이 흩어지는 모바일·AI 부하에 유리한 방향이다.",
  },
  bins: [],
  params: {},
  commands: [],
  rules: [],
  windows: [],
  refresh: null,
  refs: [
    ref("표준", "LPDDR6 SDRAM", {
      doc: "JESD209-6",
      where: "발행된 표준이다. 다만 부품 데이터시트가 아직 널리 풀리지 않아 신뢰할 수 있는 타이밍 값을 채우지 못했다 — 채널을 서브채널 둘로 가르는 구조만 적어 뒀다.",
      url: "https://www.jedec.org/",
    }),
  ],

  sources: [],
};
