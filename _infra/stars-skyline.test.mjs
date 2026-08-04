import test from "node:test";
import assert from "node:assert/strict";
import {
  bandAltitudes, CAMERA_FOV_H, CAMERA_FOV_V, downsampleLuma, extractSkyline,
  profileAltitude, profileAzimuth,
} from "../util/stars/skyline.js";

// 카메라 한 장을 흉내 낸다. skyAt(x) 위쪽은 하늘색, 아래쪽은 땅색.
function frame({ width = 240, height = 180, sky, ground, skyAt, noise = 0 }) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = skyAt(x / width) * height;
      const base = y < edge ? sky : ground;
      const v = Math.max(0, Math.min(255, base + rand() * noise));
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const read = (image) => extractSkyline(downsampleLuma(image));

test("낮 — 밝은 하늘 아래 어두운 건물의 경계를 찾는다", () => {
  const { profile, confidence } = read(frame({ sky: 215, ground: 30, skyAt: () => 0.6 }));
  assert.ok(confidence > 0.5, `자신도가 낮다: ${confidence.toFixed(2)}`);
  const mid = profile[profile.length >> 1];
  assert.ok(Math.abs(mid - 0.6) < 0.05, `경계가 0.6이 아니라 ${mid.toFixed(2)}`);
});

test("밤 — 어두운 하늘 아래 불 켜진 도시도 같은 자리를 찾는다", () => {
  // 밝기 방향이 낮과 반대다. 방향이 아니라 변화량을 보기 때문에 똑같이 잡혀야 한다.
  const { profile, confidence } = read(frame({ sky: 18, ground: 140, skyAt: () => 0.55 }));
  assert.ok(confidence > 0.5, `자신도가 낮다: ${confidence.toFixed(2)}`);
  const mid = profile[profile.length >> 1];
  assert.ok(Math.abs(mid - 0.55) < 0.05, `경계가 0.55가 아니라 ${mid.toFixed(2)}`);
});

test("건물 높낮이가 프로필에 남는다", () => {
  // 왼쪽은 높은 건물(경계가 위), 오른쪽은 낮은 건물(경계가 아래)
  const { profile } = read(frame({ sky: 210, ground: 25, skyAt: (t) => (t < 0.5 ? 0.35 : 0.7) }));
  const left = profile[Math.round(profile.length * 0.2)];
  const right = profile[Math.round(profile.length * 0.8)];
  assert.ok(Math.abs(left - 0.35) < 0.06, `왼쪽 ${left.toFixed(2)}`);
  assert.ok(Math.abs(right - 0.7) < 0.06, `오른쪽 ${right.toFixed(2)}`);
  assert.ok(right - left > 0.25, "높낮이 차이가 사라졌다");
});

// 경계가 없는 장면에서 억지로 선을 그으면 배경화면에 정체불명의 얼룩이 생긴다.
test("하늘만 찍으면 실루엣을 그리지 않는다", () => {
  const { confidence } = read(frame({ sky: 40, ground: 40, skyAt: () => 0.5, noise: 10 }));
  assert.ok(confidence < 0.35, `평평한 하늘인데 자신도가 ${confidence.toFixed(2)}`);
});

test("잡음만 있는 장면도 그리지 않는다", () => {
  const { confidence } = read(frame({ sky: 120, ground: 120, skyAt: () => 0.5, noise: 160 }));
  assert.ok(confidence < 0.35, `잡음뿐인데 자신도가 ${confidence.toFixed(2)}`);
});

test("경계가 들쭉날쭉하면 자신도가 떨어진다", () => {
  // 열마다 경계가 제멋대로면 스카이라인이 아니라 잡음이다
  const { confidence } = read(frame({
    sky: 200, ground: 40, skyAt: (t) => 0.2 + 0.6 * ((t * 37) % 1),
  }));
  assert.ok(confidence < 0.5, `들쭉날쭉한데 자신도가 ${confidence.toFixed(2)}`);
});

test("프로필 값을 고도로 옮긴다", () => {
  // 화면 한가운데(0.5)는 겨눈 고도 그대로, 위로 갈수록 높아진다
  assert.equal(profileAltitude(0.5, 20), 20);
  assert.ok(profileAltitude(0.2, 20) > 20, "화면 위쪽이 더 낮은 고도로 나왔다");
  assert.ok(profileAltitude(0.8, 20) < 20, "화면 아래쪽이 더 높은 고도로 나왔다");
  // 화각의 절반만큼이 화면 끝까지의 각도다
  assert.ok(Math.abs(profileAltitude(0, 0) - CAMERA_FOV_V / 2) < 1e-9);
});

test("열 번호를 방위로 옮긴다", () => {
  // 가운데 열은 겨눈 방위, 양 끝은 화각의 절반씩 좌우로
  assert.equal(profileAzimuth(48, 97, 180), 180);
  assert.ok(Math.abs(profileAzimuth(0, 97, 180) - (180 - CAMERA_FOV_H / 2)) < 1e-9);
  assert.ok(Math.abs(profileAzimuth(96, 97, 180) - (180 + CAMERA_FOV_H / 2)) < 1e-9);
});

test("실루엣은 0~10° 띠 안에 앉되 높낮이를 잃지 않는다", () => {
  // 겨눈 고도가 높아 추정 고도가 전부 10°를 넘는 경우 — 예전에는 전부 10°로
  // 잘려 평평한 판이 됐다. 이제는 가장 낮은 지점이 지평선에 앉는다.
  const profile = [0.55, 0.62, 0.70, 0.58, 0.72];
  const band = bandAltitudes(profile, 25);
  assert.ok(Math.abs(Math.min(...band)) < 1e-9, "가장 낮은 지점이 지평선이 아니다");
  assert.ok(Math.max(...band) <= 10 + 1e-9, `10°를 넘었다: ${Math.max(...band)}`);
  assert.ok(Math.max(...band) > 5, "높낮이가 눌려 사라졌다");
  // 어느 쪽이 높은 건물인지는 그대로 남아야 한다.
  // 프로필 값이 작을수록 화면 위쪽 = 높은 건물이다(0.55가 가장 높고 0.72가 가장 낮다).
  assert.ok(band[0] > band[1] && band[1] > band[4], "높낮이 순서가 뒤집혔다");
});

test("평평한 스카이라인은 평평하게 남는다", () => {
  const band = bandAltitudes([0.6, 0.6, 0.6, 0.6], 20);
  assert.deepEqual(band.map((a) => Math.round(a * 1000) / 1000), [0, 0, 0, 0]);
});

test("겨눈 고도가 달라도 실루엣의 모양은 그대로다", () => {
  // 지평선을 기준으로 앉히므로 겨눈 고도는 자리를 바꾸지 못한다
  const profile = [0.5, 0.6, 0.55];
  const low = bandAltitudes(profile, 5), high = bandAltitudes(profile, 40);
  for (let i = 0; i < profile.length; i++) assert.ok(Math.abs(low[i] - high[i]) < 1e-9);
});
