(() => {
  const HOURS = Array.from({ length: 14 }, (_, index) => index + 7);
  const MINUTES = [0, 10, 20, 30, 40, 50];
  const pad = (value) => String(value).padStart(2, "0");
  const kstToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  let date = kstToday();

  const shiftDate = (dateString, days) => {
    const value = new Date(`${dateString}T12:00:00+09:00`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  };
  const minutesOf = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

  function slotsFor(blocks, hour) {
    return MINUTES.map((minute) => {
      const point = hour * 60 + minute;
      const block = blocks.find((item) => minutesOf(item.startTime) <= point && minutesOf(item.endTime) > point);
      return block?.title?.trim() || "";
    });
  }

  function line(tag, values, className) {
    const row = document.createElement("div");
    row.className = `diff-line ${className}`;
    const label = document.createElement("span");
    label.className = `diff-tag ${tag === "−" ? "minus" : tag === "+" ? "plus" : "same"}`;
    label.textContent = tag;
    row.append(label);
    values.forEach((value) => {
      const cell = document.createElement("span");
      cell.className = `diff-cell${value ? "" : " empty"}`;
      cell.textContent = value || "·";
      if (value) cell.title = value;
      row.append(cell);
    });
    return row;
  }

  function renderTodos(day) {
    const root = document.getElementById("mobileTodos");
    const todos = day.todo || [];
    document.getElementById("mobileTodoCount").textContent = `${todos.filter((item) => item.done).length}/${todos.length}`;
    root.replaceChildren();
    if (!todos.length) {
      root.innerHTML = '<p class="mobile-empty">No TODOs for this day</p>';
      return;
    }
    todos.forEach((todo) => {
      const row = document.createElement("div");
      row.className = `mobile-todo${todo.done ? " done" : ""}`;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(todo.done);
      checkbox.addEventListener("change", async () => {
        row.classList.toggle("done", checkbox.checked);
        await PlannerSync.toggleTodo(date, todo.id, checkbox.checked).catch(async () => {
          checkbox.checked = !checkbox.checked;
          row.classList.toggle("done", checkbox.checked);
          await PlannerSync.refresh();
        });
        render();
      });
      const title = document.createElement("span");
      title.textContent = todo.title;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "mobile-todo-delete";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Delete ${todo.title}`);
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          await PlannerSync.deleteTodo(date, todo.id);
          await PlannerSync.refresh();
        } catch {
          remove.disabled = false;
          document.getElementById("mobileTodoError").textContent = "Could not delete TODO.";
        }
      });
      row.append(checkbox, title, remove);
      root.append(row);
    });
  }

  function renderDiff(day) {
    const root = document.getElementById("mobileDiff");
    root.replaceChildren();
    HOURS.forEach((hour) => {
      const plan = slotsFor(day.plan || [], hour);
      const real = slotsFor(day.real || [], hour);
      const same = plan.map((value, index) => value && value === real[index] ? value : "");
      const minus = plan.map((value, index) => value !== real[index] ? value : "");
      const plus = real.map((value, index) => value !== plan[index] ? value : "");
      const hourRow = document.createElement("div");
      hourRow.className = "diff-hour";
      hourRow.innerHTML = `<div class="diff-time">${pad(hour)}</div>`;
      const lines = document.createElement("div");
      lines.className = "diff-lines";
      if (hour === HOURS[0]) {
        const minutes = document.createElement("div");
        minutes.className = "diff-minutes";
        minutes.innerHTML = `<span></span>${MINUTES.map((m) => `<span>${pad(m)}</span>`).join("")}`;
        lines.append(minutes);
      }
      if (same.some(Boolean)) lines.append(line("=", same, "same-line"));
      if (minus.some(Boolean)) lines.append(line("−", minus, "minus-line"));
      if (plus.some(Boolean)) lines.append(line("+", plus, "plus-line"));
      if (!same.some(Boolean) && !minus.some(Boolean) && !plus.some(Boolean)) lines.append(line("=", Array(6).fill(""), "same-line"));
      hourRow.append(lines);
      root.append(hourRow);
    });
  }

  // ── 트랙 편집 (탭 두 번 방식): 빈 칸 두 번 탭 → 새 블록, 블록 탭 → 수정 시트 ──
  let track = "diff", pendingStart = null;
  const blockSheet = document.getElementById("blockSheet");
  const trackHint = document.getElementById("trackHint");
  let sheet = null; // { mode, id, startTime, endTime }

  const timeAt = (hour, minute) => `${pad(hour)}:${pad(minute)}`;
  const addMinutes = (time, delta) => {
    const total = minutesOf(time) + delta;
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  };
  const editingActive = () => pendingStart !== null || !blockSheet.hidden;

  function setHint(message) {
    trackHint.textContent = message ||
      "Tap an empty cell to start, tap another to finish. Tap a block to edit.";
  }

  function renderTrack(day) {
    const root = document.getElementById("mobileDiff");
    root.replaceChildren();
    const blocks = day[track] || [];
    HOURS.forEach((hour) => {
      const row = document.createElement("div");
      row.className = "track-hour-row";
      const label = document.createElement("span");
      label.className = "track-time";
      label.textContent = pad(hour);
      row.append(label);
      MINUTES.forEach((minute) => {
        const point = hour * 60 + minute;
        const block = blocks.find((item) => minutesOf(item.startTime) <= point && minutesOf(item.endTime) > point);
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "track-cell";
        if (block) {
          cell.classList.add("filled");
          cell.style.background = block.color || "#E5E7EB";
          if (minutesOf(block.startTime) === point) cell.textContent = block.title;
          cell.setAttribute("aria-label", `${block.title} ${block.startTime}–${block.endTime}`);
          cell.addEventListener("click", () => openSheet({
            mode: "edit", id: block.id, startTime: block.startTime, endTime: block.endTime,
            title: block.title, color: block.color,
          }));
        } else {
          const time = timeAt(hour, minute);
          if (time === pendingStart) cell.classList.add("start-sel");
          cell.setAttribute("aria-label", `Empty ${time}`);
          cell.addEventListener("click", () => onEmptyCellTap(time, blocks));
        }
        row.append(cell);
      });
      root.append(row);
    });
  }

  function onEmptyCellTap(time, blocks) {
    if (!pendingStart) {
      pendingStart = time;
      setHint(`Start ${time} — now tap the end cell.`);
    } else if (time === pendingStart) {
      pendingStart = null;
      setHint("");
    } else {
      const startTime = minutesOf(time) < minutesOf(pendingStart) ? time : pendingStart;
      const endTime = addMinutes(minutesOf(time) < minutesOf(pendingStart) ? pendingStart : time, 10);
      if (blocks.some((block) => minutesOf(startTime) < minutesOf(block.endTime) && minutesOf(endTime) > minutesOf(block.startTime))) {
        pendingStart = null;
        setHint("That range crosses a block. Start again.");
      } else {
        openSheet({ mode: "create", startTime, endTime, title: "", color: "#FFB3BA" }); // PC 기본색과 동일
        return;
      }
    }
    render();
  }

  function openSheet(state) {
    sheet = state;
    document.getElementById("blockSheetHeading").textContent =
      state.mode === "create" ? `New ${track.toUpperCase()} block` : `Edit ${track.toUpperCase()} block`;
    document.getElementById("blockTitleInput").value = state.title;
    document.getElementById("blockDelete").hidden = state.mode === "create";
    document.getElementById("blockError").textContent = "";
    refreshSheetColors();
    refreshSheetTimes();
    blockSheet.hidden = false;
    if (state.mode === "create") document.getElementById("blockTitleInput").focus();
  }

  function closeSheet() {
    blockSheet.hidden = true;
    sheet = null;
    pendingStart = null;
    setHint("");
    render();
  }

  function refreshSheetTimes() {
    document.getElementById("blockStartLabel").textContent = sheet.startTime;
    document.getElementById("blockEndLabel").textContent = sheet.endTime;
  }

  function refreshSheetColors() {
    document.querySelectorAll("#blockColors button").forEach((button) =>
      button.classList.toggle("on", button.dataset.color === sheet.color));
  }

  document.getElementById("blockColors").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-color]");
    if (!button) return;
    sheet.color = button.dataset.color;
    refreshSheetColors();
  });

  blockSheet.addEventListener("click", (event) => { if (event.target === blockSheet) closeSheet(); });
  document.getElementById("blockCancel").addEventListener("click", closeSheet);
  document.querySelectorAll("[data-adjust]").forEach((button) => button.addEventListener("click", () => {
    const [edge, delta] = button.dataset.adjust.split(":");
    const next = addMinutes(sheet[edge === "start" ? "startTime" : "endTime"], Number(delta));
    if (minutesOf(next) < 7 * 60 || minutesOf(next) > 21 * 60) return;
    if (edge === "start" && minutesOf(next) >= minutesOf(sheet.endTime)) return;
    if (edge === "end" && minutesOf(next) <= minutesOf(sheet.startTime)) return;
    sheet[edge === "start" ? "startTime" : "endTime"] = next;
    refreshSheetTimes();
  }));

  async function mutateBlock(action, payload) {
    const button = document.getElementById(action === "block-delete" ? "blockDelete" : "blockSave");
    button.disabled = true;
    try {
      await PlannerSync.mutateTodo(action, { date, track, ...payload });
      closeSheet();
      await PlannerSync.refresh();
    } catch (failure) {
      document.getElementById("blockError").textContent =
        failure.status === 409 ? "Overlaps another block." :
        failure.status === 400 ? "Only the current month can be edited." : "Could not save. Try again.";
    } finally {
      button.disabled = false;
    }
  }

  document.getElementById("blockSave").addEventListener("click", () => {
    const title = document.getElementById("blockTitleInput").value.trim();
    if (!title) { document.getElementById("blockError").textContent = "Enter a title."; return; }
    const payload = { startTime: sheet.startTime, endTime: sheet.endTime, title, color: sheet.color };
    if (sheet.mode === "create") mutateBlock("block-add", payload);
    else mutateBlock("block-update", { id: sheet.id, ...payload });
  });
  document.getElementById("blockDelete").addEventListener("click", () => mutateBlock("block-delete", { id: sheet.id }));

  document.getElementById("trackTabs").addEventListener("click", (event) => {
    const tab = event.target.closest("button[data-track]");
    if (!tab) return;
    track = tab.dataset.track;
    pendingStart = null;
    setHint("");
    document.querySelectorAll("#trackTabs button").forEach((b) => b.classList.toggle("on", b === tab));
    document.getElementById("diffLegend").hidden = track !== "diff";
    trackHint.hidden = track === "diff";
    render();
  });

  function render() {
    const data = PlannerSync.getData();
    const day = data[date] || { plan: [], real: [], todo: [] };
    const weekday = new Date(`${date}T12:00:00+09:00`).toLocaleDateString("en-US", { weekday: "short" });
    document.getElementById("mobileDate").textContent = `${date} (${weekday})`;
    renderTodos(day);
    if (track === "diff") renderDiff(day);
    else renderTrack(day);
  }

  const goTo = (next) => { date = next; pendingStart = null; setHint(""); render(); };
  document.getElementById("mobilePrev").addEventListener("click", () => goTo(shiftDate(date, -1)));
  document.getElementById("mobileNext").addEventListener("click", () => goTo(shiftDate(date, 1)));
  document.getElementById("mobileToday").addEventListener("click", () => goTo(kstToday()));
  let addingTodo = false;
  document.getElementById("mobileTodoForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (addingTodo) return;
    const input = document.getElementById("mobileTodoTitle");
    const error = document.getElementById("mobileTodoError");
    const title = input.value.trim();
    if (!title) return;
    addingTodo = true;
    // 입력창을 먼저 비워 연타로 같은 TODO가 중복 제출되지 않게 하고,
    // 서버 응답을 기다리지 않고 임시 항목을 그려 바로 반응하게 한다.
    input.value = "";
    error.textContent = "";
    const day = PlannerSync.getData()[date] || { plan: [], real: [], todo: [] };
    renderTodos({ ...day, todo: [...(day.todo || []), { id: "pending", title, done: false }] });
    try {
      await PlannerSync.addTodo(date, title);
      await PlannerSync.refresh();
    } catch (failure) {
      error.textContent = failure.status === 409 ? "Maximum 7 active TODOs." : "Could not add TODO.";
      input.value = title;
      render();
    } finally {
      addingTodo = false;
    }
  });
  // 편집(셀 선택·시트) 중에는 자동 갱신이 상태를 지우지 않게 멈춘다
  addEventListener("planner:remote", () => { if (!editingActive()) render(); });
  addEventListener("visibilitychange", () => { if (!document.hidden && !editingActive()) PlannerSync.refresh(); });
  setInterval(() => { if (!editingActive()) PlannerSync.refresh(); }, 30000);
  render();
})();
