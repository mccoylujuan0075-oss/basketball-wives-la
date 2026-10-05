/**
 * Data-layer tests for the episode library.
 *
 * index.html keeps its pure logic between `/* #region pure-data *\/` and
 * `/* #endregion pure-data *\/` markers. This test lifts that block out and
 * runs it under Node, so the shipped page and the tested code are the same
 * code — no duplication, no build step, no network.
 *
 *   npm run test:data
 */
const fs = require("fs");
const path = require("path");

const HTML_PATH = process.argv[2] || path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

let passes = 0;
let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) {
    passes++;
    console.log("PASS  " + name);
  } else {
    failures++;
    console.log("FAIL  " + name + (extra ? "  -> " + extra : ""));
  }
};

const REGION = /\/\* #region pure-data[^\n]*\*\/\n([\s\S]*?)\/\* #endregion pure-data \*\//;
const match = html.match(REGION);
if (!match) {
  console.error("Could not find the #region pure-data block in index.html");
  process.exit(2);
}

const EXPORTS = [
  "buildLibrary", "mulberry32", "hashString", "clamp",
  "fmtBytes", "fmtTime", "fmtRuntime", "toDateKey", "fmtDate",
  "escapeHtml", "guessEpisodeFromName",
  "SEASONS", "CAST_POOL", "allVideos", "byId",
];

let lib;
try {
  // eslint-disable-next-line no-new-func
  lib = new Function(`${match[1]}\nreturn { ${EXPORTS.join(", ")} };`)();
} catch (err) {
  console.error("pure-data region failed to evaluate:", err.message);
  process.exit(2);
}

const v = lib.allVideos;

console.log("=== Library shape ===");
check("library has exactly 100 episodes", v.length === 100, `got ${v.length}`);
const counts = {};
v.forEach((e) => (counts[e.season] = (counts[e.season] || 0) + 1));
check(
  "per-season counts match the SEASONS plan",
  lib.SEASONS.every((s) => counts[s.season] === s.episodes),
  JSON.stringify(counts)
);
check("SEASONS plan itself sums to 100", lib.SEASONS.reduce((a, s) => a + s.episodes, 0) === 100);
check("six seasons, 1-6", Object.keys(counts).sort().join(",") === "1,2,3,4,5,6");
check("ids are contiguous 1..100", v.every((e, i) => e.id === i + 1));
check("byId map covers every episode", lib.byId.size === 100 && v.every((e) => lib.byId.get(e.id) === e));
check("episode numbers restart each season", lib.SEASONS.every((s) => {
  const eps = v.filter((e) => e.season === s.season).map((e) => e.episode);
  return eps.join(",") === Array.from({ length: s.episodes }, (_, i) => i + 1).join(",");
}));

console.log("\n=== Episode codes ===");
check("codes are unique", new Set(v.map((e) => e.code)).size === 100);
check("codes are zero-padded SxxExx", v.every((e) => /^S\d{2}E\d{2}$/.test(e.code)));
check("code agrees with season/episode fields", v.every(
  (e) => e.code === `S${String(e.season).padStart(2, "0")}E${String(e.episode).padStart(2, "0")}`
));
check("first episode is S01E01", v[0].code === "S01E01");
check("last episode is S06E15", v[99].code === "S06E15");

console.log("\n=== Metadata quality ===");
check("every title is non-trivial", v.every((e) => typeof e.title === "string" && e.title.length > 5));
check("no empty descriptions", v.every((e) => e.description && e.description.length > 40));
check("descriptions are not all identical", new Set(v.map((e) => e.description)).size > 50,
  `${new Set(v.map((e) => e.description)).size} unique`);
check("titles are not all identical", new Set(v.map((e) => e.title)).size > 50,
  `${new Set(v.map((e) => e.title)).size} unique`);
