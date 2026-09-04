// 셀에서 칩까지 여섯 층. **각 층은 이 도구가 이미 모델링하는 무언가를 설명할 때만** 둔다 —
// 그림을 위한 그림은 두지 않는다.
//
//   1 셀            tRAS(복원) · tREFI(전하가 샌다)
//   2 비트라인·센스앰프  tRCD(센싱) · tRP(다시 모으기) · ΔV
//   3 서브어레이      tRRD · tFAW — 전류가 왜 제약이 되는지가 이 층에서만 보인다
//   4 뱅크           상태 머신 · tRC · 열린 행이 하나뿐인 이유
//   5 뱅크그룹        tCCD_L vs tCCD_S — 짝이 범위만 다르다는 근거
//   6 칩             커맨드 버스가 직렬인 이유 · CL/CWL · tRFC 가 칩을 잠근다
//
// 랭크·DIMM·채널은 칩 밖이라 넣지 않았다. 엔진이 단일 랭크만 다루므로 그려 봐야
// 시뮬레이터와 이어지지 않는다 — 랭크를 넣게 되면 그때 한 층 더 얹는다.
//
// engine·waves·explain 과 마찬가지로 순수 함수만 둔다.

import { paramClocks } from "./engine.js";
import { openIntervals, sampleAt } from "./waves.js";
import { VBLP } from "./spec/common.js";

export const LAYERS = [
  {
    id: "cell", label: "셀", zoom: "가장 안쪽",
    what: "트랜지스터 하나와 커패시터 하나. 워드라인이 게이트를 열면 담긴 전하가 비트라인으로 새어 나온다.",
    key: "전하를 읽는 순간 무너진다 — 그래서 **읽고 나면 반드시 다시 써 넣어야** 한다(복원). 가만히 둬도 전하는 샌다.",
    params: ["tRAS", "tREFI"],
  },
  {
    id: "bitline", label: "비트라인·센스앰프", zoom: "셀 바깥",
    what: "셀이 매달린 비트라인과 그 짝. 둘을 VDD/2 로 맞춰 두었다가, 한쪽에만 셀을 열어 생긴 미세한 차이를 센스앰프가 양 레일까지 벌린다.",
    key: "비트라인 용량이 셀보다 훨씬 커서 **갈라지는 폭이 아주 작다.** 센스앰프는 그 작은 차이를 판별해야 하고, 그 판별에 걸리는 시간이 tRCD 다.",
    params: ["tRCD", "tRP"],
  },
  {
    id: "mat", label: "서브어레이", zoom: "셀 수천 개",
    what: "셀이 격자로 늘어서고 가장자리에 워드라인 드라이버와 센스앰프 줄이 붙는다. 워드라인 하나를 켜면 그 줄의 셀이 **전부 한꺼번에** 열린다.",
    key: "행 하나를 여는 일이 곧 수많은 셀과 센스앰프를 동시에 움직이는 일이라 **전류가 크게 튄다.** tRRD 와 tFAW 가 존재하는 이유가 이것이고, 이 층 없이는 설명이 안 된다.",
    params: ["tRRD_L", "tRRD_S", "tRRD", "tFAW"],
  },
  {
    id: "bank", label: "뱅크", zoom: "서브어레이 여럿",
    what: "서브어레이를 격자로 모으고 행·열 디코더를 붙인 단위. 활성 행의 센스앰프 줄이 곧 행 버퍼다.",
    key: "**한 뱅크에 열린 행은 하나뿐이다.** 다른 행을 보려면 지금 것을 닫아야(PRE) 하고, 그 여닫는 한 바퀴가 tRC 다.",
    params: ["tRC"],
  },
  {
    id: "bg", label: "뱅크그룹", zoom: "뱅크 여럿",
    what: "뱅크 몇 개가 로컬 IO 와 프리페치 경로를 함께 쓴다. 그룹이 다르면 그 자원이 겹치지 않는다.",
    key: "그래서 **같은 그룹이냐 다른 그룹이냐로 간격이 갈린다.** tCCD_L/tCCD_S 처럼 자리가 같고 범위만 다른 짝이 여기서 나온다.",
    params: ["tCCD_L", "tCCD_S", "tCCD_L_WR"],
  },
  {
    id: "chip", label: "칩", zoom: "가장 바깥",
    what: "뱅크그룹 전부에 커맨드·주소 디코더와 데이터 핀(DQ·DQS), 모드 레지스터가 붙은 것. 밖에서 보이는 것은 이 핀들뿐이다.",
    key: "커맨드가 들어오는 길은 **하나뿐이라 직렬**이다 — 한 클럭에 두 커맨드를 낼 수 없다. 리프레시는 칩 전체를 잠근다.",
    params: ["CL", "CWL", "RL", "WL", "tRFC1", "tRFCab", "BL"],
  },
];

export const findLayer = (id) => LAYERS.find((l) => l.id === id) ?? LAYERS[4];
export const DEFAULT_LAYER = "bg";   // 지금 격자가 있던 자리 — 열었을 때 달라 보이지 않게

/* 그 층에 사는 파라미터 중 **이 세대에 실제로 있는 것**만. 세대마다 이름이 다르다
 * (tRRD_L/tRRD_S 대 tRRD, tRFC1 대 tRFCab) — 없는 이름을 보여 주면 거짓이 된다. */
export function paramsAt(gen, layerId) {
  const layer = findLayer(layerId);
  const has = (n) => gen.params?.[n] || gen.bins?.some((b) => b.params?.[n]);
  return layer.params.filter(has);
}

