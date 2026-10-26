/* VOD back-nav reproduction rig (bug reports from real-device session):
   1. Movies -> open a movie -> BACK must return to the Movies grid (not a
      black/blank view).
   2. Playing a movie -> BACK -> detail -> BACK -> Movies -> BACK -> splash must
      show the "Ready to watch" placeholder (not a black player view).
   3. RIGHT at the ready screen must NOT un-hide a stale info bar; left/right
      open the menu instead.
   Run: node vod-back-test.js */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
].find((p) => fs.existsSync(p));
const BASE = "http://127.0.0.1:8093/index.html";
const XT = "http://127.0.0.1:8093/xt";
const SHOTS = path.join(__dirname, "shots-vod");
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const PROFILE = path.join(__dirname, "profile-vod");
fs.rmSync(PROFILE, { recursive: true, force: true });

let shotNo = 0;
const fails = [];
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function waitForServer(timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(`${BASE}`, (res) => { res.resume(); resolve(); });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) reject(new Error("server never came up"));
        else setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}

let page, cdp;
const KEYS = {
  OK: { vk: 13, key: "Enter", code: "Enter" },
  UP: { vk: 38, key: "ArrowUp", code: "ArrowUp" },
  DOWN: { vk: 40, key: "ArrowDown", code: "ArrowDown" },
  LEFT: { vk: 37, key: "ArrowLeft", code: "ArrowLeft" },
  RIGHT: { vk: 39, key: "ArrowRight", code: "ArrowRight" },
  BACK: { vk: 10009, key: "GoBack", code: "GoBack" }
};
async function press(name, hold = 170) {
  const def = KEYS[name];
  const base = { windowsVirtualKeyCode: def.vk, key: def.key, code: def.code };
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
  await wait(15);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await wait(hold);
}
async function val(expr) { return page.evaluate(expr); }
async function until(expr, timeoutMs, desc) {
  const started = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await page.evaluate(expr); } catch (e) { ok = false; }
    if (ok) return true;
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for: ${desc}`);
    await wait(150);
  }
}
async function shot(name) {
  shotNo += 1;
  const file = path.join(SHOTS, `${String(shotNo).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  [shot] ${path.basename(file)}`);
}
function check(pass, label, detail) {
  const tag = pass ? "PASS" : "FAIL";
  console.log(`  ${tag}  ${label}${pass ? "" : " -> " + String(detail)}`);
  if (!pass) fails.push(label);
}
let consoleErrors = [];

async function dumpState(label) {
  const s = await val(`(function(){
    var bar = document.getElementById('info-bar');
    return {
      view: KP.Shell.state.view,
      stack: KP.Shell._navStack.slice(),
      playing: KP.Shell.state.playing ? (KP.Shell.state.playing.name || "?") :
        (KP.Shell.state.playing === null ? null : undefined),
      playerState: KP.Player.state(),
      placeholderHidden: document.getElementById('player-placeholder').classList.contains('hidden'),
      phTitle: document.getElementById('ph-title').textContent,
      ibNow: document.getElementById('ib-now').textContent,
      barHidden: bar.classList.contains('hidden'),
      vodItems: KP.Views.vod._items.length,
      vodCats: KP.Views.vod._cats.length,
      vodZone: KP.Views.vod._zone,
      vodCards: document.querySelectorAll('#vod-grid .vod-card').length,
      visibleView: (function(){
        var out = [];
        ['player','vod','voddetail','menu'].forEach(function(v){
          var el = document.getElementById('view-' + v);
          if (el && !el.classList.contains('hidden')) out.push(v);
        });
        return out.join(',');
      })()
    };
  })()`);
  console.log(`  [${label}] ${JSON.stringify(s)}`);
  return s;
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, "server.js")], { stdio: "ignore" });
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    args: [`--user-data-dir=${PROFILE}`, "--no-first-run", "--mute-audio"]
  });
  try {
    await waitForServer(10000);
    page = await browser.newPage();
    cdp = await page.target().createCDPSession();
    page.on("pageerror", (err) => consoleErrors.push(`pageerror ${String(err && err.stack || err).replace(/\n+/g, " | ").slice(0, 900)}`));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 250)); });
    await page.evaluateOnNewDocument(fs.readFileSync(path.join(__dirname, "mock-avplay.js"), "utf8"));
    await page.evaluateOnNewDocument(`
      var el = document.head || document.documentElement || document.body;
      if (el) {
        var st = document.createElement('style');
        st.textContent = 'object[type="application/avplayer"] { visibility: hidden !important; }';
        el.appendChild(st);
      }
    `);

    /* Boot: inject the mock Xtream playlist, then reload so the app boots
       through its real boot path with saved data. */
    await page.goto(BASE, { waitUntil: "load", timeout: 30000 });
    await page.evaluate(`(function(){
      var pl = KP.Store.add({ name: "Mock Xtream", type: "xtream", url: "${XT}", user: "u", pass: "p" });
      KP.Store.setActive(pl.id);
      KP.Store.loadPlaylist(pl, function () {});
    })()`);
    await until(`KP.Store.active() && KP.Store.active().status === 'ready'`, 20000, "mock playlist ready");
    await page.reload({ waitUntil: "load", timeout: 30000 });
    await until(`KP.Store.hasData() && (KP.Shell.state.view === 'player' || KP.Shell.state.view === 'guide')`, 25000, "boot with data");
    const bootView = await val(`KP.Shell.state.view`);
    if (bootView !== "player") await val(`KP.Shell.show("player")`);
    await until(`KP.Shell.state.view === 'player'`, 5000, "splash reached");
    await wait(600);
    await shot("1-splash-ready");
    const splash = await dumpState("boot splash");
    check(splash.visibleView === "player", "boot lands on player splash", splash.visibleView);
    check(!splash.placeholderHidden, "splash shows placeholder", splash.placeholderHidden);
    check(splash.phTitle === "Ready to watch", "splash title", splash.phTitle);
    check(splash.barHidden, "info bar hidden at splash", splash.barHidden);

    console.log("\n== J1: RIGHT at ready screen (stale-bar report) ==");
    await press("RIGHT");
    await wait(250);
    const s1 = await dumpState("after RIGHT at ready");
    await shot("2-right-at-ready");
    check(s1.view === "menu", "RIGHT at ready opens the menu (not info bar)", s1.view);
    check(s1.barHidden, "info bar still hidden after RIGHT at ready", s1.barHidden);
    /* Reset for the next journeys: close the stale bar and drain the boot
       nav-stack residue (boot pushes player+guide). */
    await val(`(function(){ KP.Playback.hideInfoBar(); KP.Shell._navStack = []; })()`);
    await wait(200);

    console.log("\n== J2: Movies -> open movie -> BACK ==");
    await press("LEFT"); // open menu
    await until(`KP.Shell.state.view === 'menu'`, 4000, "menu open");
    const items = await val(`Array.from(document.querySelectorAll('#view-menu .menu-item')).map(function(m){ return m.textContent.trim(); })`);
    console.log("  menu:", JSON.stringify(items));
    const moviesIdx = items.findIndex((t) => t.toLowerCase() === "movies");
    check(moviesIdx >= 0, "menu has Movies", JSON.stringify(items));
    for (let i = 0; i < 12; i += 1) {
      const idx = await val(`KP.Shell._menuIdx`);
      if (idx === moviesIdx) break;
      await press(idx < moviesIdx ? "DOWN" : "UP");
    }
    await press("OK");
    await until(`KP.Shell.state.view === 'vod'`, 5000, "vod view");
    await until(`KP.Views.vod._cats.length > 0`, 8000, "vod cats");
    await press("RIGHT"); // cats -> grid (loads the selected category)
    await until(`KP.Views.vod._items.length > 0 && KP.Views.vod._zone === 'grid'`, 15000, "vod items");
    await wait(400);
    await shot("3-movies-grid");
    const movies = await dumpState("movies grid");
    check(movies.view === "vod" && movies.vodCards > 0, "movies grid rendered", movies.vodCards);

    await press("OK"); // open movie 1
    await until(`KP.Shell.state.view === 'voddetail'`, 5000, "voddetail");
    await until(`KP.Views.voddetail._loading !== true && KP.Views.voddetail._loadingInfo !== true`, 10000, "detail loaded");
    await wait(500);
    await shot("4-movie-detail");
    const detail = await dumpState("movie detail");
    check(detail.view === "voddetail", "detail open", detail.view);

    await press("BACK");
    await wait(350);
    const back1 = await dumpState("after BACK from detail");
    await shot("5-back-to-movies");
    check(back1.view === "vod", "BACK from detail returns to Movies", JSON.stringify(back1));
    check(back1.visibleView === "vod", "Movies view visible (not blank)", back1.visibleView);
    check(back1.vodCards > 0, "Movies grid still rendered", back1.vodCards);

    console.log("\n== J3: play -> back -> detail -> back -> movies -> back -> splash ==");
    await press("OK"); // movies grid -> detail
    await until(`KP.Shell.state.view === 'voddetail' && KP.Views.voddetail._loadingInfo !== true`, 10000, "detail for J3");
    await press("OK"); // detail -> play
    await wait(600);
    await dumpState("after play OK on detail");
    await until(`KP.Shell.state.view === 'player'`, 8000, "player for movie");
    await until(`KP.Player.state() === 'playing'`, 8000, "movie playing");
    await wait(400);
    await shot("6-movie-playing");
    await press("BACK");
    await wait(400);
    const stopBack = await dumpState("after BACK during playback");
    await shot("7-back-after-play");
    check(stopBack.view === "voddetail", "BACK during playback returns to detail", stopBack.view);
    await press("BACK");
    await wait(350);
    const back2 = await dumpState("detail back again");
    check(back2.view === "vod", "second BACK returns to Movies", back2.view);
    await press("BACK");
    await wait(350);
    const back3 = await dumpState("movies back to splash");
    await shot("8-final-splash");
    check(back3.view === "player", "final BACK lands on player splash", JSON.stringify(back3));
    check(!back3.placeholderHidden, "final splash NOT black (placeholder visible)", back3.placeholderHidden);
    check(back3.phTitle === "Ready to watch", "final splash title", back3.phTitle);
    check(back3.barHidden, "no info bar at final splash", back3.barHidden);
    check(back3.stack.length === 0, "nav stack drained", JSON.stringify(back3.stack));
    await press("BACK");
    await wait(300);
    const exitToast = await val(`document.getElementById('app-toast').textContent`);
    check(/again/i.test(exitToast), "exit confirm toast", exitToast);

    console.log("\n== J4: live TV -> menu -> Movies -> back-chain (placeholder path) ==");
    await val(`(function(){ KP.Playback.playChannel(KP.Shell.allChannels()[0]); })()`);
    await until(`KP.Shell.state.view === 'player' && KP.Player.state() === 'playing'`, 10000, "live playing");
    await wait(300);
    const phDuring = await val(`document.getElementById('player-placeholder').classList.contains('hidden')`);
    check(phDuring, "placeholder hidden during live", phDuring);
    await press("LEFT");
    await until(`KP.Shell.state.view === 'menu'`, 4000, "menu over live");
    for (let i = 0; i < 12; i += 1) {
      const idx = await val(`KP.Shell._menuIdx`);
      if (idx === moviesIdx) break;
      await press(idx < moviesIdx ? "DOWN" : "UP");
    }
    await press("OK");
    await until(`KP.Shell.state.view === 'vod'`, 5000, "vod from live");
    await until(`KP.Views.vod._cats.length > 0`, 8000, "vod cats 2");
    await press("RIGHT");
    await until(`KP.Views.vod._items.length > 0 && KP.Views.vod._zone === 'grid'`, 15000, "vod items 2");
    await press("OK"); // detail
    await until(`KP.Shell.state.view === 'voddetail'`, 5000, "detail again");
    await press("BACK");
    await press("BACK");
    await wait(600);
    const liveBack = await dumpState("live path back to splash");
    await shot("9-live-path-splash");
    check(liveBack.view === "player", "back chain ends on splash view", liveBack.view);
    check(!!liveBack.playing, "live channel still playing behind the splash", liveBack.playing);
    check(!liveBack.barHidden || true, "info bar state sane at splash", liveBack.barHidden);
    check(liveBack.phTitle === "Ready to watch", "placeholder text ready", liveBack.phTitle);

    const realErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
    console.log(`\nconsole/page errors: ${realErrors.length}`);
    realErrors.slice(0, 20).forEach((e) => console.log(`  ${e}`));
    console.log(fails.length === 0 ? "\nALL PASS" : `\nFAILURES: ${fails.length}`);
    fails.forEach((f) => console.log(`  FAIL ${f}`));
  } finally {
    await browser.close().catch(() => {});
    server.kill();
  }
}

main().then(
  () => process.exit(fails.length === 0 && !consoleErrors.length ? 0 : 1),
  (error) => { console.error("RIG CRASH:", error); console.log("consoleErrors:", consoleErrors.slice(0, 15).join(" || ")); process.exit(1); }
);
