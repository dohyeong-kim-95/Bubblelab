import test from "node:test";
import assert from "node:assert/strict";
import { makeRoomCode, normalizeName, normalizeRoomCode, chooseNextHost } from "../_shared/multiplayer-room.js";
import { createRound, privateRoles, tallyVotes, normalizeGuess, resultForAccusation } from "../games/liargame/rules.js";

test("liargame room helpers normalize input and avoid ambiguous room-code letters", () => {
  assert.equal(normalizeName("  김   라이어  "), "김 라이어");
  assert.equal(normalizeRoomCode("ab-i o1cd"), "ABIOCD");
  const code = makeRoomCode(6, () => 0);
  assert.equal(code, "AAAAAA");
  assert.doesNotMatch(makeRoomCode(100), /[IO]/);
});

test("liargame host migration picks the earliest online player", () => {
  const players = {
    host: { order: 0, online: false }, late: { order: 2, online: true },
    early: { order: 1, online: true }, gone: { order: 3, online: false },
  };
  assert.equal(chooseNextHost(players, "host"), "early");
});

test("liargame creates one liar and gives citizens the same word", () => {
  const players = ["a", "b", "c", "d"];
  const round = createRound(players, () => 0);
  const roles = privateRoles(round);
  assert.equal(Object.values(roles).filter((role) => role.role === "liar").length, 1);
  assert.equal(roles[round.liarId].word, undefined);
  assert.ok(Object.values(roles).filter((role) => role.role === "citizen").every((role) => role.word === round.word));
  assert.equal(round.moderatorId, round.order[0]);
});

test("liargame tallies ties and ignores invalid targets", () => {
  const result = tallyVotes({
    a: { targetId: "b" }, b: { targetId: "a" }, c: { targetId: "b" },
    d: { targetId: "a" }, outsider: { targetId: "x" },
  }, ["a", "b", "c", "d"]);
  assert.deepEqual(result.counts, { b: 2, a: 2 });
  assert.deepEqual(result.leaders, ["a", "b"]);
});

test("liargame leaves free-text guesses to the host judgment", () => {
  assert.equal(normalizeGuess("  김치   찌개 "), "김치 찌개");
  assert.equal(resultForAccusation({ accusedId: "c", liarId: "l", word: "김치찌개" }).winner, "liar");
  assert.equal(resultForAccusation({ accusedId: "l", liarId: "l", word: "김치찌개", guess: "김치 찌개", correct: true }).winner, "liar");
  assert.equal(resultForAccusation({ accusedId: "l", liarId: "l", word: "김치찌개", guess: "된장찌개", correct: false }).winner, "citizens");
});
