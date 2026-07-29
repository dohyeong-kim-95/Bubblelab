// 노트북 런타임: Pyodide 부팅 → 문제 스펙 주입 → 셀 실행/채점.
// 채점은 파이썬 안에서 이뤄진다: check.step(id, {...})가 setup+모범답안 체인을
// 별도 네임스페이스에서 실행해 기대값을 만들고 사용자가 넘긴 값과 비교한다.
"use strict";

const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.2/full/";
const PROGRESS_KEY = "bl-ds-progress-v1";
const EXAM_KEY = "bl-ds-exam-v1";

const BOOTSTRAP = String.raw`
import ast, base64, io, json, math, os, sys, traceback

os.environ.setdefault("MPLBACKEND", "Agg")

_BL_STATE = {"spec": None, "ns": None, "passed": set(), "just": []}


class _BlCheck:
    """마지막 셀에서 check.step('s1', {'x': x}) 형태로 호출하는 채점기."""

    def step(self, step_id, answers):
        spec = _BL_STATE["spec"]
        if spec is None:
            print("[채점] 아직 문제가 준비되지 않았습니다.")
            return
        ids = [s["id"] for s in spec["steps"]]
        if step_id not in ids:
            print(f"[채점] 알 수 없는 단계 id '{step_id}' — 사용 가능: {ids}")
            return
        if not isinstance(answers, dict):
            print("[채점] 두 번째 인자는 dict여야 합니다. 예: check.step('s1', {'x': x})")
            return
        i = ids.index(step_id)
        st = spec["steps"][i]
        try:
            ns = _bl_expected_ns(i)
        except Exception:
            print("[채점] 내부 오류: 모범답안 실행에 실패했습니다. 문의해주세요.")
            traceback.print_exc()
            return
        results = []
        for name in st["expect"]:
            if name not in answers:
                results.append((name, False, "답안 dict에 이 키가 없습니다"))
                continue
            try:
                ok, why = _bl_eq(answers[name], ns[name])
            except Exception as e:
                ok, why = False, f"비교 중 오류: {e}"
            results.append((name, ok, why))
        extra = [k for k in answers if k not in st["expect"]]
        npass = sum(1 for _, ok, _ in results if ok)
        print(f"[채점] {step_id} · {st['title']} — {npass}/{len(results)} 통과")
        for name, ok, why in results:
            mark = "✅" if ok else "❌"
            print(f"  {mark} {name}" + ("" if ok else f" — {why}"))
        if extra:
            print(f"  (참고: 채점 대상이 아닌 키가 있습니다: {extra})")
        if npass == len(results):
            if step_id not in _BL_STATE["passed"]:
                _BL_STATE["passed"].add(step_id)
                _BL_STATE["just"].append(step_id)
            if len(_BL_STATE["passed"]) == len(ids):
                print("🎉 모든 단계를 통과했습니다!")
            else:
                print("👍 단계 통과!")


check = _BlCheck()


def _bl_init(spec_json):
    _BL_STATE["spec"] = json.loads(spec_json)
    _BL_STATE["ns"] = {"check": check}
    _BL_STATE["passed"] = set()
    _BL_STATE["just"] = []


def _bl_mark_passed(passed_json):
    """localStorage에 저장돼 있던 통과 기록을 복원한다(재채점 없이 표시용)."""
    _BL_STATE["passed"] = set(json.loads(passed_json))


def _bl_expected_ns(step_index):
    spec = _BL_STATE["spec"]
    ns = {}
    exec(spec["setup"], ns)
    for st in spec["steps"][: step_index + 1]:
        exec(st["solution"], ns)
    return ns


def _bl_scalar(x):
    import numpy as _np
    if isinstance(x, _np.generic):
        return x.item()
    return x


def _bl_num_close(a, b):
    return math.isclose(float(a), float(b), rel_tol=1e-3, abs_tol=1e-4)


def _bl_eq(got, exp):
    """(통과 여부, 실패 사유). 기대값을 노출하지 않는 선에서 힌트를 준다."""
    import numpy as _np
    import pandas as _pd
    got = _bl_scalar(got)
    exp = _bl_scalar(exp)
    if isinstance(exp, bool):
        if isinstance(got, bool) or got in (0, 1):
            return (bool(got) == exp, "값이 다릅니다")
        return (False, "True/False로 답하세요")
    if isinstance(exp, (int, float)):
        if isinstance(got, bool) or not isinstance(got, (int, float)):
            return (False, f"숫자가 필요합니다 (지금: {type(got).__name__})")
        return (_bl_num_close(got, exp), "값이 다릅니다")
    if isinstance(exp, str):
        if not isinstance(got, str):
            return (False, f"문자열이 필요합니다 (지금: {type(got).__name__})")
        return (got.strip() == exp.strip(), "값이 다릅니다")
    if isinstance(exp, _pd.DataFrame):
        if not isinstance(got, _pd.DataFrame):
            return (False, f"DataFrame이 필요합니다 (지금: {type(got).__name__})")
        if set(got.columns) != set(exp.columns):
            return (False, "컬럼 구성이 다릅니다")
        if got.shape[0] != exp.shape[0]:
            return (False, f"행 수가 다릅니다 (내 답 {got.shape[0]}, 기대 {exp.shape[0]})")
        try:
            _pd.testing.assert_frame_equal(
                got[list(exp.columns)].reset_index(drop=True),
                exp.reset_index(drop=True),
                check_dtype=False, check_exact=False, rtol=1e-3, atol=1e-4,
                check_names=False,
            )
            return (True, "")
        except Exception:
            return (False, "값이 다릅니다 (행 순서·인덱스 초기화 여부도 확인하세요)")
    if isinstance(exp, _pd.Series):
        if isinstance(got, (list, tuple, _np.ndarray)):
            got = _pd.Series(list(got), index=exp.index[: len(got)] if len(got) == len(exp) else None)
            got_index_free = True
        elif isinstance(got, _pd.Series):
            got_index_free = False
        else:
            return (False, f"Series가 필요합니다 (지금: {type(got).__name__})")
        if len(got) != len(exp):
            return (False, f"길이가 다릅니다 (내 답 {len(got)}, 기대 {len(exp)})")
        if not got_index_free and list(got.index) != list(exp.index):
            return (False, "인덱스(또는 정렬 순서)가 다릅니다")
        try:
            _pd.testing.assert_series_equal(
                got.reset_index(drop=True), exp.reset_index(drop=True),
                check_dtype=False, check_exact=False, rtol=1e-3, atol=1e-4,
                check_names=False,
            )
            return (True, "")
        except Exception:
            return (False, "값이 다릅니다")
    if isinstance(exp, _np.ndarray):
        try:
            got_arr = _np.asarray(got, dtype=float)
        except Exception:
            return (False, "숫자 배열이 필요합니다")
        if got_arr.shape != exp.shape:
            return (False, f"shape이 다릅니다 (내 답 {got_arr.shape}, 기대 {exp.shape})")
        return (bool(_np.allclose(got_arr, exp.astype(float), rtol=1e-3, atol=1e-4)), "값이 다릅니다")
    if isinstance(exp, (list, tuple)):
        if not isinstance(got, (list, tuple, _np.ndarray)):
            return (False, f"리스트가 필요합니다 (지금: {type(got).__name__})")
        got_list = list(got)
        if len(got_list) != len(exp):
            return (False, f"길이가 다릅니다 (내 답 {len(got_list)}, 기대 {len(exp)})")
        for a, b in zip(got_list, exp):
            ok, why = _bl_eq(a, b)
            if not ok:
                return (False, "원소 " + why)
        return (True, "")
    if isinstance(exp, dict):
        if not isinstance(got, dict):
            return (False, "dict가 필요합니다")
        if set(got) != set(exp):
            return (False, "키 구성이 다릅니다")
        for k in exp:
            ok, why = _bl_eq(got[k], exp[k])
            if not ok:
                return (False, f"'{k}' 값이 다릅니다")
        return (True, "")
    return (got == exp, "값이 다릅니다")


def _bl_run_cell(code):
    out = io.StringIO()
    ns = _BL_STATE["ns"]
    images = []
    result_html = None
    result_text = None
    error = None
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = out
    try:
        tree = ast.parse(code, filename="<cell>")
        last_expr = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last_expr = ast.Expression(tree.body[-1].value)
            tree.body = tree.body[:-1]
        exec(compile(tree, "<cell>", "exec"), ns)
        if last_expr is not None:
            value = eval(compile(last_expr, "<cell>", "eval"), ns)
            if value is not None:
                html_fn = getattr(value, "_repr_html_", None)
                if callable(html_fn):
                    try:
                        result_html = html_fn()
                    except Exception:
                        result_text = repr(value)
                else:
                    result_text = repr(value)
    except SyntaxError:
        error = "".join(traceback.format_exception_only(*sys.exc_info()[:2]))
    except Exception:
        etype, evalue, tb = sys.exc_info()
        if tb is not None and tb.tb_next is not None:
            tb = tb.tb_next  # _bl_run_cell 자체 프레임은 감춘다
        error = "".join(traceback.format_exception(etype, evalue, tb))
    finally:
        sys.stdout, sys.stderr = old_out, old_err
    if "matplotlib" in sys.modules:
        try:
            import matplotlib.pyplot as plt
            for num in plt.get_fignums():
                buf = io.BytesIO()
                plt.figure(num).savefig(buf, format="png", dpi=110, bbox_inches="tight")
                images.append(base64.b64encode(buf.getvalue()).decode("ascii"))
            plt.close("all")
        except Exception:
            pass
    if result_text is not None and len(result_text) > 20000:
        result_text = result_text[:20000] + "\n… (출력이 길어 잘랐습니다)"
    return json.dumps({
        "stdout": out.getvalue(),
        "html": result_html,
        "text": result_text,
        "images": images,
        "error": error,
    })


def _bl_take_passed():
    just = _BL_STATE["just"]
    _BL_STATE["just"] = []
    return json.dumps({"just": just, "passed": sorted(_BL_STATE["passed"])})
`;