check("every episode has at least 3 cast members", v.every((e) => Array.isArray(e.cast) && e.cast.length >= 3));
check("cast comes from the known pool", v.every((e) => e.cast.every((c) => lib.CAST_POOL.includes(c))));
check("no duplicate cast within an episode", v.every((e) => new Set(e.cast).size === e.cast.length));
check("runtime is a plausible broadcast slot", v.every((e) => e.runtime >= 41 && e.runtime <= 44));
check("views are in a sane range", v.every((e) => e.views >= 45000 && e.views <= 945000));
check("keywords present for search", v.every((e) => Array.isArray(e.keywords) && e.keywords.length >= 3));

console.log("\n=== Air dates ===");
check("every airDate parses", v.every((e) => !isNaN(Date.parse(e.airDate))));
check("every airKey is ISO-shaped", v.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.airKey)));
check("airKey matches airDate", v.every((e) => e.airKey === lib.toDateKey(new Date(e.airDate))));
let ascending = true;
for (let s = 1; s <= 6; s++) {
  const seq = v.filter((e) => e.season === s).map((e) => Date.parse(e.airDate));
  for (let i = 1; i < seq.length; i++) if (seq[i] <= seq[i - 1]) ascending = false;
}
check("air dates strictly ascend within each season", ascending);
const premieres = {};
v.forEach((e) => { if (!premieres[e.season]) premieres[e.season] = new Date(e.airDate).getFullYear(); });
check("season premieres land in 2011-2016", Object.values(premieres).join(",") === "2011,2012,2013,2014,2015,2016",
  JSON.stringify(premieres));
check("each season airs in its own year", v.every((e) => new Date(e.airDate).getFullYear() === premieres[e.season]));
check("weekly cadence: gaps are 7 or 14 days", (() => {
  for (let s = 1; s <= 6; s++) {
    const seq = v.filter((e) => e.season === s).map((e) => Date.parse(e.airDate));
    for (let i = 1; i < seq.length; i++) {
      const days = Math.round((seq[i] - seq[i - 1]) / 86400000);
      if (days !== 7 && days !== 14) return false;
    }
  }
  return true;
})());

console.log("\n=== Determinism (was randomised per reload before) ===");
check("two independent builds are byte-identical", JSON.stringify(lib.buildLibrary()) === JSON.stringify(lib.buildLibrary()));
check("a rebuilt library matches the shipped one", JSON.stringify(lib.buildLibrary()) === JSON.stringify(v));
check("PRNG is seeded and repeatable", lib.mulberry32(42)() === lib.mulberry32(42)());
check("PRNG differs per seed", lib.mulberry32(42)() !== lib.mulberry32(43)());
check("PRNG stays within [0,1)", (() => {
  const rng = lib.mulberry32(7);
  for (let i = 0; i < 10000; i++) { const x = rng(); if (!(x >= 0 && x < 1)) return false; }
  return true;
})());

console.log("\n=== Filename -> episode matching ===");
const g = lib.guessEpisodeFromName;
const idOf = (s, e) => v.find((x) => x.season === s && x.episode === e).id;
check("S02E05.mp4", g("S02E05.mp4") === idOf(2, 5), `got ${g("S02E05.mp4")}`);
check("lowercase s6e15_finale.mp4", g("s6e15_finale.mp4") === 100, `got ${g("s6e15_finale.mp4")}`);
check("dotted show.3x12.hdtv.mp4", g("show.3x12.hdtv.mp4") === idOf(3, 12));
check("spaced 'Season 4 Episode 9.mp4'", g("Season 4 Episode 9.mp4") === idOf(4, 9));
check("separator S01-E01", g("S01-E01 pilot.mp4") === idOf(1, 1));
check("separator S01_E02", g("S01_E02.mp4") === idOf(1, 2));
check("uppercase SHOW.S05E20.720p", g("SHOW.S05E20.720p.mp4") === idOf(5, 20));
check("dotted S02.E05", g("S02.E05.mp4") === idOf(2, 5));
check("spaced s1 e3", g("s1 e3.mkv") === idOf(1, 3));
check("embedded in a release name", g("BWL.S04E18.1080p.mp4") === idOf(4, 18));
check("bare S03.07 form", g("S03.07_finale.mp4") === idOf(3, 7));
check("bare 4x17 form", g("4x17.mp4") === idOf(4, 17));
check("unmatched filename -> null", g("my_home_video.mp4") === null);
check("plain word filename -> null", g("trailer.mp4") === null);
check("reversed word order -> null", g("ep 12 season 2.mp4") === null);
check("out-of-range season -> null", g("S09E99.mp4") === null);
check("out-of-range episode -> null", g("S01E99.mp4") === null);
check("empty string -> null", g("") === null);

