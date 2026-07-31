// 이모티콘 품질 게이트 — build가 남긴 report.json을 프로필 기준으로 판정한다.
//
// 왜 필요한가: build는 경고를 찍고도 exit 0으로 끝나서, 불량 산출물이
// Actions "성공"으로 커밋될 수 있었다. 판정을 데이터(report.json)와 규칙
// (프로필)로 분리해서 check가 실제로 실패하게 만든다.
//
// Hard  — 규격·구조 위반. 자동 실패시켜도 안전하다 (동작 크기와 무관).
// Soft  — 인접 diff·움직임·루프 이음새. **동작이 클수록 같이 커지는 값이라
//         단일 임계값으로 실패시키면 안 된다.** 경고와 재작업 추천만 한다.
//
// 루프 판정은 loopDiff 절대값을 쓰지 않는다. 핑퐁 타임라인은 마지막→첫
// 전환이 원래 한 걸음 차이라 절대값이 크게 나오는 게 정상이다. 그 전환이
// **다른 인접 전환들에 비해** 튀는지(seamRatio)를 본다.

export const PROFILES = {
  // 기본 — 구조만 본다. 실험 중인 컷용.
  draft: {
    label: "draft (구조만)",
    file: "master",
    size: 360,
  },
  // goal.md의 북극성: 각 2초짜리 (12fps × 24프레임 = 2.0초)
  "master-2s": {
    label: "master-2s (카카오 납품 기준)",
    file: "master",
    size: 360,
    frames: [2, 24],
    duration: [1.8, 2.2],
    frameDelay: [0.05, 2.0],
  },
  // LINE 애니메이션 스티커
  line: {
    label: "line (LINE 규격)",
    file: "line",
    size: 270,
    frames: [5, 20],
    duration: [0.1, 4.0],
    maxBytes: 300 * 1024,
    loops: [1, 4],
  },
};

// 동작이 커도 정당화되지 않는, 순수 결함 임계값
export const DRIFT_LIMIT = 0.15;      // 캐릭터 크기가 프레임마다 출렁임
// 실측 보정: heart(3.8%)는 눈으로 봐도 정지, 그다음으로 낮은 lrtest2가 15%다.
// 표본이 적으니 정지 사례가 더 쌓이면 재조정할 것.
export const MIN_MOTION = 0.08;       // 이 아래는 "정지"라 애니메이션이 아님
export const SEAM_RATIO_LIMIT = 2.0;  // 루프 이음새가 보통 전환의 2배 넘게 튐
export const SUSPECT_RATIO = 2.5;     // 이 배수를 넘는 인접 구간 = 재작업 후보

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// build가 잰 값들 → report 객체. 판정에 필요한 모든 원자료를 남긴다
// (최대값만 남기면 어느 프레임이 튀었는지 되짚을 수 없다).
export function buildReport({
  cutId, mode, size, uniqueFrames, timelineFrames, fps, durationSec,
  bytes, lineBytes = null, loops = 0, frameDelays = [],
  loopDiff, adjacentDiffs, scaleDrift, motion, transparency = [],
}) {
  const adjacentMedian = median(adjacentDiffs);
  return {
    schemaVersion: 1,
    cut: cutId,
    mode: mode ?? "sequential",
    size,
    uniqueFrames,
    timelineFrames,
    fps,
    durationSec: Number(durationSec.toFixed(3)),
    bytes,
    lineBytes,
    loops,
    frameDelays,
    loopDiff,
    adjacentDiffs,
    adjacentMedian,
    adjacentMax: adjacentDiffs.length ? Math.max(...adjacentDiffs) : 0,
    // 루프 이음새를 절대값이 아니라 일반 전환 대비 비율로 (핑퐁 오탐 방지)
    seamRatio: adjacentMedian > 0 ? loopDiff / adjacentMedian : 0,
    scaleDrift,
    motionMean: motion.mean,
    motionMax: motion.max,
    transparency,
  };
}

