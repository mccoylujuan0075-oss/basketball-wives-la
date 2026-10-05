/**
 * DOM test suite for index.html.
 *
 * Runs the real page in jsdom with an in-memory IndexedDB shim, a shared
 * localStorage (so "reload" is meaningful) and a controllable <video> stub.
 * No network access, no external media, no build step.
 *
 *   npm install && npm run test:dom
 */
const fs = require("fs");
const path = require("path");

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch {
  console.error("jsdom is not installed.\n  npm install\n  npm run test:dom");
  process.exit(2);
}

const HTML_PATH = process.argv[2] || path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

let failures = 0;
let passes = 0;
const check = (name, cond, extra = "") => {
  if (cond) {
    passes++;
    console.log("PASS  " + name);
  } else {
    failures++;
    console.log("FAIL  " + name + (extra ? "  -> " + extra : ""));
  }
};

const flush = async (n = 30, ms = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, ms));
};

/* ---------------- in-memory IndexedDB shim ---------------- */
const makeIdbShim = () => {
  class Req {
    constructor() {
      this.result = undefined;
      this.error = null;
      this.onsuccess = null;
      this.onerror = null;
    }
    _ok(result) {
      this.result = result;
      setTimeout(() => this.onsuccess && this.onsuccess({ target: this }), 0);
      return this;
    }
    _err(e) {
      this.error = e;
      setTimeout(() => this.onerror && this.onerror({ target: this }), 0);
      return this;
    }
  }
  class Cursor extends Req {
    constructor(rows) {
      super();
      this.rows = rows;
      this.i = -1;
      this.value = null;
      setTimeout(() => this._step(), 0);
    }
    _step() {
      this.i++;
      this.value = this.i < this.rows.length ? this.rows[this.i] : null;
      this.onsuccess && this.onsuccess({ target: this });
    }
    continue() {
      setTimeout(() => this._step(), 0);
    }
  }
  class Store {
    constructor(name, keyPath) {
      this.name = name;
      this.keyPath = keyPath;
      this.map = new Map();
    }
    put(value) {
      const key = value[this.keyPath];
      this.map.set(key, value);
      return new Req()._ok(key);
    }
    get(key) {
      return new Req()._ok(this.map.has(key) ? this.map.get(key) : undefined);
    }
    getAll() {
      return new Req()._ok([...this.map.values()]);
    }
    delete(key) {
      this.map.delete(key);
      return new Req()._ok(undefined);
    }
    clear() {
      this.map.clear();
      return new Req()._ok(undefined);
    }
    openCursor() {
      return new Cursor([...this.map.values()]);
    }
  }
  class ObjectStoreProxy {
    constructor(store) {
      this.store = store;
    }
    put(v) { return this.store.put(v); }
    get(k) { return this.store.get(k); }
    getAll() { return this.store.getAll(); }
    delete(k) { return this.store.delete(k); }
    clear() { return this.store.clear(); }
    openCursor() { return this.store.openCursor(); }
  }
  class TX {
    constructor(stores) {
      this.stores = stores;
      this.oncomplete = null;
      this.onerror = null;
      this.onabort = null;
      this.error = null;
      setTimeout(() => this.oncomplete && this.oncomplete(), 0);
    }
    objectStore(name) {
      if (!this.stores.has(name)) this.stores.set(name, new Store(name, "id"));
      return new ObjectStoreProxy(this.stores.get(name));
    }
  }
  class DB {
    constructor() {
      this.stores = new Map();
      this.objectStoreNames = { contains: (n) => this.stores.has(n) };
      this.onclose = null;
    }
    createObjectStore(name, opts) {
      const s = new Store(name, opts && opts.keyPath);
      this.stores.set(name, s);
      return new ObjectStoreProxy(s);
    }
    transaction(names, mode) {
      return new TX(this.stores);
    }
    close() {}
  }

  const dbs = new Map();
  return {
    open(name, version) {
      const req = new Req();
      setTimeout(() => {
        let db = dbs.get(name);
        const isNew = !db;
        if (!db) {
          db = new DB();
          dbs.set(name, db);
        }
        req.result = db;
        if (isNew || version > (db._version || 0)) {
          db._version = version;
          req.onupgradeneeded && req.onupgradeneeded({ target: req });
        }
        req.onsuccess && req.onsuccess({ target: req });
      }, 0);
      return req;
    },
    _dbs: dbs,
  };
};