const at = (lane, clk) => (lane ? sampleAt(lane.points ?? lane.series?.[0]?.points ?? [], clk) : null);

/* 지금 상태를 층마다 다르게 읽어 준다. 같은 순간을 여섯 배율로 보는 것이 요점이라,
 * 각 층은 **그 배율에서만 보이는 사실**을 말한다. */
export function stateAt(gen, bin, sim, picked, waves, layerId) {
  const bankIdx = picked.bg * gen.org.banksPerGroup + picked.bank;
  const bank = sim.banks[bankIdx];
  const open = bank.state === "active";
  const lane = (id) => waves?.lanes.find((l) => l.id === id);
  const clk = sim.clk;
  const rails = waves?.rails;

  switch (layerId) {
    case "cell": {
      const v = at(lane("Cell"), clk);
      /* **지금 전압만으로 판정하면 안 된다.** ACT 직후에는 아직 전하공유가 시작되지
       * 않아 셀이 가득 차 보이는데, 그렇다고 닫아도 되는 것은 아니다(tRAS 전이다).
       * 닫아도 되는지는 시각으로 판정한다 — 그것이 tRAS 의 뜻이다. */
      const opens = openIntervals(sim.history, picked);
      const cur = opens[opens.length - 1];
      const tRAS = paramClocks(gen, bin, "tRAS");
      const restored = open && cur && tRAS != null && clk >= cur.act + tRAS;
      return {
        open, restored,
        note: !open ? "행이 닫혀 있다 — 셀은 격리되어 전하를 들고 있다."
          : restored ? "복원이 끝났다 — 셀이 원래 전위로 돌아왔다. 이제 닫아도 된다."
          : "읽히면서 무너졌다가 되돌려지는 중이다. 지금 닫으면 값이 깨진다.",
        level: rails && v != null ? v / rails.VDD : null,
      };
    }
    case "bitline": {
      const pair = lane("BL");
      const bl = at({ points: pair?.series?.[0]?.points }, clk);
      const blb = at({ points: pair?.series?.[1]?.points }, clk);
      const sae = at(lane("SAE"), clk);
      const blp = rails ? VBLP(rails) : null;
      const gap = bl != null && blb != null ? Math.abs(bl - blb) : null;
      const split = gap != null && rails ? gap / rails.VDD : null;
      return {
        bl, blb, blp, sae: sae != null && rails ? sae > rails.VDD / 2 : false, split,
        note: gap == null ? "값이 없어 그릴 수 없다."
          : gap < 1e-9 ? "둘이 VDD/2 에 모여 있다 — 다음 판별을 받을 준비가 된 상태."
          : split < 0.2 ? "막 갈라지기 시작했다. 이 작은 차이가 센스앰프가 판별해야 할 전부다."
          : "센스앰프가 양 레일까지 벌려 놓았다 — 이제 컬럼이 읽어 갈 수 있다.",
      };
    }
    case "mat": {
      const faw = gen.windows?.find((w) => w.op === "ACT");
      const span = faw ? paramClocks(gen, bin, faw.param) : null;
      const recent = span == null ? [] : sim.history.filter((h) => h.op === "ACT" && clk - h.clk < span);
      return {
        open, wordline: open,
        used: recent.length, allowed: faw?.count ?? null, span,
        note: span == null ? ""
          : recent.length >= (faw?.count ?? 4)
            ? `창이 찼다 — 지금 또 열면 ${faw.param} 에 걸린다.`
            : `최근 ${span}클럭 안에 ${recent.length}번 열었다. ${faw.count}번까지.`,
      };
    }
    case "bank":
      return {
        open, row: bank.row,
        note: open ? `행 ${bank.row} 이 행 버퍼에 올라와 있다. 다른 행을 보려면 먼저 닫아야 한다.`
          : "닫혀 있다. 행 버퍼가 비어 있고 비트라인은 프리차지된 상태.",
      };
    case "bg": {
      const last = [...sim.history].reverse().find((h) => h.target === "bank");
      const same = last && last.bg === picked.bg;
      return {
        openInGroup: sim.banks.filter((b) => b.bg === picked.bg && b.state === "active").length,
        perGroup: gen.org.banksPerGroup,
        note: !last ? "아직 아무 뱅크도 건드리지 않았다."
          : same ? `직전 커맨드가 같은 그룹(BG${last.bg})이었다 — 긴 쪽 간격이 걸린다.`
          : `직전 커맨드가 다른 그룹(BG${last.bg})이었다 — 짧은 쪽 간격이 걸린다.`,
      };
    }
    case "chip": {
      const dq = (waves?.lanes ?? []).find((l) => l.id === "DQ");
      const busy = (dq?.ranges ?? []).some(([s, e]) => clk >= s && clk < e);
      const openBanks = sim.banks.filter((b) => b.state === "active").length;
      const last = sim.history[sim.history.length - 1];
      return {
        openBanks, total: sim.banks.length, dqBusy: busy,
        groups: Array.from({ length: gen.org.bankGroups }, (_, bg) =>
          sim.banks.filter((b) => b.bg === bg && b.state === "active").length),
        note: `${sim.banks.length}개 중 ${openBanks}개가 열려 있다. DQ 는 ${busy ? "지금 데이터를 나르는 중" : "비어 있다"}.`
          + (last ? ` 마지막 커맨드는 ${last.op} @ ${last.clk}clk.` : ""),
      };
    }
    default:
      return { note: "" };
  }
}
