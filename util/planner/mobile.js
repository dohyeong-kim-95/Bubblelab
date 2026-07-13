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
      const label = document.createElement("label");
      label.className = `mobile-todo${todo.done ? " done" : ""}`;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(todo.done);
      checkbox.addEventListener("change", async () => {
        const data = PlannerSync.getData();
        const target = data[date]?.todo?.find((item) => item.id === todo.id);
        if (!target) return;
        target.done = checkbox.checked;
        label.classList.toggle("done", target.done);
        await PlannerSync.setData(data).catch(() => {
          checkbox.checked = !checkbox.checked;
          target.done = checkbox.checked;
          label.classList.toggle("done", target.done);
        });
        render();
      });
      const title = document.createElement("span");
      title.textContent = todo.title;
      label.append(checkbox, title);
      root.append(label);
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

  function render() {
    const data = PlannerSync.getData();
    const day = data[date] || { plan: [], real: [], todo: [] };
    const weekday = new Date(`${date}T12:00:00+09:00`).toLocaleDateString("en-US", { weekday: "short" });
    document.getElementById("mobileDate").textContent = `${date} (${weekday})`;
    renderTodos(day);
    renderDiff(day);
  }

  document.getElementById("mobilePrev").addEventListener("click", () => { date = shiftDate(date, -1); render(); });
  document.getElementById("mobileNext").addEventListener("click", () => { date = shiftDate(date, 1); render(); });
  document.getElementById("mobileToday").addEventListener("click", () => { date = kstToday(); render(); });
  addEventListener("planner:remote", render);
  addEventListener("visibilitychange", () => { if (!document.hidden) PlannerSync.refresh(); });
  setInterval(() => PlannerSync.refresh(), 30000);
  render();
})();
