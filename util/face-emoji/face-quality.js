const LEFT_EYE = [33, 133];
const RIGHT_EYE = [362, 263];

export const FACE_LIMITS = Object.freeze({
  minWidth: 0.14,
  minHeight: 0.16,
  minArea: 0.035,
  minEyeGapRatio: 0.18,
  maxEyeTiltDegrees: 22,
});

function point(landmarks, index) {
  const p = landmarks[index];
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
}

function midpoint(landmarks, indices) {
  const points = indices.map((index) => point(landmarks, index)).filter(Boolean);
  if (!points.length) return null;
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

export function landmarkBounds(landmarks) {
  const points = landmarks.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

function failure(code, message, metrics = {}) {
  return { ok: false, code, message, metrics };
}

export function assessFace(landmarks, options = {}) {
  if (!Array.isArray(landmarks) || landmarks.length < 400) {
    return failure("no-face", "얼굴을 찾지 못했어요. 얼굴이 잘 보이는 사진을 골라주세요.");
  }

  const bounds = landmarkBounds(landmarks);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return failure("no-face", "얼굴 위치를 읽지 못했어요. 다른 사진을 골라주세요.");
  }

  const metrics = {
    bounds,
    area: bounds.width * bounds.height,
  };
  const limits = { ...FACE_LIMITS, ...(options.limits || {}) };

  if (bounds.width < limits.minWidth || bounds.height < limits.minHeight || metrics.area < limits.minArea) {
    return failure("face-too-small", "얼굴이 너무 작아요. 얼굴을 조금 더 가까이 찍어주세요.", metrics);
  }

  const leftEye = midpoint(landmarks, LEFT_EYE);
  const rightEye = midpoint(landmarks, RIGHT_EYE);
  if (!leftEye || !rightEye) {
    return failure("face-incomplete", "눈 위치를 읽지 못했어요. 정면에 가까운 사진을 골라주세요.", metrics);
  }

  const eyeGap = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
  const eyeTiltDegrees = Math.abs(Math.atan2(
    rightEye.y - leftEye.y,
    rightEye.x - leftEye.x,
  ) * 180 / Math.PI);
  metrics.eyeGap = eyeGap;
  metrics.eyeGapRatio = eyeGap / bounds.width;
  metrics.eyeTiltDegrees = eyeTiltDegrees;

  if (metrics.eyeGapRatio < limits.minEyeGapRatio) {
    return failure("face-profile", "옆으로 돌아간 얼굴은 아직 지원하지 않아요. 정면 사진을 골라주세요.", metrics);
  }
  if (eyeTiltDegrees > limits.maxEyeTiltDegrees) {
    return failure("face-tilted", "얼굴이 많이 기울어져 있어요. 조금 바로 본 사진을 골라주세요.", metrics);
  }

  const brightness = Number(options.brightness);
  if (Number.isFinite(brightness) && brightness < 24) {
    return failure("face-dark", "사진이 너무 어두워요. 얼굴에 빛이 있는 사진을 골라주세요.", metrics);
  }

  return { ok: true, code: "ok", message: "얼굴을 찾았어요.", metrics };
}

export function assessFaceResult(result, options = {}) {
  const faces = result?.faceLandmarks || [];
  if (faces.length === 0) {
    return failure("no-face", "얼굴을 찾지 못했어요. 얼굴이 잘 보이는 사진을 골라주세요.");
  }
  if (faces.length > 1) {
    return failure("multiple-faces", "한 명의 얼굴만 있는 사진을 골라주세요.", { count: faces.length });
  }
  return assessFace(faces[0], options);
}

export function featurePoint(landmarks, index) {
  return point(landmarks, index);
}

export function averagePoint(landmarks, indices) {
  return midpoint(landmarks, indices);
}

