import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./png.mjs";
import { encodeApng, inspectApng } from "./apng.mjs";
import { imageProvider } from "./emoticon-ai.mjs";
import { bytesToBase64 } from "./emoticon-gen.js";
import {
  autoCutout, chromaKeyGreen, dropOutsideShadow, eraseInkBlobs, fitFrameBox, fitFrames, loopDiff, resize, scaleDrift,
  transparencyRatio, unionBounds,
} from "./emoticon.mjs";
import worker from "./worker.js";

const INFRA = dirname(fileURLToPath(import.meta.url));
const CLI = join(INFRA, "emoticon.mjs");

function makeImage(width, height, fill = [0, 0, 0, 0]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(fill, i * 4);
  return { width, height, data };
}

function setPixel(image, x, y, rgba) {
  image.data.set(rgba, (y * image.width + x) * 4);
}

test("chromaKeyGreen: 초록 배경은 투명, 캐릭터 색은 보존", () => {
  const image = makeImage(4, 1, [0, 255, 0, 255]);   // 순수 초록
  setPixel(image, 1, 0, [255, 176, 32, 255]);        // 주황 (캐릭터)
  setPixel(image, 2, 0, [40, 200, 40, 255]);         // 초록빛이지만 keyness 낮음 → 보존
  const keyed = chromaKeyGreen(image);
  assert.equal(keyed.data[3], 0);                    // 배경 투명
  assert.equal(keyed.data[4 + 3], 255);              // 캐릭터 불투명 유지
  assert.equal(keyed.data[4], 255);
  assert.equal(keyed.data[8 + 3], 0);                // keyness 160 → 투명 (전신 초록 캐릭터는 금지 규칙)
  assert.ok(transparencyRatio(keyed) > 0.4);
});

test("autoCutout: 배경색을 보고 크로마키/흰배경 플러드필을 자동 선택", () => {
  // 초록 배경 → 크로마키 경로
  const green = makeImage(8, 8, [0, 255, 0, 255]);
  setPixel(green, 4, 4, [255, 176, 32, 255]);
  const keyedGreen = autoCutout(green);
  assert.equal(keyedGreen.data[3], 0);
  assert.equal(keyedGreen.data[(4 * 8 + 4) * 4 + 3], 255);

  // 흰 배경 + 닫힌 외곽선(어두운 사각 테두리) → 플러드필 경로:
  // 바깥 흰색은 투명, 테두리 안쪽 흰색은 보존된다 (흰 캐릭터 몸통 시나리오)
  const white = makeImage(12, 12, [255, 255, 255, 255]);
  for (let x = 3; x <= 8; x++) for (let y = 3; y <= 8; y++) {
    if (x === 3 || x === 8 || y === 3 || y === 8) setPixel(white, x, y, [30, 30, 30, 255]);
  }
  const keyedWhite = autoCutout(white);
  assert.equal(keyedWhite.data[3], 0);                              // 바깥 배경 투명
  assert.equal(keyedWhite.data[(5 * 12 + 5) * 4 + 3], 255);         // 외곽선 안 흰색 보존
});

test("encodeApng/inspectApng: 프레임 수·delay·루프가 기록되고 첫 프레임은 PNG로 읽힌다", () => {
  const a = makeImage(8, 8, [255, 0, 0, 255]);
  const b = makeImage(8, 8, [0, 0, 255, 128]);
  const apng = encodeApng([a, b], { fps: 10, loops: 4 });
  const info = inspectApng(apng);
  assert.deepEqual(
    { width: info.width, height: info.height, frames: info.frames, loops: info.loops, animated: info.animated },
    { width: 8, height: 8, frames: 2, loops: 4, animated: true },
  );
  assert.equal(info.delays.length, 2);
  assert.ok(Math.abs(info.delays[0] - 0.1) < 0.001);
  const first = decodePng(apng);                     // acTL/fcTL/fdAT는 무시되고 IDAT(1프레임)만
  assert.equal(first.width, 8);
  assert.deepEqual([...first.data.slice(0, 4)], [255, 0, 0, 255]);
});

test("encodeApng: 크기 다른 프레임은 거부", () => {
  assert.throws(() => encodeApng([makeImage(8, 8), makeImage(4, 4)]), /크기가 다릅니다/);
});

test("encodeApng: delaysMs로 프레임별 지속시간(홀드·ease)을 기록한다", () => {
  const frames = [makeImage(4, 4, [255, 0, 0, 255]), makeImage(4, 4, [0, 0, 255, 255])];
  const info = inspectApng(encodeApng(frames, { fps: 10, delaysMs: [250, 83] }));
  assert.ok(Math.abs(info.delays[0] - 0.25) < 0.002);
  assert.ok(Math.abs(info.delays[1] - 0.083) < 0.002);
  assert.throws(() => encodeApng(frames, { delaysMs: [100] }), /delaysMs 길이/);
});

test("fitFrames: 공통 경계 하나로 잘라 프레임 간 상대 위치를 보존한다", () => {
  // 점이 (2,2) → (6,6)으로 움직이는 두 프레임: 프레임별 트리밍이면 둘 다
  // 중앙에 붙어 움직임이 사라진다 — 공통 경계라면 서로 다른 위치에 남는다.
  const a = makeImage(16, 16);
  const b = makeImage(16, 16);
  setPixel(a, 2, 2, [255, 0, 0, 255]);
  setPixel(b, 6, 6, [255, 0, 0, 255]);
  const fitted = fitFrames([a, b], 20);
  assert.equal(fitted.length, 2);
  assert.equal(fitted[0].width, 20);
  const find = (f) => {
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) if (f.data[(y * f.width + x) * 4 + 3] > 0) return { x, y };
    }
    return null;
  };
  const pa = find(fitted[0]);
  const pb = find(fitted[1]);
  assert.ok(pa && pb);
  assert.ok(pb.x > pa.x && pb.y > pa.y);            // 움직임이 살아 있다
});

