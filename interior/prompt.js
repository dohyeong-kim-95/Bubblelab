// LLM 에게 도면 초안을 부탁할 때 붙이는 요청문. 형식은 engine.js 의 normalizePlan 이 받는 그대로다.
export function llmPrompt(plan) {
  return `너는 집 평면도를 JSON 으로 옮기는 도우미다. 아래 형식만 출력한다(설명·코드블록 없이 JSON 하나).

형식 (단위 cm, 원점은 도면 왼쪽 위, x 는 오른쪽, y 는 아래):
{
  "name": "도면 이름",
  "room": { "w": 전체 가로, "d": 전체 세로 },        // 집 전체를 감싸는 바깥 사각형. 바깥 벽은 자동
  "walls": [ { "x1":0, "y1":150, "x2":300, "y2":150 } ], // 안쪽 벽. 가로나 세로 선분만. 문·통로는 선분을 끊어서 비운다(최소 70cm)
  "zones": [ { "id":"living", "label":"거실", "x0":0, "y0":155, "x1":595, "y1":800 } ], // 방 구역(벽 두께 5cm 씩 안쪽)
  "items": [
    { "id":"washer", "label":"세탁기", "kind":"laundry", "x":950, "y":768, "w":60, "d":64, "h":85,
      "rot":180, "fixed":true, "wall":true, "zone":"utility" }
  ],
  "tasks": [ { "id":"dishes", "label":"설거지", "perWeek":14, "stops":["table","sink","cupboard"] } ]
}

가구 규칙:
- x, y 는 가구 **중심**. w 는 너비, d 는 깊이(앞뒤), h 는 높이.
- rot 은 0/90/180/270 (시계 방향). rot 0 이면 앞면(사람이 서서 쓰는 쪽)이 +y(아래)를 본다.
  90 이면 -x(왼쪽), 180 이면 -y(위), 270 이면 +x(오른쪽). 벽에 등을 대는 가구는 앞면이 방 안쪽을 보게.
- wall: true = 등을 벽에 붙여야 하는 가구(옷장·소파·수납장 등). 뒷면이 벽 면에 정확히 닿게 좌표를 맞춘다.
- fixed: true = 배관·붙박이라 못 옮기는 것(세탁기·싱크대·욕조·붙박이장). 최적화가 건드리지 않는다.
- zone: 그 가구가 있어도 되는 구역 id 하나 또는 배열. 침대는 침실, 건조대는 ["veranda","living"] 처럼.
- pass: true, w:0, d:0 = 바닥 위 한 점(현관·방 가운데 같은 들를 곳). 길을 막지 않는다.
- kind 는 색 구분용: laundry, kitchen, storage, cleaning, furniture, door.
- id 는 영문·숫자·_- 만. 가구끼리, 가구와 벽은 겹치면 안 된다.

할 일 규칙:
- stops 는 그 일을 할 때 차례로 들르는 가구 id. 예: 빨래 = 빨래바구니 → 세탁기 → 건조기 → 옷장.
- perWeek 는 한 주에 몇 번 하는지. 동선 점수 = 구간 걷는 거리 × perWeek 의 합.

지금 도면(이걸 고치거나 참고해서 새로 써라):
${JSON.stringify(plan)}

요청:
`;
}