// ---------- 진행상황 저장 ----------

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveProgress(progress) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch { /* 프라이빗 모드 등 */ }
}

function loadExamState() {
  try {
    return JSON.parse(localStorage.getItem(EXAM_KEY));
  } catch {
    return null;
  }
}

// ---------- 페이지 상태 ----------

const params = new URLSearchParams(location.search);
const problem = (window.DS_PROBLEMS || []).find((p) => p.id === params.get("id"));

// 실전 모드(exam.html에서 진입): 진행 중인 시험에 포함된 문제일 때만 켜진다.
// 시험 기록·셀 저장을 연습 모드와 분리하고, 시간 안의 통과만 시험 점수로 집계한다.
const EXAM = (() => {
  if (!params.has("exam") || !problem) return null;
  const ex = loadExamState();
  const valid = ex && !ex.finishedAt && Array.isArray(ex.problems) &&
    ex.problems.includes(problem.id);
  return valid ? ex : null;
})();
const cellsKey = (pid) => (EXAM ? `bl-ds-exam-cells-${pid}` : `bl-ds-cells-v1-${pid}`);

function currentPassed() {
  if (EXAM) {
    const ex = loadExamState();
    return (ex && ex.passed && ex.passed[problem.id]) || [];
  }
  return loadProgress()[problem.id] || [];
}