console.log("\n=== Formatting helpers ===");
check("fmtBytes(0) -> 0 MB", lib.fmtBytes(0) === "0 MB", lib.fmtBytes(0));
check("fmtBytes bytes", lib.fmtBytes(512) === "512 B", lib.fmtBytes(512));
check("fmtBytes KB", lib.fmtBytes(2048) === "2.0 KB", lib.fmtBytes(2048));
check("fmtBytes MB", lib.fmtBytes(5 * 1024 * 1024) === "5.0 MB", lib.fmtBytes(5 * 1024 * 1024));
check("fmtBytes GB", lib.fmtBytes(2.5 * 1024 ** 3) === "2.5 GB", lib.fmtBytes(2.5 * 1024 ** 3));
check("fmtBytes rounds >=100", lib.fmtBytes(150 * 1024 * 1024) === "150 MB", lib.fmtBytes(150 * 1024 * 1024));
check("fmtTime(0)", lib.fmtTime(0) === "0:00", lib.fmtTime(0));
check("fmtTime(NaN)", lib.fmtTime(NaN) === "0:00", lib.fmtTime(NaN));
check("fmtTime(59)", lib.fmtTime(59) === "0:59", lib.fmtTime(59));
check("fmtTime(3725)", lib.fmtTime(3725) === "1:02:05", lib.fmtTime(3725));
check("fmtTime(2400)", lib.fmtTime(2400) === "40:00", lib.fmtTime(2400));
check("fmtRuntime(0)", lib.fmtRuntime(0) === "0m", lib.fmtRuntime(0));
check("fmtRuntime(7500)", lib.fmtRuntime(7500) === "2h 5m", lib.fmtRuntime(7500));
check("fmtRuntime(300)", lib.fmtRuntime(300) === "5m", lib.fmtRuntime(300));
check("clamp bounds", lib.clamp(5, 0, 3) === 3 && lib.clamp(-5, 0, 3) === 0 && lib.clamp(2, 0, 3) === 2);
check("hashString is stable", lib.hashString("S01E01") === lib.hashString("S01E01"));
check("hashString varies", lib.hashString("S01E01") !== lib.hashString("S01E02"));
check("hashString returns unsigned int", Number.isInteger(lib.hashString("x")) && lib.hashString("x") >= 0);

console.log("\n=== Escaping (XSS surface) ===");
check("escapeHtml neutralises < > & \" '", lib.escapeHtml(`<img src=x onerror="a&b">`) ===
  "&lt;img src=x onerror=&quot;a&amp;b&quot;&gt;", lib.escapeHtml(`<img src=x onerror="a&b">`));
check("escapeHtml leaves plain text alone", lib.escapeHtml("Season 1 Episode 1") === "Season 1 Episode 1");
check("escapeHtml handles apostrophes", lib.escapeHtml("Shaunie O'Neal") === "Shaunie O&#39;Neal");
check("cast names with apostrophes survive round-trip", v.some((e) => e.cast.includes("Shaunie O'Neal")));

console.log(`\n================ ${passes} passed, ${failures} failed ================`);
process.exit(failures ? 1 : 0);
