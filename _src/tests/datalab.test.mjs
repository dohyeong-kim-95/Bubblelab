// test/(데이터랩) — 문제은행 모범답안과 채점기 _bl_eq.
//
// 구조 검사는 항상 돈다. 파이썬 실행(setup→solution 체인, _bl_eq)은 시스템
// python3 에 numpy·pandas 등이 있을 때만 돌고, 없으면 무엇이 없는지 남기고 건너뛴다
// (브라우저의 Pyodide 와 같은 코드 — runtime.js 의 BOOTSTRAP 을 그대로 꺼내 쓴다).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { tmpdir } from "node:os";

const PROBLEMS_SOURCE = readFileSync(new URL("../../test/problems.js", import.meta.url), "utf8");
const RUNTIME_SOURCE = readFileSync(new URL("../../test/runtime.js", import.meta.url), "utf8");

function loadProblems() {
  const window = {};
  runInNewContext(PROBLEMS_SOURCE, { window });
  return window.DS_PROBLEMS;
}

function bootstrapSource() {
  const match = /const BOOTSTRAP = String\.raw`([\s\S]*?)`;/.exec(RUNTIME_SOURCE);
  assert.ok(match, "runtime.js 에서 BOOTSTRAP 을 찾지 못했다");
  return match[1];
}

// 파이썬을 돌릴 수 있으면 null, 아니면 건너뛸 이유.
function missingPython(modules) {
  const probe = spawnSync("python3", ["-c", `import ${modules.join(", ")}`], { encoding: "utf8", cwd: tmpdir() });
  if (probe.error) return "python3 없음";
  if (probe.status !== 0) return `파이썬 모듈 없음: ${probe.stderr.trim().split("\n").pop()}`;
  return null;
}