function recordExamPass(passedIds) {
  if (!EXAM) return;
  const ex = loadExamState();
  if (!ex || ex.finishedAt || !ex.problems.includes(problem.id) || Date.now() > ex.endsAt) return;
  ex.passed[problem.id] = [...new Set([...(ex.passed[problem.id] || []), ...passedIds])];
  try {
    localStorage.setItem(EXAM_KEY, JSON.stringify(ex));
  } catch { /* 무시 */ }
}

const $ = (sel) => document.querySelector(sel);
const statusEl = $("#status");
const cellsEl = $("#cells");

let pyodide = null;
let runCellPy = null;
let takePassedPy = null;
let busy = false;

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind || "info";
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 지시문의 `code`와 **강조**만 지원하는 초소형 마크업
function renderProse(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  return html;
}

function checkTemplate(step) {
  const args = step.expect.map((name) => `'${name}': ${name}`).join(", ");
  return `check.step('${step.id}', {${args}})`;
}

function defaultCells() {
  return problem.steps.map((step, i) =>
    `# [${i + 1}단계] ${step.title}\n# 여기에 코드를 작성하세요.\n\n\n` +
    `# 다 풀었으면 아래 주석을 풀고 실행해 채점하세요.\n# ${checkTemplate(step)}\n`);
}