// report + 프로필 → { verdict, hard[], soft[], suggestions[] }
// verdict: "pass" | "review" | "fail"
export function judgeReport(report, profileName = "draft", info = null) {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`알 수 없는 프로필: ${profileName} (${Object.keys(PROFILES).join(", ")})`);
  const hard = [];
  const soft = [];
  const suggestions = [];
  const pct = (v) => `${(v * 100).toFixed(1)}%`;

  // ── Hard: 구조·규격 ──────────────────────────────────────────────
  if (info) {
    if (!info.animated) hard.push("APNG 애니메이션 청크(acTL)가 없습니다");
    if (profile.size && info.width !== profile.size) {
      hard.push(`크기 ${info.width}px — 프로필 요구 ${profile.size}px`);
    }
    if (profile.frames && (info.frames < profile.frames[0] || info.frames > profile.frames[1])) {
      hard.push(`프레임 ${info.frames}장 — 허용 ${profile.frames[0]}~${profile.frames[1]}장`);
    }
    if (profile.loops && (info.loops < profile.loops[0] || info.loops > profile.loops[1])) {
      hard.push(`루프 ${info.loops || "무한"} — 허용 ${profile.loops[0]}~${profile.loops[1]}회`);
    }
    const duration = info.delays.reduce((a, b) => a + b, 0);
    if (profile.duration && (duration < profile.duration[0] || duration > profile.duration[1])) {
      hard.push(`재생시간 ${duration.toFixed(2)}초 — 허용 ${profile.duration[0]}~${profile.duration[1]}초`);
    }
    if (profile.frameDelay) {
      const bad = info.delays.filter((d) => d < profile.frameDelay[0] || d > profile.frameDelay[1]);
      if (bad.length) hard.push(`프레임 지속시간 ${bad.length}개가 ${profile.frameDelay[0]}~${profile.frameDelay[1]}초 범위 밖`);
    }
  }
  const bytes = profile.file === "line" ? report.lineBytes : report.bytes;
  if (profile.maxBytes) {
    if (bytes == null) hard.push(`${profile.label} 산출물이 없습니다 — build --line 필요`);
    else if (bytes > profile.maxBytes) {
      hard.push(`용량 ${(bytes / 1024).toFixed(0)}KB — 상한 ${(profile.maxBytes / 1024).toFixed(0)}KB`);
    }
  }
  // 누끼 실패·빈 프레임은 동작 크기와 무관한 결함
  const emptyFrames = report.transparency.filter((t) => t < 0.05).length;
  if (emptyFrames) hard.push(`누끼 실패 또는 빈 프레임 ${emptyFrames}장 (투명 5% 미만)`);
  // 캐릭터 크기가 프레임마다 달라지는 것은 동작이 아니라 결함이다
  if (report.scaleDrift > DRIFT_LIMIT) {
    hard.push(`크기 드리프트 ${pct(report.scaleDrift)} — 상한 ${pct(DRIFT_LIMIT)} (재생 시 펄스처럼 보임)`);
  }

  // ── Soft: 동작이 크면 같이 커지는 값 — 경고만 ─────────────────────
  if (report.motionMean < MIN_MOTION) {
    soft.push(`움직임 ${pct(report.motionMean)} — 거의 정지라 애니메이션으로 읽히지 않습니다`);
  }
  if (report.seamRatio > SEAM_RATIO_LIMIT) {
    soft.push(
      `루프 이음새가 보통 전환의 ${report.seamRatio.toFixed(1)}배 — 마지막→첫 프레임 연결 확인` +
      ` (loopDiff ${pct(report.loopDiff)}, 인접 중앙값 ${pct(report.adjacentMedian)})`,
    );
  }
  // 재작업 후보: 다른 구간보다 유독 튀는 인접 전환
  report.adjacentDiffs.forEach((diff, i) => {
    if (report.adjacentMedian > 0 && diff > report.adjacentMedian * SUSPECT_RATIO) {
      const to = i + 2;
      soft.push(`${String(i + 1).padStart(2, "0")}→${String(to).padStart(2, "0")} 구간 변화가 중앙값의 ${(diff / report.adjacentMedian).toFixed(1)}배`);
      suggestions.push(to);
    }
  });

  const verdict = hard.length ? "fail" : soft.length ? "review" : "pass";
  return { verdict, profile: profileName, hard, soft, suggestions: [...new Set(suggestions)] };
}

export function formatJudgement(judgement, cutPath = "") {
  const lines = [];
  const mark = { pass: "✓ PASS", review: "△ REVIEW", fail: "✗ FAIL" }[judgement.verdict];
  lines.push(`${mark} — ${PROFILES[judgement.profile].label}`);
  for (const item of judgement.hard) lines.push(`  [HARD] ${item}`);
  for (const item of judgement.soft) lines.push(`  [soft] ${item}`);
  for (const frame of judgement.suggestions) {
    lines.push(`  SUGGEST: node _infra/emoticon.mjs redo ${cutPath} ${frame}`.trimEnd());
  }
  return lines.join("\n");
}
