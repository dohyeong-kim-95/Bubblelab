// 최적화는 무거우니 화면을 멈추지 않게 워커에서 돌린다.
import { optimize } from "./engine.js";

self.onmessage = ({ data }) => {
  const { plan, iterations, seed } = data;
  const result = optimize(plan, {
    iterations, seed,
    onProgress: (i, bestCm) => self.postMessage({ type: "progress", ratio: i / iterations, bestCm }),
  });
  self.postMessage({ type: "done", ...result });
};