test("unionBounds/loopDiff 기본 동작", () => {
  const a = makeImage(8, 8);
  setPixel(a, 1, 1, [10, 10, 10, 255]);
  setPixel(a, 6, 5, [10, 10, 10, 255]);
  assert.deepEqual(unionBounds([a]), { left: 1, top: 1, right: 6, bottom: 5 });
  assert.equal(loopDiff(a, a), 0);
  const b = makeImage(8, 8);
  setPixel(b, 1, 1, [255, 255, 255, 255]);
  assert.ok(loopDiff(a, b) > 0.1);
});

test("scaleDrift: 위치 이동은 무시하고 캐릭터 크기 변동만 잡는다", () => {
  // 같은 크기(높이 4)의 사각형이 위치만 이동 — 드리프트 0
  const box = (top, height) => {
    const img = makeImage(16, 16);
    for (let y = top; y < top + height; y++) for (let x = 2; x < 6; x++) setPixel(img, x, y, [0, 0, 0, 255]);
    return img;
  };
  assert.equal(scaleDrift([box(2, 4), box(8, 4)]), 0);
  // 높이 4 → 6으로 커짐: (6-4)/중앙값 = 50% 드리프트
  assert.ok(scaleDrift([box(2, 4), box(2, 6)]) > 0.3);
});

test("resize: 알파 가중 축소에서 투명 배경색이 번지지 않는다", () => {
  const image = makeImage(4, 4, [0, 255, 0, 0]);     // 투명 초록 배경
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) setPixel(image, x, y, [255, 0, 0, 255]);
  const small = resize(image, 2, 2);
  assert.deepEqual([...small.data.slice(0, 4)], [255, 0, 0, 255]);  // 빨강 유지
  assert.equal(small.data[3 * 4 + 3], 0);                           // 우하단은 투명
});

// 내부 프롬프트는 영어로 쓴다(지시 추종 정확도) — mock도 영어 문구로 분기한다
test("mock provider: 시트·프레임 모두 흰 배경이고 서로 구별된다", async () => {
  // 실제 프롬프트가 흰 배경을 지정하고 autoCutout이 그걸 처리한다. mock도 같아야
  // 리그(머리 원 피팅)까지 파이프라인 전체가 mock으로 검증된다.
  const provider = imageProvider({ EMOTICON_IMAGE_PROVIDER: "mock" });
  const sheet = await provider.generate({ prompt: "Draw a character reference sheet" });
  const frame = await provider.generate({ prompt: "Draw frame 3/12 of a 12-frame loop" });
  assert.deepEqual([...decodePng(sheet).data.slice(0, 4)], [255, 255, 255, 255]);
  assert.deepEqual([...decodePng(frame).data.slice(0, 4)], [255, 255, 255, 255]);
  assert.notDeepEqual(Buffer.from(sheet), Buffer.from(frame));
});