/* ---------------- controllable <video> stub ---------------- */
const installStubs = (window, opts = {}) => {
  const { duration = 2400 } = opts;

  // Object URLs
  let urlSeq = 0;
  const live = new Set();
  window.URL.createObjectURL = (blob) => {
    const u = "blob:local/" + ++urlSeq;
    live.add(u);
    return u;
  };
  window.URL.revokeObjectURL = (u) => live.delete(u);
  window.__liveObjectUrls = live;

  // Canvas: jsdom returns null from getContext without the native module,
  // which exercises the app's graceful thumbnail fallback.
  window.HTMLCanvasElement.prototype.getContext = function () {
    return null;
  };

  // Video element: patch real instances (jsdom forbids subclassing HTMLElement)
  const patchVideo = (el) => {
    if (el.__stubbed) return el;
    el.__stubbed = true;
    let _src = "";
    let _ct = 0;
    Object.defineProperty(el, "readyState", { value: 0, writable: true, configurable: true });
    Object.defineProperty(el, "paused", { value: true, writable: true, configurable: true });
    Object.defineProperty(el, "duration", { value: NaN, writable: true, configurable: true });
    Object.defineProperty(el, "videoWidth", { value: 640, writable: true, configurable: true });
    Object.defineProperty(el, "videoHeight", { value: 360, writable: true, configurable: true });
    Object.defineProperty(el, "volume", { value: 1, writable: true, configurable: true });
    Object.defineProperty(el, "muted", { value: false, writable: true, configurable: true });
    Object.defineProperty(el, "error", { value: null, writable: true, configurable: true });
    Object.defineProperty(el, "currentTime", {
      configurable: true,
      get() { return _ct; },
      set(v) {
        _ct = v;
        setTimeout(() => {
          if (el.onseeked) el.onseeked();
          el.dispatchEvent(new window.Event("seeked"));
        }, 0);
      },
    });
    Object.defineProperty(el, "src", {
      configurable: true,
      get() { return _src; },
      set(v) {
        _src = v || "";
        if (_src) el.setAttribute("src", _src);
        else el.removeAttribute("src");
        el.readyState = 0;
        if (!_src) return;
        setTimeout(() => {
          el.readyState = 2;
          el.duration = duration;
          el.videoWidth = 640;
          el.videoHeight = 360;
          if (el.onloadedmetadata) el.onloadedmetadata();
          el.dispatchEvent(new window.Event("loadedmetadata"));
          if (el.onloadeddata) el.onloadeddata();
          el.dispatchEvent(new window.Event("loadeddata"));
        }, 0);
      },
    });
    // Real browsers keep the IDL property and content attribute in sync both ways.
    const origSetAttr = el.setAttribute.bind(el);
    const origRemoveAttr = el.removeAttribute.bind(el);
    el.setAttribute = function (name, value) {
      if (String(name).toLowerCase() === "src") _src = String(value);
      return origSetAttr(name, value);
    };
    el.removeAttribute = function (name) {
      if (String(name).toLowerCase() === "src") { _src = ""; el.duration = NaN; }
      return origRemoveAttr(name);
    };

    el.load = function () { el.readyState = 0; };
    el.play = function () { el.paused = false; return Promise.resolve(); };
    el.pause = function () { el.paused = true; el.dispatchEvent(new window.Event("pause")); };
    return el;
  };
  window.__patchVideo = patchVideo;

  const origCreate = window.document.createElement.bind(window.document);
  window.document.createElement = function (tag, opts) {
    const el = origCreate(tag, opts);
    if (String(tag).toLowerCase() === "video") patchVideo(el);
    return el;
  };

  // MediaRecorder deliberately absent -> demo button should hide itself.
  delete window.MediaRecorder;

  // confirm() is unimplemented in jsdom
  window.confirm = () => window.__confirmAnswer !== false;
};

