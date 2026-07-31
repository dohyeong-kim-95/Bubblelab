import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./png.mjs";
import { encodeApng, inspectApng } from "./apng.mjs";
import { imageProvider } from "./emoticon-ai.mjs";
import { bytesToBase64 } from "./emoticon-gen.js";
import { chromaKeyGreen, fitFrames, loopDiff, resize, transparencyRatio, unionBounds } from "./emoticon.mjs";
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

test("resize: 알파 가중 축소에서 투명 배경색이 번지지 않는다", () => {
  const image = makeImage(4, 4, [0, 255, 0, 0]);     // 투명 초록 배경
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) setPixel(image, x, y, [255, 0, 0, 255]);
  const small = resize(image, 2, 2);
  assert.deepEqual([...small.data.slice(0, 4)], [255, 0, 0, 255]);  // 빨강 유지
  assert.equal(small.data[3 * 4 + 3], 0);                           // 우하단은 투명
});

test("mock provider: 시트는 흰 배경, 프레임 요청은 초록 배경", async () => {
  const provider = imageProvider({ EMOTICON_IMAGE_PROVIDER: "mock" });
  const sheet = decodePng(await provider.generate({ prompt: "캐릭터 시트" }));
  assert.deepEqual([...sheet.data.slice(0, 4)], [255, 255, 255, 255]);
  const frame = decodePng(await provider.generate({ prompt: "프레임 3/12 ..." }));
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
    assert.match(out, /8프레임 @8fps/);
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
