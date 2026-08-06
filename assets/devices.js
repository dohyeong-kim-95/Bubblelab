// 배경화면 상세페이지의 기종 목록. **손으로 관리하는 표**라 최신 기종이 빠져
// 있을 수 있다 — 목록에 없으면 화면에서 "직접 입력"으로 숫자를 넣으면 된다.
// 값은 기기의 물리 픽셀 해상도(세로 기준). 새 기종은 여기 한 줄만 추가한다.
// 검증(양수 정수·라벨 중복)은 `_infra/devices.test.mjs`가 한다.
export const DEVICE_GROUPS = [
  {
    label: "아이폰",
    devices: [
      { label: "iPhone 16 Pro Max", width: 1320, height: 2868 },
      { label: "iPhone 16 Pro", width: 1206, height: 2622 },
      { label: "iPhone 16 Plus · 15 Pro Max · 15 Plus · 14 Pro Max", width: 1290, height: 2796 },
      { label: "iPhone 16 · 15 · 15 Pro · 14 Pro", width: 1179, height: 2556 },
      { label: "iPhone 14 Plus · 13 Pro Max · 12 Pro Max", width: 1284, height: 2778 },
      { label: "iPhone 14 · 13 · 13 Pro · 12 · 12 Pro", width: 1170, height: 2532 },
      { label: "iPhone 13 mini · 12 mini", width: 1080, height: 2340 },
      { label: "iPhone SE (2·3세대)", width: 750, height: 1334 },
    ],
  },
  {
    label: "갤럭시",
    devices: [
      { label: "갤럭시 S24 Ultra · S24+", width: 1440, height: 3120 },
      { label: "갤럭시 S23 Ultra", width: 1440, height: 3088 },
      { label: "갤럭시 S24 · S23 · S22 · S21", width: 1080, height: 2340 },
      { label: "갤럭시 Z 플립5 · 플립4", width: 1080, height: 2640 },
      { label: "갤럭시 Z 폴드5 · 폴드4 (내부 화면)", width: 1812, height: 2176 },
    ],
  },
  {
    label: "태블릿",
    devices: [
      { label: "iPad Pro 12.9\"", width: 2048, height: 2732 },
      { label: "iPad Pro 11\"", width: 1668, height: 2388 },
      { label: "iPad Air 11\" · iPad 10세대", width: 1640, height: 2360 },
      { label: "갤럭시 탭 S9 Ultra", width: 1848, height: 2960 },
      { label: "갤럭시 탭 S9", width: 1600, height: 2560 },
    ],
  },
  {
    label: "PC · 노트북",
    devices: [
      { label: "4K 모니터 (UHD)", width: 3840, height: 2160 },
      { label: "울트라와이드 (21:9)", width: 3440, height: 1440 },
      { label: "QHD 모니터", width: 2560, height: 1440 },
      { label: "FHD 모니터", width: 1920, height: 1080 },
      { label: "맥북 프로 16\"", width: 3456, height: 2234 },
      { label: "맥북 프로 14\"", width: 3024, height: 1964 },
      { label: "맥북 에어 13\"", width: 2560, height: 1664 },
    ],
  },
];

export const findDevice = (label) =>
  DEVICE_GROUPS.flatMap((group) => group.devices).find((device) => device.label === label) || null;
