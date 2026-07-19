#!/usr/bin/env node
// VWorld 배경지도(Base) 타일을 지역별 한 장짜리 PNG로 이어붙여
// estate/basemap-<지역>.png + estate/data/basemap.json(투영 정보)을 만드는 CLI.
// 런타임에 외부 타일을 부르는 대신 스냅샷을 커밋한다 — CSP 변경도 키 노출도
// 없다 (키는 .dev.vars의 VWORLD_KEY에서만 읽고, 리포에는 이미지만 남는다).
// 출처 표기: 배경지도 © 브이월드(국토교통부).
//
//   VWORLD_KEY=키 node _infra/estate-basemap.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./png.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "estate", "data");
const TILE = 256;
const MAX_PX = 2400;      // 이미지 한 변 상한 (줌은 이 안에서 최대로)
const PAD_DEG = 0.008;    // 외곽 여백 (~800m)

function readKey() {
  if (process.env.VWORLD_KEY?.trim()) return process.env.VWORLD_KEY.trim();
  const devVars = join(ROOT, ".dev.vars");
  if (existsSync(devVars)) {
    const match = /^VWORLD_KEY\s*=\s*(.+)$/m.exec(readFileSync(devVars, "utf8"));
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

const mercX = (lng, z) => (lng + 180) / 360 * TILE * 2 ** z;
const mercY = (lat, z) => {
  const rad = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * TILE * 2 ** z;
};

async function fetchTile(key, z, x, y) {
  const url = `https://api.vworld.kr/req/wmts/1.0.0/${key}/Base/${z}/${y}/${x}.png`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`타일 ${z}/${y}/${x} 응답 ${res.status}`);
  return decodePng(Buffer.from(await res.arrayBuffer()));
}

async function buildRegion(key, region, points) {
  const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
  const bounds = {
    south: Math.min(...lats) - PAD_DEG, north: Math.max(...lats) + PAD_DEG,
    west: Math.min(...lngs) - PAD_DEG, east: Math.max(...lngs) + PAD_DEG,
  };
  let z = 16;
  while (z > 10 && (mercX(bounds.east, z) - mercX(bounds.west, z) > MAX_PX ||
    mercY(bounds.south, z) - mercY(bounds.north, z) > MAX_PX)) z -= 1;

  const x0 = mercX(bounds.west, z), x1 = mercX(bounds.east, z);
  const y0 = mercY(bounds.north, z), y1 = mercY(bounds.south, z);
  const width = Math.round(x1 - x0), height = Math.round(y1 - y0);
  const canvas = new Uint8Array(width * height * 4);

  const tiles = [];
  for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx += 1) {
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(y1 / TILE); ty += 1) tiles.push([tx, ty]);
  }
  console.log(`${region}: z${z} ${width}x${height}px, 타일 ${tiles.length}장`);

  const queue = [...tiles];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const [tx, ty] = queue.shift();
      const tile = await fetchTile(key, z, tx, ty);
      const offX = Math.round(tx * TILE - x0), offY = Math.round(ty * TILE - y0);
      for (let py = 0; py < TILE; py += 1) {
        const cy = offY + py;
        if (cy < 0 || cy >= height) continue;
        for (let px = 0; px < TILE; px += 1) {
          const cx = offX + px;
          if (cx < 0 || cx >= width) continue;
          const src = (py * tile.width + px) * 4, dst = (cy * width + cx) * 4;
          canvas[dst] = tile.data[src];
          canvas[dst + 1] = tile.data[src + 1];
          canvas[dst + 2] = tile.data[src + 2];
          canvas[dst + 3] = 255;
        }
      }
    }
  }));

  const file = join(ROOT, "estate", `basemap-${region}.png`);
  writeFileSync(file, encodePng({ width, height, data: canvas }, { filterType: 4 }));
  console.log(`  → basemap-${region}.png (${(readFileSync(file).length / 1048576).toFixed(1)}MB)`);
  return { ...bounds, zoom: z, width, height };
}

async function main() {
  const key = readKey();
  if (!key) {
    console.error("VWORLD_KEY가 없습니다. env로 주거나 .dev.vars에 한 줄 추가하세요.");
    process.exit(1);
  }
  const geo = JSON.parse(readFileSync(join(DATA_DIR, "geo.json"), "utf8"));
  const refs = Object.values(geo.refs);
  const meta = {};
  for (const region of ["dongtan", "giheung"]) {
    const points = [
      ...Object.entries(geo.points).filter(([id]) => id.startsWith(region)).map(([, p]) => p),
      ...refs, // 캠퍼스 기준점은 두 지역 모두에 보이게 포함
    ];
    meta[region] = await buildRegion(key, region, points);
  }
  writeFileSync(join(DATA_DIR, "basemap.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), regions: meta }));
  console.log("완료: estate/data/basemap.json 갱신");
}

main();
