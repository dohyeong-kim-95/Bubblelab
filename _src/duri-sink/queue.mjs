// 받은 항목을 seq 순서대로 디스크에 쓰고, 쓴 데까지만 ack 하는 규칙.
//
// 소켓·디스크·타이머를 밖에서 받아서(deps) 데몬 없이도 테스트할 수 있게
// duri-sink.mjs 에서 떼어 냈다. 규칙 세 가지:
//   1. 커서 다음 번호(cursor + 1)가 와야 쓴다. 중간이 비면 백필이 끝날 때까지 기다린다.
//   2. 백필이 끝난 뒤의 빈 번호는 서버에 없는 항목(삭제된 사진·이미 폐기된 항목)이라 건너뛴다.
//   3. 쓰기에 실패하면 커서를 멈추고 ack 하지 않는다 — 서버가 지우지 않는다 — 그리고
//      잠시 뒤 다시 시도한다(조용한 밤에 새 항목이 없어도 멈춰 있지 않게).

export const ACK_DELAY_MS = 800;
export const GAP_RETRY_MS = 3000;
export const FAIL_RETRY_MS = 5000;
// 연속 복호화 실패 상한 — 이만큼 이어지면 문구 자체가 틀린 것으로 보고 멈춘다.
export const MAX_DECRYPT_FAILS = 10;

export function isDecryptError(error) {
  return error?.name === "OperationError" || /decrypt/i.test(String(error));
}

/**
 * backfill-done·older-done 을 받았을 때 서버에 더 물어볼지 정한다.
 *
 * Args:
 *   message: 서버 메시지. more 가 true 면 서버가 앞 구간을 잘라 보낸 것이다.
 * Returns:
 *   더 받아 와야 하면 보낼 요청({ type: "fetch-older", before }), 다 받았으면 null.
 */
export function backfillReply(message) {
  if (!message.more) return null;
  if (!Number.isInteger(message.oldest)) return null;
  return { type: "fetch-older", before: message.oldest };
}

/**
 * 순서 큐를 만든다.
 *
 * Args:
 *   deps.cursor: 디스크에 마지막으로 보존한 seq
 *   deps.persist(entry): 항목을 디스크에 쓴다. 실패하면 throw
 *   deps.quarantine(entry): 복호화가 안 되는 항목을 암호문 그대로 보관한다
 *   deps.writeCursor(seq): 커서를 디스크에 쓴다
 *   deps.sendAck(seq): 서버에 ack 를 보낸다
 *   deps.setTimer(fn, ms): setTimeout 과 같다(테스트는 가짜를 넣는다)
 *   deps.log(...args): 로그
 *   deps.stop(message): 더 진행하면 안 될 때 부른다(데몬은 프로세스를 끝낸다)
 * Returns:
 *   { enqueue, startBackfill, finishBackfill, drain, cursor() }
 */
export function createSinkQueue(deps) {
  let cursor = deps.cursor;
  const queue = [];
  let draining = false;
  // 이번 연결에서 서버가 가진 것을 다 보냈는지 — 빈 번호를 기다릴지 건너뛸지 가른다.
  let backfilled = false;
  let ackScheduled = false;
  let retryScheduled = false;
  let decryptFails = 0;

  function enqueue(entry) {
    if (entry.seq <= cursor) return drain(); // 이미 보존됨
    queue.push(entry);
    queue.sort((a, b) => a.seq - b.seq);
    return drain();
  }

  // 재연결할 때마다 백필을 다시 받는다.
  function startBackfill() {
    backfilled = false;
  }

  function finishBackfill() {
    backfilled = true;
    return drain();
  }

  function moveCursor(seq) {
    cursor = seq;
    deps.writeCursor(cursor);
  }

  function scheduleAck() {
    if (ackScheduled) return;
    ackScheduled = true;
    deps.setTimer(() => {
      ackScheduled = false;
      deps.sendAck(cursor);
    }, ACK_DELAY_MS);
  }

  function scheduleRetry(delayMs) {
    if (retryScheduled) return;
    retryScheduled = true;
    deps.setTimer(() => {
      retryScheduled = false;
      drain();
    }, delayMs);
  }

  // 항목 하나를 보존한다. 커서를 넘겨도 되면 true, 다음에 다시 해야 하면 false.
  async function saveOne(entry) {
    try {
      await deps.persist(entry);
      decryptFails = 0;
      return true;
    } catch (error) {
      if (!isDecryptError(error)) {
        deps.log("⏳ 보존 재시도:", entry.seq, String(error?.message || error));
        return false;
      }
      // 산발적으로 안 풀리는 한 건(문구를 바꾸기 전의 옛 항목 등) 때문에 그 뒤
      // 전부가 막히면 안 된다 — 실제로 731건이 딱 한 건에 막혀 있었다. 원문을
      // 못 읽어도 원본까지 잃을 이유는 없으니 암호블롭 그대로 격리하고 넘어간다.
      // 다만 연속으로 계속 실패하면 문구 자체가 틀린 것이므로 그때는 멈춘다
      // (전부 격리한 채 ack 해서 서버에서 지워 버리는 게 최악이다).
      decryptFails += 1;
      if (decryptFails >= MAX_DECRYPT_FAILS) {
        deps.stop(`복호화가 연속 ${MAX_DECRYPT_FAILS}건 실패 — 패스프레이즈가 상대와 다릅니다. 중단합니다.`);
        return false;
      }
      try {
        const saved = await deps.quarantine(entry);
        deps.log(`⚠ seq ${entry.seq} 복호화 실패 — 암호문 그대로 보관: undecryptable/${saved}`);
        return true;
      } catch (quarantineError) {
        deps.log("⏳ 격리 보관 재시도:", entry.seq, String(quarantineError?.message || quarantineError));
        return false; // 사진 다운로드 실패 등 — ack 하지 않고 다음 기회에
      }
    }
  }

  async function drain() {
    if (draining) return;
    draining = true;
    let retryDelay = 0;
    while (queue.length > 0) {
      const entry = queue[0];
      if (entry.seq <= cursor) {
        queue.shift();
        continue;
      }
      if (entry.seq !== cursor + 1) {
        // 백필이 끝나기 전이면 빈 번호가 아직 오는 중일 수 있다 — 기다린다.
        if (!backfilled) {
          retryDelay = GAP_RETRY_MS;
          break;
        }
        deps.log(`서버에 없는 구간 건너뜀: ${cursor + 1}~${entry.seq - 1} (삭제됐거나 이미 폐기된 항목)`);
        moveCursor(entry.seq - 1);
      }
      const saved = await saveOne(entry);
      if (!saved) {
        retryDelay = FAIL_RETRY_MS;
        break;
      }
      queue.shift();
      moveCursor(entry.seq);
      scheduleAck();
    }
    draining = false;
    if (retryDelay > 0) scheduleRetry(retryDelay);
  }

  return { enqueue, startBackfill, finishBackfill, drain, cursor: () => cursor };
}
