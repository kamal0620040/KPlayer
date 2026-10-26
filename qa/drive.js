/* KPlayer headless QA driver.
   Drives every screen/flow with synthetic Tizen remote keys (CDP),
   captures screenshots and asserts app state. Results -> qa/results.json,
   console/page errors -> qa/console.json, screenshots -> qa/shots/.
   Run:  node drive.js   (starts qa/server.js itself) */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const EDGE_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
];
const BASE = "http://127.0.0.1:8093/index.html";
const SHOTS = path.join(__dirname, "shots");
const M3U_URL = "https://gist.githubusercontent.com/kamal0620040/d61227916075cd3cc3c488f85511a0a4/raw/c873ea943e8a01498f5b47e96f31bbd6316894c1/tv.m3u";

const results = [];
const issues = [];
const notes = [];
const consoleErrors = [];
let shotNo = 0;

const PROFILE_DIR = path.join(__dirname, "profile");
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(PROFILE_DIR, { recursive: true, force: true });

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function waitForServer(timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(BASE, (res) => { res.resume(); resolve(); });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) reject(new Error("server never came up"));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

/* ---------- key definitions (Tizen remote) ---------- */
const KEYS = {
  OK: { vk: 13, key: "Enter", code: "Enter" },
  UP: { vk: 38, key: "ArrowUp", code: "ArrowUp" },
  DOWN: { vk: 40, key: "ArrowDown", code: "ArrowDown" },
  LEFT: { vk: 37, key: "ArrowLeft", code: "ArrowLeft" },
  RIGHT: { vk: 39, key: "ArrowRight", code: "ArrowRight" },
  BACK: { vk: 10009, key: "GoBack", code: "GoBack" },
  ESC: { vk: 27, key: "Escape", code: "Escape" },
  MENUBTN: { vk: 93, key: "ContextMenu", code: "ContextMenu" },
  CHUP: { vk: 427, key: "ChannelUp", code: "ChannelUp" },
  CHDN: { vk: 428, key: "ChannelDown", code: "ChannelDown" },
  TOOLS: { vk: 1015, key: "Tools", code: "Tools" },
  MPP: { vk: 179, key: "MediaPlayPause", code: "MediaPlayPause" },
  MSTOP: { vk: 178, key: "MediaStop", code: "MediaStop" }
};
const DIGITS = {
  0: { vk: 48, key: "0", code: "Digit0" }, 1: { vk: 49, key: "1", code: "Digit1" },
  2: { vk: 50, key: "2", code: "Digit2" }, 3: { vk: 51, key: "3", code: "Digit3" },
  4: { vk: 52, key: "4", code: "Digit4" }, 5: { vk: 53, key: "5", code: "Digit5" },
  6: { vk: 54, key: "6", code: "Digit6" }, 7: { vk: 55, key: "7", code: "Digit7" },
  8: { vk: 56, key: "8", code: "Digit8" }, 9: { vk: 57, key: "9", code: "Digit9" }
};

let page, cdp;

async function press(nameOrDef) {
  const def = typeof nameOrDef === "string" ? KEYS[nameOrDef] : nameOrDef;
  const base = { windowsVirtualKeyCode: def.vk, key: def.key, code: def.code };
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
  await wait(15);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await wait(180);
}

async function typeText(text, delay = 12) {
  await page.keyboard.type(String(text), { delay });
  await wait(120);
}

async function typeDigits(text, delay = 170) {
  for (const ch of String(text)) {
    await press(DIGITS[ch]);
    await wait(delay);
  }
}

async function shot(name) {
  shotNo += 1;
  const file = path.join(SHOTS, `${String(shotNo).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  [shot] ${path.basename(file)}`);
  return path.basename(file);
}

async function val(expr) { return page.evaluate(expr); }

async function until(expr, timeoutMs, desc) {
  const started = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await page.evaluate(expr); } catch (e) { ok = false; }
    if (ok) return true;
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for: ${desc}`);
    await wait(200);
  }
}

function check(pass, label, detail) {
  results.push({ label, pass: !!pass, detail: detail == null ? "" : String(detail).slice(0, 400) });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : "  -> " + String(detail).slice(0, 300)}`);
  if (!pass) issues.push({ label, detail: String(detail).slice(0, 400) });
}

