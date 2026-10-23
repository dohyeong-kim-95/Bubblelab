import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIDENTIAL_SUBDOMAINS,
  GATED_SITES,
  KNOWN_SITES,
  NO_STORE_SITES,
  isSiteDirectoryName,
} from "./sites.js";

test("게이트·no-store 사이트는 모두 비공개 서브도메인이다", () => {
  for (const site of GATED_SITES) assert.ok(CONFIDENTIAL_SUBDOMAINS.has(site), site);
  for (const site of NO_STORE_SITES) assert.ok(CONFIDENTIAL_SUBDOMAINS.has(site), site);
  for (const site of CONFIDENTIAL_SUBDOMAINS) assert.ok(KNOWN_SITES.includes(site), site);
});

test("서브도메인 폴더 이름 규칙", () => {
  assert.equal(isSiteDirectoryName("slop"), true);
  for (const name of ["_infra", ".github", "docs", "scripts", "dist", "node_modules"]) {
    assert.equal(isSiteDirectoryName(name), false, name);
  }
});
