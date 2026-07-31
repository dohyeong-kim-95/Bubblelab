import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHIBI, KEYPOINTS, REST_ANGLES,
  drawSkeleton, expandSequence, lerpAngle, lerpPose, renderGrid, renderPose, solvePose,
} from "./skeleton.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const idx = (name) => KEYPOINTS.indexOf(name);

test("solvePose: 기본 자세에서 캐릭터의 오른쪽(R)이 화면 왼쪽에 온다", () => {
  const kp = solvePose({}, { width: 400, height: 400 });
  assert.equal(kp.length, 18);
  const neck = kp[idx("neck")];
  // OpenPose COCO 규약: R = 캐릭터 기준 오른쪽 = 정면 캐릭터에선 화면 왼쪽
  assert.ok(kp[idx("shoulderR")][0] < neck[0], "오른어깨가 화면 왼쪽");
  assert.ok(kp[idx("shoulderL")][0] > neck[0], "왼어깨가 화면 오른쪽");
  // 차렷 자세: 손목이 어깨보다 아래
  assert.ok(kp[idx("wristR")][1] > kp[idx("shoulderR")][1]);
});

test("solvePose: 팔 각도가 -90이면 손목이 어깨 위로 올라간다 (좌우 독립)", () => {
  const kp = solvePose({ angles: { upperArmR: -90, foreArmR: -90 } }, { width: 400, height: 400 });
  assert.ok(kp[idx("wristR")][1] < kp[idx("shoulderR")][1], "오른손목이 어깨 위");
  assert.ok(kp[idx("wristL")][1] > kp[idx("shoulderL")][1], "왼팔은 그대로 아래");
});

test("solvePose: 비율만 바꾸면 같은 포즈가 다른 체형으로 그려진다 (각도=모션, 길이=정체성)", () => {
  const pose = { angles: { upperArmR: -90 } };
  const normal = solvePose(pose, { width: 400, height: 400 });
  const longArm = solvePose(pose, { width: 400, height: 400, proportions: { ...CHIBI, upperArm: 0.2 } });
  const reach = (kp) => Math.abs(kp[idx("elbowR")][1] - kp[idx("shoulderR")][1]);
  assert.ok(reach(longArm) > reach(normal) * 1.5, "팔 길이만 늘어난다");
  // 어깨 위치(비율에 안 걸린 관절)는 그대로
  assert.deepEqual(normal[idx("neck")], longArm[idx("neck")]);
});

test("lerpAngle: 최단 회전으로 보간한다", () => {
  assert.equal(lerpAngle(0, 90, 0.5), 45);
  assert.equal(lerpAngle(350, 10, 0.5), 360);   // -10 → +10 경유(340도 역주행 금지)
  assert.equal(lerpAngle(10, 350, 0.5), 0);
});

test("lerpPose: 지정 안 한 관절은 기본 자세를 쓴다", () => {
  const mid = lerpPose({ angles: { upperArmR: 0 } }, { angles: { upperArmR: 100 } }, 0.5);
  assert.equal(mid.angles.upperArmR, 50);
  const partial = lerpPose({ angles: { head: -90 } }, { angles: { upperArmR: 0 } }, 0.5);
  assert.equal(partial.angles.upperArmR, REST_ANGLES.upperArmR / 2);
});

test("expandSequence: pingpong는 왕복, cycle은 순환을 닫는다", () => {
  const keys = [{ angles: { upperArmR: 100 } }, { angles: { upperArmR: -80 } }];
  // 구간 1개 × (키1 + 인비트윈1) + 마지막 키 = 3, 핑퐁 역순 +1 = 4
  const ping = expandSequence(keys, { steps: 1, loop: "pingpong" });
  assert.equal(ping.length, 4);
  assert.equal(ping[0].angles.upperArmR, 100);
  assert.equal(ping[2].angles.upperArmR, -80);
  assert.equal(ping[3].angles.upperArmR, ping[1].angles.upperArmR); // 역순 재사용

  // cycle: 마지막→첫 구간도 채우고 첫 키를 중복하지 않는다
  const cycle = expandSequence(keys, { steps: 1, loop: "cycle" });
  assert.equal(cycle.length, 4);
  assert.equal(cycle[0].angles.upperArmR, 100);
  assert.notEqual(cycle[cycle.length - 1].angles.upperArmR, 100);

  assert.throws(() => expandSequence([{}], {}), /2개 이상/);
});

test("renderPose: 검은 배경 위에 컬러 스켈레톤이 그려진다", () => {
  const image = renderPose({}, { width: 128, height: 128 });
  assert.deepEqual([...image.data.slice(0, 4)], [0, 0, 0, 255]); // 모서리는 배경
  let colored = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i] + image.data[i + 1] + image.data[i + 2] > 60) colored++;
  }
  assert.ok(colored > 200, `스켈레톤 픽셀이 그려져야 함 (현재 ${colored})`);
});

test("renderGrid: 셀 순서대로 배치된다 (sticker-pack 슬라이스 규약과 동일)", () => {
  const poses = [
    { angles: { upperArmR: -90, foreArmR: -90 } },  // 오른팔 위 (셀 0)
    {}, {}, {},
  ];
  const grid = renderGrid(poses, { cols: 4, cell: 96 });
  assert.equal(grid.width, 384);
  assert.equal(grid.height, 96);
  const litInCell = (cellIndex, rowFrom, rowTo) => {
    let n = 0;
    for (let y = rowFrom; y < rowTo; y++) {
      for (let x = cellIndex * 96; x < (cellIndex + 1) * 96; x++) {
        const i = (y * grid.width + x) * 4;
        if (grid.data[i] + grid.data[i + 1] + grid.data[i + 2] > 60) n++;
      }
    }
    return n;
  };
  // 어깨선(y≈47) 위쪽 픽셀은 머리 + (팔을 들었다면) 팔. 첫 셀만 팔이 올라가 있다.
  assert.ok(litInCell(0, 0, 46) > litInCell(1, 0, 46), "첫 셀만 팔을 들고 있다");
  assert.equal(litInCell(1, 0, 46), litInCell(2, 0, 46), "나머지 셀은 서로 동일");
});

test("포즈 라이브러리의 모든 시퀀스가 유효하다", () => {
  const dir = join(ROOT, "_src", "emoticon", "poses");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length > 0, "포즈 라이브러리가 비어 있다");
  for (const file of files) {
    const spec = JSON.parse(readFileSync(join(dir, file), "utf8"));
    assert.ok(spec.name, `${file}: name 필요`);
    assert.ok(Array.isArray(spec.keys) && spec.keys.length >= 2, `${file}: keys 2개 이상`);
    assert.ok(["pingpong", "cycle", "none"].includes(spec.loop ?? "pingpong"), `${file}: loop 값 확인`);
    const frames = expandSequence(spec.keys, { steps: Number(spec.steps ?? 2), loop: spec.loop ?? "pingpong" });
    assert.ok(frames.length >= 2 && frames.length <= 24, `${file}: 프레임 ${frames.length} (2~24)`);
    for (const pose of frames) {
      for (const [name, value] of Object.entries(pose.angles ?? {})) {
        assert.ok(name in REST_ANGLES, `${file}: 알 수 없는 관절 "${name}"`);
        assert.ok(Number.isFinite(value), `${file}: ${name} 각도가 숫자가 아님`);
      }
    }
    assert.doesNotThrow(() => drawSkeleton(solvePose(frames[0], { width: 64, height: 64 }), { width: 64, height: 64 }));
  }
});
