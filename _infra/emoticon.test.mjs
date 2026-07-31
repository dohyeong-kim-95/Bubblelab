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
  autoCutout, chromaKeyGreen, fitFrames, loopDiff, resize, scaleDrift,
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
test("mock provider: 시트는 흰 배경, 프레임 요청은 초록 배경", async () => {
  const provider = imageProvider({ EMOTICON_IMAGE_PROVIDER: "mock" });
  const sheet = decodePng(await provider.generate({ prompt: "Draw a character reference sheet" }));
  assert.deepEqual([...sheet.data.slice(0, 4)], [255, 255, 255, 255]);
  const frame = decodePng(await provider.generate({ prompt: "Draw frame 3/12 of a 12-frame loop" }));
  assert.deepEqual([...frame.data.slice(0, 3)], [0, 255, 0]);
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
    assert.match(redo, /프레임 02 \(브레이크다운 1→2\) 재생성/);
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
