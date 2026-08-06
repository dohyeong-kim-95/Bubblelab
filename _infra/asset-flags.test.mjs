import test from "node:test";
import assert from "node:assert/strict";
import {
  AssetFlagsDO,
  adminAssetList,
  assetFlagKey,
  isAssetVisible,
  normalizeOverrides,
  publicCatalog,
} from "./asset-flags.js";

const sticker = (id, extra = {}) => ({
  id, category: "sticker", title: `${id} 팩`, preview: `/_assets/sticker/${id}/preview.png`,
  downloads: [{ label: "01", file: "01.png" }], createdAt: "2026-07-31", active: true, ...extra,
});

// 메모리 storage로 DO를 돌린다 (다른 DO 테스트와 같은 방식)
function memoryState() {
  const map = new Map();
  return {
    storage: {
      async get(key) { return map.get(key); },
      async put(key, value) { map.set(key, value); },
    },
  };
}

const flagsRequest = (method, body) => new Request("https://assetflags.internal/flags", {
  method,
  ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
});

test("토글 키는 스티커만, 경로 조작은 막는다", () => {
  assert.equal(assetFlagKey("sticker", "dageudangseu-1"), "sticker/dageudangseu-1");
  // 배경화면은 빌드가 상세페이지를 굽기 때문에 런타임 토글 대상이 아니다
  assert.equal(assetFlagKey("wallpaper", "night-sky"), null);
  assert.equal(assetFlagKey("sticker", "../../etc/passwd"), null);
  assert.equal(assetFlagKey("sticker", "a/b"), null);
  assert.equal(assetFlagKey("sticker", ""), null);
  assert.equal(assetFlagKey("sticker", null), null);
});

test("오버라이드는 형식이 맞는 항목만 남는다", () => {
  assert.deepEqual(
    normalizeOverrides({
      "sticker/jeju-cat": false,
      "sticker/ok": true,
      "wallpaper/night": false,   // 토글 대상 아님
      "sticker/../secret": false, // 경로 조작
      "sticker/hoodie-cat": "false", // boolean 아님
      "sticker": true,               // 카테고리만
    }),
    { "sticker/jeju-cat": false, "sticker/ok": true },
  );
  assert.deepEqual(normalizeOverrides(null), {});
  assert.deepEqual(normalizeOverrides("nope"), {});
});

test("공개 여부는 오버라이드 → metadata active 순으로 정해진다", () => {
  const overrides = { "sticker/hidden-now": false, "sticker/shown-now": true };
  assert.equal(isAssetVisible(sticker("plain"), overrides), true);
  assert.equal(isAssetVisible(sticker("hidden-now"), overrides), false);
  // metadata에서 꺼 둔 팩도 admin에서 켤 수 있다 (재빌드 없이)
  assert.equal(isAssetVisible(sticker("shown-now", { active: false }), overrides), true);
  assert.equal(isAssetVisible(sticker("off", { active: false }), overrides), false);
  // 토글 대상이 아닌 카테고리는 metadata 값만 따른다
  assert.equal(isAssetVisible({ id: "night", category: "wallpaper", active: false }, { "wallpaper/night": true }), false);
});

test("공개 카탈로그는 숨긴 항목과 내부 플래그를 내보내지 않는다", () => {
  const catalog = {
    version: 1,
    generatedAt: "2026-08-06T00:00:00.000Z",
    items: [sticker("keep"), sticker("drop"), sticker("build-hidden", { active: false })],
  };
  const result = publicCatalog(catalog, { "sticker/drop": false });
  assert.deepEqual(result.items.map((item) => item.id), ["keep"]);
  assert.equal(result.version, 1);
  assert.equal(result.generatedAt, catalog.generatedAt);
  assert.equal("active" in result.items[0], false);
  // 원본은 그대로 (같은 카탈로그를 다음 요청에서 다시 쓴다)
  assert.equal(catalog.items.length, 3);
  assert.equal(catalog.items[0].active, true);
});

test("admin 목록은 숨긴 팩까지 현재 상태와 함께 보여준다", () => {
  const catalog = {
    items: [
      sticker("one", { chat: { title: "원" } }),
      sticker("two", { active: false }),
      { id: "night", category: "wallpaper", title: "밤", preview: "p.png", downloads: [], active: true },
    ],
  };
  const items = adminAssetList(catalog, { "sticker/one": false }, "sticker");
  assert.deepEqual(items.map((item) => item.id), ["one", "two"]); // 배경화면은 빠진다
  assert.deepEqual(items[0], {
    id: "one", category: "sticker", title: "one 팩", preview: "/_assets/sticker/one/preview.png",
    count: 1, createdAt: "2026-07-31", chat: "원",
    defaultVisible: true, visible: false, overridden: true,
  });
  assert.deepEqual(
    { visible: items[1].visible, defaultVisible: items[1].defaultVisible, overridden: items[1].overridden },
    { visible: false, defaultVisible: false, overridden: false },
  );
});

test("AssetFlagsDO: 저장·해제와 잘못된 요청 거절", async () => {
  const flags = new AssetFlagsDO(memoryState());

  assert.deepEqual(await (await flags.fetch(flagsRequest("GET"))).json(), { overrides: {} });

  let res = await flags.fetch(flagsRequest("POST", { key: "sticker/jeju-cat", visible: false }));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).overrides, { "sticker/jeju-cat": false });
  // 새 인스턴스(=재시작)에서도 값이 남아 있어야 한다면 storage에 들어 있어야 한다
  assert.deepEqual(
    (await (await flags.fetch(flagsRequest("GET"))).json()).overrides,
    { "sticker/jeju-cat": false },
  );

  // null = 오버라이드 해제 → metadata 기본값으로 되돌아간다
  res = await flags.fetch(flagsRequest("POST", { key: "sticker/jeju-cat", visible: null }));
  assert.deepEqual((await res.json()).overrides, {});

  for (const body of [
    { key: "wallpaper/night", visible: false },
    { key: "sticker/../etc", visible: true },
    { key: "sticker/ok", visible: "false" },
    {},
  ]) {
    assert.equal((await flags.fetch(flagsRequest("POST", body))).status, 400, JSON.stringify(body));
  }

  assert.equal((await flags.fetch(flagsRequest("DELETE"))).status, 405);
  assert.equal((await flags.fetch(new Request("https://assetflags.internal/other"))).status, 404);
});
