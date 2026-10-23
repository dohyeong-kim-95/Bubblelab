// index.mjs(cron)와 gateway.mjs(상주 데몬)가 같이 쓰는 조각. 프로세스·소켓 없이
// 테스트할 수 있게 여기로 뗐다(테스트는 common.test.mjs).

/**
 * `claude -p` 인자. **도구를 전부 끈다.**
 *
 * 프롬프트에 arXiv 초록(남이 쓴 검증되지 않은 텍스트)이 그대로 들어간다. 도구가
 * 없으면 초록에 지시를 심어 둬도 읽고 답하는 것 말고 할 수 있는 게 없다.
 * `--allowed-tools ""` 만으로는 안 된다 — 그건 "묻지 않고 허락할" 목록일 뿐이라
 * 권한 확인이 필요 없는 읽기 도구(Read·Grep·Glob)가 그대로 살아서 작업 폴더의
 * 파일(.verify.env 등)을 읽어 답에 옮길 수 있었다. 끄는 옵션은 `--tools ""` 다.
 *
 * Args:
 *   prompt: 모델에 줄 프롬프트
 * Returns:
 *   spawn 에 넘길 인자 배열
 */
export function claudeArgs(prompt) {
  return ["-p", prompt, "--tools", "", "--allowed-tools", "", "--output-format", "text"];
}

/**
 * 디스코드 게이트웨이 박동.
 *
 * HELLO 를 받으면 start, 소켓이 닫히면 stop. 첫 박동은 지터를 줘서 여러 봇이
 * 동시에 때리지 않게 한다(스펙 권고). **지터 타이머도 stop 이 지운다** — 예전엔
 * interval 만 지워서, 지터(최대 약 41초) 안에 재접속하면 옛 타이머가 새 소켓에
 * 박동을 보내고 interval 을 하나 더 만들었다. 박동이 두 배로 나가면 응답을 받기
 * 전에 다음 박동이 와서 "응답 없음"으로 끊기를 되풀이했다.
 *
 * Args:
 *   deps.sendBeat(): 박동 하나를 보낸다
 *   deps.onMissedAck(): 지난 박동에 응답이 없을 때(보통 소켓을 닫는다)
 *   deps.timers: { setTimeout, clearTimeout, setInterval, clearInterval } (테스트는 가짜)
 *   deps.random(): 0~1 난수(지터)
 * Returns:
 *   { start(intervalMs), stop(), ack() }
 */
export function createHeartbeat(deps) {
  const timers = deps.timers;
  let firstBeatTimer = null;
  let repeatTimer = null;
  let acked = true;

  function beat() {
    if (!acked) {
      deps.onMissedAck();
      return;
    }
    acked = false;
    deps.sendBeat();
  }

  function stop() {
    if (firstBeatTimer !== null) timers.clearTimeout(firstBeatTimer);
    if (repeatTimer !== null) timers.clearInterval(repeatTimer);
    firstBeatTimer = null;
    repeatTimer = null;
  }

  function start(intervalMs) {
    stop();
    acked = true;
    firstBeatTimer = timers.setTimeout(() => {
      firstBeatTimer = null;
      beat();
      repeatTimer = timers.setInterval(beat, intervalMs);
    }, intervalMs * deps.random());
  }

  function ack() {
    acked = true;
  }

  return { start, stop, ack };
}
