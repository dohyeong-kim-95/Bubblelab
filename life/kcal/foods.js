// life/kcal 의 음식표. **사람이 채워 넣는 표다** — 사진이나 포장지의 영양성분표를
// 보고 한 줄씩 는다. 외부 API 를 부르지 않는 화면이라 여기 없는 음식은 직접 적고,
// 적은 것은 "자주 먹는 것"으로 남아 다음부터 한 번 눌러 담긴다.
//
// 값은 1회 제공량(unit) 기준이고 근사값이다. 담은 뒤 화면에서 고칠 수 있다.
// 추가·수정은 손으로 하지 말고 CLI 로 한다:
//
//   node _infra/kcal-food.mjs --name "김치찌개" --unit "1인분" \
//     --kcal 240 --carb 12 --protein 18 --fat 13
//
// 형식·중복은 _infra/kcal.test.mjs 가 검사한다.
export const FOODS = [
  { name: "갈배사이다 제로", brand: "해태", unit: "355ml", kcal: 0, carb: 0, protein: 0, fat: 0 },
  { name: "더단백 드링크 커피", brand: "빙그레", unit: "250ml", kcal: 110, carb: 7, protein: 20, fat: 1 },
  { name: "덴마크 드링킹 요구르트 딸기", brand: "동원", unit: "275ml", kcal: 220, carb: 28, protein: 9, fat: 8 },
  { name: "렌틸닭큐브 밸런스팩", brand: "삼성웰스토리", unit: "1팩", kcal: 349, carb: 37, protein: 35, fat: 7 },
  { name: "바삭 닭가슴살칩 블랙페퍼", brand: "아임닭", unit: "30g(1봉)", kcal: 105, carb: 2, protein: 22, fat: 1.2 },
  { name: "아메리카노", unit: "1잔(355ml)", kcal: 10, carb: 2, protein: 1, fat: 0 },
  { name: "우삼겹 깍두기 주먹밥", brand: "삼성웰스토리", unit: "1팩", kcal: 612, carb: 100, protein: 22, fat: 14 },
  { name: "참치&바질 샌드위치", brand: "삼성웰스토리", unit: "1개", kcal: 411, carb: 40, protein: 16, fat: 21 },
  { name: "치즈 함박스테이크 덮밥", brand: "삼성웰스토리", unit: "1팩", kcal: 590, carb: 70, protein: 24, fat: 24 },
  { name: "칠성사이다 제로", brand: "롯데칠성", unit: "355ml", kcal: 0, carb: 6, protein: 0, fat: 0 },
  { name: "프로틴 드링크 퍼펙트 곡물", brand: "랩노쉬", unit: "350ml", kcal: 125, carb: 3, protein: 27, fat: 0.6 },
  { name: "프로틴 드링크 퍼펙트 바나나", brand: "랩노쉬", unit: "350ml", kcal: 125, carb: 3, protein: 27, fat: 0.5 },
  { name: "프로틴 드링크 퍼펙트 초코", brand: "랩노쉬", unit: "350ml", kcal: 135, carb: 5, protein: 27, fat: 0.6 },
  { name: "프로틴 드링크 퍼펙트 쿠키앤크림", brand: "랩노쉬", unit: "350ml", kcal: 135, carb: 1, protein: 27, fat: 2.3 },
  { name: "햄에그 샌드위치", brand: "삼성웰스토리", unit: "1개", kcal: 324, carb: 44, protein: 12, fat: 11 },
];
