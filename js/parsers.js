/* KPlayer parsers: M3U, XMLTV and Xtream URL builders.
   Pure functions only; no DOM, storage or network access. */
"use strict";

const parserWarn = (context, error) => {
  if (window.console && console.warn) console.warn(`[KPlayer parsers] ${context}:`, error);
};

const decodeEntities = (value) => String(value == null ? "" : value)
  .replace(/&#(\d+);/g, (match, decimal) => String.fromCharCode(parseInt(decimal, 10)))
  .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&");

const splitExtinf = (body) => {
  let quoted = false;
  let comma = -1;
  for (let index = 0; index < body.length; index += 1) {
    const character = body.charAt(index);
    if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      comma = index;
      break;
    }
  }
  if (comma < 0) comma = body.lastIndexOf(",");
  return {
    attrs: comma >= 0 ? body.substring(0, comma) : body,
    name: comma >= 0 ? body.substring(comma + 1).trim() : ""
  };
};

const M3U_PARSE_CHUNK_MS = 12;
const M3U_PARSE_CHUNK_LINES = 4000;

const m3uParseState = (options) => ({
  maxChannels: options.maxChannels || 0,
  groups: [],
  seenGroups: new Set(),
  channels: [],
  truncated: false,
  current: null,
  pendingGroup: ""
});

const m3uParseGroup = (state, name) => {
  if (state.seenGroups.has(name)) return;
  state.seenGroups.add(name);
  state.groups.push(name);
};

const m3uParseLine = (state, rawLine) => {
  const line = String(rawLine || "").trim();
  if (!line) return true;

  if (line.startsWith("#EXTINF:")) {
    const parts = splitExtinf(line.substring(8));
    let tvgId = "";
    let tvgLogo = "";
    let groupTitle = "";
    const attrRegex = /([\w-]+)\s*=\s*"([^"]*)"/g;
    let match;
    while ((match = attrRegex.exec(parts.attrs)) !== null) {
      const key = match[1].toLowerCase();
      if (key === "tvg-id") tvgId = match[2];
      else if (key === "tvg-logo") tvgLogo = match[2];
      else if (key === "group-title") groupTitle = match[2];
    }
    state.current = {
      name: decodeEntities(parts.name) || "Channel",
      epgId: tvgId,
      logo: tvgLogo,
      group: decodeEntities(groupTitle) || state.pendingGroup || "Ungrouped"
    };
    state.pendingGroup = "";
  } else if (line.startsWith("#EXTGRP:")) {
    state.pendingGroup = decodeEntities(line.substring(8).trim()) || "Ungrouped";
    if (state.current) state.current.group = state.pendingGroup;
  } else if (!line.startsWith("#") && state.current) {
    if (state.maxChannels && state.channels.length >= state.maxChannels) {
      state.truncated = true;
      return false;
    }
    m3uParseGroup(state, state.current.group);
    state.channels.push({
      name: state.current.name,
      url: line,
      logo: state.current.logo,
      group: state.current.group,
      epgId: state.current.epgId
    });
    state.current = null;
  }
  return true;
};

const m3uParseResult = (state) => ({
  groups: state.groups,
  channels: state.channels,
  truncated: state.truncated
});

const parseM3U = (text, options = {}) => {
  const state = m3uParseState(options);
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const rawLine of lines) {
    if (!m3uParseLine(state, rawLine)) break;
  }
  return m3uParseResult(state);
};

const parseM3UChunked = (text, options = {}, done) => {
  const state = m3uParseState(options || {});
  const source = String(text || "").replace(/^\uFEFF/, "");
  let position = 0;

  const step = () => {
    try {
      const started = Date.now();
      let processed = 0;
      while (position < source.length) {
        let end = source.indexOf("\n", position);
        if (end < 0) end = source.length;
        const rawLine = source.substring(position, end);
        position = end + 1;
        processed += 1;
        if (!m3uParseLine(state, rawLine)) {
          if (typeof done === "function") done(null, m3uParseResult(state));
          return;
        }
        if (processed >= M3U_PARSE_CHUNK_LINES || Date.now() - started >= M3U_PARSE_CHUNK_MS) {
          setTimeout(step, 0);
          return;
        }
      }
      if (typeof done === "function") done(null, m3uParseResult(state));
    } catch (error) {
      if (typeof done === "function") done(error);
    }
  };

  setTimeout(step, 0);
};

const safeDecode = (value) => {
  try {
    return decodeURIComponent(String(value || "").replace(/\+/g, " "));
  } catch (error) {
    parserWarn("Invalid URL-encoded component", error);
    return String(value || "");
  }
};

