export function parseAnswerKey(value, count) {
  const tokens = value.trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length !== count) throw new Error(`정답 ${count}개가 필요합니다. 현재 ${tokens.length}개입니다.`);
  if (tokens.some(token => !/^[1-5]$/.test(token))) throw new Error("정답은 1~5만 입력할 수 있습니다.");
  return tokens.map(Number);
}

export function gradeAnswers(answers, key) {
  const rows = key.map((answer, i) => ({ number: i + 1, answer, selected: answers[i] ?? null,
    state: answers[i] == null ? "skipped" : answers[i] === answer ? "correct" : "wrong" }));
  const correct = rows.filter(row => row.state === "correct").length;
  return { rows, total: key.length, correct, wrong: rows.filter(row => row.state === "wrong").length,
    skipped: rows.filter(row => row.state === "skipped").length, percent: Math.round(correct / key.length * 100) };
}
