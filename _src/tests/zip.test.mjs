// _shared/zip.js — 만든 ZIP 을 다시 읽어 본다(헤더 결함은 만들 때가 아니라 풀 때 드러난다).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";

const SOURCE = readFileSync(new URL("../../_shared/zip.js", import.meta.url), "utf8");

async function makeZip(files) {
  const window = {};
  runInNewContext(SOURCE, { window, TextEncoder, Blob, Uint8Array, DataView, ArrayBuffer, Array });
  const blob = window.blMakeZip(files);
  return new Uint8Array(await blob.arrayBuffer());
}

// 중앙 디렉터리를 따라가며 항목을 읽는다(무압축만).
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endAt = bytes.length - 22;
  assert.equal(view.getUint32(endAt, true), 0x06054b50, "끝 레코드");
  const count = view.getUint16(endAt + 10, true);
  let at = view.getUint32(endAt + 16, true);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(view.getUint32(at, true), 0x02014b50, "중앙 디렉터리");
    const centralFlags = view.getUint16(at + 8, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const localAt = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(localAt, true), 0x04034b50, "로컬 헤더");
    const localFlags = view.getUint16(localAt + 6, true);
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true);
    entries.push({ name, centralFlags, localFlags, crc, data: bytes.subarray(dataAt, dataAt + size) });
    at += 46 + nameLength;
  }
  return entries;
}

const encoder = new TextEncoder();
const FILES = [
  { name: "사진_01.png", data: encoder.encode("첫 번째") },
  { name: "plain.txt", data: encoder.encode("hello") },
  { name: "빈파일", data: new Uint8Array(0) },
];

test("zip: 이름·내용이 그대로 돌아오고 UTF-8 파일명 플래그가 양쪽 헤더에 있다", async () => {
  const entries = readZip(await makeZip(FILES));
  assert.deepEqual(entries.map((entry) => entry.name), FILES.map((file) => file.name));
  for (let index = 0; index < FILES.length; index += 1) {
    assert.deepEqual([...entries[index].data], [...FILES[index].data]);
    assert.equal(entries[index].centralFlags & 0x0800, 0x0800);
    assert.equal(entries[index].localFlags & 0x0800, 0x0800);
  }
  assert.equal(entries[1].crc, 0x3610a686); // crc32("hello")
});

test("zip: 다른 구현(파이썬 zipfile)도 한글 이름과 CRC 를 그대로 읽는다", async (t) => {
  const python = spawnSync("python3", ["--version"]);
  if (python.status !== 0) {
    t.skip("python3 없음");
    return;
  }
  const bytes = await makeZip(FILES);
  const script = [
    "import sys, zipfile, io, json",
    "z = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))",
    "bad = z.testzip()",
    "print(json.dumps({'bad': bad, 'names': z.namelist(), 'first': z.read(z.namelist()[0]).decode('utf-8')}))",
  ].join("\n");
  const run = spawnSync("python3", ["-I", "-c", script], { input: bytes, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.bad, null);
  assert.deepEqual(result.names, FILES.map((file) => file.name));
  assert.equal(result.first, "첫 번째");
});
