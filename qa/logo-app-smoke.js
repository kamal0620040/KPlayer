"use strict";
/* One-off boot smoke: real index.html, check logo defs + zero console errors. */
const { spawn } = require("child_process");
const path = require("path");
const puppeteer = require("puppeteer-core");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, "server.js")], { stdio: "ignore" });
  await wait(700);
  const candidates = ["C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"];
  const browser = await puppeteer.launch({ executablePath: candidates.find((p) => { try { require("fs").existsSync(p); return true; } catch (e) { return false; } }), headless: "new" });
  const page = await browser.newPage();
  const errors = [];
  page.on("response", (r) => { if (r.status() >= 400) errors.push("HTTP" + r.status() + " " + r.url()); });
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("http://127.0.0.1:8093/index.html");
  await wait(2500);
  const state = await page.evaluate(() => ({
    monoDef: !!document.getElementById("kp-mono"),
    views: Object.keys(KP.Views || {}).sort().join(","),
    imgSample: document.querySelectorAll("img.logo-img").length
  }));
  console.log(JSON.stringify(state));
  console.log("consoleErrors:", JSON.stringify(errors));
  await browser.close();
  server.kill();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