const xtreamFromGetUrl = (raw) => {
  const source = String(raw || "").trim();
  const match = /^(https?:\/\/.+?)\/get\.php(?:\?([^#]*))?/i.exec(source);
  if (!match) return null;
  const query = {};
  String(match[2] || "").split("&").forEach((pair) => {
    if (!pair) return;
    const index = pair.indexOf("=");
    const key = index < 0 ? pair : pair.substring(0, index);
    const value = index < 0 ? "" : pair.substring(index + 1);
    query[safeDecode(key).toLowerCase()] = safeDecode(value);
  });
  const user = query.username || query.user || "";
  const pass = query.password || query.pass || "";
  if (!user || !pass) return null;
  return {
    base: match[1].replace(/\/+$/, ""),
    user,
    pass
  };
};

const parseXMLTVTimestamp = (value) => {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*([+-]\d{4}))?/);
  if (!match) return null;
  let date = Date.UTC(
    parseInt(match[1], 10),
    parseInt(match[2], 10) - 1,
    parseInt(match[3], 10),
    parseInt(match[4], 10),
    parseInt(match[5], 10),
    match[6] ? parseInt(match[6], 10) : 0
  );
  if (match[7]) {
    const sign = match[7].charAt(0) === "-" ? 1 : -1;
    const hours = parseInt(match[7].substring(1, 3), 10);
    const minutes = parseInt(match[7].substring(3, 5), 10);
    date += sign * (hours * 3600 + minutes * 60) * 1000;
  }
  return date;
};

const parseXMLTV = (text) => {
  const channels = {};
  const programmes = [];
  const channelRegex = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
  let match;

  while ((match = channelRegex.exec(text)) !== null) {
    const idMatch = match[1].match(/\bid="([^"]*)"/);
    if (!idMatch) continue;
    const content = match[2];
    const nameMatch = content.match(/<display-name[^>]*>([\s\S]*?)<\/display-name>/);
    const iconMatch = content.match(/<icon\s+src="([^"]*)"/);
    channels[idMatch[1]] = {
      name: nameMatch ? decodeEntities(nameMatch[1].trim()) : "",
      icon: iconMatch ? iconMatch[1] : ""
    };
  }

  const programmeRegex = /<programme\s+([^>]+)>([\s\S]*?)<\/programme>/g;
  while ((match = programmeRegex.exec(text)) !== null) {
    const attrs = match[1];
    const body = match[2];
    const startMatch = attrs.match(/start="([^"]+)"/);
    const stopMatch = attrs.match(/stop="([^"]+)"/);
    const channelMatch = attrs.match(/channel="([^"]+)"/);
    if (!startMatch || !stopMatch || !channelMatch) continue;
    const start = parseXMLTVTimestamp(startMatch[1]);
    const end = parseXMLTVTimestamp(stopMatch[1]);
    if (start === null || end === null) continue;
    const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const descMatch = body.match(/<desc[^>]*>([\s\S]*?)<\/desc>/);
    const categoryMatch = body.match(/<category[^>]*>([\s\S]*?)<\/category>/);
    programmes.push({
      channel: channelMatch[1],
      title: titleMatch ? decodeEntities(titleMatch[1].trim()) : "",
      desc: descMatch ? decodeEntities(descMatch[1].trim()) : "",
      start,
      end,
      category: categoryMatch ? decodeEntities(categoryMatch[1].trim()) : ""
    });
  }

  programmes.sort((a, b) => a.start - b.start);
  return { channels, programmes };
};

const encodePathPart = (value) => encodeURIComponent(String(value == null ? "" : value));

const baseUrl = (value) => String(value || "").replace(/\/+$/, "");

const Xtream = {
  api: (base, username, password, action, extra) => {
    let params = `username=${encodePathPart(username)}&password=${encodePathPart(password)}&action=${encodePathPart(action)}`;
    if (extra) {
      Object.keys(extra).forEach((key) => {
        params += `&${encodePathPart(key)}=${encodePathPart(extra[key])}`;
      });
    }
    return `${baseUrl(base)}/player_api.php?${params}`;
  },

  liveUrl: (base, username, password, streamId, extension) =>
    `${baseUrl(base)}/live/${encodePathPart(username)}/${encodePathPart(password)}/${encodePathPart(streamId)}.${extension || "ts"}`,

  vodUrl: (base, username, password, streamId, extension) =>
    `${baseUrl(base)}/movie/${encodePathPart(username)}/${encodePathPart(password)}/${encodePathPart(streamId)}.${extension || "mp4"}`,

  seriesUrl: (base, username, password, episodeId, extension) =>
    `${baseUrl(base)}/series/${encodePathPart(username)}/${encodePathPart(password)}/${encodePathPart(episodeId)}.${extension || "mp4"}`,

  timeshiftUrl: (base, username, password, streamId, startDate, durationMin) => {
    const date = new Date(startDate);
    const pad = (number) => String(number).padStart(2, "0");
    const start = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
      `:${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}`;
    return `${baseUrl(base)}/streaming/timeshift.php?username=${encodePathPart(username)}` +
      `&password=${encodePathPart(password)}&stream=${encodePathPart(streamId)}` +
      `&start=${encodePathPart(start)}&duration=${encodePathPart(String(durationMin))}`;
  }
};

const classifyVod = (name, url) => {
  const normalizedName = String(name || "").toLowerCase();
  const normalizedUrl = String(url || "").toLowerCase();
  if (/s\d{1,2}e\d{1,2}/i.test(normalizedName) || normalizedUrl.includes("/series/")) return "series";
  if (normalizedUrl.includes("/movie/") || /\.(mp4|mkv|avi)(\?|$)/i.test(normalizedUrl)) return "movie";
  return "live";
};

const Parsers = {
  parseM3U,
  parseM3UChunked,
  parseXMLTV,
  xtreamFromGetUrl,
  Xtream,
  classifyVod
};

KP.Parsers = Parsers;
window.Parsers = Parsers;
if (typeof module !== "undefined" && module.exports) module.exports = Parsers;
