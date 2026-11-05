// 최적화는 무거우니 화면을 멈추지 않게 워커에서 돌린다.
// 담금질은 시작 난수에 따라 답이 꽤 갈린다(실측 155~203m) — 시드 몇 개로 돌려 제일 좋은 걸 고른다.
import { optimize } from "./engine.js";

self.onmessage = ({ data }) => {
  const { plan, iterations, seed, restarts = 3 } = data;
  let best = null;
  for (let r = 0; r < restarts; r++) {
    const result = optimize(plan, {
      iterations, seed: seed + r * 7919,
      onProgress: (i) => self.postMessage({ type: "progress", ratio: (r + i / iterations) / restarts }),
    });
    if (!best || result.bestCm < best.bestCm) best = result;
  }
  self.postMessage({ type: "done", ...best });
};
