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

  // 선택 필드: 미리보기 원본 크기. 카드가 칸 비율을 항목에 맞추는 데 쓴다.
  // 둘 다 양의 정수여야 한다 — 반쪽짜리 값은 비율 계산에서 조용히 NaN이 된다.
  const size = data.previewSize;
  const previewSize = Number.isInteger(size?.width) && size.width > 0 && Number.isInteger(size?.height) && size.height > 0
    ? { width: size.width, height: size.height }
    : null;
  if (size && !previewSize) throw new Error(`${category}/${id}: previewSize must be positive integer width and height`);
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
    // 선택 필드: 배경화면 [모바일 | PC] 탭 분류. 없으면 어느 탭에서나 보인다.
    // _infra/wallpaper.mjs 가 출력 비율(세로/가로)을 보고 채운다.
    if (download.device && download.device !== "mobile" && download.device !== "desktop") {
      throw new Error(`${category}/${id}: download device must be "mobile" or "desktop": ${download.device}`);
    }
    // 선택 필드: 파일의 픽셀 크기. 상세페이지가 "내 기기에 맞게 저장"의
    // 원본으로 가장 큰 규격을 고르는 데 쓴다. 반쪽 값은 거른다.
    const sized = Number.isInteger(download.width) && download.width > 0
      && Number.isInteger(download.height) && download.height > 0;
    if ((download.width || download.height) && !sized) {
      throw new Error(`${category}/${id}: download width/height must both be positive integers: ${download.file}`);
    }
    return {
      label: String(download.label || "다운로드"),
      file: download.file,
      url: assetUrl(category, id, download.file),
      ...(download.device ? { device: download.device } : {}),
      ...(sized ? { width: download.width, height: download.height } : {}),
    };
  });

  return {
    id,
    category,
    title: data.title.trim(),
    description: String(data.description || "").trim(),
    tags: Array.isArray(data.tags) ? data.tags.map(String).filter(Boolean) : [],
    preview: assetUrl(category, id, data.preview),
    ...(previewSize ? { previewSize } : {}),
    downloads,
    createdAt: /^\d{4}-\d{2}-\d{2}$/.test(data.createdAt || "") ? data.createdAt : null,
    active: data.active !== false,
    ...(chat ? { chat } : {}),
  };
}

/** 숨긴 항목까지 담은 전체 카탈로그.
 *
 * 공개 목록에서 빼는 일은 요청 시점에 워커가 한다 (_infra/asset-flags.js) —
 * active:false 항목도 굽혀 있어야 admin에서 재빌드 없이 다시 켤 수 있다.
 * dist/_assets/catalog.json 은 run_worker_first 라 워커 필터를 우회할 수 없다. */
export function generateAssetCatalog(root) {
  const items = [];
  for (const category of ASSET_CATEGORIES) {
    const categoryDir = join(root, category);
    if (!existsSync(categoryDir)) continue;
    for (const entry of readdirSync(categoryDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const item = readAssetMetadata(root, category, join(categoryDir, entry.name));
      if (item) items.push(item);
    }
  }
  return items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "") || a.title.localeCompare(b.title, "ko"));
}