function loadCells() {
  try {
    const saved = JSON.parse(localStorage.getItem(cellsKey(problem.id)));
    if (Array.isArray(saved) && saved.length && saved.every((s) => typeof s === "string")) {
      return saved;
    }
  } catch { /* 무시 */ }
  return defaultCells();
}

let saveTimer = null;
function persistCells() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const sources = [...cellsEl.querySelectorAll("textarea")].map((t) => t.value);
    try {
      localStorage.setItem(cellsKey(problem.id), JSON.stringify(sources));
    } catch { /* 무시 */ }
  }, 300);
}

// ---------- 렌더링 ----------

function renderProblem() {
  document.title = `${problem.title} — 데이터랩`;
  $("#p-title").textContent = problem.title;
  $("#p-meta").innerHTML =
    `<span class="badge">${escapeHtml(problem.category)}</span>` +
    `<span class="badge">난이도 ${"●".repeat(problem.level)}${"○".repeat(3 - problem.level)}</span>` +
    problem.tags.map((t) => `<span class="badge tag">${escapeHtml(t)}</span>`).join("");
  $("#p-intro").innerHTML = renderProse(problem.intro);

  $("#steps").innerHTML = problem.steps.map((step, i) => `
    <li class="step" id="step-${step.id}">
      <div class="step-head">
        <span class="step-state" data-state="todo">○</span>
        <strong>${i + 1}단계 · ${escapeHtml(step.title)}</strong>
      </div>
      <div class="step-body">
        <p>${renderProse(step.prompt)}</p>
        <p class="tmpl">채점: <code>${escapeHtml(checkTemplate(step))}</code></p>
        <details><summary>힌트</summary><p>${renderProse(step.hint)}</p></details>
      </div>
    </li>`).join("");
}

function refreshStepStates() {
  const passed = new Set(currentPassed());
  for (const step of problem.steps) {
    const el = $(`#step-${step.id} .step-state`);
    const done = passed.has(step.id);
    el.textContent = done ? "✅" : "○";
    el.dataset.state = done ? "done" : "todo";
  }
  const total = problem.steps.length;
  $("#p-progress").textContent = `${passed.size}/${total} 단계 통과${passed.size === total ? " 🎉" : ""}`;
}

