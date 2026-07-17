import test from "node:test";
import assert from "node:assert/strict";
import {
  downloadContentDisposition,
  parseAssetDownloadPath,
  serveAssetDownload,
} from "./downloads.js";

test("parses only known, flat asset download paths", () => {
  assert.deepEqual(parseAssetDownloadPath("/_download/music/upward-drift/upward_drift.mp3"), {
    category: "music", id: "upward-drift", file: "upward_drift.mp3",
  });
  assert.equal(parseAssetDownloadPath("/_download/unknown/item/file.zip"), null);
  assert.equal(parseAssetDownloadPath("/_download/music/../secret"), null);
  assert.equal(parseAssetDownloadPath("/_download/music/item/a/b.mp3"), null);
});

test("serves a file as an attachment and records one event", async () => {
  const events = [];
  const waits = [];
  const env = {
    ASSETS: {
      async fetch(request) {
        assert.equal(new URL(request.url).pathname, "/_assets/music/upward-drift/upward_drift.mp3");
        assert.equal(request.headers.has("Range"), false);
        return new Response("audio", { headers: { "Content-Type": "audio/mpeg" } });
      },
    },
    ANALYTICS: {
      idFromName(name) { assert.equal(name, "global"); return "analytics-id"; },
      get(id) {
        assert.equal(id, "analytics-id");
        return { fetch: async (_url, init) => { events.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); } };
      },
    },
  };
  const response = await serveAssetDownload(
    new Request("https://assets.bubblelab.dev/_download/music/upward-drift/upward_drift.mp3", {
      headers: { Range: "bytes=0-99" },
    }),
    env,
    { waitUntil(promise) { waits.push(promise); } },
    new URL("https://assets.bubblelab.dev/_download/music/upward-drift/upward_drift.mp3"),
  );
  await Promise.all(waits);

  assert.equal(await response.text(), "audio");
  assert.match(response.headers.get("Content-Disposition"), /^attachment;/);
  assert.deepEqual(events, [{ category: "music", id: "upward-drift", file: "upward_drift.mp3" }]);
});

test("does not record missing files", async () => {
  let recorded = false;
  const response = await serveAssetDownload(
    new Request("https://assets.bubblelab.dev/_download/music/missing/missing.mp3"),
    {
      ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
      ANALYTICS: { idFromName: () => "id", get: () => ({ fetch: async () => { recorded = true; } }) },
    },
    { waitUntil() {} },
    new URL("https://assets.bubblelab.dev/_download/music/missing/missing.mp3"),
  );
  assert.equal(response.status, 404);
  assert.equal(recorded, false);
});

test("creates a safe UTF-8 attachment header", () => {
  assert.match(downloadContentDisposition("sound.mp3"), /filename="sound\.mp3"/);
});
