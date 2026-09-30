// 카톡 미리보기용 카드(1200×630 PNG). 참여자의 화면이 지금 상태를 그려 서버에 올리고,
// 방 주소의 og:image 가 이 그림을 가리킨다 — 링크만 봐도 "대충 언제쯤이구나"를 알 수 있게.
// 단계마다 그리는 것이 다르다: 날짜 잡기 = 달력 현황, 장소 전달·놀기 = 확정 날짜·장소,
// 정산 = 총액과 보낼 돈.
import {
  PHASES, SLOT_LABEL, dateLabel, datesBetween, dayCounts, settle, weekday, won,
} from "./logic.js";
import { drawSprite } from "./sprite.js";

const W = 1200, H = 630;
const C = {
  bg: "#eef5f1", ink: "#1c2733", soft: "#1c27330f", line: "#d7e2dc", accent: "#2f8f6e",
  lunch: [240, 163, 58], dinner: [91, 110, 225], sun: "#d4493b", sat: "#3a6fd4",
};
const FONT = `"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",ui-monospace,sans-serif`;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function header(ctx, state) {
  ctx.fillStyle = C.ink;
  ctx.font = `800 54px ${FONT}`;
  ctx.fillText(`🫧 약속 방 ${state.code}`, 60, 96);
  // 진행 단계
  let x = 60;
  PHASES.forEach((label, i) => {
    ctx.font = `700 26px ${FONT}`;
    const w = ctx.measureText(label).width + 36;
    roundRect(ctx, x, 124, w, 46, 23);
    ctx.fillStyle = i === state.phase ? C.accent : i < state.phase ? "#2f8f6e33" : C.soft;
    ctx.fill();
    ctx.fillStyle = i === state.phase ? "#fff" : C.ink;
    ctx.globalAlpha = i <= state.phase ? 1 : 0.45;
    ctx.fillText(label, x + 18, 157);
    ctx.globalAlpha = 1;
    x += w + 12;
  });
}

// 날짜 잡기: 후보 기간 달력. 칸 위 점심·아래 저녁, 불투명도 = 가능 인원 ÷ 정원, 모두 되면 테두리.
function calendar(ctx, state) {
  const dates = datesBetween(state.period.start, state.period.end);
  const ids = state.members.map((m) => m.id);
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))].slice(0, 2);
  const top = 200, cell = 50, gap = 6;
  months.forEach((ym, mi) => {
    const left = 60 + mi * 430;
    const [y, m] = ym.split("-").map(Number);
    ctx.fillStyle = C.ink;
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText(`${m}월`, left, top + 4);
    const first = `${ym}-01`;
    const offset = weekday(first);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let day = 1; day <= last; day += 1) {
      const date = `${ym}-${String(day).padStart(2, "0")}`;
      const i = offset + day - 1;
      const x = left + (i % 7) * (cell + gap), yy = top + 20 + Math.floor(i / 7) * (cell + gap);
      const inPeriod = date >= state.period.start && date <= state.period.end;
      roundRect(ctx, x, yy, cell, cell, 9);
      ctx.fillStyle = inPeriod ? "#fff" : "#ffffff55";
      ctx.fill();
      if (inPeriod) {
        const { lunch, dinner } = dayCounts(state.votes, ids, date);
        ctx.save();
        roundRect(ctx, x, yy, cell, cell, 9);
        ctx.clip();
        ctx.fillStyle = `rgba(${C.lunch},${lunch / state.max})`;
        ctx.fillRect(x, yy, cell, cell / 2);
        ctx.fillStyle = `rgba(${C.dinner},${dinner / state.max})`;
        ctx.fillRect(x, yy + cell / 2, cell, cell / 2);
        ctx.restore();
        if (lunch === state.max || dinner === state.max) {
          roundRect(ctx, x + 2, yy + 2, cell - 4, cell - 4, 8);
          ctx.lineWidth = 4;
          ctx.strokeStyle = C.accent;
          ctx.stroke();
        }
      }
      const wd = weekday(date);
      ctx.fillStyle = wd === 0 ? C.sun : wd === 6 ? C.sat : C.ink;
      ctx.globalAlpha = inPeriod ? 1 : 0.35;
      ctx.font = `700 19px ${FONT}`;
      ctx.fillText(String(day), x + 7, yy + 22);
      ctx.globalAlpha = 1;
    }
  });
  const responded = state.members.filter((m) => m.responded).length;
  ctx.fillStyle = C.ink;
  ctx.font = `700 30px ${FONT}`;
  ctx.fillText(`${state.max}명 중 ${responded}명 응답`, 930, 250);
  ctx.font = `500 22px ${FONT}`;
  ctx.globalAlpha = 0.7;
  ctx.fillText("진할수록 많이 돼요", 930, 290);
  ctx.fillText("테두리 = 모두 가능", 930, 322);
  ctx.globalAlpha = 1;
}

function seats(ctx, state, top) {
  state.members.slice(0, 10).forEach((m, i) => {
    const sprite = document.createElement("canvas");
    drawSprite(sprite, `${m.id}:${m.name}`);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, 60 + i * 108, top, 80, 80);
    ctx.fillStyle = C.ink;
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(m.name.slice(0, 5), 60 + i * 108, top + 106);
  });
}

function confirmed(ctx, state) {
  const c = state.confirmed;
  ctx.fillStyle = C.ink;
  ctx.font = `800 64px ${FONT}`;
  ctx.fillText(`📅 ${dateLabel(c.date)} ${SLOT_LABEL[c.slot]}`, 60, 280);
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(state.place ? `📍 ${state.place.name}` : "📍 장소는 곧 알려 드려요", 60, 350);
  seats(ctx, state, 420);
}

function settlement(ctx, state) {
  const ids = state.members.map((m) => m.id);
  const { total, transfers } = settle(ids, state.expenses ?? []);
  const name = (id) => state.members.find((m) => m.id === id)?.name ?? "?";
  ctx.fillStyle = C.ink;
  ctx.font = `800 56px ${FONT}`;
  ctx.fillText(`💸 총 ${won(total)}`, 60, 270);
  ctx.font = `600 34px ${FONT}`;
  transfers.slice(0, 5).forEach((t, i) => {
    const done = state.sent?.[`${t.from}>${t.to}`]?.sentAt;
    ctx.globalAlpha = done ? 0.4 : 1;
    ctx.fillText(`${name(t.from)} → ${name(t.to)}  ${won(t.amount)}${done ? "  ✓" : ""}`, 60, 340 + i * 52);
    ctx.globalAlpha = 1;
  });
  if (!transfers.length) ctx.fillText(total ? "보낼 돈이 없어요 🎉" : "결제 항목을 넣어 주세요", 60, 340);
}

export function drawCard(state) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  header(ctx, state);
  if (state.phase === 0 || !state.confirmed) calendar(ctx, state);
  else if (state.phase === 3) settlement(ctx, state);
  else confirmed(ctx, state);
  ctx.fillStyle = C.ink;
  ctx.globalAlpha = 0.45;
  ctx.font = `500 20px ${FONT}`;
  ctx.fillText("util.bubblelab.dev/yaksok", 60, H - 30);
  ctx.globalAlpha = 1;
  return canvas;
}

export async function cardPngBase64(state) {
  const canvas = drawCard(state);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