function autoSize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(textarea.scrollHeight + 2, 56)}px`;
}

function makeCell(source, { readonly = false, label = null } = {}) {
  const cell = document.createElement("section");
  cell.className = "cell" + (readonly ? " readonly" : "");
  const head = document.createElement("div");
  head.className = "cell-head";
  const title = document.createElement("span");
  title.textContent = label || "코드";
  head.appendChild(title);
  const actions = document.createElement("span");
  actions.className = "cell-actions";
  const runBtn = document.createElement("button");
  runBtn.textContent = "▶ 실행";
  runBtn.addEventListener("click", () => runCell(cell));
  actions.appendChild(runBtn);
  if (!readonly) {
    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.title = "셀 삭제";
    delBtn.addEventListener("click", () => {
      if (cellsEl.querySelectorAll(".cell:not(.readonly)").length <= 1) return;
      cell.remove();
      persistCells();
    });
    actions.appendChild(delBtn);
  }
  head.appendChild(actions);

  const textarea = document.createElement("textarea");
  textarea.value = source;
  textarea.spellcheck = false;
  textarea.readOnly = readonly;
  textarea.addEventListener("input", () => { autoSize(textarea); persistCells(); });
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      runCell(cell);
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: t } = textarea;
      textarea.setRangeText("    ", s, t, "end");
      persistCells();
    }
  });

  const output = document.createElement("div");
  output.className = "cell-output";
  output.hidden = true;

  cell.append(head, textarea, output);
  requestAnimationFrame(() => autoSize(textarea));
  return cell;
}

function renderOutput(cell, res) {
  const out = cell.querySelector(".cell-output");
  out.innerHTML = "";
  out.hidden = true;
  const add = (node) => { out.hidden = false; out.appendChild(node); };
  if (res.stdout) {
    const pre = document.createElement("pre");
    pre.textContent = res.stdout;
    add(pre);
  }
  if (res.html) {
    const div = document.createElement("div");
    div.className = "df-html";
    div.innerHTML = res.html; // pandas _repr_html_ (셀프 데이터, 신뢰 가능)
    add(div);
  } else if (res.text) {
    const pre = document.createElement("pre");
    pre.className = "result";
    pre.textContent = res.text;
    add(pre);
  }
  for (const b64 of res.images || []) {
    const img = document.createElement("img");
    img.src = `data:image/png;base64,${b64}`;
    img.alt = "plot";
    add(img);
  }
  if (res.error) {
    const pre = document.createElement("pre");
    pre.className = "error";
    pre.textContent = res.error;
    add(pre);
  }
}

// ---------- 실행 ----------

async function runCell(cell) {
  if (busy) return;
  if (!pyodide) { setStatus("아직 파이썬 환경을 준비하는 중입니다…", "warn"); return; }
  busy = true;
  cell.classList.add("running");
  setStatus("실행 중…", "busy");
  const code = cell.querySelector("textarea").value;
  try {
    try {
      await pyodide.loadPackagesFromImports(code);
    } catch { /* 사용자가 없는 패키지를 임포트하면 파이썬 에러로 드러난다 */ }
    const res = JSON.parse(runCellPy(code));
    renderOutput(cell, res);
    const passedInfo = JSON.parse(takePassedPy());
    if (passedInfo.just.length) {
      // 연습 진행상황은 항상 누적하고, 실전 모드면 시험 기록에도 반영한다
      const progress = loadProgress();
      progress[problem.id] =
        [...new Set([...(progress[problem.id] || []), ...passedInfo.passed])];
      saveProgress(progress);
      recordExamPass(passedInfo.passed);
      refreshStepStates();
    }
    setStatus("준비 완료 — Shift+Enter로 셀을 실행하세요.", "ok");
  } catch (err) {
    renderOutput(cell, { error: String(err) });
    setStatus("실행 오류가 났습니다.", "warn");
  } finally {
    cell.classList.remove("running");
    busy = false;
    persistCells();
  }
}

async function runAll() {
  for (const cell of cellsEl.querySelectorAll(".cell")) {
    await runCell(cell);
  }
}

async function restartKernel(keepCode = true) {
  if (!pyodide || busy) return;
  const spec = specJson();
  pyodide.runPython("_bl_init")(spec);
  pyodide.runPython("_bl_mark_passed")(JSON.stringify(currentPassed()));
  for (const out of cellsEl.querySelectorAll(".cell-output")) {
    out.innerHTML = "";
    out.hidden = true;
  }
  if (!keepCode) {
    localStorage.removeItem(cellsKey(problem.id));
    const editables = [...cellsEl.querySelectorAll(".cell:not(.readonly)")];
    const fresh = defaultCells();
    editables.forEach((c) => c.remove());
    for (const src of fresh) cellsEl.appendChild(makeCell(src));
  }
  await runCell(cellsEl.querySelector(".cell.readonly"));
  setStatus("커널을 다시 시작했습니다.", "ok");
}

function specJson() {
  return JSON.stringify({
    setup: problem.setup,
    steps: problem.steps.map((s) => ({
      id: s.id, title: s.title, expect: s.expect, solution: s.solution,
    })),
  });
}

function setupExamHeader() {
  const back = document.querySelector("header a");
  back.href = "exam.html";
  back.textContent = "← 시험";
  const timer = document.createElement("span");
  timer.id = "exam-timer";
  statusEl.before(timer);
  const update = () => {
    const ex = loadExamState();
    if (!ex || ex.finishedAt) {
      timer.textContent = "⏱ 시험 종료";
      timer.dataset.zone = "over";
      return;
    }
    const left = ex.endsAt - Date.now();
    if (left <= 0) {
      timer.textContent = "⏱ 시간 종료 — 이후 제출은 점수 미반영";
      timer.dataset.zone = "over";
      return;
    }
    const s = Math.floor(left / 1000);
    timer.textContent = `⏱ ${Math.floor(s / 3600)}:` +
      `${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    timer.dataset.zone = left <= 10 * 60 * 1000 ? "danger" : left <= 30 * 60 * 1000 ? "warn" : "ok";
  };
  update();
  setInterval(update, 1000);
}

