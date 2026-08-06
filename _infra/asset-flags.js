// 에셋 공개 여부의 런타임 오버레이.
//
// 빌드가 굽는 /_assets/catalog.json 에는 metadata.json 의 active 값을 그대로
// 담은 전체 목록이 들어간다. 실제로 공개되는 목록은 여기 오버라이드를 얹어서
// 만든다 — 그래야 admin에서 껐다 켜는 데 재빌드·재배포가 필요 없다.
//
// 공개 여부는 "목록 노출" 기준이다. 파일 자체(/_assets/<category>/<id>/…)는
// 숨겨도 주소를 아는 사람은 그대로 받을 수 있다 (metadata의 active와 같은 수준).

// 토글을 허용하는 카테고리. 배경화면은 항목마다 빌드가 상세페이지를 굽기
// 때문에 런타임 토글과 반쪽으로 어긋난다 — 지금은 스티커만 연다.
export const FLAGGABLE_CATEGORIES = new Set(["sticker"]);

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

/** "<category>/<id>" 저장 키. 토글할 수 없는 카테고리·잘못된 id면 null. */
export function assetFlagKey(category, id) {
  if (!FLAGGABLE_CATEGORIES.has(category) || typeof id !== "string" || !SAFE_ID.test(id)) return null;
  return `${category}/${id}`;
}

/** 저장·전달받은 오버라이드에서 유효한 항목만 남긴다 (키 형식 + boolean 값). */
export function normalizeOverrides(raw) {
  const overrides = {};
  if (!raw || typeof raw !== "object") return overrides;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "boolean") continue;
    const [category, id, ...rest] = key.split("/");
    if (rest.length || assetFlagKey(category, id) !== key) continue;
    overrides[key] = value;
  }
  return overrides;
}

/** 오버라이드가 있으면 그 값, 없으면 metadata의 active(기본 공개). */
export function isAssetVisible(item, overrides) {
  const key = assetFlagKey(item?.category, item?.id);
  const override = key ? overrides?.[key] : undefined;
  return typeof override === "boolean" ? override : item?.active !== false;
}

/** 공개용 카탈로그: 숨김 항목을 빼고, 내부 플래그(active)는 내보내지 않는다. */
export function publicCatalog(catalog, overrides) {
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  return {
    ...catalog,
    items: items.filter((item) => isAssetVisible(item, overrides)).map(({ active, ...item }) => item),
  };
}

/** admin 목록: 숨긴 항목까지 현재 상태와 함께 보여준다. */
export function adminAssetList(catalog, overrides, category) {
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  return items
    .filter((item) => item.category === category && assetFlagKey(item.category, item.id))
    .map((item) => ({
      id: item.id,
      category: item.category,
      title: item.title,
      preview: item.preview,
      count: Array.isArray(item.downloads) ? item.downloads.length : 0,
      createdAt: item.createdAt,
      chat: item.chat?.title ?? null,
      // defaultVisible = 리포의 metadata.json 값, visible = 지금 실제로 보이는 값
      defaultVisible: item.active !== false,
      visible: isAssetVisible(item, overrides),
      overridden: typeof overrides?.[assetFlagKey(item.category, item.id)] === "boolean",
    }));
}

/** 공개 여부 오버라이드 저장소. 값이 작아 한 키에 통째로 담는다. */
export class AssetFlagsDO {
  constructor(state) {
    this.state = state;
  }

  async #overrides() {
    return normalizeOverrides(await this.state.storage.get("overrides"));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/flags") return new Response("not found", { status: 404 });

    if (request.method === "GET") {
      return Response.json({ overrides: await this.#overrides() });
    }

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const [category, id] = String(body?.key ?? "").split("/");
      const key = assetFlagKey(category, id);
      if (!key) return Response.json({ error: "invalid key" }, { status: 400 });
      if (body.visible !== null && typeof body.visible !== "boolean") {
        return Response.json({ error: "visible must be boolean or null" }, { status: 400 });
      }

      const overrides = await this.#overrides();
      // null = 오버라이드 해제, 리포의 metadata 값으로 되돌린다
      if (body.visible === null) delete overrides[key];
      else overrides[key] = body.visible;
      await this.state.storage.put("overrides", overrides);
      return Response.json({ overrides });
    }

    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  }
}
