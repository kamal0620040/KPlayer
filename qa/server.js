/* Minimal static server for the KPlayer project root + CORS proxy fallback. */
"use strict";
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8093;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff"
};

/* Tiny Xtream Codes mock for VOD back-nav QA. Base: http://127.0.0.1:PORT/xt */
const XT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mPcv2/1fwAH1QM7XKAJNQAAAABJRU5ErkJggg==",
  "base64"
);
const xtSend = (res, body) => {
  res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
};

function xtreamMock(req, res) {
  const q = new URL(req.url, "http://127.0.0.1").searchParams;
  const action = q.get("action") || "";
  if (action === "get_live_categories") {
    xtSend(res, [{ category_id: 1, category_name: "Mock Live" }]);
    return;
  }
  if (action === "get_live_streams") {
    const rows = [];
    const count = Number(q.get("count")) || 240;
    for (let i = 1; i <= count; i += 1) {
      rows.push({
        stream_id: 500 + i,
        num: i,
        name: `Mock Chan ${i}`,
        stream_icon: "",
        category_id: 1,
        epg_channel_id: ""
      });
    }
    xtSend(res, rows);
    return;
  }
  if (action === "get_vod_categories") {
    xtSend(res, [{ category_id: 10, category_name: "Mock Movies" }]);
    return;
  }
  if (action === "get_series_categories") {
    xtSend(res, [{ category_id: 20, category_name: "Mock Shows" }]);
    return;
  }
  if (action === "get_vod_streams") {
    const rows = [];
    for (let i = 1; i <= 5; i += 1) {
      rows.push({
        stream_id: 100 + i,
        name: `Movie Alpha ${i}`,
        stream_icon: `/p/m${i}.png`,
        rating: `${(6 + i / 2).toFixed(1)}`,
        category_id: 10,
        container_extension: "mp4",
        plot: `Plot for movie ${i}: a long storyline used by the detail screen.`,
        genre: "Drama",
        releaseDate: `202${i}-05-02`
      });
    }
    xtSend(res, rows);
    return;
  }
  if (action === "get_series") {
    const rows = [];
    for (let i = 1; i <= 3; i += 1) {
      rows.push({
        series_id: 200 + i,
        name: `Show Beta ${i}`,
        cover: `/p/s${i}.png`,
        rating: `${(7 + i / 10).toFixed(1)}`,
        category_id: 20,
        plot: `Plot for show ${i}.`,
        genre: "Sci-fi",
        releaseDate: `201${i}-01-04`
      });
    }
    xtSend(res, rows);
    return;
  }
  if (action === "get_vod_info") {
    xtSend(res, {
      info: {
        movie_image: "/p/big.png",
        plot: "Full detail plot loaded from vod_info for the movie page.",
        genre: "Drama, Thriller",
        releasedate: "2021-05-02",
        rating: "7.5",
        duration: "01:34:00"
      }
    });
    return;
  }
  if (action === "get_series_info") {
    xtSend(res, {
      info: { plot: "Series plot.", genre: "Sci-fi", releasedate: "2019-01-04", rating: "7.9" },
      seasons: [{ season: 1 }],
      episodes: {
        "1": [
          { id: 9001, title: "Pilot", episode_num: 1, container_extension: "mp4" },
          { id: 9002, title: "Second", episode_num: 2, container_extension: "mp4" }
        ]
      }
    });
    return;
  }
  xtSend(res, []);
}

function proxy(req, res, target) {
  let url;
  try {
    url = new URL(target);
  } catch (error) {
    res.writeHead(400).end("bad url");
    return;
  }
  const lib = url.protocol === "http:" ? http : https;
  const request = lib.get(url, { headers: { "User-Agent": "KPlayer-QA" }, timeout: 45000 }, (up) => {
    if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location) {
      proxy(req, res, new URL(up.headers.location, url).toString());
      up.resume();
      return;
    }
    res.writeHead(up.statusCode, { "Content-Type": up.headers["content-type"] || "text/plain" });
    up.pipe(res);
  });
  request.on("timeout", () => request.destroy(new Error("proxy timeout")));
  request.on("error", (error) => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("proxy error: " + error.message);
  });
}

http.createServer((req, res) => {
  const raw = (req.url || "/").split("?")[0];
  if (raw.startsWith("/px")) {
    const target = new URL(req.url, "http://127.0.0.1").searchParams.get("url");
    if (!target) {
      res.writeHead(400).end("missing url");
      return;
    }
    proxy(req, res, target);
    return;
  }
  if (raw.startsWith("/xt/")) {
    if (raw.endsWith(".png")) {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(XT_PNG);
      return;
    }
    if (raw.endsWith(".mp4") || raw.endsWith(".ts")) {
      res.writeHead(200, { "Content-Type": "video/mp4" });
      res.end("");
      return;
    }
    xtreamMock(req, res);
    return;
  }
  let file = path.normalize(path.join(ROOT, raw === "/" ? "index.html" : decodeURIComponent(raw)));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[qa-server] serving ${ROOT} on http://127.0.0.1:${PORT}`);
});
