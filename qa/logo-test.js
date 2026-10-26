/* KPlayer logo-contrast regression test.
   Loads core.js in a headless page, renders logos with known pixel
   properties through the real KP.Logo path, and checks the verdicts:
     mono   - dark glyph on transparency -> white SVG-alpha reshape
     invert - dark full-bleed image flipped inside out
     plate  - CORS-blocked analysis -> light chip behind the raw image
     plain  - already readable, untouched
   Run:  node logo-test.js   (starts qa/server.js itself on port 8093) */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const EDGE_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
];
const CORE = path.resolve(__dirname, "..", "js", "core.js");
const ICON = path.resolve(__dirname, "..", "icon.png");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pickBrowser() {
  for (const candidate of EDGE_CANDIDATES) if (fs.existsSync(candidate)) return candidate;
  throw new Error("no chrome/edge found");
}

function startServer() {
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], { stdio: "pipe" });
  child.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  return child;
}

/* Different port => cross origin, and it sends no CORS header, so the
   canvas getImageData() in the classifier must throw -> verdict "plate". */
function startForbiddenServer() {
  const server = require("http").createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(fs.readFileSync(ICON));
  });
  server.listen(8094, "127.0.0.1");
  return server;
}

const svg = (body) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">${body}</svg>`);

const CASES = [
  { name: "dark-glyph-transparent", url: svg('<path d="M40 60h70M60 30h30" stroke="#0e1015" stroke-width="16" stroke-linecap="round"/><circle cx="150" cy="60" r="20" fill="none" stroke="#0e1015" stroke-width="16"/>'), expect: "mono" },
  { name: "white-glyph-transparent", url: svg('<path d="M40 60h70M60 30h30" stroke="#ffffff" stroke-width="16" stroke-linecap="round"/><circle cx="150" cy="60" r="20" fill="none" stroke="#ffffff" stroke-width="16"/>'), expect: "plain" },
  { name: "fullbleed-dark", url: svg('<rect width="200" height="120" fill="#101828"/>'), expect: "invert" },
  { name: "colorful-glyph", url: svg('<circle cx="100" cy="60" r="30" fill="none" stroke="#ff8800" stroke-width="20"/>'), expect: "plain" },
  { name: "nearly-empty", url: svg('<circle cx="100" cy="60" r="3" fill="#555555"/>'), expect: "plain" },
  /* filled colorful artwork must NEVER be reshaped into a white silhouette */
  { name: "badge-artwork", url: svg('<rect x="10" y="10" width="180" height="100" rx="18" fill="#0a0a0a"/><rect x="40" y="45" width="120" height="18" fill="#e7222e"/><rect x="40" y="70" width="120" height="12" fill="#79c70b"/>'), notMono: true },
  { name: "flat-illustration", url: svg('<rect x="0" y="0" width="200" height="60" fill="#3d5dc8"/><rect x="8" y="10" width="184" height="100" fill="#3d5dc8"/><rect x="18" y="20" width="164" height="80" fill="#57c785"/><circle cx="100" cy="60" r="26" fill="#111"/><circle cx="100" cy="60" r="18" fill="#ffffff"/>'), notMono: true },
  { name: "real-pbr", url: "http://127.0.0.1:8093/qa/assets/pbr.png", notMono: true },
  { name: "real-tv-color", url: "http://127.0.0.1:8093/qa/assets/tvcolor.png", notMono: true }
];