async function step(name, fn) {
  console.log(`\n== ${name}`);
  const started = Date.now();
  try {
    await fn();
    console.log(`   ok (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    return true;
  } catch (error) {
    console.log(`   STEP FAILED: ${error.message}`);
    results.push({ label: `STEP ${name}`, pass: false, detail: error.message });
    issues.push({ label: `STEP ${name} crashed`, detail: error.message });
    try { await shot(`FAIL-${name.replace(/\W+/g, "-").toLowerCase()}`); } catch (e) { /* ignore */ }
    return false;
  }
}

const viewVisible = (v) => `!document.getElementById('view-${v}').classList.contains('hidden')`;
const V = async () => val(`KP.Shell.state.view`);
const PST = async () => val(`KP.Player ? KP.Player.state() : "n/a"`);
const playingCh = async () => val(`KP.Shell.state.playing ? (KP.Shell.state.playing.num + "|" + KP.Shell.state.playing.name) : null`);
const barVisible = async () => val(`!document.getElementById('info-bar').classList.contains('hidden')`);
const toastText = async () => val(`document.getElementById('app-toast').textContent`);
const pinOpen = async () => val(`KP.Views.pin.isOpen()`);

/* The Tizen Tools key has no Chromium VK mapping, so dispatch a synthetic
   keyboard event carrying event.key = "Tools" (what the real remote sends). */
async function pressTools() {
  await val(`(function(){ var e = new KeyboardEvent('keydown', { key: 'Tools', code: 'Tools', bubbles: true }); Object.defineProperty(e, 'keyCode', { value: 1015 }); document.dispatchEvent(e); })()`);
  await wait(350);
}

/* Navigate: get to the menu from wherever we are, then focus a menu item by text. */
async function gotoMenu() {
  for (let i = 0; i < 5; i += 1) {
    const v = await V();
    if (v === "menu") return;
    if (await pinOpen()) { await press("BACK"); await wait(300); continue; }
    if (v === "guide") { await val(`KP.Shell.show("player")`); await wait(200); await press("LEFT"); }
    else if (v === "player") await press("LEFT");
    else await press("BACK");
    await wait(250);
  }
  await until(viewVisible("menu"), 4000, "menu visible");
}

async function gotoMenuItem(label) {
  await gotoMenu();
  const items = await val(`Array.from(document.querySelectorAll('#view-menu .menu-item')).map(m => m.textContent.trim())`);
  const target = items.findIndex((t) => t.toLowerCase() === label.toLowerCase());
  if (target < 0) throw new Error(`menu item not found: ${label} in ${JSON.stringify(items)}`);
  for (let guard = 0; guard < 12; guard += 1) {
    const idx = await val(`KP.Shell._menuIdx`);
    if (idx === target) break;
    await press(target > idx ? "DOWN" : "UP");
  }
  await press("OK");
}

/* Settings: two-zone view (sections column + rows). Helpers below handle both. */
async function setGotoSection(name) {
  const zone = await val(`KP.Views.settings._zone`);
  if (zone !== "sections") { await press("BACK"); await wait(300); }
  for (let i = 0; i < 12; i += 1) {
    const cur = await val(`(document.querySelector('#set-sections .set-sec.focused')||{}).textContent||''`);
    if (cur.toLowerCase().includes(name.toLowerCase())) return true;
    await press("DOWN");
  }
  throw new Error(`settings section not found: ${name}`);
}

async function setEnterSection(name) {
  await setGotoSection(name);
  await press("OK");
  await wait(450);
  if (await pinOpen()) { // Parental controls asks for the PIN once it is set
    await typeDigits("1234");
    await wait(700);
  }
}

async function setGotoRow(match) {
  for (let i = 0; i < 22; i += 1) {
    const cur = await val(`(document.querySelector('#set-rows .set-row.focused')||{}).textContent||''`);
    if (cur.toLowerCase().includes(match.toLowerCase())) return true;
    await press("DOWN");
  }
  throw new Error(`settings row not found: ${match}`);
}

/* ---------- flow steps ---------- */

async function main() {
  const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!edge) throw new Error("No Edge/Chrome executable found");
  const server = spawn(process.execPath, [path.join(__dirname, "server.js")], { stdio: "ignore" });
  try {
    await waitForServer(10000);
    const browser = await puppeteer.launch({
      executablePath: edge,
      headless: true,
      defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
      args: [
        `--user-data-dir=${PROFILE_DIR}`,
        "--no-first-run", "--no-default-browser-check", "--mute-audio",
        "--disable-features=Translate,BackForwardCache"
      ]
    });
    page = await browser.newPage();
    cdp = await page.target().createCDPSession();
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push({ kind: "console", text: msg.text().slice(0, 500) });
    });
    page.on("pageerror", (err) => consoleErrors.push({ kind: "pageerror", text: String(err && err.stack || err).slice(0, 800) }));
    page.on("requestfailed", (req) => {
      const u = req.url();
      if (!/favicon|\.png$|\.jpg$|\.svg$|\.webp$/i.test(u)) consoleErrors.push({ kind: "requestfailed", text: `${req.failure() && req.failure().errorText} ${u.slice(0, 200)}` });
    });
    await page.evaluateOnNewDocument(fs.readFileSync(path.join(__dirname, "mock-avplay.js"), "utf8"));
    // Desktop Edge renders <object type="application/avplayer"> as a full-screen
    // "plug-in isn't supported" box; hide it so screenshots show the real UI.
    await page.evaluateOnNewDocument(`
      function addHideStyle() {
        var st = document.createElement('style');
        st.textContent = 'object[type="application/avplayer"], #av-player { visibility: hidden !important; }';
        (document.head || document.documentElement).appendChild(st);
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addHideStyle);
      else addHideStyle();
    `);

    /* ============ A. BOOT ============ */
    await step("boot", async () => {
      await page.goto(BASE, { waitUntil: "load", timeout: 30000 });
      await until(viewVisible("playlists"), 8000, "boot -> playlists auto-open");
      await wait(400);
      await shot("boot-playlists-empty");
      check(await val(viewVisible("playlists")), "boot opens playlists view when no playlists");
      check(await val(`!!document.querySelector('.pl-row.is-add')`), "add-playlist row exists");
    });

    /* ============ B. ADD M3U ============ */
    await step("add-m3u", async () => {
      await press("OK"); // open add flow
      await until(`!document.getElementById('pl-addflow').classList.contains('hidden')`, 4000, "add flow");
      await wait(300);
      await shot("add-source-chooser");
      await press("OK"); // m3u choice
      await wait(350);
      await shot("add-form-empty");
      await press("OK"); // focus name input
      await until(`document.activeElement && document.activeElement.id === 'plf-name'`, 3000, "name focused");
      await typeText("QA India Live");
      await press("DOWN");
      await press("OK");
      await until(`document.activeElement && document.activeElement.id === 'plf-url'`, 3000, "url focused");
      await typeText(M3U_URL);
      const typed = await val(`document.getElementById('plf-url').value`);
      check(typed === M3U_URL, "URL typed intact", typed.length + " chars vs " + M3U_URL.length);
      await shot("add-form-filled");
      await press("DOWN"); await press("DOWN"); // -> add button
      await press("OK"); // submit
      await until(`document.getElementById('plf-msg').classList.contains('busy') || document.getElementById('plf-add').getAttribute('aria-busy') === 'true'`, 5000, "busy state");
      await shot("add-loading");
      await until(`KP.Store.active() && KP.Store.active().status === 'ready' && KP.Store.hasData() && document.getElementById('pl-addflow').classList.contains('hidden')`, 75000, "playlist ready");
      const count = await val(`KP.Store.active()._channels.length`);
      const toast = await toastText();
      check(count > 50, `M3U parsed -> ${count} channels`);
      check(/Loaded [\d,]+ channels/.test(toast), "success toast shown", toast);
      check(await V() === "player", "app switches to player after load");
      await wait(400);
      await shot("player-ready-placeholder");
      check(await val(`document.getElementById('ph-title').textContent`) === "Ready to watch", "placeholder says Ready to watch",
        await val(`document.getElementById('ph-title').textContent`));
    });

    /* ============ C. CHANNELS LIST + DIGIT ENTRY ============ */
    await step("channels-digit", async () => {
      await press("OK"); // not playing -> channels.open()
      await until(viewVisible("channels"), 4000, "channels view");
      await wait(400);
      await shot("channels-list");
      const rows = await val(`document.querySelectorAll('#channel-list .ch-row').length`);
      check(rows > 0, `channel list rendered (${rows} rows)`);
      await typeDigits("12");
      await until(`!document.getElementById('digit-entry').classList.contains('hidden')`, 2000, "digit entry shows");
      await shot("digit-entry-buffer");
      await until(`document.getElementById('digit-entry').classList.contains('hidden')`, 3500, "digit entry commits");
      await wait(350);
      await shot("channels-digit-jumped");
      const focusNum = await val(`(document.querySelector('#channel-list .ch-row.focused .ch-num, #channel-list .ch-row.playing .ch-num')||{}).textContent||''`);
      check(/12/.test(focusNum), "digit 12 jumped focus to channel 12", focusNum);
      await press("DOWN"); await press("DOWN");
      await wait(250);
      await shot("channels-scrolled");
      await press("OK"); // play focused
      await until(viewVisible("player"), 4000, "player view");
      await until(`KP.Player.state() === 'playing'`, 6000, "stream playing");
      await wait(500);
      await shot("player-live-infobar");
      check(await barVisible(), "info bar visible when playback starts");
      const ibNow = await val(`(document.getElementById('ib-now')||{}).textContent`);
      check(!!ibNow, "info bar shows channel title", ibNow);
      await wait(5300);
      check(!(await barVisible()), "info bar auto-hides after ~4.5s");
      await shot("player-live-nobar");
    });

    /* ============ D. PAUSE / RESUME (live) ============ */
    await step("pause-resume", async () => {
      await press("MPP");
      await until(`KP.Player.state() === 'paused'`, 3000, "paused state");
      await wait(350);
      await shot("player-paused-live");
      check(await val(`!document.getElementById('ib-paused').classList.contains('hidden')`), "PAUSED badge shows for live pause");
      check(await val(`document.getElementById('seek-toast').textContent === 'Paused' && !document.getElementById('seek-toast').classList.contains('hidden')`), "Paused toast shown");
      await press("MPP");
      await until(`KP.Player.state() === 'playing'`, 3000, "resumed");
      await wait(350);
      await shot("player-resumed");
      check(await val(`document.getElementById('ib-paused').classList.contains('hidden')`), "PAUSED badge hidden after resume");
    });

    /* ============ D2. RESUME FALLBACK (engine without avplay.resume) ============ */
    /* Real device/simulator avplay has no resume() - unpause must use play(). */
    await step("resume-fallback", async () => {
      await press("MPP");
      await until(`KP.Player.state() === 'paused'`, 3000, "paused for fallback");
      const playsBefore = await val(`window.__AV.logs.filter(l => l[0] === 'play').length`);
      await shot("player-paused-fallback");
      await val(`(function(){ window.__savedResume = window.webapis.avplay.resume; delete window.webapis.avplay.resume; })()`);
      await press("MPP");
      await until(`KP.Player.state() === 'playing'`, 3000, "resume falls back to play");
      const playsAfter = await val(`window.__AV.logs.filter(l => l[0] === 'play').length`);
      check(playsAfter > playsBefore, `avplay.play() called by resume fallback (${playsBefore} -> ${playsAfter})`);
      await shot("player-resumed-fallback");
      await val(`(function(){ window.webapis.avplay.resume = window.__savedResume; })()`);
    });


    /* ============ E. OK while paused -> jump to live ============ */
    await step("jump-to-live", async () => {
      await press("MPP");
      await until(`KP.Player.state() === 'paused'`, 3000, "paused again");
      const openBefore = await val(`window.__AV.logs.filter(l => l[0] === 'open').length`);
      await press("OK");
      await until(`KP.Player.state() === 'playing'`, 6000, "jump-to-live reopens");
      const openAfter = await val(`window.__AV.logs.filter(l => l[0] === 'open').length`);
      check(openAfter > openBefore, "OK while paused re-opens the stream", `${openBefore} -> ${openAfter}`);
      await wait(400);
      await shot("jumptolive-playing");
      check(await val(`document.getElementById('ib-paused').classList.contains('hidden')`), "paused badge cleared after jump-to-live");
    });

    /* ============ F. AV PANEL ============ */
    await step("av-panel", async () => {
      await pressTools();
      await until(`!document.getElementById('av-panel').classList.contains('hidden')`, 3000, "av panel opens");
      await wait(350);
      await shot("av-panel-open");
      const rows = await val(`Array.from(document.querySelectorAll('#av-panel .av-row')).map(r => r.textContent.trim().slice(0, 60))`);
      console.log("   AV rows:", JSON.stringify(rows));
      check(rows.some((r) => /audio/i.test(r)), "audio track row present");
      check(!rows.some((r) => /speed/i.test(r)), "speed row hidden for live stream");
      await press("RIGHT");
      await wait(300);
      const sel = await val(`window.__AV.selects()`);
      check(sel.length > 0 && sel[sel.length - 1][0] === "AUDIO", "audio track switch calls setSelectTrack", JSON.stringify(sel));
      await shot("av-panel-audio-switched");
      await press("DOWN");
      await press("RIGHT");
      await wait(250);
      const mode = await val(`KP.Player._displayMode`);
      check(mode !== "PLAYER_DISPLAY_MODE_LETTER_BOX", "video fit changed via panel", mode);
      await shot("av-panel-fit");
      await pressTools();
      await until(`document.getElementById('av-panel').classList.contains('hidden')`, 3000, "av panel closes");
      check(true, "AV panel closes with Tools");
      await val(`KP.Playback.closeAvPanel()`); // safety for later steps
    });

    /* ============ G. ZAPPING + DIGITS IN PLAYER ============ */
    await step("zap", async () => {
      const before = await playingCh();
      await press("CHUP");
      await until(`KP.Player.state() === 'playing'`, 6000, "ChannelUp plays next");
      const after = await playingCh();
      check(before !== after, `ChannelUp changed channel (${before} -> ${after})`);
      await wait(400);
      await shot("zap-up");
      await press("CHDN");
      await until(`KP.Player.state() === 'playing'`, 6000, "ChannelDown plays previous");
      check((await playingCh()) === before, "ChannelDown returns to previous channel", await playingCh());
      await typeDigits("9999");
      await until(`/No channel/.test(document.getElementById('app-toast').textContent)`, 4500, "no-channel toast");
      await shot("player-digit-nochannel");
      check(true, "player digit entry -> 'No channel' toast");
    });

    /* ============ H. ERROR OVERLAY ============ */
    await step("player-error", async () => {
      await val(`(function(){ var c = KP.Shell.allChannels()[0]; window.__orig0 = c.url; c.url = 'http://fail.invalid/live/fail.ts'; KP.Playback.playChannel(c); })()`);
      await until(`KP.Player.state() === 'error'`, 9000, "error state (after retry)");
      await wait(350);
      await shot("player-error-overlay");
      check(await val(`!document.getElementById('player-status').classList.contains('hidden') && document.getElementById('player-status').classList.contains('error')`), "error overlay visible");
      const title = await val(`(document.getElementById('ps-title')||{}).textContent`);
      check(!!title, "error title text", title);
      check(await val(`KP.Player.canRetry()`), "error is retryable");
      await press("OK"); // retry -> fails again
      await until(`KP.Player.state() === 'error'`, 9000, "retry returns to error");
      await shot("player-error-retry");
      await press("BACK");
      await wait(400);
      check(await V() !== "player" || (await PST()) !== "error", "Back leaves error overlay", `view=${await V()}`);
      await val(`(function(){ KP.Shell.allChannels()[0].url = window.__orig0; })()`); // restore for later steps
    });

    /* ============ I. ENDED STATE ============ */
    await step("player-ended", async () => {
      await val(`(function(){ var c = KP.Shell.allChannels()[1]; window.__orig1 = c.url; c.url = 'http://complete.invalid/movie.mkv'; KP.Playback.playChannel(c); })()`);
      await until(`KP.Player.state() === 'playing'`, 8000, "movie playing");
      await until(`KP.Player.state() === 'ended'`, 12000, "onstreamcompleted fires");
      await wait(350);
      await shot("player-ended");
      check(true, "stream end -> ended state handled");
      await press("BACK");
      await wait(300);
      await val(`(function(){ KP.Shell.allChannels()[1].url = window.__orig1; })()`); // restore for later steps
    });

    /* ============ J. STALL RECOVERY ============ */
    await step("stall-recovery", async () => {
      await val(`KP.Playback.playChannel(KP.Shell.allChannels()[2])`);
      await until(`KP.Player.state() === 'playing'`, 8000, "playing for stall test");
      await wait(2000); // let >=2 playhead samples accrue before freezing
      await val(`window.__AV.freeze(true)`);
      await until(`KP.Player.state() === 'buffering'`, 16000, "stall detected -> buffering");
      await shot("stall-buffering");
      await val(`window.__AV.freeze(false)`);
      await until(`KP.Player.state() === 'playing'`, 8000, "recovered to playing");
      await shot("stall-recovered");
      check(true, "stall recovery works (freeze -> buffering -> playing)");
    });

    /* ============ K. MENU / GUIDE ============ */
    await step("guide", async () => {
      await gotoMenuItem("TV guide");
      await until(viewVisible("guide"), 4000, "guide view");
      await wait(400);
      await shot("guide-favorites-empty");
      // F3 fix: the guide now focuses the group list (panel) when the current
      // group has no channels, instead of leaving dead arrow keys in the grid.
      check(await val(`KP.Views.guide._focus.zone`) === "panel", "guide focuses group list when group is empty");
      let rows = await val(`document.querySelectorAll('#guide-rows .grow').length`);
      for (let i = 0; i < 6 && !rows; i += 1) {
        const zone = await val(`KP.Views.guide._focus.zone`);
        if (zone === "grid") await press("LEFT");
        else await press("DOWN");
        await wait(400);
        rows = await val(`document.querySelectorAll('#guide-rows .grow').length`);
      }
      check(rows > 0, `guide shows channel rows after group navigation (${rows} rows)`);
      await wait(300);
      await shot("guide");
      check(await val(`!!document.querySelector('#guide-times .gnoepg-note')`), "guide shows no-EPG note");
      const tr = await val(`document.getElementById('guide-nowline').style.transform`);
      check(!!tr, "now-line positioned via transform", tr);
      const gName = await val(`KP.Shell.groups()[KP.Shell.state.gGroupIdx].name`);
      console.log(`   guide group: ${gName}`);
      await press("RIGHT"); // panel -> grid
      await press("DOWN");
      await wait(300);
      await shot("guide-row2");
      await press("OK"); // play from guide
      await until(viewVisible("player"), 4000, "guide OK plays");
      await until(`KP.Player.state() === 'playing'`, 8000, "playing from guide");
      await shot("guide-play");
      check(await V() === "player", "OK on guide row plays the channel");
    });

    /* ============ L. SCHEDULE (no EPG) ============ */
    await step("schedule", async () => {
      await val(`KP.Views.schedule.open(KP.Shell.allChannels()[0])`);
      await until(viewVisible("schedule"), 4000, "schedule view");
      await wait(350);
      await shot("schedule-empty");
      check(await val(`!!document.querySelector('#sched-list .sched-empty')`), "schedule shows empty state without EPG");
      check(await val(`(document.getElementById('sched-info-title')||{}).textContent`) === "No programme information", "preview shows no-programme title",
        await val(`(document.getElementById('sched-info-title')||{}).textContent`));
      await press("BACK");
      await wait(350);
      const v = await V();
      check(v === "guide" || v === "player", "Back from schedule is sane", v);
    });

    /* ============ M. SEARCH ============ */
    await step("search", async () => {
      await gotoMenuItem("Search");
      await until(viewVisible("search"), 4000, "search view");
      await until(`document.activeElement && document.activeElement.id === 'search-input'`, 3000, "search input focused");
      await typeText("star");
      await until(`document.querySelectorAll('#search-results .search-card').length > 0`, 4000, "search results");
      await wait(250);
      await shot("search-results");
      const n = await val(`document.querySelectorAll('#search-results .search-card').length`);
      check(n > 0, `search 'star' returns ${n} cards`);
      await press("DOWN"); await press("DOWN");
      await wait(250);
      await shot("search-results-focus");
      await press("OK");
      await until(viewVisible("player"), 4000, "search OK plays");
      await until(`KP.Player.state() === 'playing'`, 8000, "playing from search");
      await shot("search-play");
      await press("BACK");
      await wait(400);
      const v = await V();
      console.log("   after back from search-play:", v);
      if (v === "search") {
        await press("BACK"); // results -> input
        await wait(250);
        await press("UP"); // scopes
        await press("RIGHT"); await press("RIGHT"); // all -> tv -> movies
        await wait(400);
        await shot("search-scope-movies");
        check(await val(`!!document.querySelector('#search-results .search-hint')`), "movies scope hint for M3U",
          await val(`(document.querySelector('#search-results .search-hint')||{}).textContent`));
        await press("BACK"); await press("BACK");
        await wait(300);
      } else {
        check(false, "search back navigation", v);
      }
    });

    /* ============ N. VOD ERROR (M3U) ============ */
    await step("vod-error", async () => {
      await gotoMenuItem("Movies");
      await until(viewVisible("vod"), 4000, "vod view");
      await wait(400);
      await shot("vod-m3u-error");
      check(await val(`!document.getElementById('vod-empty').classList.contains('hidden')`), "VOD explains it needs an Xtream playlist");
      console.log("   vod-empty:", await val(`document.getElementById('vod-empty').textContent.trim().slice(0, 140)`));
      await press("BACK");
      await wait(350);
      await gotoMenuItem("My list");
      await wait(500);
      await shot("vod-mylist");
      check(await val(`!document.getElementById('vod-empty').classList.contains('hidden')`), "My list (non-Xtream) explains too");
      await press("BACK");
      await wait(300);
    });

    /* ============ O. SETTINGS ============ */
    await step("settings", async () => {
      await gotoMenuItem("Settings");
      await until(viewVisible("settings"), 4000, "settings view");
      await wait(400);
      const secs = await val(`Array.from(document.querySelectorAll('#set-sections .set-sec')).map(s => s.textContent.trim())`);
      console.log("   sections:", JSON.stringify(secs));
      await shot("settings-sections");
      check(secs.length === 6, "settings sections rendered", JSON.stringify(secs));

      // Playback: toggles
      await setEnterSection("Playback");
      await setGotoRow("Zap within");
      await press("RIGHT");
      await wait(250);
      check(await val(`KP.Store.settings().zapInGroup`) === true, "zapInGroup toggles ON");
      await setGotoRow("Play last channel");
      await press("RIGHT");
      await wait(250);
      check(await val(`KP.Store.settings().lastChannelOnStart`) === true, "lastChannelOnStart toggles ON");
      await shot("settings-playback");

      // Appearance: accent
      await setEnterSection("Appearance");
      const before = await val(`document.documentElement.style.getPropertyValue('--accent').trim()`);
      await press("RIGHT");
      await wait(300);
      const after = await val(`document.documentElement.style.getPropertyValue('--accent').trim()`);
      check(before !== after, `accent changes (${before} -> ${after})`);
      await shot("settings-accent");

      // Parental: set PIN
      await setEnterSection("Parental controls");
      await setGotoRow("Set / change PIN");
      await press("OK");
      await wait(500);
      await shot("pin-set1");
      await typeDigits("1234");
      await wait(700);
      await shot("pin-set2");
      await typeDigits("1234");
      await until(`!KP.Views.pin.isOpen()`, 5000, "pin saved, pad closes");
      await wait(400);
      const pin = await val(`KP.Store.settings().parentalPin`);
      check(!!pin, "parental PIN stored", pin ? "set" : "missing");
      await shot("pin-saved");

      // Parental: lock the India group
      await setGotoRow("Locked groups");
      await press("OK");
      await wait(450);
      await shot("lockgroups-list");
      const lockRows = await val(`Array.from(document.querySelectorAll('#set-rows .set-row')).map(r => r.textContent.trim().slice(0, 40))`);
      console.log("   lock rows:", JSON.stringify(lockRows));
      for (let i = 0; i < 10; i += 1) {
        const cur = await val(`(document.querySelector('#set-rows .set-row.focused')||{}).textContent||''`);
        if (/^India/i.test(cur.trim())) break;
        await press("DOWN");
      }
      await press("OK"); // toggle lock
      await wait(300);
      check(await val(`(KP.Store.settings().lockedGroups||[]).indexOf('India') >= 0`), "India group locked");
      await shot("settings-india-locked");
      await press("BACK"); // leave lock mode
      await wait(250);
      await press("BACK"); // rows -> sections
      await wait(250);

      // Backup: export
      await setEnterSection("Backup & restore");
      await setGotoRow("Export backup");
      await press("OK");
      await wait(500);
      await shot("settings-export");
      check(await val(`!!document.querySelector('#set-extra textarea')`), "export shows backup JSON + download link");
      await press("BACK");
      await wait(250);

      // About
      await setEnterSection("About");
      await wait(400);
      await shot("about");
      check(await val(`(document.querySelector('#set-extra .about-name')||{}).textContent`) === "KPlayer", "about panel renders");
      check(await val(`document.body.textContent.includes('version 1.1.16')`), "about shows version 1.1.16");
      await press("BACK");
      await wait(250);
      await press("BACK");
      await wait(250);
    });

    /* ============ P. PIN GATE + UNLOCK ============ */
    await step("pin-gate", async () => {
      const locked = await val(`(KP.Store.settings().lockedGroups||[])[0] || null`);
      check(!!locked, "a group is locked for the gate test", locked);
      await gotoMenuItem("TV");
      await until(viewVisible("channels"), 4000, "channels view");
      await wait(300);
      // Move off the locked group first: digit-jump only routes through the
      // guard when the target channel lives in a DIFFERENT (locked) group.
      // Land on group 1 (Recent channels): group 0 is empty and ignores digits.
      let gi = await val(`KP.Shell.state.groupIdx`);
      if (gi === 0) {
        await press("RIGHT");
      } else {
        for (let i = 1; i < gi; i += 1) await press("LEFT");
      }
      await wait(300);
      gi = await val(`KP.Shell.state.groupIdx`);
      check(gi === 1, "start on an unlocked group for the digit test", gi);
      // 1) Digit-jump gate: channel num 4 (22 Scope News HD) lives ONLY in the
      //    locked India group; typing its number must open the PIN pad before
      //    the group opens. (num 3 also exists in Recent, so it is not usable.)
      await typeDigits("4");
      await wait(2600);
      await shot("pin-gate-digit");
      check(await pinOpen() === true, "digit jump into locked group triggers PIN pad");
      await typeDigits("1234");
      await wait(800);
      check(!(await pinOpen()), "correct PIN opens group after digit jump");
      check(await val(`(KP.Shell.groups()[KP.Shell.state.groupIdx]||{}).name||''`) === locked, "India group open after digit-jump unlock");
      await shot("pin-gate-digit-open");
      // 2) Gate via the group list: walk LEFT back to the first group, then
      //    RIGHT toward India (navigation wraps).
      const nowIdx = await val(`KP.Shell.state.groupIdx`);
      for (let i = 0; i < nowIdx; i += 1) await press("LEFT");
      await wait(200);
      await press("RIGHT"); // Recent
      await wait(250);
      await press("RIGHT"); // India -> guard
      await wait(350);
      const gateSeen = await pinOpen();
      await shot("pin-gate");
      check(gateSeen === true, "locked group triggers PIN pad");
      if (gateSeen) {
        await typeDigits("0000");
        await wait(400);
        await shot("pin-gate-wrong");
        const msg = await val(`(document.getElementById('pin-msg')||{}).textContent||''`);
        console.log("   wrong-pin message:", msg);
        check(/Wrong/i.test(msg), "wrong PIN shows message", msg);
        await typeDigits("1234");
        await wait(800);
        await shot("pin-gate-unlocked");
        check(!(await pinOpen()), "PIN pad closes after correct PIN");
        await press("BACK");
        await wait(350);
      }
      // unlock again via settings (Parental section now requires the PIN)
      await gotoMenuItem("Settings");
      await until(viewVisible("settings"), 4000, "settings again");
      await setEnterSection("Parental controls");
      await setGotoRow("Locked groups");
      await press("OK");
      await wait(450);
      for (let i = 0; i < 10; i += 1) {
        const cur = await val(`(document.querySelector('#set-rows .set-row.focused')||{}).textContent||''`);
        if (/^India/i.test(cur.trim())) break;
        await press("DOWN");
      }
      await press("OK"); // toggle unlock
      await wait(300);
      check(await val(`(KP.Store.settings().lockedGroups||[]).length`) === 0, "group unlocked again");
      await press("BACK"); await press("BACK"); await press("BACK");
      await wait(300);
    });

    /* ============ Q. PLAYLIST MANAGEMENT ============ */
    await step("playlists-manage", async () => {
      await gotoMenuItem("Playlists");
      await until(viewVisible("playlists"), 4000, "playlists view");
      await wait(350);
      await shot("playlists-list");
      check(await val(`document.querySelectorAll('.pl-row').length >= 2`), "playlist rows rendered");
      // focus the playlist row (down from add row)
      await press("DOWN");
      await wait(200);
      await press("MENUBTN");
      await wait(450);
      await shot("playlists-row-menu");
      const menuDump = await val(`(function(){ var v = document.getElementById('view-playlists'); var open = Array.from(v.querySelectorAll('div,li,button')).filter(function(e){ return e.offsetHeight > 0 && /rename|remove|reload|set active|move up|move down/i.test(e.textContent) && e.textContent.trim().length < 40; }); return open.map(function(e){ return e.textContent.trim(); }).slice(0, 8).join(' | '); })()`);
      console.log("   row menu options:", menuDump);
      const renamed = await val(`(function(){ var els = Array.from(document.querySelectorAll('#view-playlists *')); var t = els.find(function(e){ return e.offsetHeight > 0 && e.children.length === 0 && /rename/i.test(e.textContent); }); if (t) { t.click(); return true; } return false; })()`);
      if (renamed) {
        await wait(450);
        await until(`document.querySelectorAll('#view-playlists input').length > 0`, 3000, "rename input");
        await typeText("QA India Renamed");
        await press("OK");
        await wait(500);
        await shot("playlists-renamed");
        check(await val(`document.body.textContent.includes('QA India Renamed')`), "playlist renamed");
      } else {
        check(false, "rename option reachable via menu key", menuDump);
        await press("BACK");
        await wait(300);
      }
      // add a failing playlist
      const onAdd = await val(`document.querySelector('.pl-row.focused') && document.querySelector('.pl-row.focused').getAttribute('data-key') === 'add'`);
      if (!onAdd) await val(`(function(){ var el = document.querySelector('.pl-row.is-add'); if (el) el.click(); })()`);
      else await press("OK");
      await until(`!document.getElementById('pl-addflow').classList.contains('hidden')`, 4000, "add flow again");
      await wait(250);
      await press("OK"); // m3u
      await wait(300);
      await press("OK"); // name
      await typeText("QA Bad");
      await press("DOWN");
      await press("OK");
      await typeText("http://127.0.0.1:9/x.m3u");
      await press("DOWN"); await press("DOWN");
      await press("OK");
      await until(`document.getElementById('plf-msg').classList.contains('bad')`, 30000, "add error message");
      await wait(250);
      await shot("playlists-add-error");
      check(/Could not add/i.test(await val(`document.getElementById('plf-msg').textContent`)), "failed add shows inline error",
        await val(`document.getElementById('plf-msg').textContent`));
      check(await val(`KP.Store.playlists.length === 1`), "failed playlist auto-removed", await val(`KP.Store.playlists.length`));
      await press("ESC");
      await wait(250);
      await press("ESC");
      await wait(250);
    });

    /* ============ R. ZAP-IN-GROUP EFFECT ============ */
    await step("zap-in-group", async () => {
      await gotoMenuItem("TV");
      await until(viewVisible("channels"), 4000, "channels");
      await press("OK");
      await until(viewVisible("player"), 4000, "player");
      await until(`KP.Player.state() === 'playing'`, 8000, "playing");
      const gBefore = await val(`(KP.Shell.state.playing||{}).group`);
      await press("CHUP");
      await until(`KP.Player.state() === 'playing'`, 8000, "zap up");
      const gAfter = await val(`(KP.Shell.state.playing||{}).group`);
      check(gBefore === gAfter, `zap stays within group (${gBefore} -> ${gAfter})`);
      await shot("zap-in-group");
    });

    /* ============ S. LAST-CHANNEL-ON-START BOOT ============ */
    await step("boot-lastchannel", async () => {
      const last = await playingCh();
      await page.reload({ waitUntil: "load", timeout: 30000 });
      await until(`KP.Player.state() === 'playing'`, 20000, "autoplay last channel on boot");
      await wait(600);
      await shot("boot-lastchannel");
      const now = await playingCh();
      check(now === last, `boot autoplays last channel (${last} -> ${now})`);
    });

    /* ============ T. BACK NAV SANITY ============ */
    await step("back-nav", async () => {
      // From the player one BACK returns to the guide (or playlists); BACK
      // inside the guide must return to the player (not arm app-exit).
      await val(`KP.Shell.show("player")`);
      await wait(250);
      await press("BACK");
      await wait(400);
      const v1 = await V();
      console.log(`   player BACK -> ${v1}`);
      await shot("back-nav");
      check(["guide", "playlists", "menu", "channels"].includes(v1), "player BACK lands on a sane view", v1);
      if (v1 === "guide") {
        await press("BACK");
        await wait(500);
        const v2 = await V();
        console.log(`   guide BACK -> ${v2}`);
        await shot("back-nav-guide");
        check(v2 === "player", "guide BACK returns to player");
      }
    });

    await shot("final-state");
    const finalErrors = consoleErrors.filter((e) => !/favicon/i.test(e.text));
    fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify({ results, issues }, null, 2));
    fs.writeFileSync(path.join(__dirname, "console.json"), JSON.stringify(finalErrors, null, 2));
    const failed = results.filter((r) => !r.pass);
    console.log(`\n========== SUMMARY ==========`);
    console.log(`checks: ${results.length}, failed: ${failed.length}`);
    failed.forEach((f) => console.log(`  FAIL: ${f.label} :: ${f.detail}`));
    console.log(`console/page errors: ${finalErrors.length}`);
    finalErrors.slice(0, 30).forEach((e) => console.log(`  [${e.kind}] ${e.text.slice(0, 160)}`));
    await browser.close();
  } finally {
    server.kill();
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error("DRIVER CRASH:", error);
  fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify({ results, issues, crash: String(error) }, null, 2));
  process.exit(1);
});
