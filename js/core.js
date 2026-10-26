/* KPlayer core: namespace, branding, DOM helpers, formatting and shared UI
   primitives. Targets Chromium 63 (Tizen 5.0) with ES2017 syntax. */
"use strict";

const KP = window.KPlayer || (window.KPlayer = {});

  KP.VERSION = "1.1.16";
KP.BRAND = {
  name: "KPlayer",
  tagline: "Live TV, your way.",
  version: KP.VERSION,
  icon: "images/kplayer.svg",
  author: "Kamal Neupane",
  platform: "Samsung Tizen 5.0+"
};

const byId = (id) => document.getElementById(id);

const esc = (value) => String(value == null ? "" : value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const fmtNum = (value) => String(value == null ? 0 : value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const fmtTime = (timestamp) => {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const fmtDuration = (milliseconds) => {
  const total = Math.max(0, Math.round((milliseconds || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const nowNext = (channel) => {
  let now = null;
  let next = null;
  const timestamp = Date.now();
  const programmes = (channel && channel.programmes) || [];
  for (const programme of programmes) {
    if (programme.start <= timestamp && timestamp < programme.end) now = programme;
    if (programme.start > timestamp && !next) next = programme;
  }
  return { now, next };
};

const progress = (programme) => {
  if (!programme) return 0;
  const span = programme.end - programme.start;
  if (!(span > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((Date.now() - programme.start) / span * 100)));
};

const designPx = (value) => value * (window.innerWidth || 1920) / 1920;

/* Virtualized lists scroll in whole-row steps: quantize row height to whole
   physical pixels so scrollTop, spacer heights and CSS row height agree and
   scroll snapping never repaints rows on half-pixel boundaries. */
const pixelRow = (value) => Math.max(1, Math.round(designPx(value)));

const digitFromKey = (keyCode) => {
  if (keyCode >= 48 && keyCode <= 57) return keyCode - 48;
  if (keyCode >= 96 && keyCode <= 105) return keyCode - 96;
  return -1;
};

const centerShift = (container, inner, focused) => {
  if (!container || !inner || !focused) return 0;
  const children = inner.children;
  if (!children.length) return 0;
  /* vertical padding eats into the visible content area: the list can only
     slide until its bottom row meets (box bottom - padding bottom), and the
     center point sits mid-content, not mid-box. */
  const boxStyle = getComputedStyle(container);
  const padTop = parseFloat(boxStyle.paddingTop) || 0;
  const padBottom = parseFloat(boxStyle.paddingBottom) || 0;
  const visible = container.clientHeight - padTop - padBottom;
  if (visible <= 0) return 0;
  const max = Math.max(0, inner.offsetHeight - visible);
  const wanted = focused.offsetTop - (visible - focused.offsetHeight) / 2;
  return Math.max(0, Math.min(Math.round(wanted), max));
};

/* Effective device-pixel grid for an element: devicePixelRatio composed with
   every ancestor transform scale. The Samsung simulator hosts the 1080p app
   inside a scaled frame, so pure CSS-integer offsets still land on fractional
   device pixels and scrolled rows shimmer under rapid navigation. Snapping
   every scroll/tansform write to this grid keeps edges phase-stable at any
   zoom; at scale 1 it is the ordinary whole-pixel round. */
const pixelGridFor = (element) => {
  let grid = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  if (element && element.getBoundingClientRect && element.offsetWidth) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0) grid *= rect.width / element.offsetWidth;
  }
  if (!(grid > 0.25) || !(grid < 9)) grid = 1;
  return grid;
};

const snapPixels = (value, element) => {
  const grid = pixelGridFor(element);
  return Math.round(value * grid) / grid;
};

const logError = (context, error) => {
  if (!window.console) return;
  const detail = error && error.stack ? error.stack : error;
  if (console.error) console.error(`[KPlayer] ${context}:`, detail);
};

const logWarn = (context, error) => {
  if (!window.console) return;
  const detail = error && error.message ? error.message : error;
  if (console.warn) console.warn(`[KPlayer] ${context}:`, detail);
};

let lastReportAt = 0;
const reportError = (context, error, userMessage) => {
  logError(context, error);
  const now = Date.now();
  if (now - lastReportAt < 4000) return;
  lastReportAt = now;
  if (KP.Shell && KP.Shell.toast) {
    KP.Shell.toast(userMessage || "Something went wrong. Please try again.", 4200);
  }
};

const attempt = (context, fn, fallback = null) => {
  try {
    return fn();
  } catch (error) {
    logWarn(context, error);
    return fallback;
  }
};

const KPLAYER_ICONS = {
  tv: '<rect x="2.5" y="6" width="19" height="13" rx="2.4"/><path d="M7.5 19v2h9v-2"/><path d="M11.5 3.5 8.5 6h7l-3-2.5z"/>',
  movie: '<rect x="3" y="4" width="18" height="16" rx="2.4"/><path d="m10.3 8.5 4.9 3.5-4.9 3.5z"/>',
  show: '<rect x="3.5" y="6" width="17" height="11" rx="2.4"/><path d="M4 21h16M8 3l3 3M13 6l3-3"/>',
  vod: '<rect x="5" y="6.5" width="14" height="11" rx="2.4"/><path d="M8.5 19v2.5h7V19"/>',
  star: '<path d="M12 3l2.6 5.6L21 9.7l-4.4 4.3 1 6-5.6-3.1-5.6 3.1 1-6L3.5 9.7l6.4-1.1z"/>',
  play: '<g transform="translate(2.85 2.85)"><circle cx="9.15" cy="9.15" r="9.15"/><path d="M6.65 9.05C6.65 7.61 6.65 6.9 6.95 6.5C7.21 6.15 7.61 5.93 8.04 5.9C8.54 5.87 9.14 6.25 10.35 7.03L10.51 7.13C11.55 7.8 12.08 8.14 12.26 8.57C12.42 8.94 12.42 9.36 12.26 9.73C12.08 10.16 11.55 10.5 10.51 11.17L10.35 11.27C9.14 12.05 8.54 12.43 8.04 12.4C7.61 12.37 7.21 12.15 6.95 11.8C6.65 11.4 6.65 10.69 6.65 9.25L6.65 9.05Z"/></g>',
  playlist: '<path d="M4 6.5h10M4 11.5h10M4 16.5h7"/><path d="M17 10.5l4 2.5-4 2.5z"/>',
  back: '<path d="M15.5 6.5 10 12l5.5 5.5"/><path d="M9 12h10"/>',
  chevRight: '<path d="M9 5.5 15.5 12 9 18.5"/>',
  chevDown: '<path d="M5.5 9 12 15.5 18.5 9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  link: '<path d="M9.5 14.5 14.5 9.5"/><path d="M7.7 16.3 5.9 18a3.5 3.5 0 0 1-5-5l2.4-2.4a3.5 3.5 0 0 1 5 0"/><path d="m16.3 7.7 1.8-1.8a3.5 3.5 0 0 1 5 5l-2.4 2.4a3.5 3.5 0 0 1-5 0"/>',
  reload: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m14 6 4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7 8 20h8l1.5-13"/><path d="M10 11v5M14 11v5"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8"/><path d="m16 6 2 2M13 9l2 2"/>',
  guide: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16.6 16.6 4.4 4.4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-2.8-2.8.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.8-2.8.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 2.8v-.2h4v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>'
};

const iconInner = (name, className) => {
  const body = KPLAYER_ICONS[name] || KPLAYER_ICONS.tv;
  return `<svg class="${className || "ico"}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
};

const kindIcon = (item) => {
  if (!item) return "tv";
  if (item.isVod) return item.kind === "series" ? "show" : "movie";
  if (item.kind === "series") return "show";
  if (item.kind === "movie") return "movie";
  return "tv";
};

const brokenLogos = new Set();

/* Dark logos (Disney+, SporTV, ...) vanish on the dark theme. Remedy:
    classify each logo once with a tiny canvas pass and then
    - mono:   reshape via alpha into a white glyph (sparse dark MONOCHROME
              glyphs like Disney+/SporTV wordmarks)
    - invert: flip very dark monochrome full-bleed images inside out
    - plate:  put a light chip behind the raw image (colorful filled artwork
              like PBR badges, or CORS-blocked analysis)
    - plain:  already readable, untouched (white logos, colorful art).
    Verdicts are cached in localStorage keyed by URL so views stay consistent.
    Store key carries a recipe generation: bump it when rules change so
    devices never re-use verdicts picked by older logic. */
const LOGO_VERDICT_GENERATION = 2;
const LOGO_VERDICT_STORE = "kplayer.logo-verdicts-v" + LOGO_VERDICT_GENERATION;
const LOGO_VERDICT_MAX = 400;
const LOGO_SAMPLE = 48;
const logoVerdicts = (() => {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOGO_VERDICT_STORE) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
})();

const logoVerdictSave = () => {
  try {
    const keys = Object.keys(logoVerdicts);
    if (keys.length > LOGO_VERDICT_MAX) {
      const keep = keys.slice(keys.length - LOGO_VERDICT_MAX);
      const trimmed = {};
      keep.forEach((key) => { trimmed[key] = logoVerdicts[key]; });
      Object.keys(logoVerdicts).forEach((key) => { delete logoVerdicts[key]; });
      Object.keys(trimmed).forEach((key) => { logoVerdicts[key] = trimmed[key]; });
    }
    localStorage.setItem(LOGO_VERDICT_STORE, JSON.stringify(logoVerdicts));
  } catch (error) {
    /* storage full or blocked: verdicts stay session-only */
  }
};

const logoVerdictApply = (image, verdict) => {
  if (!image) return;
  image.classList.toggle("logo-mono", verdict === "mono");
  image.classList.toggle("logo-invert", verdict === "invert");
  image.classList.toggle("logo-plate", verdict === "plate");
};

const logoHash = (url) => {
  let hash = 5381;
  for (let index = 0; index < url.length; index += 1) {
    hash = ((hash << 5) + hash + url.charCodeAt(index)) | 0;
  }
  return String(hash);
};

const logoVerdictFor = (url) => {
  const cached = logoVerdicts[logoHash(url) + url.length];
  return cached === "mono" || cached === "invert" || cached === "plate" ? cached : "unknown";
};

/* Sample the decoded image and pick the contrast recipe. Alpha coverage
   separates shaped PNG/WebP from full-bleed JPEG-style logos; mean luminance
   separates dark from light; hue-bucket variety keeps colorful filled artwork
   (PBR badges, flat illustrations) out of the white-reshape path. */
const logoCanvas = (typeof document === "undefined") ? null : document.createElement("canvas");

const logoClassify = (image, src) => {
  if (!logoCanvas || !image.naturalWidth || !image.naturalHeight) return;
  const width = Math.max(1, Math.min(LOGO_SAMPLE, image.naturalWidth));
  const height = Math.max(1, Math.min(LOGO_SAMPLE, image.naturalHeight));
  logoCanvas.width = width;
  logoCanvas.height = height;
  const context = logoCanvas.getContext("2d");
  if (!context) return;
  let data = null;
  try {
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    data = context.getImageData(0, 0, width, height).data;
  } catch (error) {
    logoVerdicts[logoHash(src) + src.length] = "plate";
    logoVerdictSave();
    logoVerdictApply(image, "plate");
    return;
  }
  let opaque = 0;
  let lumaSum = 0;
  let darkCount = 0;
  const hueBuckets = [false, false, false, false, false, false, false, false, false, false, false, false];
  const total = width * height;
  for (let index = 0; index < total; index += 1) {
    const offset = index * 4;
    const alpha = data[offset + 3];
    if (alpha < 32) continue;
    opaque += 1;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    lumaSum += luma * (alpha / 255);
    if (luma < 128) darkCount += 1;
    /* count distinct saturated hue families: logos with 2+ families carry
       real color artwork and must never be reduced to a white silhouette */
    const maxChannel = Math.max(red, green, blue);
    const minChannel = Math.min(red, green, blue);
    const value = maxChannel / 255;
    const sat = maxChannel ? (maxChannel - minChannel) / maxChannel : 0;
    if (sat >= 0.3 && value >= 0.2 && alpha >= 200) {
      const delta = (maxChannel - minChannel) || 1;
      let hue = 0;
      if (maxChannel === red) hue = 60 * (((green - blue) / delta) % 6);
      else if (maxChannel === green) hue = 60 * ((blue - red) / delta + 2);
      else hue = 60 * ((red - green) / delta + 4);
      if (hue < 0) hue += 360;
      hueBuckets[Math.floor(hue / 30) % 12] = true;
    }
  }
  let hueFamilies = 0;
  for (let bucket = 0; bucket < 12; bucket += 1) if (hueBuckets[bucket]) hueFamilies += 1;
  const coverage = opaque / total;
  /* lumaSum is alpha-weighted on the raw 0-255 scale: normalize to 0-1 */
  const lumaMean = opaque ? (lumaSum / opaque) / 255 : 1;
  const bleadMean = (lumaSum / total) / 255;
  const darkFrac = opaque ? darkCount / opaque : 0;
  let verdict = "plain";
  if (coverage < 0.02) {
    verdict = "plain";
  } else if (coverage > 0.92) {
    /* full-bleed: invert only really dark monochrome images; colorful art
       already reads on the dark theme */
    if (bleadMean < 0.35 && hueFamilies <= 1) verdict = "invert";
    else if (bleadMean < 0.55) verdict = "plate";
    else verdict = "plain";
  } else if (lumaMean < 0.55 && darkFrac > 0.6) {
    /* dark logo: thin monochrome glyph -> white reshape; anything denser or
       multi-hued keeps its art on a light chip instead */
    verdict = (hueFamilies <= 1 && coverage < 0.3) ? "mono" : "plate";
  } else {
    verdict = "plain";
  }
  logoVerdicts[logoHash(src) + src.length] = verdict;
  logoVerdictSave();
  logoVerdictApply(image, verdict);
};

const logoFallback = (channel) => `<span class="logo-fb">${iconInner(kindIcon(channel))}</span>`;

const logoInner = (channel) => {
  const fallback = logoFallback(channel);
  if (!channel || !channel.logo) return fallback;
  if (brokenLogos.has(channel.logo)) return fallback;
  const verdict = logoVerdictFor(channel.logo);
  const extra = verdict === "unknown" ? "" : ` logo-${verdict}`;
  return `<img class="logo-img${extra}" src="${esc(channel.logo)}" alt=""/>${fallback}`;
};

const logoBox = (channel, className) => `<div class="${className}">${logoInner(channel)}</div>`;

const logoDefs = () =>
  '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' +
  '<filter id="kp-mono" color-interpolation-filters="sRGB">' +
  '<feFlood flood-color="#f4f6f9" result="flood"/>' +
  '<feComposite in="flood" in2="SourceGraphic" operator="in"/>' +
  "</filter></svg>";

const logoFallbackFor = (image) => {
  const sibling = image.nextElementSibling;
  return sibling && String(sibling.className).includes("logo-fb") ? sibling : null;
};

const installLogoHandlers = () => {
  if (logoCanvas && !document.getElementById("kp-mono")) {
    const holder = document.createElement("div");
    holder.innerHTML = logoDefs();
    document.body.appendChild(holder.firstChild);
  }
  document.addEventListener("error", (event) => {
    const target = event.target;
    if (!target || target.tagName !== "IMG" || !String(target.className).includes("logo-img")) return;
    const src = target.getAttribute("src") || "";
    if (src) brokenLogos.add(src);
    if (target.src) brokenLogos.add(target.src);
    target.style.display = "none";
    const fallback = logoFallbackFor(target);
    if (fallback) fallback.style.display = "flex";
  }, true);
  document.addEventListener("load", (event) => {
    const target = event.target;
    if (!target || target.tagName !== "IMG" || !String(target.className).includes("logo-img")) return;
    const fallback = logoFallbackFor(target);
    if (fallback) fallback.style.display = "none";
    const src = target.getAttribute("src") || "";
    const verdict = logoVerdictFor(src);
    if (verdict === "unknown") logoClassify(target, src);
    else logoVerdictApply(target, verdict);
  }, true);
};

const brandMark = (className) =>
  `<img class="${className || "brand-mark"}" src="${KP.BRAND.icon}" alt=""/>`;

const isTizen = () => !!(window.webapis && window.webapis.avplay);

const installGlobalErrorHandler = () => {
  window.addEventListener("error", (event) => {
    if (event && event.target && event.target !== window) return;
    reportError("Unhandled runtime error", (event && (event.error || event.message)) || event);
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError("Unhandled promise rejection", event && event.reason);
  });
};

KP.Utils = {
  byId,
  esc,
  fmtNum,
  fmtTime,
  fmtDuration,
  nowNext,
  progress,
  designPx,
  pixelRow,
  pixelGrid: pixelGridFor,
  snapPixels,
  digitFromKey,
  centerShift,
  logError,
  logWarn,
  reportError,
  attempt,
  isTizen
};
KP.Icons = {
  inner: iconInner,
  kind: kindIcon
};
KP.Logo = {
  inner: logoInner,
  box: logoBox,
  install: installLogoHandlers,
  verdictFor: logoVerdictFor,
  classify: logoClassify
};
KP.brandMark = brandMark;
KP.installGlobalErrorHandler = installGlobalErrorHandler;