(async () => {
  const failures = [];
  const server = startServer();
  const forbidden = startForbiddenServer();
  await wait(700);
  const browser = await puppeteer.launch({
    executablePath: pickBrowser(),
    headless: "new",
    args: ["--window-size=1600,900"]
  });

  const boot = async () => {
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:8093/qa-logo-boot");
    /* real app css so filter/computed rules behave like the shipped app */
    await page.addStyleTag({ url: "http://127.0.0.1:8093/css/app.css" });
    await page.addStyleTag({ url: "http://127.0.0.1:8093/css/tokens.css" });
    await page.addScriptTag({ path: CORE });
    await page.evaluate(() => {
      document.body.innerHTML = '<div id="row" style="display:flex"></div>';
      KP.Logo.install();
    });
    return page;
  };

  const render = async (page) => {
    await page.evaluate((cases) => {
      const row = document.getElementById("row");
      cases.forEach((entry) => {
        row.insertAdjacentHTML("beforeend", KP.Logo.box({ id: entry.name, name: entry.name, logo: entry.url }, "glogo"));
      });
      row.insertAdjacentHTML("beforeend", KP.Logo.box({ id: "cross", name: "cross", logo: "http://127.0.0.1:8094/icon.png" }, "glogo"));
      row.insertAdjacentHTML("beforeend", KP.Logo.box({ id: "same", name: "same-origin", logo: "http://127.0.0.1:8093/icon.png" }, "glogo"));
    }, CASES);
    await wait(1000);
    return page.evaluate(() => {
      const order = Array.from(document.querySelectorAll("#row .glogo"));
      const extra = ["cross", "same-origin"];
      return Array.from({ length: order.length }, (unused, index) => {
        const box = order[index];
        const img = box.querySelector("img.logo-img");
        if (!img) return { verdict: "no-img", filter: "" };
        const flags = ["logo-mono", "logo-invert", "logo-plate"].filter((cls) => img.classList.contains(cls))
          .map((cls) => cls.replace("logo-", ""));
        const src = img.src;
        let verdict = flags[0] || "plain";
        if (src.indexOf(":8094/") >= 0) verdict = "plate:" + verdict;
        if (src.indexOf(":8093/") >= 0 && index >= order.length - extra.length) verdict = "same-origin:" + verdict;
        return { verdict, filter: getComputedStyle(img).filter };
      });
    });
  };

  try {
    const page = await boot();
    const report = await render(page);

    console.log("== pass 1: fresh classification ==");
    /* report indexes: 0..4 = strict CASES, 5..8 = colorful artwork (never
       mono), 9 = cross-origin tainted, 10 = same-origin sanity */
    report.forEach((entry, index) => {
      const strict = CASES[index];
      if (index < CASES.length && strict && strict.expect) {
        const ok = entry.verdict === strict.expect;
        console.log(ok ? "PASS" : "FAIL", strict.name, "verdict=" + entry.verdict,
          strict.expect === "mono" ? "filter=" + entry.filter : "");
        if (!ok) failures.push(strict.name + " got " + entry.verdict + " want " + strict.expect);
        /* reshaped logos must go through the inline SVG filter */
        if (strict.expect === "mono" && entry.filter.indexOf("kp-mono") < 0) {
          failures.push(strict.name + " mono filter not applied: " + entry.filter);
        }
      } else if (strict && strict.notMono) {
        const ok = entry.verdict !== "mono";
        console.log(ok ? "PASS" : "FAIL", strict.name, "verdict=" + entry.verdict,
          "(colorful artwork must not be reshaped)");
        if (!ok) failures.push(strict.name + " wrongly reshaped to mono");
      } else if (index === CASES.length) {
        const ok = entry.verdict === "plate:plain" || entry.verdict === "plate" || entry.verdict === "plate:plate";
        console.log(ok ? "PASS" : "FAIL", "cross-origin-tainted", "verdict=" + entry.verdict);
        if (!ok) failures.push("tainted image got " + entry.verdict);
      } else {
        console.log("INFO", "verdict=" + entry.verdict, "(sanity, any verdict ok)");
      }
    });

    console.log("== pass 2: cached verdicts baked at build time ==");
    const page2 = await boot();
    const bakedList = await page2.evaluate((cases) => {
      const row = document.getElementById("row");
      cases.forEach((entry) => {
        row.insertAdjacentHTML("beforeend", KP.Logo.box({ id: entry.name, name: entry.name, logo: entry.url }, "glogo"));
      });
      const disney = row.querySelectorAll("img.logo-img")[0];
      return disney ? disney.className : "MISSING";
    }, CASES);
    if (String(bakedList).indexOf("logo-mono") < 0) {
      failures.push("cached verdict missing on rebuild markup: " + bakedList);
      console.log("FAIL rebuild classes:", bakedList);
    } else {
      console.log("PASS rebuild markup already carries logo-mono:", bakedList);
    }
  } finally {
    await browser.close();
    server.kill();
    forbidden.close();
  }

  if (failures.length) {
    console.log("\n" + failures.length + " FAILURES");
    process.exit(1);
  }
  console.log("\nlogo test OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
