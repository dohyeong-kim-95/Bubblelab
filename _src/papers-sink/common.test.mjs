import test from "node:test";
import assert from "node:assert/strict";
import { claudeArgs, createHeartbeat, edgeAuthHeaders } from "./common.mjs";

test("claudeArgs: 도구를 --tools \"\" 로 전부 끈다", () => {
  const args = claudeArgs("질문");
  assert.equal(args[0], "-p");
  assert.equal(args[1], "질문");
  const toolsAt = args.indexOf("--tools");
  assert.ok(toolsAt > 0, "--allowed-tools 만으로는 읽기 도구가 살아 있다");
  assert.equal(args[toolsAt + 1], "");
  assert.equal(args[args.indexOf("--output-format") + 1], "text");
});

test("claudeArgs: 프롬프트가 옵션처럼 생겨도 -p 의 값으로만 들어간다", () => {
  const args = claudeArgs("--tools default");
  assert.equal(args[1], "--tools default");
  assert.equal(args[args.indexOf("--tools", 2) + 1], "");
});

// 가짜 타이머 — 등록된 것을 들고 있다가 테스트가 직접 부른다.
function fakeTimers() {
  let nextId = 1;
  const live = new Map();
  return {
    live,
    setTimeout: (fn, ms) => { const id = nextId++; live.set(id, { fn, ms, kind: "timeout" }); return id; },
    clearTimeout: (id) => { live.delete(id); },
    setInterval: (fn, ms) => { const id = nextId++; live.set(id, { fn, ms, kind: "interval" }); return id; },
    clearInterval: (id) => { live.delete(id); },
    fire(kind) {
      for (const [id, timer] of [...live]) {
        if (timer.kind !== kind) continue;
        if (kind === "timeout") live.delete(id);
        timer.fn();
      }
    },
  };
}

function heartbeatWithFakes() {
  const timers = fakeTimers();
  const sent = [];
  const missed = [];
  const heartbeat = createHeartbeat({
    sendBeat: () => sent.push("beat"),
    onMissedAck: () => missed.push("missed"),
    timers,
    random: () => 0.5,
  });
  return { heartbeat, timers, sent, missed };
}

test("heartbeat: 지터 뒤 첫 박동, 이후 interval 로 박동한다", () => {
  const { heartbeat, timers, sent } = heartbeatWithFakes();
  heartbeat.start(40_000);
  const [first] = [...timers.live.values()];
  assert.equal(first.kind, "timeout");
  assert.equal(first.ms, 20_000);
  timers.fire("timeout");
  assert.equal(sent.length, 1);
  heartbeat.ack();
  timers.fire("interval");
  assert.equal(sent.length, 2);
});

test("heartbeat: 지터 안에 재접속해도 옛 타이머가 남지 않는다 (박동이 두 배로 나가지 않는다)", () => {
  const { heartbeat, timers, sent, missed } = heartbeatWithFakes();
  heartbeat.start(40_000);
  heartbeat.stop();          // 소켓 닫힘(op 7 재접속 요청 등)
  heartbeat.start(40_000);   // 새 소켓의 HELLO
  assert.equal(timers.live.size, 1);
  timers.fire("timeout");
  assert.equal(sent.length, 1);
  assert.equal([...timers.live.values()].filter((timer) => timer.kind === "interval").length, 1);
  heartbeat.ack();
  timers.fire("interval");
  assert.equal(sent.length, 2);
  assert.deepEqual(missed, []);
});

test("heartbeat: 응답 없이 다음 박동이 오면 끊는다", () => {
  const { heartbeat, timers, sent, missed } = heartbeatWithFakes();
  heartbeat.start(40_000);
  timers.fire("timeout");
  timers.fire("interval");
  assert.equal(sent.length, 1);
  assert.deepEqual(missed, ["missed"]);
});

test("heartbeat: stop 은 지터 타이머와 interval 을 모두 지운다", () => {
  const { heartbeat, timers } = heartbeatWithFakes();
  heartbeat.start(40_000);
  timers.fire("timeout");
  heartbeat.stop();
  assert.equal(timers.live.size, 0);
});

test("edgeAuthHeaders: /_papers/latest 도 싱크 비밀값으로 부른다", () => {
  assert.deepEqual(edgeAuthHeaders("s3cret"), { Authorization: "Bearer s3cret" });
});
