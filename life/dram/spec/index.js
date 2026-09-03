// 세대 등록부. 화면은 이 목록만 보고 탭을 만든다 — 세대를 더하려면 파일 하나와
// 여기 한 줄이면 된다.

import ddr5 from "./ddr5.js";
import lpddr5 from "./lpddr5.js";
import ddr6 from "./ddr6.js";
import lpddr6 from "./lpddr6.js";

export const GENERATIONS = [ddr5, lpddr5, ddr6, lpddr6];
export const DEFAULT_GEN = "ddr5";
export const findGen = (id) => GENERATIONS.find((g) => g.id === id) ?? GENERATIONS[0];
/* 시뮬레이터를 돌릴 수 있는 세대인가 — 커맨드와 빈이 다 있어야 한다. */
export const isRunnable = (gen) => Boolean(gen?.commands?.length && gen?.bins?.length);
