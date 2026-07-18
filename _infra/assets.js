import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export const ASSET_CATEGORIES = new Set(["wallpaper", "sticker", "photo-frame", "music"]);

const safePart = (value) =>
  typeof value === "string" && /^[a-z0-9][a-z0-9._-]*$/i.test(value) && value !== "." && value !== "..";

function assetUrl(category, id, file) {
  return `/_assets/${category}/${id}/${file}`;
}

export function readAssetMetadata(root, category, itemDir) {
  const metadataPath = join(itemDir, "metadata.json");
  if (!existsSync(metadataPath)) return null;
  const id = basename(itemDir);
  if (!ASSET_CATEGORIES.has(category) || !safePart(id)) throw new Error(`invalid asset path: ${category}/${id}`);

  let data;
  try { data = JSON.parse(readFileSync(metadataPath, "utf8")); }
  catch (error) { throw new Error(`${category}/${id}/metadata.json: ${error.message}`); }

  if (data.id && data.id !== id) throw new Error(`${category}/${id}: metadata id must match directory name`);
  if (typeof data.title !== "string" || !data.title.trim()) throw new Error(`${category}/${id}: title is required`);
  if (!safePart(data.preview)) throw new Error(`${category}/${id}: preview must be a local file name`);
  if (!existsSync(join(itemDir, data.preview))) throw new Error(`${category}/${id}: preview file not found`);
  if (!Array.isArray(data.downloads) || !data.downloads.length) throw new Error(`${category}/${id}: downloads are required`);

  // 선택 필드: 익명 채팅(util/chat) 스티커 서랍 노출용 짧은 제목.
  // 클라이언트는 catalog.json에서 chat 팩 목록을 읽는다 (하드코딩 없음).
  // 서버 검증(_infra/chat.js CHAT_STICKER_PACKS)은 sticker-pack.test.mjs가 동기화를 검사한다.
  // cutout:false = 클라이언트 흰 배경 누끼 생략 (흰 캐릭터가 같이 지워지는 팩용).
  const chat = typeof data.chat?.title === "string" && data.chat.title.trim()
    ? {
        title: data.chat.title.trim(),
        ...(data.chat.cutout === false ? { cutout: false } : {}),
      }
    : null;
  if (data.chat && !chat) throw new Error(`${category}/${id}: chat.title must be a non-empty string`);

  const downloads = data.downloads.map((download, index) => {
    if (!safePart(download?.file)) throw new Error(`${category}/${id}: invalid download file #${index + 1}`);
    if (!existsSync(join(itemDir, download.file))) throw new Error(`${category}/${id}: download file not found: ${download.file}`);
    return {
      label: String(download.label || "다운로드"),
      file: download.file,
      url: assetUrl(category, id, download.file),
    };
  });

  return {
    id,
    category,
    title: data.title.trim(),
    description: String(data.description || "").trim(),
    tags: Array.isArray(data.tags) ? data.tags.map(String).filter(Boolean) : [],
    preview: assetUrl(category, id, data.preview),
    downloads,
    createdAt: /^\d{4}-\d{2}-\d{2}$/.test(data.createdAt || "") ? data.createdAt : null,
    active: data.active !== false,
    ...(chat ? { chat } : {}),
  };
}

export function generateAssetCatalog(root) {
  const items = [];
  for (const category of ASSET_CATEGORIES) {
    const categoryDir = join(root, category);
    if (!existsSync(categoryDir)) continue;
    for (const entry of readdirSync(categoryDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const item = readAssetMetadata(root, category, join(categoryDir, entry.name));
      if (item?.active) items.push(item);
    }
  }
  return items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "") || a.title.localeCompare(b.title, "ko"));
}
