/* KPlayer guide shake - rapid-press burst test.
   Runs the guide rig (real core.js + ui-guide.js + app.css, 200 channels with
   alternating 1-line / 4-line descriptions) and mashes Down 5x across real
   frames while recording every compositor frame:
     - #guide-rows scrollTop / clientHeight / scrollHeight
     - focused row getBoundingClientRect().top
   Instability evidence = clientHeight changing mid-gesture, fractional
   rect.top, or oscillating deltas. Run: node guide-burst.js */
"use strict";
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const RIG = "file:///C:/Users/keshab/AppData/Local/Temp/opencode/guide-rig/index.html";
const EDGE_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const exePath = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
  const browser = await puppeteer.launch({ executablePath: exePath, headless: "new", args: ["--window-size=1920,1200"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(RIG, { waitUntil: "load" });
  await wait(400);

  const burst = async (disableAnchor, scaled) => {
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 1920, height: 1080 });
    await page2.goto(RIG, { waitUntil: "load" });
    if (disableAnchor) {
      await page2.addStyleTag({ content: ".grows { overflow-anchor: none; }" });
    }
    if (scaled) {
      /* stand-in for the simulator TV frame: app hosted at a reduced scale */
      await page2.addStyleTag({ content: "#view-guide { transform: scale(0.7844); transform-origin: top left; width:1920px; height:1080px; }" });
    }
    await wait(300);
    const result = await page2.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const guide = KP.Views.guide;
      const box = document.getElementById("guide-rows");
      const inner = document.getElementById("guide-rows-inner");
      const frames = [];
      let running = true;
      const effScroll = () => {
        const value = inner.style.transform || "";
        const match = value.match(/translateY\((-?[0-9.]+)px\)/);
        return match ? parseFloat(match[1]) : 0;
      };
      const stamp = () => {
        const focusRow = inner.querySelector('.grow[data-ci="' + KP.Shell.state.gChanIdx + '"]');
        frames.push({
          scrollTop: -effScroll(),
          clientHeight: box.clientHeight,
          scrollHeight: inner.offsetHeight,
          rowTop: focusRow ? Math.round(focusRow.getBoundingClientRect().top * 10) / 10 : -1,
          focus: KP.Shell.state.gChanIdx
        });
      };
      const monitor = () => {
        if (!running) return;
        stamp();
        requestAnimationFrame(monitor);
      };
      requestAnimationFrame(monitor);

      /* instrument: split direct renders (window crosses) from deferred data renders */
      let directRenders = 0;
      let deferredRuns = 0;
      const origRender = guide.render.bind(guide);
      guide.render = function (force) { directRenders += 1; return origRender(force); };
      const realDefer = KP.Shell.deferDataRender.bind(KP.Shell);
      KP.Shell.deferDataRender = function (job, delay) {
        return realDefer(function () { deferredRuns += 1; return job(); });
      };
      window.__startEpgTick();

      /* rapid mashing: 30 downs ~55ms apart with real frames between */
      for (let press = 0; press < 30; press += 1) {
        KP.Shell.touchGesture();
        guide.handleKey(40);
        await sleep(55);
      }
      window.__stopEpgTick();
      await sleep(1500);
      running = false;
      const effective = KP.Utils.pixelGrid ? KP.Utils.pixelGrid(box) : 1;
      const uniq = (values) => Array.from(new Set(values));
      return {
        focus: KP.Shell.state.gChanIdx,
        directRenders,
        deferredRuns,
        effectiveGrid: effective,
        scrollTops: frames.map((f) => f.scrollTop),
        clientHeights: uniq(frames.map((f) => f.clientHeight)),
        rowTops: frames.map((f) => f.rowTop),
        focusTrail: frames.map((f) => f.focus)
      };
    });
    await page2.close();
    return result;
  };

  const withAnchor = await burst(false, false);
  const noAnchor = await burst(true, false);
  const scaled = await burst(false, true);

  const diagnose = (result, label) => {
    const problems = [];
    if (result.clientHeights.length !== 1) problems.push("clientHeight changed: " + result.clientHeights);
    /* all scroll writes must land on the effective device grid (integer device
       pixels after DPR + ancestor scale); else rows shimmer on scaled screens */
    const effective = result.effectiveGrid;
    result.scrollTops.forEach((value) => {
      const device = value * effective;
      if (Math.abs(device - Math.round(device)) > 0.011) {
        problems.push("scrollTop " + value + " off device grid (device=" + device.toFixed(3) + ")");
      }
    });
    /* oscillation: reversal while clientHeight stable */
    const scrollTops = result.scrollTops;
    for (let index = 2; index < scrollTops.length; index += 1) {
      const direction1 = scrollTops[index - 1] - scrollTops[index - 2];
      const direction2 = scrollTops[index] - scrollTops[index - 1];
      if (direction1 > 0 && direction2 < 0 && result.clientHeights.length === 1) {
        problems.push("scroll oscillated at frame " + index + ": " + scrollTops.slice(Math.max(0, index - 4), index + 2));
        break;
      }
    }
    /* focused row must never visibly move when focus does not change */
    const rowTops = result.rowTops;
    let anomalyAt = -1;
    for (let index = 1; index < rowTops.length; index += 1) {
      if (rowTops[index] < 0) continue;
      const sameFocus = result.focusTrail[index] === result.focusTrail[index - 1];
      if (!sameFocus) continue;
      const delta = rowTops[index] - rowTops[index - 1];
      if (Math.abs(delta) > 0.75) {
        problems.push("row rect moved " + delta.toFixed(1) + " with unchanged focus at frame " + index);
        anomalyAt = index;
        break;
      }
    }
    console.log(label, JSON.stringify({
      focus: result.focus,
      directRenders: result.directRenders,
      deferredRuns: result.deferredRuns,
      effectiveGrid: effective,
      clientHeights: result.clientHeights,
      scrollSamples: [scrollTops[Math.floor(scrollTops.length / 3)], scrollTops[Math.floor(scrollTops.length * 2 / 3)], scrollTops[scrollTops.length - 1]]
    }));
    if (anomalyAt >= 0) {
      const from = Math.max(0, anomalyAt - 5);
      console.log(label + " frames around anomaly:", JSON.stringify(result.scrollTops.slice(from, anomalyAt + 6)
        .map((value, offset) => ({ frame: from + offset, st: value, rowTop: result.rowTops[from + offset], focus: result.focusTrail[from + offset] }))));
    }
    if (problems.length) {
      console.log(label + " PROBLEMS:\n- " + problems.join("\n- "));
    } else {
      console.log(label + ": stable");
    }
    return problems;
  };

  const problems1 = diagnose(withAnchor, "[normal]");
  const problems2 = diagnose(noAnchor, "[anchor-none]");
  const problems3 = diagnose(scaled, "[scaled-0.78]");
  await browser.close();
  if (problems1.length || problems2.length || problems3.length) process.exit(1);
  console.log("burst test OK (stable scroll)");
})().catch((error) => { console.error(error); process.exit(1); });
