(() => {
  const DATA_KEY = "dailyPlanner";
  const nativeSetItem = Storage.prototype.setItem;
  let hydrating = false;
  let saveTimer;

  const setLocal = (data) => {
    hydrating = true;
    nativeSetItem.call(localStorage, DATA_KEY, JSON.stringify(data ?? {}));
    hydrating = false;
  };

  async function saveRemote(data) {
    const status = document.getElementById("mobileSync");
    if (status) status.textContent = "Syncing…";
    const response = await fetch("/_planner/data", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
    if (response.status === 401) return location.reload();
    if (!response.ok) throw new Error("sync failed");
    if (status) status.textContent = "Synced";
  }

  Storage.prototype.setItem = function (key, value) {
    nativeSetItem.call(this, key, value);
    if (this !== localStorage || key !== DATA_KEY || hydrating) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { saveRemote(JSON.parse(value)); }
      catch { document.getElementById("mobileSync")?.replaceChildren("Sync failed"); }
    }, 450);
  };

  async function fetchRemote({ notify = false } = {}) {
    const response = await fetch("/_planner/data", { cache: "no-store" });
    if (!response.ok) return response;
    const { data } = await response.json();
    setLocal(data);
    if (notify) dispatchEvent(new CustomEvent("planner:remote", { detail: data }));
    return response;
  }

  window.PlannerSync = {
    getData: () => JSON.parse(localStorage.getItem(DATA_KEY) || "{}"),
    setData(data) { setLocal(data); return saveRemote(data); },
    async mutateTodo(action, payload) {
      const response = await fetch("/_planner/data", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!response.ok) {
        const error = new Error("todo sync failed");
        error.status = response.status;
        throw error;
      }
      return response.json();
    },
    async toggleTodo(date, id, done) {
      const data = this.getData();
      const todo = data[date]?.todo?.find((item) => item.id === id);
      if (todo) { todo.done = done; setLocal(data); }
      return this.mutateTodo("toggle", { date, id, done });
    },
    addTodo: (date, title) => window.PlannerSync.mutateTodo("add", { date, title }),
    deleteTodo: (date, id) => window.PlannerSync.mutateTodo("delete", { date, id }),
    refresh: () => fetchRemote({ notify: true }),
  };

  function loadApp() {
    document.body.classList.add("authenticated");
    const script = document.createElement("script");
    script.src = matchMedia("(max-width: 768px)").matches ? "mobile.js" : "script.js";
    document.body.append(script);
  }

  async function start() {
    const response = await fetchRemote();
    if (response.ok) return loadApp();
    if (response.status === 503) {
      document.getElementById("loginError").textContent = "Planner login is not configured.";
    }
  }

  document.getElementById("plannerLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const pin = document.getElementById("plannerPin").value.trim();
    const letter = document.getElementById("plannerLetter").value.trim().toUpperCase();
    const error = document.getElementById("loginError");
    if (!/^\d{6}$/.test(pin) || !/^[A-Z]{2}$/.test(letter)) {
      error.textContent = "Enter 6 digits and 2 letters.";
      return;
    }
    error.textContent = "";
    const response = await fetch("/_planner/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pin + letter }),
    });
    if (!response.ok) {
      error.textContent = response.status === 503 ? "Planner login is not configured." : "Enter 6 digits and 2 letters.";
      return;
    }
    await fetchRemote();
    loadApp();
  });

  document.getElementById("plannerPin").addEventListener("input", (event) => {
    event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
    if (event.target.value.length === 6) document.getElementById("plannerLetter").focus();
  });
  document.getElementById("plannerLetter").addEventListener("input", (event) => {
    event.target.value = event.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2);
  });
  document.getElementById("plannerSwitch").addEventListener("click", async () => {
    await fetch("/_planner/logout", { method: "POST" });
    localStorage.removeItem(DATA_KEY);
    location.reload();
  });
  start();
})();