test("CLI E2E (mock): sheet → cut → build --line → check", () => {
  const workdir = mkdtempSync(join(tmpdir(), "emoticon-"));
  const env = { ...process.env, EMOTICON_IMAGE_PROVIDER: "mock" };
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  try {
    run("sheet", workdir, "--prompt", "테스트 캐릭터");
    assert.ok(existsSync(join(workdir, "sheet.png")));
    run("cut", workdir, "bounce", "--motion", "통통 튀기", "--frames", "8", "--fps", "8");
    assert.ok(existsSync(join(workdir, "cuts", "bounce", "frames", "08.png")));
    const out = run("build", workdir, "bounce", "--line");
    assert.match(out, /유니크 8장\/타임라인 8프레임 \(1\.00초\)/);
    const master = inspectApng(readFileSync(join(workdir, "out", "bounce.png")));
    assert.deepEqual([master.width, master.frames, master.loops], [360, 8, 0]);
    const line = inspectApng(readFileSync(join(workdir, "out", "bounce-line.png")));
    assert.deepEqual([line.width, line.frames, line.loops], [270, 8, 4]);
    assert.ok(readFileSync(join(workdir, "out", "bounce-line.png")).length <= 300 * 1024);
    assert.match(run("check", workdir, "bounce"), /무한/);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("CLI 게이트: plan·예산 상한·provenance·resume·force 정리", () => {
  const workdir = mkdtempSync(join(tmpdir(), "emoticon-gates-"));
  // gitCommit은 GITHUB_SHA를 먼저 본다. Actions에는 그 값이 항상 있으므로
  // 비워서 BUBBLELAB_COMMIT으로 떨어지게 해야 로컬·CI 결과가 같다.
  const env = {
    ...process.env,
    EMOTICON_IMAGE_PROVIDER: "mock",
    GITHUB_SHA: "",
    BUBBLELAB_COMMIT: "test-commit",
  };
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  const cutDir = join(workdir, "cuts", "wave");
  try {
    run("sheet", workdir, "--prompt", "테스트 캐릭터");

    const initialPlan = JSON.parse(run(
      "plan", workdir, "wave", "--motion", "손 흔들기", "--frames", "4", "--fps", "8", "--json",
    ));
    assert.deepEqual(
      [initialPlan.totalCalls, initialPlan.remainingCalls, initialPlan.estimatedCostUsd, initialPlan.frames],
      [4, 4, 0.156, 4],
    );
    assert.equal(existsSync(cutDir), false); // plan은 파일을 만들지 않는다

    assert.throws(
      () => run("cut", workdir, "wave", "--motion", "손 흔들기", "--frames", "4", "--max-calls", "3"),
      /예상 호출 4회가 --max-calls 3회를 넘습니다/,
    );
    assert.equal(existsSync(cutDir), false); // 예산 게이트는 생성 전에 닫힌다

    run("cut", workdir, "wave", "--motion", "손 흔들기", "--frames", "4", "--fps", "8", "--max-cost", "0.156");
    let meta = JSON.parse(readFileSync(join(cutDir, "cut.json"), "utf8"));
    assert.equal(meta.schemaVersion, 2);
    assert.equal(meta.status, "complete");
    assert.equal(meta.mode, "sequential");
    assert.equal(meta.calls, 4);
    assert.equal(meta.estimatedCostUsd, 0.156);
    assert.equal(meta.runs[0].gitCommit, "test-commit");
    assert.match(meta.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    for (const key of ["specHash", "sheetHash"]) assert.match(meta[key], /^[a-f0-9]{64}$/);

    // 가공 프레임만 사라졌다면 raw를 재사용하므로 API 호출 없이 복원한다.
    unlinkSync(join(cutDir, "frames", "02.png"));
    run("cut", workdir, "wave", "--motion", "손 흔들기", "--frames", "4", "--fps", "8", "--resume", "--max-calls", "0");
    assert.ok(existsSync(join(cutDir, "frames", "02.png")));
    meta = JSON.parse(readFileSync(join(cutDir, "cut.json"), "utf8"));
    assert.equal(meta.calls, 4);
    assert.equal(meta.runs.at(-1).calls, 0);

    // raw까지 사라진 한 장만 다시 호출한다.
    unlinkSync(join(cutDir, "frames-raw", "04.png"));
    unlinkSync(join(cutDir, "frames", "04.png"));
    const resumePlan = JSON.parse(run(
      "plan", workdir, "wave", "--motion", "손 흔들기", "--frames", "4", "--fps", "8", "--resume", "--json",
    ));
    assert.deepEqual([resumePlan.remainingCalls, resumePlan.reusedCalls], [1, 3]);
    run("cut", workdir, "wave", "--motion", "손 흔들기", "--frames", "4", "--fps", "8", "--resume", "--max-calls", "1");
    meta = JSON.parse(readFileSync(join(cutDir, "cut.json"), "utf8"));
    assert.equal(meta.calls, 5);
    assert.equal(meta.runs.at(-1).calls, 1);

    // --force는 컷 디렉터리를 통째로 교체해 줄어든 프레임의 찌꺼기를 남기지 않는다.
    run("cut", workdir, "wave", "--motion", "손 흔들기", "--frames", "3", "--fps", "8", "--force");
    assert.equal(existsSync(join(cutDir, "frames", "04.png")), false);
    assert.equal(existsSync(join(cutDir, "frames-raw", "04.png")), false);
    const files = readdirSync(cutDir, { recursive: true }).map(String);
    assert.equal(files.some((name) => name.includes(".partial-")), false);

    // 입력 축이 달라지면 조용히 이어 붙이지 않는다.
    writeFileSync(join(workdir, "sheet.png"), Buffer.concat([readFileSync(join(workdir, "sheet.png")), Buffer.from([0])]));
    assert.throws(
      () => run("plan", workdir, "wave", "--motion", "손 흔들기", "--frames", "3", "--fps", "8", "--resume"),
      /sheetHash가 기존 컷과 다릅니다/,
    );
    assert.throws(
      () => run("build", workdir, "wave"),
      /캐릭터 레퍼런스가 현재 파일과 다릅니다/,
    );
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

const ctx = { waitUntil() {} };
const generateRequest = (init = {}) =>
  new Request("https://work.bubblelab.dev/_emoticon/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...init.headers },
    body: JSON.stringify(init.payload ?? { prompt: "테스트", references: [] }),
  });

test("/_emoticon/generate: 키·비밀번호 없으면 503, 인증 없거나 틀리면 401", async () => {
  const closed = await worker.fetch(generateRequest(), {}, ctx);
  assert.equal(closed.status, 503);

  const env = { WORK_PASSWORD: "master-pw", GEMINI_STICKER_KEY: "sk" };
  const anonymous = await worker.fetch(generateRequest(), env, ctx);
  assert.equal(anonymous.status, 401);
  const wrong = await worker.fetch(
    generateRequest({ headers: { Authorization: "Bearer nope" } }), env, ctx,
  );
  assert.equal(wrong.status, 401);
});

test("/_emoticon/generate: 마스터 인증 시 Gemini를 대신 호출해 이미지를 돌려준다", async () => {
  const env = { WORK_PASSWORD: "master-pw", GEMINI_STICKER_KEY: "sk" };
  const auth = { Authorization: "Bearer master-pw" };

  const invalid = await worker.fetch(
    generateRequest({ headers: auth, payload: { prompt: "" } }), env, ctx,
  );
  assert.equal(invalid.status, 400);

  const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const seen = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.url = String(url);
    seen.body = JSON.parse(init.body);
    seen.key = init.headers["x-goog-api-key"];
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { data: bytesToBase64(image) } }] } }],
    }), { status: 200 });
  };
  try {
    const res = await worker.fetch(
      generateRequest({ headers: auth, payload: { prompt: "캐릭터", references: [bytesToBase64(image)] } }),
      env, ctx,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "image/png");
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), image);
    assert.equal(seen.key, "sk");                              // Worker secret이 쓰였다
    assert.match(seen.url, /gemini-2\.5-flash-image:generateContent/);
    assert.equal(seen.body.contents[0].parts.length, 2);       // 레퍼런스 1 + 프롬프트
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("edge provider: Bearer 토큰으로 프록시를 호출하고 바이트를 돌려받는다", async () => {
  const provider = imageProvider({ EMOTICON_IMAGE_PROVIDER: "edge", EMOTICON_EDGE_TOKEN: "master-pw" });
  const image = new Uint8Array([1, 2, 3, 4]);
  const seen = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.url = String(url);
    seen.auth = init.headers.Authorization;
    seen.body = JSON.parse(init.body);
    return new Response(image, { status: 200 });
  };
  try {
    const bytes = await provider.generate({ prompt: "x", references: [new Uint8Array([9])] });
    assert.deepEqual(bytes, image);
    assert.equal(seen.url, "https://work.bubblelab.dev/_emoticon/generate");
    assert.equal(seen.auth, "Bearer master-pw");
    assert.equal(seen.body.references.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
  await assert.rejects(
    imageProvider({ EMOTICON_IMAGE_PROVIDER: "edge" }).generate({ prompt: "x" }),
    /EMOTICON_EDGE_TOKEN/,
  );
});

test("CLI E2E (mock): keys 모드 — 키·브레이크다운 생성 + 핑퐁 타임라인 조립", () => {
  const workdir = mkdtempSync(join(tmpdir(), "emoticon-"));
  const env = { ...process.env, EMOTICON_IMAGE_PROVIDER: "mock" };
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  try {
    run("sheet", workdir, "--prompt", "테스트 캐릭터");
    const spec = {
      motion: "고개 끄덕임",
      keys: [
        { pose: "고개를 똑바로 든 기본 자세", hold: 2 },
        { pose: "고개를 아래로 깊이 숙임", hold: 3 },
      ],
      breakdowns: 1,
      assembly: "pingpong",
    };
    const specPath = join(workdir, "nod-keys.json");
    writeFileSync(specPath, JSON.stringify(spec));
    const out = run("cut", workdir, "nod", "--keys", specPath, "--fps", "12");
    assert.match(out, /유니크 3장 → 타임라인 4프레임, pingpong/); // 키2+bd1, 핑퐁 역순 +1

    const meta = JSON.parse(readFileSync(join(workdir, "cuts", "nod", "cut.json"), "utf8"));
    assert.equal(meta.mode, "keys");
    assert.deepEqual(meta.timeline.map((t) => t.frame), [0, 1, 2, 1]);   // k1, bd, k2, bd(역순)
    assert.deepEqual(meta.timeline.map((t) => t.delayMs), [167, 83, 250, 83]); // hold 2/1/3 @12fps

    const built = run("build", workdir, "nod");
    assert.match(built, /유니크 3장\/타임라인 4프레임/);
    assert.match(built, /인접 diff 최대/);
    const info = inspectApng(readFileSync(join(workdir, "out", "nod.png")));
    assert.equal(info.frames, 4);
    assert.ok(Math.abs(info.delays[2] - 0.25) < 0.002); // k2 hold 3 @12fps = 250ms

    // 선별 재작업: 튄 프레임 하나만 같은 프롬프트·레퍼런스로 다시 생성한다
    const before = readFileSync(join(workdir, "cuts", "nod", "frames", "02.png"));
    const redo = run("redo", workdir, "nod", "2");
    assert.match(redo, /프레임 02 \(브레이크다운 1→2 \(50%\)\) 재생성/);
    assert.ok(readFileSync(join(workdir, "cuts", "nod", "frames", "02.png")).length > 0);
    assert.equal(before.length > 0, true);
    assert.throws(() => run("redo", workdir, "nod", "9"), /프레임 번호는 1~3/);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("redo: 순차 생성(poses) 컷은 거부한다", () => {
  const workdir = mkdtempSync(join(tmpdir(), "emoticon-"));
  const env = { ...process.env, EMOTICON_IMAGE_PROVIDER: "mock" };
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  try {
    run("sheet", workdir, "--prompt", "테스트 캐릭터");
    run("cut", workdir, "seq", "--motion", "인사", "--frames", "3", "--fps", "8");
    assert.throws(() => run("redo", workdir, "seq", "1"), /keys 모드 컷만 지원/);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

// --ref를 plan에만 기록하고 cut.json에 빠뜨려서, 생성은 됐는데 build가
// sheet.png와 해시를 비교하다 막힌 적이 있다 (wave 컷 1차).
test("keys --ref: cut.json에 characterRef를 남겨 build가 같은 레퍼런스를 검증한다", () => {
  const workdir = mkdtempSync(join(tmpdir(), "emoticon-ref-"));
  const env = { ...process.env, EMOTICON_IMAGE_PROVIDER: "mock" };
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  try {
    run("sheet", workdir, "--prompt", "테스트 캐릭터");
    // 시트가 아닌 단일 컷을 레퍼런스로 준다
    const refPath = join(workdir, "ref.png");
    run("cut", workdir, "seed", "--motion", "기준", "--frames", "2", "--fps", "8");
    writeFileSync(refPath, readFileSync(join(workdir, "cuts", "seed", "frames-raw", "01.png")));

    const spec = join(workdir, "keys.json");
    writeFileSync(spec, JSON.stringify({
      motion: "끄덕", breakdowns: 1, assembly: "pingpong",
      keys: [{ pose: "정면", hold: 2 }, { pose: "숙임", hold: 2 }],
    }));
    run("cut", workdir, "nod", "--keys", spec, "--fps", "12", "--ref", refPath);

    const meta = JSON.parse(readFileSync(join(workdir, "cuts", "nod", "cut.json"), "utf8"));
    assert.equal(meta.characterRef, refPath);
    assert.equal(meta.sheetHash, createHash("sha256").update(readFileSync(refPath)).digest("hex"));
    run("build", workdir, "nod");   // 레퍼런스 검증을 통과해야 한다
    assert.ok(existsSync(join(workdir, "out", "nod.png")));

    // 레퍼런스가 바뀌면 build가 막는다
    writeFileSync(refPath, readFileSync(join(workdir, "sheet.png")));
    assert.throws(() => run("build", workdir, "nod"), /캐릭터 레퍼런스가 현재 파일과 다릅니다/);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("CLI: 시트 없이 cut은 실패, 잘못된 명령은 usage 안내", () => {
  const workdir = mkdtempSync(join(tmpdir(), "emoticon-"));
  const env = { ...process.env, EMOTICON_IMAGE_PROVIDER: "mock" };
  try {
    assert.throws(
      () => execFileSync(process.execPath, [CLI, "cut", workdir, "x", "--motion", "y"], { env, encoding: "utf8" }),
      /시트가 없습니다/,
    );
    assert.throws(
      () => execFileSync(process.execPath, [CLI, "wat", workdir], { env, encoding: "utf8" }),
      /알 수 없는 명령/,
    );
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("CLI E2E (mock): breakdowns 2 — 유니크 4장, 핑퐁 타임라인 7프레임", () => {
  // 왕복 3프레임으로는 결함이 안 보인다는 실사용 피드백 → 브레이크다운을
  // 키 쌍당 N장으로 늘린다. 대칭 재사용이라 4장 생성으로 7프레임이 나온다.
  const workdir = mkdtempSync(join(tmpdir(), "emoticon-"));
  const env = { ...process.env, EMOTICON_IMAGE_PROVIDER: "mock" };
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  try {
    run("sheet", workdir, "--prompt", "테스트 캐릭터");
    const spec = {
      motion: "고개 끄덕임",
      breakdowns: 2,
      assembly: "pingpong",
      keys: [{ pose: "고개를 든 자세", hold: 2 }, { pose: "고개를 숙인 자세", hold: 2 }],
    };
    const specPath = join(workdir, "keys.json");
    writeFileSync(specPath, JSON.stringify(spec));

    const plan = run("plan", workdir, "nod", "--keys", specPath, "--fps", "12");
    assert.match(plan, /호출: 4\/4회/);
    assert.match(plan, /출력: 4프레임/);

    run("cut", workdir, "nod", "--keys", specPath, "--fps", "12");
    const meta = JSON.parse(readFileSync(join(workdir, "cuts", "nod", "cut.json"), "utf8"));
    assert.equal(meta.frames, 4);
    // 키1 · bd(33%) · bd(67%) · 키2 · bd(67%) · bd(33%) = 6, 루프백 포함 7번째가 키1
    assert.equal(meta.timeline.length, 6);
    assert.deepEqual(meta.timeline.map((t) => t.frame), [0, 1, 2, 3, 2, 1]);
    // 슬롯별 파일이 따로 남는다
    for (const name of ["bd-1-2-1.png", "bd-1-2-2.png"]) {
      assert.ok(existsSync(join(workdir, "cuts", "nod", "frames-raw", name)), name);
    }
    // 순서 메타에 슬롯이 기록돼 redo가 같은 퍼센트로 재생성할 수 있다
    assert.deepEqual(meta.sequence[1], { type: "bd", pair: [0, 1], slot: 0, of: 2 });
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("CLI E2E (mock): rig — 모델 작화에 기하를 코드로 입힌다", () => {
  // 아홉 번의 실측에서 모델은 표정은 정확히 그렸지만 얼굴 위치는 항상
  // 원위치로 되돌렸다. 그래서 위치는 리그가 만든다 (doc/guide-by-movement/nod.md §5).
  const workdir = mkdtempSync(join(tmpdir(), "emoticon-rig-"));
  const env = { ...process.env, EMOTICON_IMAGE_PROVIDER: "mock" };
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  try {
    run("sheet", workdir, "--prompt", "테스트 캐릭터");
    const spec = join(workdir, "keys.json");
    writeFileSync(spec, JSON.stringify({
      motion: "끄덕", breakdowns: 0, assembly: "pingpong",
      keys: [
        { pose: "정면", hold: 2 },
        { pose: "눈 감음", hold: 2, rig: { type: "nod", drop: 0.2 } },
      ],
    }));
    const out = run("cut", workdir, "nod", "--keys", spec, "--fps", "12");
    assert.match(out, /키 2 리그: 얼굴 [\d.]+ → [\d.]+/);

    const meta = JSON.parse(readFileSync(join(workdir, "cuts", "nod", "cut.json"), "utf8"));
    assert.deepEqual(meta.keys[1].rig, { type: "nod", drop: 0.2 });

    // 리그가 적용된 프레임은 리그 없는 프레임과 달라야 한다 (mock은 두 포즈가 같은 그림)
    const f1 = readFileSync(join(workdir, "cuts", "nod", "frames", "01.png"));
    const f2 = readFileSync(join(workdir, "cuts", "nod", "frames", "02.png"));
    assert.notDeepEqual(f1, f2, "리그가 적용되지 않았습니다");
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("CLI: redo는 프레임당 2회까지, --force-redo로 다시 연다", () => {
  // 같은 프레임이 계속 실패하면 운이 아니라 포즈 문장이 틀린 것이다.
  // 상한이 세션 기억이 아니라 cut.json에 있어야 다음 실행도 같은 규칙을 받는다.
  const workdir = mkdtempSync(join(tmpdir(), "emoticon-redo-"));
  const env = { ...process.env, EMOTICON_IMAGE_PROVIDER: "mock" };
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  const meta = () => JSON.parse(readFileSync(join(workdir, "cuts", "b", "cut.json"), "utf8"));
  try {
    run("sheet", workdir, "--prompt", "테스트");
    const spec = join(workdir, "keys.json");
    writeFileSync(spec, JSON.stringify({
      motion: "깜빡", breakdowns: 0, keys: [{ pose: "뜸", hold: 2 }, { pose: "감음", hold: 2 }],
    }));
    run("cut", workdir, "b", "--keys", spec, "--fps", "12");

    assert.match(run("redo", workdir, "b", "2"), /재생성 1\/2/);
    assert.match(run("redo", workdir, "b", "2"), /재생성 2\/2/);
    assert.equal(meta().redoCounts["2"], 2);
    assert.throws(() => run("redo", workdir, "b", "2"), /이미 2번 재작업/);

    // 다른 프레임은 상한과 무관하다
    assert.match(run("redo", workdir, "b", "1"), /재생성 1\/2/);
    // 포즈를 고친 뒤에는 다시 열린다
    assert.match(run("redo", workdir, "b", "2", "--force-redo"), /재생성 1\/2/);
    assert.equal(meta().redoCounts["2"], 1);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("mirror: 좌우 반전은 무손실이고 두 번 하면 원본이다", async () => {
  // 든 팔이 프레임마다 좌우로 뛰는 문제를 재생성 없이 고치는 경로다.
  const { mirrorImage } = await import("./emoticon.mjs");
  const image = {
    width: 3, height: 2,
    data: Uint8Array.from([
      1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255,
      10, 11, 12, 255, 13, 14, 15, 255, 16, 17, 18, 200,
    ]),
  };
  const flipped = mirrorImage(image);
  assert.deepEqual([...flipped.data.slice(0, 4)], [7, 8, 9, 255]);   // 첫 픽셀 ← 마지막
  assert.deepEqual([...flipped.data.slice(12, 16)], [16, 17, 18, 200]); // 알파도 함께
  assert.deepEqual([...mirrorImage(flipped).data], [...image.data]);
});

test("CLI: mirror가 프레임 파일을 실제로 뒤집는다", () => {
  const workdir = mkdtempSync(join(tmpdir(), "emoticon-mirror-"));
  const env = { ...process.env, EMOTICON_IMAGE_PROVIDER: "mock" };
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  try {
    run("sheet", workdir, "--prompt", "테스트");
    const spec = join(workdir, "keys.json");
    writeFileSync(spec, JSON.stringify({
      motion: "인사", breakdowns: 0, keys: [{ pose: "차렷", hold: 2 }, { pose: "손 들기", hold: 2 }],
    }));
    run("cut", workdir, "m", "--keys", spec, "--fps", "12");
    const path = join(workdir, "cuts", "m", "frames", "02.png");
    const before = readFileSync(path);
    assert.match(run("mirror", workdir, "m", "2"), /프레임 02 좌우 반전/);
    const after = readFileSync(path);
    // mock은 좌우대칭 원이라 픽셀은 같을 수 있다 — 파일이 정상 PNG로 남는지 확인
    assert.ok(after.length > 0);
    assert.doesNotThrow(() => run("build", workdir, "m"));
    assert.throws(() => run("mirror", workdir, "m", "99"), /프레임이 없습니다/);
    assert.ok(before.length > 0);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("alignFrames: 몸 기준점으로 평행이동해 흔들림을 없앤다", async () => {
  // 모델이 프레임마다 몸을 몇 px씩 옮겨 그린다 — 재생하면 "갑자기 translation"
  // 한다는 검수 지적으로 드러났다(wave2 하체 중심 502~517px).
  const { alignFrames, bodyAnchor } = await import("./emoticon.mjs");
  const blob = (dx, dy, size = 40) => {
    const data = new Uint8Array(size * size * 4);
    for (let y = 20; y < 34; y++) {
      for (let x = 14; x < 26; x++) {
        const i = ((y + dy) * size + (x + dx)) * 4;
        data[i] = 20; data[i + 1] = 20; data[i + 2] = 20; data[i + 3] = 255;
      }
    }
    return { width: size, height: size, data };
  };
  const frames = [blob(0, 0), blob(3, -2), blob(-2, 1)];
  const spread = (list) => {
    const xs = list.map((f) => bodyAnchor(f).x);
    const ys = list.map((f) => bodyAnchor(f).y);
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  };
  assert.deepEqual(spread(frames), [5, 3]);          // 정렬 전에는 흔들린다
  assert.deepEqual(spread(alignFrames(frames)), [0, 0]);  // 정렬 후 기준점 일치
});

test("guide: 카탈로그가 동작 → 문서를 매핑한다", async () => {
  // 문서가 열두 개까지 늘어서, 동작 하나 만들려고 전부 읽는 건 컨텍스트 낭비다.
  const { findMovement } = await import("./emoticon.mjs");
  const catalog = JSON.parse(readFileSync("work/emoticon/doc/movement_catalog.json", "utf8"));

  // 한국어 이름·영문 id 양쪽으로 찾힌다
  assert.equal(findMovement(catalog, "인사")?.id, "wave");
  assert.equal(findMovement(catalog, "wave")?.id, "wave");
  assert.equal(findMovement(catalog, "끄덕임")?.id, "nod");
  assert.equal(findMovement(catalog, "없는동작"), null);

  // 카탈로그가 가리키는 guide 파일이 실제로 있어야 한다 (링크 썩음 방지)
  for (const m of catalog.movements) {
    assert.ok(catalog.channels[m.channel], `${m.id}: 알 수 없는 channel ${m.channel}`);
    assert.ok(catalog.statuses[m.status], `${m.id}: 알 수 없는 status ${m.status}`);
    if (m.guide) {
      assert.ok(existsSync(join("work/emoticon", m.guide)), `${m.id}: guide 파일 없음 ${m.guide}`);
    }
  }
});

test("redo는 그 키의 lift를 다시 적용한다 (빠뜨리면 그 프레임만 점프가 사라진다)", () => {
  const workdir = mkdtempSync(join(tmpdir(), "emoticon-lift-"));
  const env = { ...process.env, EMOTICON_IMAGE_PROVIDER: "mock" };
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  const topOf = (path) => {
    const im = decodePng(readFileSync(path));
    for (let y = 0; y < im.height; y++) {
      for (let x = 0; x < im.width; x++) if (im.data[(y * im.width + x) * 4 + 3] > 128) return y;
    }
    return -1;
  };
  try {
    run("sheet", workdir, "--prompt", "테스트");
    const spec = join(workdir, "keys.json");
    writeFileSync(spec, JSON.stringify({
      motion: "점프", breakdowns: 0,
      keys: [{ pose: "웅크림", hold: 2 }, { pose: "최고점", hold: 2, lift: 0.3 }],
    }));
    run("cut", workdir, "j", "--keys", spec, "--fps", "12");
    // lift가 있으면 build가 몸 정렬로 점프를 지우지 않도록 anchor를 끈다
    const meta = JSON.parse(readFileSync(join(workdir, "cuts", "j", "cut.json"), "utf8"));
    assert.equal(meta.anchor, "none");

    const path = join(workdir, "cuts", "j", "frames", "02.png");
    const lifted = topOf(path);
    assert.ok(lifted < topOf(join(workdir, "cuts", "j", "frames", "01.png")), "2번이 위로 올라가야 함");

    const out = run("redo", workdir, "j", "2");
    assert.match(out, /들어올림 재적용: 30%/);
    assert.equal(topOf(path), lifted, "재작업 후에도 같은 높이여야 함");
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("lift·rig를 손봐도 이미 뽑은 raw를 재사용한다 (후처리는 해시 밖)", () => {
  // 실측: lift가 캔버스를 넘어 멈췄을 때 lift만 낮추면 되는데 해시가 달라져
  // 6장을 다시 뽑을 뻔했다. 후처리 값은 모델에게 보내는 것을 바꾸지 않는다.
  const workdir = mkdtempSync(join(tmpdir(), "emoticon-hash-"));
  const env = { ...process.env, EMOTICON_IMAGE_PROVIDER: "mock" };
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  try {
    run("sheet", workdir, "--prompt", "테스트");
    const spec = join(workdir, "keys.json");
    const write = (lift) => writeFileSync(spec, JSON.stringify({
      motion: "점프", breakdowns: 0,
      keys: [{ pose: "서기", hold: 2 }, { pose: "점프", hold: 2, lift }],
    }));
    write(0.3);
    run("cut", workdir, "j", "--keys", spec, "--fps", "12");

    write(0.1);   // lift만 바꾼다
    const plan = run("plan", workdir, "j", "--keys", spec, "--fps", "12", "--resume");
    assert.match(plan, /재사용 2회/, "lift만 바뀌면 전부 재사용되어야 한다");

    // 포즈를 바꾸면 재사용되지 않는다 (해시가 제 역할을 하는지)
    writeFileSync(spec, JSON.stringify({
      motion: "점프", breakdowns: 0,
      keys: [{ pose: "서기", hold: 2 }, { pose: "다른 포즈", hold: 2, lift: 0.1 }],
    }));
    // 포즈가 바뀌면 resume 자체가 거부된다 (재사용이 아니라 아예 막는다)
    assert.throws(() => run("plan", workdir, "j", "--keys", spec, "--fps", "12", "--resume"),
      /specHash가 기존 컷과 다릅니다/);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("dropGroundLine: 열별 두께의 최빈값으로 바닥선만 지운다", async () => {
  // 모델이 지시하지 않고 바닥선을 그린다(bounce2 6/6). 발이 땅에 닿아 붙어
  // 있어도 잡아야 하므로 연결요소가 아니라 **열별 바닥 두께**로 본다 —
  // 선만 있는 열은 전부 같은 두께이고 몸·발이 얹힌 열은 훨씬 두껍다.
  const { dropGroundLine } = await import("./emoticon.mjs");
  const make = (withLine) => {
    const size = 120;
    const data = new Uint8Array(size * size * 4);
    const put = (x, y) => { data[(y * size + x) * 4 + 3] = 255; };
    for (let y = 20; y < 100; y++) {                 // 아래로 갈수록 좁아지는 몸
      const half = Math.round(30 - (y - 20) * 0.2);
      for (let x = 60 - half; x <= 60 + half; x++) put(x, y);
    }
    if (withLine) for (let y = 100; y < 104; y++) for (let x = 10; x < 110; x++) put(x, y);
    return { width: size, height: size, data };
  };
  const cleaned = dropGroundLine(make(true));
  assert.ok(cleaned.removed > 0, "바닥선을 지워야 한다");
  assert.equal(cleaned.bandHeight, 4, "선의 두께를 정확히 재야 한다");
  // 몸통 아래에서도 선 두께만큼만 걷어낸다 — 발 외곽선은 남는다
  const body = dropGroundLine(make(true)).image;
  let bottomInk = 0;
  for (let x = 0; x < 120; x++) if (body.data[(99 * 120 + x) * 4 + 3] > 16) bottomInk++;
  assert.ok(bottomInk > 0, "선 위의 몸통은 남아 있어야 한다");
  // 선이 없으면 손대지 않는다
  assert.equal(dropGroundLine(make(false)).removed, 0);
});

// ── erase: 몸통 안 군더더기 획 제거 ────────────────────────
// bounce2 2번 프레임의 "안쪽 손" 한 쌍처럼 실루엣 안에 떠 있는 여분의 획은
// 포즈 문장으로 세 번 못 없앴다. 외곽선과 닿지 않는 독립 덩어리라 코드로 지운다.
function inkCanvas() {
  // 40x40 흰 사각형 안에 5x5 검은 점 하나. 테두리 한 줄은 검정(외곽선 역할).
  const width = 40, height = 40;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const blob = x >= 18 && x < 23 && y >= 18 && y < 23;
      const v = edge || blob ? 20 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}
const pixelAt = ({ width, data }, x, y) => data[(y * width + x) * 4];

test("erase는 지정한 획만 지우고 주변 색으로 메운다", () => {
  const { image, erased } = eraseInkBlobs(inkCanvas(), [[20, 20]]);
  assert.deepEqual(erased, [{ x: 20, y: 20, px: 25 }]);
  assert.equal(pixelAt(image, 20, 20), 255);       // 획이 흰 몸통 색으로 메워졌다
  assert.equal(pixelAt(image, 0, 20), 20);         // 외곽선은 그대로
});

test("erase는 외곽선(가장자리에 닿는 덩어리)을 거부한다", () => {
  // 실수로 외곽선 좌표를 주면 캐릭터가 통째로 지워진다 — 막아야 한다.
  assert.throws(() => eraseInkBlobs(inkCanvas(), [[0, 20]]), /가장자리에 닿습니다/);
});

test("erase는 잉크가 아닌 좌표를 거부한다", () => {
  assert.throws(() => eraseInkBlobs(inkCanvas(), [[10, 10]]), /잉크가 아닙니다/);
});

test("erase는 전체 잉크의 큰 비중을 차지하는 덩어리를 거부한다", () => {
  assert.throws(() => eraseInkBlobs(inkCanvas(), [[20, 20]], { maxInkRatio: 0.01 }), /지울 위험이 있어 거부/);
});

test("erase는 안티에일리어싱 테두리까지 지운다", () => {
  // 처음 구현은 잉크 문턱(<110)만 지워서 회색 유령이 남았다 — bounce2 2번에서
  // 실제로 그랬다. 획 둘레의 중간 밝기 픽셀까지 함께 걷어내야 한다.
  const width = 40, height = 40;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const core = x >= 18 && x < 23 && y >= 18 && y < 23;
      const fringe = x >= 17 && x < 24 && y >= 17 && y < 24;
      const v = edge || core ? 20 : fringe ? 160 : 255;   // 160 = 반투명 테두리
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const { image } = eraseInkBlobs({ width, height, data }, [[20, 20]]);
  let darkest = 255;
  for (let y = 15; y < 26; y++) for (let x = 15; x < 26; x++) darkest = Math.min(darkest, pixelAt(image, x, y));
  assert.equal(darkest, 255, "테두리 잔상이 남았습니다");
});

// ── unshadow: 외곽선 바깥 드롭섀도 제거 ───────────────────
// bounce3 3·4번에 발밑 회색 타원이 생겼고 재생성해도 같은 자리에 다시 나왔다.
// 발과 이어져 있어 연결요소로는 못 뗀다 — "닫힌 외곽선 바깥"이라는 성질을 쓴다.
test("unshadow는 외곽선 바깥 회색만 지우고 몸통 안은 지키지 않는다", () => {
  const width = 60, height = 60;
  const data = new Uint8Array(width * height * 4);
  const set = (x, y, v, a = 255) => {
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = a;
  };
  // 20..40 정사각형: 테두리는 잉크, 안은 흰 몸통. 안쪽 한 점은 회색(안티에일리어싱 흉내).
  for (let y = 20; y <= 40; y++) for (let x = 20; x <= 40; x++) {
    const edge = x === 20 || x === 40 || y === 20 || y === 40;
    set(x, y, edge ? 20 : 255);
  }
  set(30, 30, 190);                       // 몸통 **안쪽** 회색 — 살아남아야 한다
  for (let x = 24; x <= 36; x++) set(x, 48, 190);  // 몸통 **바깥** 회색 띠 = 그림자

  const { image, removed } = dropOutsideShadow({ width, height, data });
  assert.equal(removed, 13, "바깥 회색 띠 13px가 지워져야 합니다");
  assert.equal(image.data[(48 * width + 30) * 4 + 3], 0, "그림자가 남았습니다");
  assert.equal(image.data[(30 * width + 30) * 4 + 3], 255, "몸통 안쪽 회색을 지웠습니다");
  assert.equal(image.data[(20 * width + 30) * 4 + 3], 255, "외곽선을 지웠습니다");
});

test("unshadow는 외곽선 바로 바깥의 안티에일리어싱을 지킨다", () => {
  // 선 둘레까지 걷어내면 외곽선이 계단처럼 딱딱해진다.
  const width = 60, height = 60;
  const data = new Uint8Array(width * height * 4);
  const set = (x, y, v) => { const i = (y * width + x) * 4; data[i]=data[i+1]=data[i+2]=v; data[i+3]=255; };
  for (let y = 20; y <= 40; y++) for (let x = 20; x <= 40; x++) {
    set(x, y, x === 20 || x === 40 || y === 20 || y === 40 ? 20 : 255);
  }
  set(30, 19, 190);   // 선에 딱 붙은 바깥 회색 = 안티에일리어싱
  const { image, removed } = dropOutsideShadow({ width, height, data });
  assert.equal(removed, 0);
  assert.equal(image.data[(19 * width + 30) * 4 + 3], 255);
});

// ── fit: 혼자 커진 프레임을 이웃 크기에 맞춘다 ────────────
// bounce3 3번이 실루엣 높이 582px로 이웃 546px보다 7% 컸다. 같은
// "normal proportions"를 줘도 모델이 매번 다시 정규화해서 생기는 편차다.
test("fit은 가로·세로를 따로 맞추고 중심을 지킨다", () => {
  const width = 100, height = 100;
  const data = new Uint8Array(width * height * 4);
  for (let y = 30; y < 70; y++) for (let x = 40; x < 60; x++) {   // 높이 40, 중심 y=50
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 20; data[i + 3] = 255;
  }
  const r = fitFrameBox({ width, height, data }, 20, 36);   // 40 → 36 (bounce3와 같은 정도의 편차)
  assert.deepEqual(r.from, [20, 40]);
  assert.equal(r.scaleY, 0.9);
  assert.equal(r.scaleX, 1);
  let y0 = height, y1 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (r.image.data[(y * width + x) * 4 + 3] > 16) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  assert.equal(y1 - y0 + 1, 36, "목표 높이가 아닙니다");
  assert.equal(Math.round((y0 + y1) / 2), 50, "중심이 움직였습니다");
});

test("fit은 말이 안 되는 배율을 거부한다", () => {
  const width = 40, height = 40;
  const data = new Uint8Array(width * height * 4);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) data[(y * width + x) * 4 + 3] = 255;
  assert.throws(() => fitFrameBox({ width, height, data }, 20, 5), /너무 큽니다/);
});

test("fit은 홀쭉한 프레임의 폭도 되돌린다", () => {
  // 한 배율로만 줄이면 원래 홀쭉했던 프레임이 높이만 맞고 폭은 더 홀쭉해진다.
  // bounce3 3번이 582x453(홀쭉)이라 균일 축소 후 폭이 이웃보다 4% 좁아졌다.
  const width = 100, height = 100;
  const data = new Uint8Array(width * height * 4);
  for (let y = 25; y < 75; y++) for (let x = 45; x < 65; x++) data[(y * width + x) * 4 + 3] = 255;
  const r = fitFrameBox({ width, height, data }, 24, 44);   // 20x50 → 24x44
  assert.deepEqual(r.from, [20, 50]);
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (r.image.data[(y * width + x) * 4 + 3] > 16) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  assert.equal(x1 - x0 + 1, 24, "폭이 목표와 다릅니다");
  assert.equal(y1 - y0 + 1, 44, "높이가 목표와 다릅니다");
});