function runPython(script, input) {
  // -I 를 쓰지 않는다(사용자 site-packages 의 pandas 등을 못 본다). 대신 리포 밖
  // 임시 폴더에서 돌려 현재 폴더의 .py 가 끼어들지 않게 한다.
  const run = spawnSync("python3", ["-c", script], {
    input, encoding: "utf8", cwd: tmpdir(), maxBuffer: 64 * 1024 * 1024, timeout: 600_000,
    env: { ...process.env, MPLBACKEND: "Agg", PYTHONWARNINGS: "ignore" },
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  return JSON.parse(run.stdout.trim().split("\n").pop());
}

// solution 안에서 이 이름에 값을 대입하는 줄이 있는가(a = …, a, b = …, for a in …).
function assigns(code, name) {
  const word = new RegExp(`(^|[^\\w.])${name}($|[^\\w])`);
  for (const line of code.split("\n")) {
    const assignment = /^\s*([\w\s,()[\]]+?)\s*(=|\+=|-=)(?!=)/.exec(line);
    if (assignment && word.test(assignment[1])) return true;
    const loop = /^\s*for\s+(.+?)\s+in\s/.exec(line);
    if (loop && word.test(loop[1])) return true;
  }
  return false;
}

test("datalab: 문제 id·단계 id 가 유일하고 setup·solution·expect 가 다 있다", () => {
  const problems = loadProblems();
  assert.ok(problems.length > 0);
  const problemIds = new Set();
  for (const problem of problems) {
    assert.ok(!problemIds.has(problem.id), `문제 id 중복: ${problem.id}`);
    problemIds.add(problem.id);
    assert.ok(problem.setup.trim(), `${problem.id}: setup 이 비었다`);
    const stepIds = new Set();
    for (const step of problem.steps) {
      assert.ok(!stepIds.has(step.id), `${problem.id}: 단계 id 중복 ${step.id}`);
      stepIds.add(step.id);
      assert.ok(step.solution.trim(), `${problem.id}/${step.id}: solution 이 비었다`);
      assert.ok(step.expect.length > 0, `${problem.id}/${step.id}: expect 가 비었다`);
    }
  }
});

test("datalab: expect 의 변수는 그 단계까지의 solution 이 만든다", () => {
  for (const problem of loadProblems()) {
    let chain = "";
    for (const step of problem.steps) {
      chain += `\n${step.solution}`;
      for (const name of step.expect) {
        assert.ok(assigns(chain, name), `${problem.id}/${step.id}: solution 체인이 ${name} 을 만들지 않는다`);
      }
    }
  }
});

const SCIENCE = ["numpy", "pandas", "scipy", "sklearn", "statsmodels", "matplotlib"];

test("datalab: setup→solution 체인이 실제로 돌고 expect 변수를 모두 만든다", (t) => {
  const missing = missingPython(SCIENCE);
  if (missing) {
    t.skip(missing);
    return;
  }
  const script = [
    "import json, sys, warnings",
    "warnings.filterwarnings('ignore')",
    bootstrapSource(),
    "problems = json.loads(sys.stdin.read())",
    "failures = []",
    "for problem in problems:",
    "    ns = {}",
    "    try:",
    "        exec(problem['setup'], ns)",
    "    except Exception as error:",
    "        failures.append(f\"{problem['id']}/setup: {error!r}\")",
    "        continue",
    "    for step in problem['steps']:",
    "        try:",
    "            exec(step['solution'], ns)",
    "        except Exception as error:",
    "            failures.append(f\"{problem['id']}/{step['id']}: {error!r}\")",
    "            break",
    "        for name in step['expect']:",
    "            if name not in ns:",
    "                failures.append(f\"{problem['id']}/{step['id']}: {name} 없음\")",
    "                continue",
    "            ok, why = _bl_eq(ns[name], ns[name])",
    "            if not ok:",
    "                failures.append(f\"{problem['id']}/{step['id']}: {name} 이 자기 자신과 다르다 ({why})\")",
    "print(json.dumps(failures, ensure_ascii=False))",
  ].join("\n");
  const failures = runPython(script, JSON.stringify(loadProblems()));
  assert.deepEqual(failures, []);
});

test("datalab: _bl_eq 채점 규칙(허용오차·컬럼 순서·인덱스·타입)", (t) => {
  const missing = missingPython(["numpy", "pandas"]);
  if (missing) {
    t.skip(missing);
    return;
  }
  const cases = String.raw`
import numpy as np
import pandas as pd
results = {}
def case(label, got, exp):
    results[label] = bool(_bl_eq(got, exp)[0])

case("상대오차 1e-3 안", 100.05, 100.0)
case("상대오차 1e-3 밖", 100.5, 100.0)
case("0 근처 절대오차 1e-4 안", 0.00005, 0.0)
case("numpy 스칼라", np.float64(2.0), 2)
case("숫자 자리에 문자열", "2", 2)
case("bool 자리에 0/1", 1, True)
case("bool 자리에 숫자 2", 2, True)
case("숫자 자리에 bool", True, 1)
case("문자열 앞뒤 공백", " 강남 ", "강남")
frame = pd.DataFrame({"a": [1.0, 2.0], "b": [3.0, 4.0]})
case("DataFrame 컬럼 순서만 다름", frame[["b", "a"]], frame)
case("DataFrame 인덱스만 다름", frame.set_axis([10, 11]), frame)
case("DataFrame 컬럼 구성 다름", frame[["a"]], frame)
case("DataFrame 행 순서 다름", frame.iloc[::-1], frame)
series = pd.Series([1.0, 2.0], index=["x", "y"])
case("Series 같은 인덱스", series.copy(), series)
case("Series 인덱스 순서 다름", series.iloc[::-1], series)
case("Series 자리에 리스트(인덱스 무시)", [1.0, 2.0], series)
case("Series 길이 다름", [1.0], series)
case("ndarray shape 다름", np.zeros(3), np.zeros((3, 1)))
case("ndarray 자리에 리스트", [1, 2], np.array([1.0, 2.0]))
case("리스트 원소 허용오차", [1.00001, "a"], [1.0, "a"])
case("dict 키 구성 다름", {"a": 1}, {"a": 1, "b": 2})
case("dict 값 비교", {"a": 1.00001}, {"a": 1})
print(json.dumps(results, ensure_ascii=False))
`;
  const script = ["import json", bootstrapSource(), cases].join("\n");
  const results = runPython(script, "");
  assert.deepEqual(results, {
    "상대오차 1e-3 안": true,
    "상대오차 1e-3 밖": false,
    "0 근처 절대오차 1e-4 안": true,
    "numpy 스칼라": true,
    "숫자 자리에 문자열": false,
    "bool 자리에 0/1": true,
    "bool 자리에 숫자 2": false,
    "숫자 자리에 bool": false,
    "문자열 앞뒤 공백": true,
    "DataFrame 컬럼 순서만 다름": true,
    "DataFrame 인덱스만 다름": true,
    "DataFrame 컬럼 구성 다름": false,
    "DataFrame 행 순서 다름": false,
    "Series 같은 인덱스": true,
    "Series 인덱스 순서 다름": false,
    "Series 자리에 리스트(인덱스 무시)": true,
    "Series 길이 다름": false,
    "ndarray shape 다름": false,
    "ndarray 자리에 리스트": true,
    "리스트 원소 허용오차": true,
    "dict 키 구성 다름": false,
    "dict 값 비교": true,
  });
});