async function boot() {
  renderProblem();
  refreshStepStates();
  if (EXAM) setupExamHeader();

  cellsEl.appendChild(makeCell(problem.setup, { readonly: true, label: "데이터 준비 (자동 실행)" }));
  for (const src of loadCells()) cellsEl.appendChild(makeCell(src));

  $("#add-cell").addEventListener("click", () => {
    const cell = makeCell("");
    cellsEl.appendChild(cell);
    cell.querySelector("textarea").focus();
    persistCells();
  });
  $("#run-all").addEventListener("click", runAll);
  $("#restart").addEventListener("click", () => restartKernel(true));
  $("#reset-code").addEventListener("click", () => {
    if (confirm("작성한 코드를 지우고 기본 틀로 되돌릴까요?")) restartKernel(false);
  });

  setStatus("파이썬 환경(Pyodide)을 내려받는 중… 첫 방문은 시간이 걸립니다.", "busy");
  try {
    pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });
  } catch (err) {
    setStatus("Pyodide 로드 실패 — 네트워크를 확인하고 새로고침하세요.", "warn");
    console.error(err);
    return;
  }
  setStatus("필요한 패키지를 내려받는 중… (numpy·pandas 등)", "busy");
  const allCode = [problem.setup, ...problem.steps.map((s) => s.solution)].join("\n");
  try {
    await pyodide.loadPackagesFromImports(allCode, {
      messageCallback: (msg) => setStatus(`패키지 준비: ${msg}`, "busy"),
    });
  } catch (err) {
    setStatus("패키지 로드에 실패했습니다 — 새로고침해 주세요.", "warn");
    console.error(err);
    return;
  }
  pyodide.runPython(BOOTSTRAP);
  pyodide.runPython("_bl_init")(specJson());
  pyodide.runPython("_bl_mark_passed")(JSON.stringify(currentPassed()));
  runCellPy = pyodide.runPython("_bl_run_cell");
  takePassedPy = pyodide.runPython("_bl_take_passed");

  await runCell(cellsEl.querySelector(".cell.readonly"));
  setStatus("준비 완료 — Shift+Enter로 셀을 실행하세요.", "ok");
}

if (!problem) {
  document.body.innerHTML =
    '<p style="padding:2rem">문제를 찾을 수 없습니다. <a href="./">목록으로</a></p>';
} else {
  boot();
}
