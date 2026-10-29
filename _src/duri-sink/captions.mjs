// 사진 설명 달기 — 당이가 한가할 때 PC 원본 사진을 비전 모델로 한 장씩 보고 짧은 설명·낱말을 남긴다.
//
// 결과는 DuriStorage/captions.json 하나에 따로 둔다(달별 metadata.json 은 싱크의 정본이라 건드리지 않는다).
// 키는 사진 파일 이름(seq 가 들어 있어 겹치지 않는다) → { desc, tags, at } 또는 실패 횟수 { fails }.
// 당이가 사진을 **찾을 때는** 비전을 쓰지 않는다 — archive.mjs 가 이 파일을 읽어 낱말 맞추기에 섞을 뿐이다.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { atomicWrite } from "./store.mjs";

export const CAPTIONS_FILE = "captions.json";
const MAX_FAILS = 3;
const MAX_BYTES = 15 * 1024 * 1024;
const MIME_OF = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" }; // llama-server(stb_image)가 읽는 것만

export function readCaptions(dir) {
  try { return JSON.parse(readFileSync(join(dir, CAPTIONS_FILE), "utf8")) ?? {}; } catch { return {}; }
}

export function captionMessages(mime, b64) {
  return [{
    role: "user",
    content: [
      { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
      { type: "text", text: [
        "이 사진을 나중에 낱말로 찾을 수 있게 설명해라. JSON 으로만 답한다:",
        '{"desc":"무엇이 찍혔는지 한국어 한 문장(40자 안팎)","tags":["찾을 때 쓸 한국어 낱말 3~6개(음식·장소 종류·물건·동물·풍경·날씨·실내/실외)"]}',
        "보이는 것만 쓴다. 사람 이름·가게 이름·지명은 간판 글씨로 또렷이 보일 때만 쓰고 추측하지 않는다.",
      ].join("\n") },
    ],
  }];
}

/** 모델 답 → { desc, tags } 또는 null. 길이·개수를 자른다. */
export function cleanCaption(raw) {
  const desc = String(raw?.desc ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const tags = (Array.isArray(raw?.tags) ? raw.tags : [])
    .map((t) => String(t).replace(/\s+/g, " ").trim().slice(0, 20)).filter(Boolean).slice(0, 8);
  return desc ? { desc, tags: [...new Set(tags)] } : null;
}

/**
 * dir: DuriStorage. list() → [{ path, mime? }] 설명을 달 사진(archive.photoFiles). see(messages) → 모델 JSON.
 * step() 은 아직 설명이 없는 사진 하나를 보고 결과를 적는다. 할 게 없거나 모델 서버가 자는 중이면 false.
 */
export function createCaptioner({ dir, list, see, log, now = () => Date.now() }) {
  const file = join(dir, CAPTIONS_FILE);
  let caps = readCaptions(dir);
  const save = () => atomicWrite(file, JSON.stringify(caps));

  const todo = () => list().filter((p) => {
    const c = caps[basename(p.path)];
    return !c?.desc && (c?.fails ?? 0) < MAX_FAILS && MIME_OF[p.path.split(".").pop().toLowerCase()];
  });

  async function step() {
    const next = todo().at(-1); // 최근 사진부터 — 물어볼 가능성이 큰 쪽
    if (!next) return false;
    const name = basename(next.path);
    try {
      if (!existsSync(next.path)) throw new Error("원본 없음");
      const bytes = readFileSync(next.path);
      if (bytes.length > MAX_BYTES) throw new Error("너무 큼");
      const mime = MIME_OF[name.split(".").pop().toLowerCase()];
      const cap = cleanCaption(await see(captionMessages(mime, bytes.toString("base64"))));
      if (!cap) throw new Error("빈 설명");
      caps[name] = { ...cap, at: now() };
    } catch (e) {
      if (e?.asleep) return false; // 모델 서버가 자는 중(새벽 3~6시 등) — 실패로 세지 않고 깨면 다시 본다
      caps[name] = { fails: (caps[name]?.fails ?? 0) + 1 };
      log?.("당이: 사진 설명 실패", name.slice(-16), String(e?.message || e));
    }
    save();
    return true;
  }

  return { step, left: () => todo().length };
}
