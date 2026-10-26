/* Attach to the RUNNING Tizen simulator (PW-remote-debug), find the app frame,
   and burst ArrowDown presses in the channels ("TV") list while sampling every
   animation frame for focus-row rect movement (= the reported shake).
   Run: node sim-shake.js [channels|guide] */
"use strict";
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const KIND = process.argv[2] || "channels";
let shotNo = 0;
let rigServer = null;

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: null });
  const targets = await browser.targets();
  console.log("targets:", targets.map((t) => `${t.type()} ${t.url().slice(0, 80)}`).join("\n  "));
  const ripple = targets.find((t) => /ripple\.html/.test(t.url()));
  if (!ripple) throw new Error("simulator ripple target not found");
  const page = await ripple.page();

  await page.waitForTimeout ? null : null;
  await wait(500);
  const frames = page.frames();
  console.log("frames:", frames.map((f) => `${f.url().slice(0, 90)}`).join("\n  "));
  let app = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    app = page.frames().find((f) => /kplayer001\/index\.html|tvapp\/index\.html/.test(f.url()));
    if (!app) {
      app = page.frames().find((f) => f !== page.mainFrame() && !/FirstScreen|simulator|ripple/.test(f.url()));
    }
    if (app && await app.evaluate("typeof KP !== 'undefined' && !!KP.Shell").catch(() => false)) break;
    app = null;
    await wait(500);
  }
  if (!app) throw new Error("app frame never appeared");

  const hasKP = await app.evaluate("typeof KP !== 'undefined' && !!KP.Shell").catch(() => false);
  if (!hasKP) throw new Error("KP not found in frame " + app.url());
  console.log("app frame:", app.url());

  /* hard reload the app frame so the latest js/css is running */
  await app.evaluate(`location.replace("${app.url()}")`).catch(() => {});
  await wait(3000);
  app = page.frames().find((f) => /tvapp|kplayer001|index\.html/.test(f.url())) || app;
  const reloaded = await app.evaluate("typeof KP !== 'undefined' && !!KP.Shell").catch(() => false);
  console.log("frame reloaded:", reloaded);

  /* ensure data: when the store is empty, inject the mock Xtream playlist, then
     reload the frame so the app boots through its real boot path with data. */
  const hasData = await app.evaluate("!!(KP.Store && KP.Store.hasData())").catch(() => false);
  const activeUrl = await app.evaluate(`(function(){ var a = KP.Store.active(); return a ? (a.url || "") : ""; })()`).catch(() => "");
  const mockActive = /:8093\/xt/.test(activeUrl);
  if (!hasData || mockActive) {
    console.log(`store empty: ${!hasData}, mock active: ${mockActive} -> (re)inject mock Xtream playlist`);
    const serverProc = require("child_process").spawn(process.execPath, [path.join(__dirname, "server.js")], { stdio: "ignore" });
    rigServer = serverProc;
    await wait(1200);
    const dropMock = "(function(){" +
      "(KP.Store.playlists || []).forEach(function (p) {" +
      "if ((p.url || '').indexOf(':8093/xt') >= 0) KP.Store.remove(p.id);" +
      "});" +
      "return KP.Store.playlists.length;" +
      "})()";
    await app.evaluate(dropMock);
    await app.evaluate(`(function(){
      var pl = KP.Store.add({ name: "Mock Xtream", type: "xtream", url: "http://127.0.0.1:8093/xt", user: "u", pass: "p" });
      KP.Store.setActive(pl.id);
      KP.Store.loadPlaylist(pl, function () {});
    })()`);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = await app.evaluate(`(function(){ var a = KP.Store.active(); return a ? a.status : ""; })()`).catch(() => "");
      if (status === "ready" || status === "error") break;
      await wait(300);
    }
    await app.evaluate(`location.replace("${app.url()}")`).catch(() => {});
    await wait(3000);
    app = page.frames().find((f) => /kplayer001\/index\.html|tvapp\/index\.html/.test(f.url())) || app;
    console.log("store ready:", await app.evaluate("!!KP.Store.hasData()").catch(() => false));
  }

  const info = await app.evaluate(`(function(){
    var g = document.body.getBoundingClientRect();
    return {
      bodyRect: {x: g.x, y: g.y, w: g.width, h: g.height},
      offW: document.body.offsetWidth,
      dpr: window.devicePixelRatio,
      view: KP.Shell.state.view,
      playing: !!KP.Shell.state.playing,
      guideRows: (function(){var t = (document.getElementById('guide-rows-inner')||{}).style; return t.transform || "";})(),
      chShift: (function(){var t = document.getElementById('channel-list-inner'); return t ? t.style.transform : null;})(),
      scaleProbe: KP.Utils.pixelGrid(document.body)
    };
  })()`);
  console.log("info:", JSON.stringify(info));

  /* navigate to the target view */
  const current = info.view;
  if (KIND === "channels") {
    if (current === "player" && !info.playing) {
      await app.evaluate(`KP.Views.channels.open()`);
    } else if (current !== "channels") {
      await app.evaluate(`KP.Views.channels.open()`);
    }
  } else if (KIND === "guide") {
    await app.evaluate(`KP.Views.guide.open()`);
  }
  await wait(700);
  const viewNow = await app.evaluate(`KP.Shell.state.view`);
  console.log("view now:", viewNow);

  /* rAF sampler inside the app frame */
  await app.evaluate(`(function(){
    window.__SHAKE = { frames: [], on: true };
    var sample = function(){
      if (!window.__SHAKE.on) { requestAnimationFrame(sample); return; }
      var row = document.querySelector('#channel-list .ch-row.focused, #channel-list .ch-row.playing') ||
                document.querySelector('#guide-rows .grow.focused');
      var r = row ? row.getBoundingClientRect() : null;
      var inner = document.getElementById('channel-list-inner');
      var grows = document.getElementById('guide-rows-inner');
      var f = { t: performance.now() };
      if (r) f.rY = Math.round(r.y * 100) / 100;
      if (inner) f.chTf = inner.style.transform;
      if (grows) f.gTf = grows.style.transform;
      var sb = document.getElementById('side-panel');
      if (sb) { var sbR = sb.getBoundingClientRect(); f.sbH = Math.round(sbR.height * 10) / 10; f.sbW = Math.round(sbR.width * 10) / 10; }
      var pr = document.querySelector('.side-preview');
      if (pr) { var prR = pr.getBoundingClientRect(); f.prH = Math.round(prR.height * 10) / 10; }
      window.__SHAKE.frames.push(f);
      if (window.__SHAKE.frames.length > 400) window.__SHAKE.frames.shift();
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })()`);

  /* burst of ArrowDown: 26 presses, ~60ms cadence, with per-press centering math log */
  const boxProbe = await app.evaluate(`(function(){
    window.__SHIFTLOG = [];
    var list = document.getElementById('channel-list');
    var rect = list.getBoundingClientRect();
    var inner = document.getElementById('channel-list-inner');
    return { top: Math.round(rect.y * 10) / 10, h: Math.round(rect.height * 10) / 10, vis: list.clientHeight, innerH: inner.offsetHeight };
  })()`);
  console.log("box:", JSON.stringify(boxProbe));
  const shiftLog = [];
  for (let i = 0; i < 26; i += 1) {
    await app.evaluate(`(function(){
      var e = new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true });
      document.dispatchEvent(e);
      Object.defineProperty(e, 'keyCode', { value: 40 });
    })()`);
    const m = await app.evaluate(`(function(){
      var list = document.getElementById('channel-list');
      var inner = document.getElementById('channel-list-inner');
      var row = document.querySelector('#channel-list .ch-row.focused');
      if (!row) return { i: ${i}, ci: KP.Shell.state.chanIdx, missing: true };
      var r = row.getBoundingClientRect();
      var box = list.getBoundingClientRect();
      return {
        i: ${i},
        ci: KP.Shell.state.chanIdx,
        gi: KP.Shell.state.groupIdx,
        rowTop: row.offsetTop,
        rowH: row.offsetHeight,
        vis: list.clientHeight,
        innerH: inner.offsetHeight,
        rowCenterY: Math.round((r.y + r.height / 2) * 10) / 10,
        boxCenterY: Math.round((box.y + box.height / 2) * 10) / 10,
        shift: KP.Utils.centerShift(list, inner, row),
        tf: inner.style.transform
      };
    })()`);
    shiftLog.push(m);
    await wait(28);
    await app.evaluate(`(function(){
      var e = new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true });
      Object.defineProperty(e, 'keyCode', { value: 40 });
      document.dispatchEvent(e);
    })()`);
    await wait(30);
  }
  shiftLog.forEach((m) => console.log(JSON.stringify(m)));
  await wait(900);

  const data = await app.evaluate(`(function(){
    window.__SHAKE.on = false;
    return window.__SHAKE.frames.filter(function(f){ return f.rY !== undefined; });
  })()`);
  console.log(`sampled frames: ${data.length}`);

  /* analyze: biggest rY jumps between consecutive frames */
  let maxJump = 0, jumpFrames = 0;
  for (let i = 1; i < data.length; i += 1) {
    const a = data[i - 1], b = data[i];
    const d = Math.abs((b.rY || 0) - (a.rY || 0));
    if (d > maxJump) maxJump = d;
    if (d > 0.25) jumpFrames += 1;
  }
  console.log(`max inter-frame focus-row delta: ${maxJump}px, frames with >0.25px delta: ${jumpFrames}/${data.length - 1}`);
  const jumpHist = {};
  for (let i = 1; i < data.length; i += 1) {
    const d = Math.abs((data[i].rY || 0) - (data[i - 1].rY || 0));
    if (d > 0.25) {
      const key = d < 60 ? `<60 : ${Math.round(d / 6) * 6}` : `big: ${Math.round(d)}`;
      jumpHist[key] = (jumpHist[key] || 0) + 1;
    }
  }
  console.log("delta histogram:", JSON.stringify(jumpHist));
  const last = data.slice(-14);
  console.log("tail:", JSON.stringify(last, null, 1));

  const tailTransform = await app.evaluate(`(function(){
    var inner = document.getElementById('channel-list-inner');
    var grows = document.getElementById('guide-rows-inner');
    var grid = KP.Utils.pixelGrid(document.body);
    return { ch: inner ? inner.style.transform : null, g: grows ? grows.style.transform : null, grid: grid };
  })()`);
  console.log("tail transform:", JSON.stringify(tailTransform));

  const dir = path.join(__dirname, "shots-sim");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  shotNo += 1;
  const file = path.join(dir, `${KIND}-${shotNo}-tail.png`);
  await page.screenshot({ path: file });
  console.log("shot:", file);

  browser.disconnect();
  if (rigServer) rigServer.kill();
  console.log("DONE");
}

main().then(() => process.exit(0), (error) => { console.error("CRASH", error); process.exit(1); });
