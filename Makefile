# bubblelab — 배포는 항상 `make ship` 으로 한다.
#
# 맨 push 는 검증 없이 라이브를 바꾼다. ship 은 빌드·테스트·배포·라이브 검증을
# 한 줄로 묶고, 검증이 실패하면 직전 배포로 되돌린다.
.PHONY: help test lint build e2e verify ship serve

help:
	@echo "make test    — 인프라 단위 테스트"
	@echo "make lint    — 문법 검사 (js/mjs/json/sh)"
	@echo "make build   — dist/ 빌드 (_health.json 스탬프 포함)"
	@echo "make e2e     — 모바일 스모크 (빌드 후 Playwright)"
	@echo "make verify  — 지금 라이브를 읽기 전용으로 검증"
	@echo "make ship    — 빌드→테스트→배포(push)→라이브 검증→실패 시 롤백"
	@echo "make serve   — 로컬 서빙 (wrangler dev)"

test:
	npm test

# eslint/prettier 는 두지 않는다 — 토이가 의존성 없는 바닐라라 스타일 규칙보다
# "파싱은 되는가"가 실제로 사고를 막는다. 커밋 훅이 스테이지된 파일에 같은
# 스크립트를 돌린다.
lint:
	bash scripts/lint.sh

build:
	node _infra/build.mjs

e2e:
	npm run test:e2e

# 자격증명(BL_*)이 있으면 게이트 안쪽까지, 없으면 게이트가 막는지까지 확인한다.
verify:
	bash scripts/verify-prod.sh $(ARGS)

ship:
	bash scripts/ship.sh

serve:
	npx wrangler@4 dev --local --local-upstream localhost
