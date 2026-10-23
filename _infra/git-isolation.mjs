// 테스트가 임시 리포에서 git 을 돌릴 때 쓰는 환경.
//
// pre-commit 훅 안에서 `npm test` 가 돌면 git 이 넣어 준 GIT_DIR·GIT_INDEX_FILE·
// GIT_WORK_TREE 같은 변수가 그대로 물려 내려온다. 그 상태로 테스트가 임시 폴더에서
// `git init`·`git config`·`git commit` 을 하면 cwd 가 아니라 **진짜 리포**에 적힌다 —
// 실제로 core.bare=true, user.name=t, "seed"/"base"/"head" 커밋, agent/duri/calendar
// 브랜치가 진짜 리포에 생겼다. 그래서 테스트의 모든 git 자식 프로세스는 이 환경으로
// 띄운다: GIT_* 를 전부 지우고, 사용자 전역·시스템 설정(서명 강제 등)도 끊는다.

export function isolatedGitEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("GIT_")) continue;
    env[key] = value;
  }
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  // 신원은 리포 설정(`git config user.name`)이 아니라 환경으로 준다 — 설정 명령이
  // 엉뚱한 리포로 새는 길 자체를 없앤다.
  env.GIT_AUTHOR_NAME = "Test";
  env.GIT_AUTHOR_EMAIL = "test@example.com";
  env.GIT_COMMITTER_NAME = "Test";
  env.GIT_COMMITTER_EMAIL = "test@example.com";
  return { ...env, ...extra };
}
