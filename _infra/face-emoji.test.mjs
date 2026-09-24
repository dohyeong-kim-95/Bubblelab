import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assessFace, assessFaceResult } from "../util/face-emoji/face-quality.js";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));

function face({ small = false, tilted = false } = {}) {
  const center = small ? 0.5 : 0.5;
  const halfWidth = small ? 0.06 : 0.22;
  const halfHeight = small ? 0.08 : 0.28;
  const landmarks = Array.from({ length: 478 }, () => ({ x: center, y: center, z: 0 }));
  const put = (index, x, y) => { landmarks[index] = { x, y, z: 0 }; };
  put(10, center, center - halfHeight);
  put(152, center, center + halfHeight);
  put(234, center - halfWidth, center);
  put(454, center + halfWidth, center);
  put(33, center - halfWidth * 0.43, center - halfHeight * 0.22);
  put(133, center - halfWidth * 0.2, center - halfHeight * 0.22);
  put(159, center - halfWidth * 0.31, center - halfHeight * 0.27);
  put(145, center - halfWidth * 0.31, center - halfHeight * 0.17);
  const eyeY = tilted ? center + halfHeight * 0.05 : center - halfHeight * 0.22;
  put(362, center + halfWidth * 0.2, eyeY);
  put(263, center + halfWidth * 0.43, eyeY + (tilted ? halfHeight * 0.8 : 0));
  put(386, center + halfWidth * 0.31, eyeY - halfHeight * 0.05);
  put(374, center + halfWidth * 0.31, eyeY + halfHeight * 0.05);
  put(1, center, center + halfHeight * 0.06);
  put(61, center - halfWidth * 0.2, center + halfHeight * 0.3);
  put(291, center + halfWidth * 0.2, center + halfHeight * 0.3);
  put(13, center, center + halfHeight * 0.25);
  put(14, center, center + halfHeight * 0.36);
  return landmarks;
}

test("정상적인 한 얼굴은 통과한다", () => {
  const result = assessFaceResult({ faceLandmarks: [face()] });
  assert.equal(result.ok, true);
  assert.equal(result.code, "ok");
});

test("얼굴 없음과 여러 얼굴은 결과를 만들지 않는다", () => {
  assert.equal(assessFaceResult({ faceLandmarks: [] }).code, "no-face");
  assert.equal(assessFaceResult({ faceLandmarks: [face(), face()] }).code, "multiple-faces");
});

test("작은 얼굴과 기울어진 얼굴은 다시 고르게 한다", () => {
  assert.equal(assessFace(face({ small: true })).code, "face-too-small");
  assert.equal(assessFace(face({ tilted: true })).code, "face-tilted");
});

test("옆얼굴과 어두운 얼굴도 다시 고르게 한다", () => {
  const profile = face();
  profile[33].x = 0.49; profile[133].x = 0.50;
  profile[362].x = 0.50; profile[263].x = 0.51;
  assert.equal(assessFace(profile).code, "face-profile");
  assert.equal(assessFace(face(), { brightness: 10 }).code, "face-dark");
});

test("face-emoji 정적 자산은 동일 출처 경로만 사용한다", () => {
  const html = readFileSync(join(ROOT, "util/face-emoji/index.html"), "utf8");
  const app = readFileSync(join(ROOT, "util/face-emoji/app.js"), "utf8");
  assert.match(html, /<html lang="ko">/);
  assert.match(html, /<title>얼굴 사진으로 SD 캐릭터 만들기<\/title>/);
  assert.match(html, /_shared\/share\.js/);
  assert.doesNotMatch(html, /id="choosePhoto"[^>]*disabled/);
  assert.doesNotMatch(html, /id="photoInput"[^>]*disabled/);
  assert.match(app, /\.\/vendor\/face_landmarker\.task/);
  assert.match(app, /\.\/vendor\/wasm\//);
  assert.match(app, /numFaces: 2/);
  assert.match(app, /chooseButton\.addEventListener\("click", \(\) => fileInput\.click\(\)\)/);
  assert.match(app, /let pendingFile = null/);
  assert.match(app, /pendingFile = file/);
  assert.doesNotMatch(app, /FormData|XMLHttpRequest|sendBeacon/);
  assert.doesNotMatch(app, /https?:\/\//);
});

test("MediaPipe 모델과 WASM은 저장소에 고정되어 있다", () => {
  const files = [
    "util/face-emoji/vendor/vision_bundle.mjs",
    "util/face-emoji/vendor/wasm/vision_wasm_internal.js",
    "util/face-emoji/vendor/wasm/vision_wasm_internal.wasm",
    "util/face-emoji/vendor/wasm/vision_wasm_nosimd_internal.js",
    "util/face-emoji/vendor/wasm/vision_wasm_nosimd_internal.wasm",
    "util/face-emoji/vendor/face_landmarker.task",
  ];
  for (const file of files) {
    const path = join(ROOT, file);
    assert.equal(existsSync(path), true, `${file}가 없다`);
    assert.ok(statSync(path).size > 100, `${file}가 비어 있다`);
    assert.ok(statSync(path).size < 25 * 1024 * 1024, `${file}가 정적 자산 한도를 넘는다`);
  }
});
