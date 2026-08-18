// life 서브도메인은 서버에 아무것도 저장하지 않는다. 할 일은 브라우저의
// localStorage 에만 있고, 워커가 하는 일은 로그인 게이트뿐이다.
//
// 이 클래스가 남아 있는 이유는 하나다: wrangler.jsonc 의 v17 마이그레이션이
// 이미 프로덕션에 적용됐고, Durable Object 마이그레이션은 append-only 라
// 클래스를 그냥 지우면 배포가 거부된다. 정말로 걷어내려면 새 마이그레이션에
// deleted_classes 로 선언해야 하며, 그건 저장된 내용을 지우는 동작이다.
export class LifeDO {
  async fetch() {
    return Response.json({ error: "gone" }, { status: 410, headers: { "Cache-Control": "no-store" } });
  }
}