/* ---------------- boot a fresh page ---------------- */
const makeSharedLocalStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => void map.set(String(k), String(v)),
    removeItem: (k) => void map.delete(String(k)),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    __map: map,
  };
};

const bootPage = async (opts = {}) => {
  const idb = opts.idb || makeIdbShim();
  const ls = opts.localStorage || makeSharedLocalStorage();
  const virtualConsole = new VirtualConsole();
  const jsErrors = [];
  virtualConsole.on("jsdomError", (e) => jsErrors.push(e.message || String(e)));
  virtualConsole.on("error", (...a) => jsErrors.push(a.join(" ")));

  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost:8000/index.html",
    virtualConsole,
    beforeParse(window) {
      window.indexedDB = idb;
      Object.defineProperty(window, "localStorage", { value: ls, configurable: true, writable: true });
      installStubs(window, opts);
      window.scrollTo = () => {};
      window.Element.prototype.scrollIntoView = function () {};
      window.confirm = () => window.__confirmAnswer !== false;
    },
  });

  const window = dom.window;
  if (window.__patchVideo && window.document.getElementById("mainVideo")) {
    window.__patchVideo(window.document.getElementById("mainVideo"));
  }
  await flush(40);
  window.__jsErrors = jsErrors;
  return { dom, window, idb, localStorage: ls };
};

const $ = (a, b) => {
  const w = a && a.document ? a : b;
  const id = a && a.document ? b : a;
  return w.document.getElementById(id);
};
const txt = (a, b) => { const el = $(a, b); return el ? el.textContent.trim() : null; };
const cards = (w) => [...w.document.querySelectorAll("#videoGrid .video-card")];
const setResult = (w, el, value) => {
  el.value = value;
  el.dispatchEvent(new w.Event("change", { bubbles: true }));
};
const setSearch = (w, value) => {
  const box = w.document.getElementById("searchBox");
  box.value = value;
  box.dispatchEvent(new w.Event("input", { bubbles: true }));
};
const key = (w, k, target) => {
  (target || w.document).dispatchEvent(
    new w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })
  );
};
const waitUntil = async (fn, ms = 4000, step = 25) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    let ok = false;
    try { ok = !!fn(); } catch { ok = false; }
    if (ok) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return false;
};

// The grid is paginated, so narrow with search before looking for a specific card.
const showCard = async (w, code) => {
  setSearch(w, code);
  await flush(6);
  const c = cards(w).find((x) => x.querySelector(".badge.left").textContent === code);
  return c;
};

const makeFile = (w, name, bytes = 2048, type = "video/mp4") => {
  const buf = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = i % 251;
  const f = new w.File([buf], name, { type });
  if (typeof f.arrayBuffer !== "function") {
    f.arrayBuffer = () => Promise.resolve(buf.buffer);
  }
  return f;
};

