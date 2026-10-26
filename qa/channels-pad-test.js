/* Anchor-window channel list rig (user spec, revised):
   - open: list top-aligned, row 0 highlighted at the top
   - DOWN: the highlight walks the visible rows freely (no scroll) until it
     reaches the last fully visible row; then every further press slides the
     list exactly one row and the highlight stays at the bottom slot
   - UP: symmetric (walks back up, then slides with the highlight at the top
     slot until the list head is reached) - no empty bands, no pin-in jumps,
     no oscillation
   Run: node channels-pad-test.js */
"use strict";
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
].find((p) => fs.existsSync(p));
const BASE = "http://127.0.0.1:8093/index.html";
const PROFILE = path.join(__dirname, "profile-chpad");
fs.rmSync(PROFILE, { recursive: true, force: true });
const fails = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function check(pass, label, detail) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : " -> " + String(JSON.stringify(detail))}`);
  if (!pass) fails.push(label);
}

async function probe(page) {
  return page.evaluate(`(function(){
    var list = document.getElementById('channel-list');
    var row = document.querySelector('#channel-list .ch-row.focused');
    if (!list || !row) return null;
    var box = list.getBoundingClientRect();
    var r = row.getBoundingClientRect();
    return {
      ci: KP.Shell.state.chanIdx,
      fromBoxTop: Math.round((r.y - box.y) * 10) / 10,
      fromBoxBottom: Math.round((box.y + box.height - (r.y + r.height)) * 10) / 10,
      boxH: Math.round(box.height),
      rowH: Math.round(r.height),
      tf: document.getElementById('channel-list-inner').style.transform,
      groupCount: KP.Shell.currentGroup().channels.length
    };
  })()`);
}

async function press(page, key) {
  await page.evaluate(`typeof KP !== "undefined" && KP.Views.channels.handleKey(${key})`);
  return probe(page);
}

function tfPx(m) {
  const matches = String(m && m.tf || "0").match(/-?\d+/g);
  return matches ? Number(matches) : 0;
}

async function main() {
  const server = require("child_process").spawn(process.execPath, [path.join(__dirname, "server.js")], { stdio: "ignore" });
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    args: [`--user-data-dir=${PROFILE}`, "--no-first-run", "--mute-audio"]
  });
  try {
    page = await browser.newPage();
    await page.goto(BASE, { waitUntil: "load", timeout: 20000 });
    await wait(1200);

    await page.evaluate(`(function(){
      var chans = [];
      for (var i = 0; i < 60; i += 1) {
        chans.push({ id: "c" + i, num: 100 + i, name: "Fake " + (100 + i), logo: "", url: "http://127.0.0.1:8093/px/u", programmes: [] });
      }
      KP.Store.hasData = function() { return true; };
      KP.Store.groups = function() { return [
        { id: "fav", name: "Favorites", channels: [] },
        { id: "recent", name: "Recent channels", channels: [] },
        { id: "all", name: "All channels", channels: chans }
      ]; };
      KP.Store.activeChannels = function() { return chans; };
      KP.Store.activeId = function() { return "fake"; };
      KP.Store.active = function() { return null; };
      KP.Store.isGroupLocked = function() { return false; };
    })()`);

    await page.evaluate(`KP.Shell.state.groupIdx = 2; KP.Views.channels.open()`);
    await wait(400);

    let m = await probe(page);
    const fully = Math.floor(m.boxH / m.rowH); // rows that fit fully (12 here)
    const pinSlotIdx = Math.max(1, Math.round((fully - 1) / 2)); // middle slot (6 here)
    const bottomGap = m.boxH - fully * m.rowH; // space left for the peeking row
    console.log("probe:", JSON.stringify(m), "fully:", fully, "gap:", bottomGap);
    check(m && Math.abs(m.fromBoxTop) <= 2, "open: row 0 top-aligned, no band", m && m.fromBoxTop);

    /* first downs walk the highlight from the head toward the middle slot;
       the list only slides once the highlight reaches the middle */
    let walkOk = true;
    for (let i = 1; i <= pinSlotIdx; i += 1) {
      m = await press(page, 40);
      if (Math.abs(m.fromBoxTop - i * m.rowH) > 2 || m.tf !== "translateY(0px)") walkOk = false;
    }
    check(walkOk, `first ${pinSlotIdx} downs: highlight walks freely, list static`, m && m.tf);

    /* each subsequent press slides exactly one row while the highlight stays put */
    m = await press(page, 40);
    check(m && Math.abs(m.fromBoxTop - pinSlotIdx * m.rowH) <= 2 && tfPx(m) === -76,
      "press past the middle: highlight pinned, list slid one row", m);

    /* 20 more downs: highlight NEVER moves; content steps exactly 76px per press */
    let steady = true; let lastTf = tfPx(m);
    for (let i = 0; i < 20; i += 1) {
      m = await press(page, 40);
      const cur = tfPx(m);
      if (Math.abs(m.fromBoxTop - pinSlotIdx * m.rowH) > 2 || cur !== lastTf - 76) steady = false;
      lastTf = cur;
    }
    check(steady, "20 downs: per-press slide, highlight pinned at middle", m);

    /* 20 ups: highlight stays pinned while the list slides back */
    let upOk = true;
    for (let i = 0; i < 20; i += 1) {
      m = await press(page, 38);
      if (Math.abs(m.fromBoxTop - pinSlotIdx * m.rowH) > 2) upOk = false;
    }
    check(upOk && m.ci === 27 - 20 && tfPx(m) === -(m.ci - pinSlotIdx) * m.rowH,
      "20 ups: highlight stays pinned while list slides back", m);

    /* walk the last rows to the head, then static */
    let headOk = true;
    for (let i = 0; i < 12; i += 1) {
      m = await press(page, 38);
      if (m.ci === 0) break;
      if (Math.abs(m.fromBoxTop - Math.min(m.ci, pinSlotIdx) * m.rowH) > 2) headOk = false;
    }
    check(headOk && m.ci === 0 && Math.abs(m.fromBoxTop) <= 2 && tfPx(m) === 0,
      "head walk: pinned until near the head then walks, rests at head", m);

    /* flick at the head: no drift */
    for (let i = 0; i < 6; i += 1) {
      await press(page, 40);
      m = await press(page, 38);
    }
    check(m && m.ci === 0 && Math.abs(m.fromBoxTop) <= 2 && tfPx(m) === 0, "flick at head: row 0 stays top", m);

    /* digit jump to a deep row: lands pinned at the middle slot */
    await page.evaluate(`KP.Shell.state.chanIdx = 25; KP.Views.channels.render()`);    await wait(80);
    m = await probe(page);
    check(m && m.ci === 25
      && Math.abs(m.fromBoxTop - pinSlotIdx * m.rowH) <= 2
      && tfPx(m) === -(25 - pinSlotIdx) * m.rowH,
      "deep jump: row 25 pinned at the middle", m);

    /* end of list: last rows walk to the bottom, no overscroll */
    await page.evaluate(`KP.Shell.state.chanIdx = 59; KP.Views.channels.render()`);
    await wait(80);
    m = await press(page, 40);
    check(m && m.ci === 59 && Math.abs(m.fromBoxTop - (fully - 1) * m.rowH) <= 2,
      "last row: rests at the bottom, list cannot scroll further", m);
    m = await press(page, 38);
    check(m && Math.abs(m.fromBoxTop - (fully - 2) * m.rowH) <= 2, "UP from last row: walk resumes", m && m.fromBoxTop);

    console.log(fails.length ? `FAILURES: ${fails.join(" | ")}` : "ALL OK");
    return fails.length ? 1 : 0;
  } catch (error) {
    console.error("CRASH", error);
    return 1;
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(PROFILE, { recursive: true, force: true });
  }
}

let page = null;
main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
