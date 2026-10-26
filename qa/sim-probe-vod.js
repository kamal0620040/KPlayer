/* Probe the VOD category list and the playlists list in the RUNNING simulator:
   - open Movies, walk the category selection to the end and settle the list
   - probe clientHeight vs inner height, the translate clamp, and whether the
     focused category row stays fully visible at the tail (top/bottom rects)
   - then open Playlists and do the same for the JSON list
   Run: node sim-probe-vod.js */
"use strict";
const puppeteer = require("puppeteer-core");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function pickApp(page) {
  let app = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    app = page.frames().find((f) => /kplayer001\/index\.html|tvapp\/index\.html/.test(f.url()));
    if (!app) app = page.frames().find((f) => f !== page.mainFrame() && !/FirstScreen|simulator|ripple/.test(f.url()));
    if (app && await app.evaluate("typeof KP !== 'undefined' && !!KP.Shell").catch(() => false)) break;
    app = null;
    await wait(500);
  }
  if (!app) throw new Error("app frame never appeared");
  return app;
}

let mockServer = null;

async function injectMock(app) {
  const hasData = await app.evaluate("!!(KP.Store && KP.Store.hasData())").catch(() => false);
  const activeUrl = await app.evaluate(`(function(){ var a = KP.Store.active(); return a ? (a.url || "") : ""; })()`).catch(() => "");
  if (!hasData || /:8093\/xt/.test(activeUrl)) {
    mockServer = require("child_process").spawn(process.execPath, [`${__dirname}/server.js`], { stdio: "ignore" });
    await wait(1200);
    await app.evaluate("(KP.Store.playlists||[]).forEach(function(p){ if ((p.url||'').indexOf(':8093/xt')>=0) KP.Store.remove(p.id); })");
    await app.evaluate(`(function(){
      var pl = KP.Store.add({ name: "Mock Xtream", type: "xtream", url: "http://127.0.0.1:8093/xt", user: "u", pass: "p" });
      KP.Store.setActive(pl.id);
      KP.Store.loadPlaylist(pl, function () {});
    })()`);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const status = await app.evaluate("(function(){ var a = KP.Store.active(); return a ? a.status : ''; })()").catch(() => "");
      if (status === "ready" || status === "error") break;
      await wait(300);
    }
    await app.evaluate(`location.replace(${JSON.stringify(app.url())})`).catch(() => {});
    await wait(3000);
    return true;
  }
  mockServer = require("child_process").spawn(process.execPath, [`${__dirname}/server.js`], { stdio: "ignore" });
  await wait(800);
  return false;
}

const KEY_CODES = { ArrowDown: 40, ArrowUp: 38, ArrowRight: 39, ArrowLeft: 37, Enter: 13, Backspace: 8, Escape: 27 };

async function press(app, key) {
  const code = KEY_CODES[key] || 0;
  await app.evaluate(`(function(){
    var e = new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, keyCode: ${code}, which: ${code}, bubbles: true });
    document.dispatchEvent(e);
  })()`);
  await wait(130);
}

async function vodCatsProbe(app) {
  const cat = await app.evaluate(`(function(){
    var box = document.querySelector('.vod-cats');
    var list = document.getElementById('vod-cat-list');
    var rows = list ? list.children : [];
    var last = rows[rows.length - 1];
    var focused = list && list.querySelector('.focused');
    return {
      boxH: box.clientHeight,
      boxRect: (function(){var r = box.getBoundingClientRect(); return {y: Math.round(r.y), h: Math.round(r.height)};})(),
      innerH: list.offsetHeight,
      rows: rows.length,
      tf: list.style.transform,
      lastTop: last ? last.offsetTop : -1,
      lastH: last ? last.offsetHeight : -1,
      focusedIdx: KP.Views.vod._catIdx,
      focusedRect: focused ? (function(){var r = focused.getBoundingClientRect(); return {y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.y + r.height)};})() : null,
      lastRect: last ? (function(){var r = last.getBoundingClientRect(); return {y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.y + r.height)};})() : null,
      catsLen: KP.Views.vod._cats.length,
      fadeInited: !!KP.Shell._scrollFadeObserver,
      catsBound: box.classList.contains('scroll-fade-y'),
      catClasses: box.className,
      gridBound: (function(){var g = document.querySelector('.vod-scroll'); return g ? g.classList.contains('scroll-fade-y') : false;})()
    };
  })()`);
  console.log("vod cats:", JSON.stringify(cat));
}

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: null });
  try {
    const ripple = (await browser.targets()).find((t) => /ripple\.html/.test(t.url()));
    const page = await ripple.page();
    const app = await pickApp(page);
    const injected = await injectMock(app);
    console.log("mock injected:", injected);

    await app.evaluate("KP.Views.vod.open('movies')");
    await wait(2500);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const ready = await app.evaluate("!!KP.Views.vod._cats.length").catch(() => false);
      if (ready) break;
      await wait(500);
    }
    /* the mock serves 1-2 categories: synthesize a long list to exercise the tail */
    await app.evaluate(`(function(){
      if (KP.Views.vod._cats.length >= 60) return;
      var cats = [];
      for (var i = 0; i < 72; i += 1) cats.push({ name: "Category " + (i + 1), items: [{ name: "Movie " + i }] });
      KP.Views.vod._cats = cats;
      KP.Views.vod._catIdx = 0;
      KP.Views.vod._zone = "cats";
      KP.Views.vod.render();
    })()`);
    await wait(500);

    /* walk to the end of the categories, sampling every 15 presses */
    const catsLen = await app.evaluate("KP.Views.vod._cats.length");
    console.log("catsLen:", catsLen);
    for (let i = 0; i < catsLen + 4; i += 1) {
      await press(app, "ArrowDown");
      if (i % 15 === 0 || i === catsLen + 3) {
        console.log(`--- after ${i + 1} downs ---`);
        await vodCatsProbe(app);
        if (i === 30 || i === catsLen + 3) {
          await page.screenshot({ path: `${__dirname}/shots-sim/vodcats-${i + 1}.png` });
        }
      }
    }

    /* playlists view: JSON list */
    await app.evaluate("KP.Views.playlists.open()");
    await wait(1600);
    const pl0 = await app.evaluate(`(function(){
      var list = document.getElementById('pl-list');
      return {
        boxH: list.clientHeight,
        scrolled: list.scrollTop,
        scrollMax: list.scrollHeight - list.clientHeight,
        rows: list.children.length,
        bound: list.classList.contains('scroll-fade-y'),
        classes: list.className
      };
    })()`);
    console.log("playlists:", JSON.stringify(pl0));
    for (let i = 0; i < 60; i += 1) await press(app, "ArrowDown");
    const pl1 = await app.evaluate(`(function(){
      var list = document.getElementById('pl-list');
      return { scrolled: list.scrollTop, max: list.scrollHeight - list.clientHeight };
    })()`);
    console.log("playlists tail:", JSON.stringify(pl1));
  } finally {
    if (mockServer) mockServer.kill();
    await browser.disconnect();
  }
}

main().then(() => process.exit(0), (error) => { console.error("CRASH", error); process.exit(1); });