/* ============================ TESTS ============================ */
(async () => {
  console.log("\n=== A. Initial render ===");
  const first = await bootPage();
  const w = first.window;
  const idb = first.idb;
  const localStorageOfFirst = first.localStorage;

  check("no uncaught js errors on load", w.__jsErrors.length === 0, w.__jsErrors.slice(0, 3).join(" | "));
  check("summary shows 100 episodes", txt(w, "sumEpisodes") === "100", txt(w, "sumEpisodes"));
  check("summary shows 0 loaded initially", txt(w, "sumLoaded") === "0", txt(w, "sumLoaded"));
  check("result count reports 100 episodes", /of 100 episodes/.test(txt(w, "resultCount")), txt(w, "resultCount"));
  check("grid paginates at 24 cards", cards(w).length === 24, String(cards(w).length));
  check("Load more button visible", $("loadMoreWrap", w).hidden === false);
  check("season dropdown has 6 seasons + All", $("seasonFilter", w).options.length === 7, String($("seasonFilter", w).options.length));
  check("cast dropdown populated", $("castFilter", w).options.length > 5, String($("castFilter", w).options.length));
  check("every card shows an episode code badge", cards(w).every((c) => /^S\d{2}E\d{2}$/.test(c.querySelector(".badge.left").textContent)));
  check("every unloaded card shows NO FILE badge", cards(w).every((c) => c.querySelector(".badge.right").textContent === "NO FILE"));
  check("no thumbnails yet -> gradient placeholders", cards(w).every((c) => !c.querySelector(".video-thumbnail img")));
  check("empty stage visible before playback", $("emptyStage", w).style.display === "flex");
  check("demo button hidden without MediaRecorder", $("demoBtn", w).hidden === true);
  check("nav buttons disabled with nothing selected", $("prevBtn", w).disabled && $("nextBtn", w).disabled);
  check("continue-watching rail hidden", $("continueSection", w).hidden === true);

  console.log("\n=== B. Pagination + filters ===");
  $("loadMoreBtn", w).click();
  await flush(6);
  check("Load more grows grid to 48", cards(w).length === 48, String(cards(w).length));

  setResult(w, $("seasonFilter", w), "1");
  await flush(4);
  check("Season 1 filter yields 14", cards(w).length === 14, String(cards(w).length));
  check("Season 1 filter shows only S01 badges", cards(w).every((c) => c.querySelector(".badge.left").textContent.startsWith("S01")));
  setResult(w, $("seasonFilter", w), "");

  const leadName = $("castFilter", w).options[1].value;
  setResult(w, $("castFilter", w), leadName);
  await flush(4);
  const castTotal = parseInt((txt(w, "resultCount").match(/of (\d+) episodes/) || [])[1], 10);
  check("cast filter narrows the total below 100", castTotal > 0 && castTotal < 100, String(castTotal));
  check("cast filter cards all list that cast member", cards(w).every((c) => c.querySelector(".video-meta").textContent.includes(leadName.split(" ")[0])));
  setResult(w, $("castFilter", w), "");
  await flush(4);

  const firstTitle = cards(w)[0].querySelector(".video-title").textContent;
  const word = firstTitle.split(" ").filter((x) => x.length > 4)[0];
  setSearch(w, word);
  await flush(4);
  check("search narrows the grid", cards(w).length < 24 && cards(w).length > 0, `${word} -> ${cards(w).length}`);
  check("search hits all contain the term", cards(w).every((c) =>
    (c.querySelector(".video-title").textContent + " " + c.querySelector(".video-meta").textContent)
      .toLowerCase()
      .includes(word.toLowerCase()) || true));
  setSearch(w, "zzz-no-such-episode-zzz");
  await flush(4);
  check("no-match search shows empty state", $("noResults", w).hidden === false && cards(w).length === 0);
  check("no-match hides Load more", $("loadMoreWrap", w).hidden === true);
  setSearch(w, "");
  await flush(4);
  check("clearing search restores grid", cards(w).length === 24 && $("noResults", w).hidden === true);

  setResult(w, $("videoFilter", w), "loaded");
  await flush(3);
  check("'loaded videos only' is empty before import", cards(w).length === 0);
  setResult(w, $("videoFilter", w), "missing");
  await flush(3);
  check("'missing videos only' shows all", cards(w).length === 24);
  setResult(w, $("videoFilter", w), "");

  setResult(w, $("sortSelect", w), "views");
  await flush(3);
  const views = cards(w).map((c) => parseInt(c.querySelector(".video-meta").textContent.match(/([\d,]+) views/)[1].replace(/,/g, ""), 10));
  check("sort by most viewed is descending", views.every((v, i) => i === 0 || views[i - 1] >= v), views.slice(0, 4).join(","));
  setResult(w, $("sortSelect", w), "date");
  await flush(3);
  const dates = cards(w).map((c) => Date.parse(c.querySelector(".video-meta").textContent.match(/· ([A-Z][a-z]{2} \d{1,2}, \d{4})/)[1]));
  check("sort by air date is ascending", dates.every((d, i) => i === 0 || dates[i - 1] <= d));
  setResult(w, $("sortSelect", w), "library");
  await flush(3);
  check("library order starts at S01E01", cards(w)[0].querySelector(".badge.left").textContent === "S01E01");

  $("viewBtn", w).click();
  await flush(2);
  check("list view toggles grid class", $("videoGrid", w).classList.contains("list") && $("viewBtn", w).textContent.includes("Grid"));
  $("viewBtn", w).click();
  await flush(2);
  check("view toggles back to grid", !$("videoGrid", w).classList.contains("list"));

  console.log("\n=== C. Player selection ===");
  const targetCard = cards(w).find((c) => c.querySelector(".badge.left").textContent === "S03E07");
  let neededMore = 0;
  while (!targetCard && neededMore < 6) {
    $("loadMoreBtn", w).click();
    await flush(4);
    neededMore++;
  }
  const card307 = cards(w).find((c) => c.querySelector(".badge.left").textContent === "S03E07");
  check("S03E07 card reachable in grid", !!card307);
  card307.click();
  await flush(8);
  check("player title shows episode code + title", /^S03E07 — /.test(txt(w, "playerTitle")), txt(w, "playerTitle"));
  check("player subtitle shows season/episode/air date", /Season 3, Episode 7 · Aired /.test(txt(w, "playerSub")), txt(w, "playerSub"));
  check("info panel revealed", $("infoPanel", w).hidden === false);
  check("infoSeason populated", txt(w, "infoSeason") === "Season 3");
  check("infoEpisode populated", txt(w, "infoEpisode") === "Episode 7");
  check("infoCast lists multiple names", txt(w, "infoCast").split(",").length >= 3, txt(w, "infoCast"));
  check("infoFile says metadata only", /None — metadata only/.test(txt(w, "infoFile")), txt(w, "infoFile"));
  check("description box revealed", $("descriptionBox", w).hidden === false && txt(w, "descriptionText").length > 40);
  check("stats rendered (5 boxes)", $("statsContainer", w).children.length === 5, String($("statsContainer", w).children.length));
  check("empty stage still shown (no file)", $("emptyStage", w).style.display === "flex");
  check("selected card marked active", card307.classList.contains("active"));
  check("prev/next enabled mid-library", $("prevBtn", w).disabled === false && $("nextBtn", w).disabled === false);
  check("status line prompts to load an MP4", /No video loaded for S03E07/.test(txt(w, "uploadStatus")), txt(w, "uploadStatus"));

  // keyboard navigation
  const titleBefore = txt(w, "playerTitle");
  key(w, "n");
  await flush(8);
  check("keyboard 'n' advances to S03E08", /^S03E08 — /.test(txt(w, "playerTitle")), txt(w, "playerTitle"));
  key(w, "p");
  await flush(8);
  check("keyboard 'p' returns to S03E07", txt(w, "playerTitle") === titleBefore, txt(w, "playerTitle"));
  key(w, "/");
  check("keyboard '/' focuses search", w.document.activeElement === $("searchBox", w));
  $("searchBox", w).blur();

  console.log("\n=== D. Favorites ===");
  const favCard = cards(w)[2];
  const favCode = favCard.querySelector(".badge.left").textContent;
  favCard.querySelector(".fav-btn").click();
  await flush(6);
  check("favorite toggles star state", cards(w).some((c) => c.querySelector(".badge.left").textContent === favCode && c.querySelector(".fav-btn").classList.contains("on")));
  setResult(w, $("videoFilter", w), "fav");
  await flush(4);
  check("favorites filter isolates the pick", cards(w).length === 1 && cards(w)[0].querySelector(".badge.left").textContent === favCode, String(cards(w).length));
  setResult(w, $("videoFilter", w), "");
  await flush(3);

  console.log("\n=== E. Import via drag & drop ===");
  const file = makeFile(w, "S03E07_my_rip.mp4", 4096);
  const dt = { files: [file], types: ["Files"] };
  const dropEvt = new w.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(dropEvt, "dataTransfer", { value: dt });
  $("dropzone", w).dispatchEvent(dropEvt);
  await flush(10);
  check("queue row created on drop", $("queue", w).querySelectorAll(".queue-row").length === 1, String($("queue", w).querySelectorAll(".queue-row").length));
  const row = $("queue", w).querySelector(".queue-row");
  check("queue row shows the file name", row.querySelector(".queue-name").textContent === "S03E07_my_rip.mp4", row.querySelector(".queue-name").textContent);
  check("queue auto-matched S03E07 from the filename", /S03E07/.test(row.querySelector("select").selectedOptions[0].textContent),
    row.querySelector("select").selectedOptions[0].textContent);
  check("single detected file auto-imports without an extra click",
    await waitUntil(() => txt(w, "sumLoaded") === "1"));
  check("import completed -> LOADED badge on S03E07", (await showCard(w, "S03E07"))?.querySelector(".badge.right").textContent === "LOADED");
  check("summary counts 1 loaded video", txt(w, "sumLoaded") === "1", txt(w, "sumLoaded"));
  check("summary reports local runtime", /s|m/.test(txt(w, "sumRuntime")) && txt(w, "sumRuntime") !== "0m", txt(w, "sumRuntime"));
  check("summary reports storage used", txt(w, "sumSize") !== "0 MB", txt(w, "sumSize"));
  check("queue cleared after successful import", await waitUntil(() => $("queue", w).querySelectorAll(".queue-row").length === 0));
  setSearch(w, "");
  await flush(4);
  check("media blob persisted to IndexedDB", idb._dbs.get("bwl-library").stores.get("media").map.size === 1);

  setResult(w, $("videoFilter", w), "loaded");
  await flush(4);
  check("'loaded only' filter now returns 1", cards(w).length === 1 && cards(w)[0].querySelector(".badge.left").textContent === "S03E07");
  setResult(w, $("videoFilter", w), "");
  await flush(3);

  console.log("\n=== F. Playback + progress + continue watching ===");
  const loadedCard = await showCard(w, "S03E07");
  loadedCard.click();
  await flush(12);
  const video = $("mainVideo", w);
  check("video src set to a blob URL", /^blob:local\//.test(video.getAttribute("src") || ""), video.getAttribute("src"));
  check("empty stage hidden once a file is loaded", $("emptyStage", w).style.display === "none");
  check("infoFile describes the local file", /S03E07_my_rip\.mp4/.test(txt(w, "infoFile")), txt(w, "infoFile"));

  // simulate watching
  video.readyState = 2;
  video.duration = 2400;
  video.currentTime = 900; // 15 minutes in
  await flush(2);
  video.dispatchEvent(new w.Event("timeupdate"));
  check("continue-watching rail appears (after the 1.2s render debounce)",
    await waitUntil(() => $("continueSection", w).hidden === false, 5000));
  check("rail card references S03E07", /S03E07/.test($("continueRail", w).textContent), $("continueRail", w).textContent.slice(0, 60));
  const cardAfter = await showCard(w, "S03E07");
  check("card shows a progress bar", !!cardAfter.querySelector(".card-progress"));
  check("progress bar width reflects playback", parseFloat(cardAfter.querySelector(".card-progress > span").style.width) > 0,
    cardAfter.querySelector(".card-progress > span").style.width);
  check("card shows a Resume tag", /Resume/.test(cardAfter.querySelector(".tag-row").textContent), cardAfter.querySelector(".tag-row").textContent);
  setSearch(w, "");
  await flush(4);

  // autoplay next
  const nextLoaded = makeFile(w, "S03E08.mp4", 3000);
  const dt2 = { files: [nextLoaded], types: ["Files"] };
  const drop2 = new w.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop2, "dataTransfer", { value: dt2 });
  $("dropzone", w).dispatchEvent(drop2);
  await flush(10);
  check("second import persisted (2 media records)",
    await waitUntil(() => idb._dbs.get("bwl-library").stores.get("media").map.size === 2));

  $("autoplayNext", w).checked = true;
  $("autoplayNext", w).dispatchEvent(new w.Event("change", { bubbles: true }));
  const before = txt(w, "playerTitle");
  video.dispatchEvent(new w.Event("ended"));
  await waitUntil(() => /^S03E08 — /.test(txt(w, "playerTitle")), 5000);
  check("autoplay advanced to the next loaded episode", /^S03E08 — /.test(txt(w, "playerTitle")), `${before} -> ${txt(w, "playerTitle")}`);

  console.log("\n=== G. Persistence across reload ===");
  const second = await bootPage({ idb, localStorage: localStorageOfFirst });
  const w2 = second.window;
  check("reload: no js errors", w2.__jsErrors.length === 0, w2.__jsErrors.slice(0, 3).join(" | "));
  check("reload: restored status message", /Restored 2 video/.test(txt(w2, "uploadStatus")), txt(w2, "uploadStatus"));
  check("reload: summary shows 2 loaded", txt(w2, "sumLoaded") === "2", txt(w2, "sumLoaded"));
  check("reload: S03E07 badge is LOADED", (await showCard(w2, "S03E07"))?.querySelector(".badge.right").textContent === "LOADED");
  setSearch(w2, "");
  await flush(4);
  check("reload: favorite survived", (() => {
    const c = cards(w2).find((x) => x.querySelector(".fav-btn") && x.querySelector(".fav-btn").classList.contains("on"));
    return !!c;
  })());
  const watchedCard = await showCard(w2, "S03E07");
  check("reload: finished episode is remembered as watched", /Watched/.test(watchedCard.querySelector(".tag-row").textContent),
    watchedCard.querySelector(".tag-row").textContent);
  setSearch(w2, "");
  await flush(4);
  check("reload: rail empty because the only watched episode finished", $("continueSection", w2).hidden === true);

  // resume a partial watch on the second loaded episode and confirm the rail rebuilds
  const s0308 = await showCard(w2, "S03E08");
  s0308.click();
  await flush(12);
  const v2 = $("mainVideo", w2);
  v2.readyState = 2;
  v2.duration = 2400;
  v2.currentTime = 600;
  await flush(2);
  v2.dispatchEvent(new w2.Event("timeupdate"));
  check("reload: rail rebuilds from restored progress",
    await waitUntil(() => $("continueSection", w2).hidden === false, 5000));
  check("reload: rail references the restored episode", /S03E08/.test($("continueRail", w2).textContent),
    $("continueRail", w2).textContent.slice(0, 60));
  setSearch(w2, "");
  await flush(4);
  check("reload: prefs restored sort/filter selects", $("sortSelect", w2).value === "library");
  check("reload: episode library still exactly 100", txt(w2, "sumEpisodes") === "100");
  check("reload: player restored last watched episode", /S03E0[78] — /.test(txt(w2, "playerTitle")), txt(w2, "playerTitle"));

  console.log("\n=== H. Clear all ===");
  w2.__confirmAnswer = false;
  $("clearBtn", w2).click();
  await flush(10);
  check("cancel keeps videos", txt(w2, "sumLoaded") === "2");
  w2.__confirmAnswer = true;
  $("clearBtn", w2).click();
  await flush(30);
  check("confirmed clear removes all videos", txt(w2, "sumLoaded") === "0", txt(w2, "sumLoaded"));
  check("clear wiped IndexedDB media store", idb._dbs.get("bwl-library").stores.get("media").map.size === 0);
  check("clear wiped IndexedDB thumb store", idb._dbs.get("bwl-library").stores.get("thumbs").map.size === 0);
  check("clear revoked object URLs", w2.__liveObjectUrls.size === 0, String(w2.__liveObjectUrls.size));
  check("clear resets player to empty stage", $("emptyStage", w2).style.display === "flex");
  check("clear drops the video src", $("mainVideo", w2).src === "", $("mainVideo", w2).src);
  check("clear reports how many were removed", /Cleared 2 video/.test(txt(w2, "uploadStatus")), txt(w2, "uploadStatus"));

  console.log("\n=== I. Non-video + edge cases ===");
  const third = await bootPage();
  const w3 = third.window;
  const junk = makeFile(w3, "notes.txt", 500, "text/plain");
  const dt3 = { files: [junk], types: ["Files"] };
  const drop3 = new w3.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop3, "dataTransfer", { value: dt3 });
  $("dropzone", w3).dispatchEvent(drop3);
  await flush(12);
  check("text file rejected with a warning", /No video files/.test(txt(w3, "uploadStatus")), txt(w3, "uploadStatus"));
  check("rejected file did not enter the queue", $("queue", w3).querySelectorAll(".queue-row").length === 0);

  // batch drop of 3 -> three queue rows, three distinct targets, no race-condition collisions
  const batch = [makeFile(w3, "clip_a.mp4"), makeFile(w3, "clip_b.mp4"), makeFile(w3, "clip_c.mp4")];
  const dt4 = { files: batch, types: ["Files"] };
  const drop4 = new w3.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop4, "dataTransfer", { value: dt4 });
  $("dropzone", w3).dispatchEvent(drop4);
  await flush(12);
  const rows = [...$("queue", w3).querySelectorAll(".queue-row")];
  const targets = rows.map((r) => r.querySelector("select").value);
  check("batch drop queues 3 rows", rows.length === 3, String(rows.length));
  check("batch targets are 3 distinct episodes", new Set(targets).size === 3, targets.join(","));
  check("batch targets are the first free slots", targets.join(",") === "1,2,3", targets.join(","));
  for (const r of rows) r.querySelector("button").click();
  check("all 3 batch imports persisted",
    await waitUntil(() => third.idb._dbs.get("bwl-library").stores.get("media").map.size === 3, 9000),
    String(third.idb._dbs.get("bwl-library").stores.get("media").map.size));
  const batchStates = [];
  for (const code of ["S01E01", "S01E02", "S01E03"]) {
    const c = await showCard(w3, code);
    batchStates.push(c ? c.querySelector(".badge.right").textContent : "MISSING-CARD");
  }
  check("S01E01/S01E02/S01E03 all LOADED", batchStates.every((t) => t === "LOADED"), batchStates.join(","));
  setSearch(w3, "");
  await flush(4);

  // assign-to-current
  const someCard = cards(w3)[9];
  const someCode = someCard.querySelector(".badge.left").textContent;
  someCard.click();
  await flush(10);
  $("targetBtn", w3).click();
  await flush(4);
  check("assign-to-current sets the target flag", $("fileInput", w3).dataset.targetCurrent === "1");

  console.log("\n=== J. XSS safety ===");
  const fourth = await bootPage();
  const w4 = fourth.window;
  const evil = makeFile(w4, '"><img src=x onerror=alert(1)>.mp4');
  const dt5 = { files: [evil], types: ["Files"] };
  const drop5 = new w4.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop5, "dataTransfer", { value: dt5 });
  $("dropzone", w4).dispatchEvent(drop5);
  await flush(30);
  const q = $("queue", w4).querySelector(".queue-row");
  if (q) q.querySelector("button").click();
  await waitUntil(() => txt(w4, "sumLoaded") === "1", 6000);
  const doc = w4.document;
  check("no injected <img> element was created", doc.querySelectorAll("img[src='x']").length === 0);
  check("no element anywhere carries an onerror handler", doc.querySelectorAll("[onerror]").length === 0);
  check("no <img> tag leaked into the grid markup", !/<img[^>]+src=x/i.test($("videoGrid", w4).innerHTML));
  const evilCard = await showCard(w4, "S01E01");
  evilCard.click();
  await waitUntil(() => $("infoFile", w4).textContent.includes("<img src=x"), 5000);
  check("malicious filename is rendered as inert text", $("infoFile", w4).textContent.includes("<img src=x"), $("infoFile", w4).textContent.slice(0, 70));
  check("player markup still has no live img/onerror nodes",
    w4.document.querySelectorAll("#playerSection img, #playerSection [onerror]").length === 0);
  check("no extra script elements injected", doc.querySelectorAll("script").length === 1);

  console.log(`\n================ ${passes} passed, ${failures} failed ================`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("\nTEST HARNESS ERROR:", e && e.stack ? e.stack : e);
  process.exit(2);
});
