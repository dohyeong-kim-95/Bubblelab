import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accessPoint, backOnWall, buildGrid, evaluate, findPath, normalizePlan, optimize, placementProblems, placeOnFace,
  UNREACHABLE_CM, wallFaces,
} from "../interior/engine.js";

const sample = () => normalizePlan(readFileSync(new URL("../interior/plans/sample.json", import.meta.url), "utf8"));
const room = (extra = {}) => normalizePlan({ room: { w: 400, d: 300 }, items: [], tasks: [], ...extra });

test("앞면은 회전을 따라가고, 사람은 앞면 앞 35cm 에 선다", () => {
  const it = { x: 100, y: 100, w: 60, d: 40 };
  assert.deepEqual(accessPoint({ ...it, rot: 0 }), { x: 100, y: 155 });
  assert.deepEqual(accessPoint({ ...it, rot: 90 }), { x: 45, y: 100 });
  assert.deepEqual(accessPoint({ ...it, rot: 180 }), { x: 100, y: 45 });
  assert.deepEqual(accessPoint({ ...it, rot: 270 }), { x: 155, y: 100 });
});

test("빈 방에서는 거의 곧은 길, 가로막는 벽이 있으면 문으로 돌아간다", () => {
  const open = room();
  const g = buildGrid(open, 10);
  const p = findPath(g, { x: 50, y: 150 }, { x: 350, y: 150 });
  assert.ok(Math.abs(p.cm - 300) < 15, `곧은 길 ${p.cm}`);

  // x=200 에 벽, 문은 아래쪽 y 220~300 만
  const walled = room({ walls: [{ x1: 200, y1: 0, x2: 200, y2: 220 }] });
  const q = findPath(buildGrid(walled, 10), { x: 50, y: 50 }, { x: 350, y: 50 });
  // 곧은 길은 300, 문(y 245 아래)을 거치면 최소 2×√(150²+205²) ≈ 508
  assert.ok(q.cm > 500 && q.cm < 600, `문으로 돌아가야 한다: ${q.cm}`);

  const sealed = room({ walls: [{ x1: 200, y1: 0, x2: 200, y2: 300 }] });
  assert.equal(findPath(buildGrid(sealed, 10), { x: 50, y: 50 }, { x: 350, y: 50 }), null);
});

test("40cm(몸 폭) 미만 틈은 못 지나간다", () => {
  const gap = (w) => room({ walls: [{ x1: 200, y1: 0, x2: 200, y2: 150 - w / 2 }, { x1: 200, y1: 150 + w / 2, x2: 200, y2: 300 }] });
  assert.equal(findPath(buildGrid(gap(40), 10), { x: 50, y: 150 }, { x: 350, y: 150 }), null);
  assert.ok(findPath(buildGrid(gap(80), 10), { x: 50, y: 150 }, { x: 350, y: 150 }));
});

test("겹침·방 밖·벽에 안 붙음·구역 밖을 잡는다", () => {
  const p = room({
    zones: [{ id: "a", x0: 0, y0: 0, x1: 200, y1: 300 }],
    items: [
      { id: "sofa", x: 100, y: 45, w: 200, d: 90, rot: 0, wall: true, zone: "a" },
      { id: "box", x: 150, y: 60, w: 50, d: 50 },
      { id: "out", x: 390, y: 150, w: 50, d: 50 },
    ],
  });
  const [sofa, box, out] = p.items;
  assert.deepEqual(placementProblems(p, sofa).filter((s) => !s.includes("겹침")), []);
  assert.ok(placementProblems(p, box).some((s) => s.includes("겹침")));
  assert.ok(placementProblems(p, out).includes("방 밖"));
  assert.ok(placementProblems(p, { ...sofa, y: 60 }).includes("벽에 안 붙음"));
  assert.ok(placementProblems(p, { ...sofa, x: 250 }).some((s) => s.endsWith("밖")));
});

test("placeOnFace 는 등을 벽 면에 정확히 붙이고 앞이 방 안을 보게 돌린다", () => {
  const p = room({ walls: [{ x1: 200, y1: 0, x2: 200, y2: 300 }] });
  const item = { id: "c", w: 100, d: 60, x: 0, y: 0, rot: 0, wall: true };
  for (const f of wallFaces(p)) {
    const placed = placeOnFace(item, f, (f.a + f.b) / 2);
    assert.ok(backOnWall(p, placed), JSON.stringify({ f, placed }));
  }
});

test("예시 도면은 문제없이 놓여 있고 모든 할 일에 길이 있다", () => {
  const r = evaluate(sample());
  assert.deepEqual(r.problems, []);
  assert.equal(r.unreachable, 0);
  assert.ok(r.weeklyCm > 10000);
});

test("최적화는 시드가 같으면 같은 답, 동선을 줄이고, 고정·구역·놓기 규칙을 지킨다", () => {
  const p = sample();
  const a = optimize(p, { iterations: 800, seed: 7 });
  const b = optimize(p, { iterations: 800, seed: 7 });
  assert.deepEqual(a.plan.items, b.plan.items);
  const before = evaluate(p).weeklyCm, after = evaluate(a.plan).weeklyCm;
  assert.ok(after < before * 0.8, `${before} → ${after}`);
  for (const it of a.plan.items) {
    assert.deepEqual(placementProblems(a.plan, it), [], it.id);
    const orig = p.items.find((x) => x.id === it.id);
    if (orig.fixed) assert.deepEqual([it.x, it.y, it.rot], [orig.x, orig.y, orig.rot], it.id);
  }
});

test("못 가는 구간은 벌점으로 세고 표시한다", () => {
  const p = room({
    walls: [{ x1: 200, y1: 0, x2: 200, y2: 300 }],
    items: [{ id: "a", x: 50, y: 150, w: 0, d: 0, pass: true }, { id: "b", x: 350, y: 150, w: 0, d: 0, pass: true }],
    tasks: [{ id: "t", stops: ["a", "b"], perWeek: 2 }],
  });
  const r = evaluate(p);
  assert.equal(r.unreachable, 1);
  assert.equal(r.weeklyCm, UNREACHABLE_CM * 2);
});

test("normalizePlan 은 LLM 이 틀리게 쓴 도면을 이유와 함께 거절한다", () => {
  assert.throws(() => normalizePlan({ room: { w: 50, d: 300 } }), /room 크기/);
  assert.throws(() => normalizePlan({ room: { w: 400, d: 300 }, walls: [{ x1: 0, y1: 0, x2: 10, y2: 10 }] }), /가로나 세로/);
  assert.throws(() => normalizePlan({ room: { w: 400, d: 300 }, items: [{ id: "a b", x: 1, y: 1 }] }), /id/);
  assert.throws(() => normalizePlan({ room: { w: 400, d: 300 }, items: [{ id: "a", x: 1, y: 1 }], tasks: [{ stops: ["a", "z"] }] }), /"z"/);
  assert.throws(() => normalizePlan({ room: { w: 400, d: 300 }, items: [{ id: "a", x: 1, y: 1, zone: "nope" }] }), /zone/);
  const ok = normalizePlan(JSON.stringify({ room: { w: 400, d: 300 }, items: [{ id: "a", x: 1, y: 1, rot: 450 }] }));
  assert.equal(ok.items[0].rot, 90);
});
