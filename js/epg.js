/* KPlayer EPG: explicit XMLTV downloads plus lazy Xtream short-guide lookups.
   Full guides are capped and parsed off the playlist load path; short guides are
   queued with a small concurrency limit so the UI never stalls the TV. */
"use strict";

const EPG_MAX_BYTES = 80e6;
const EPG_PARALLEL = 3;
const EPG_STALE_MS = 5 * 60e3;
const EPG_EMPTY_MS = 30 * 60e3;

class KPlayerEpg {
  constructor() {
    this._queue = [];
    this._active = 0;
    this._seen = new Set();
    this._notifyTimers = new Map();
  }

  _log(context, error) {
    KP.Utils.logWarn(`epg/${context}`, error);
  }

  _notifyNow(playlist) {
    if (!KP.Store) return;
    KP.Store.notify("epg", playlist);
  }

  _notifySoon(playlist) {
    if (!playlist) return;
    const id = playlist.id;
    const previous = this._notifyTimers.get(id);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this._notifyTimers.delete(id);
      this._notifyNow(playlist);
    }, 150);
    this._notifyTimers.set(id, timer);
  }

  on(fn) {
    return KP.Store ? KP.Store.on("epg", fn) : () => {};
  }

  _normalizeId(value) {
    return String(value == null ? "" : value).trim().toLowerCase();
  }

  _decodeValue(value) {
    const text = String(value == null ? "" : value).trim();
    if (!text) return "";
    if (!/^[A-Za-z0-9+/=_\-\s]+$/.test(text)) return text;
    try {
      const decoded = decodeURIComponent(escape(atob(text.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, ""))));
      return /[\u0000-\u0008\u000e-\u001f]/.test(decoded) ? text : decoded;
    } catch (error) {
      this._log("decode", error);
      return text;
    }
  }

  _startOf(item) {
    if (item.start_timestamp) return Number(item.start_timestamp) * 1000;
    const parsed = item.start ? Date.parse(String(item.start).replace(" ", "T")) : NaN;
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  _stopOf(item) {
    if (item.stop_timestamp) return Number(item.stop_timestamp) * 1000;
    const parsed = item.stop ? Date.parse(String(item.stop).replace(" ", "T")) : NaN;
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  _shortEpgUrl(playlist, channel) {
    return KP.Parsers.Xtream.api(playlist.url, playlist.user, playlist.pass, "get_short_epg", {
      stream_id: channel.xtreamId,
      limit: 12
    });
  }

  _mergeProgrammes(channel, programmes) {
    const cutoff = Date.now() - 7 * 864e5;
    const incoming = new Set(programmes.map((programme) => `${programme.start}|${programme.end}`));
    const merged = (channel.programmes || []).filter((programme) =>
      programme && programme.end >= cutoff && !incoming.has(`${programme.start}|${programme.end}`)
    );
    merged.push(...programmes);
    merged.sort((a, b) => a.start - b.start);
    channel.programmes = merged;
  }

  _applyGuide(playlist, guide) {
    const byChannel = new Map();
    const infoByChannel = new Map();
    let matched = 0;
    const programmes = guide.programmes || [];
    const channels = guide.channels || {};

    programmes.forEach((programme) => {
      const key = this._normalizeId(programme.channel);
      if (!key) return;
      if (!byChannel.has(key)) byChannel.set(key, []);
      byChannel.get(key).push(programme);
    });

    Object.keys(channels).forEach((key) => {
      infoByChannel.set(this._normalizeId(key), channels[key]);
    });

    (playlist._channels || []).forEach((channel) => {
      const id = this._normalizeId(channel.epgId);
      const list = id ? byChannel.get(id) : null;
      if (!list || !list.length) return;
      const clean = [];
      list.forEach((programme) => {
        if (!(programme.start && programme.end > programme.start)) return;
        clean.push({
          title: programme.title || "No programme information",
          desc: programme.desc || "",
          start: programme.start,
          end: programme.end,
          category: programme.category || ""
        });
      });
      if (!clean.length) return;
      this._mergeProgrammes(channel, clean);
      matched += 1;
      const info = channels[channel.epgId] || infoByChannel.get(id);
      if (info && info.icon && !channel.logo) channel.logo = info.icon;
    });

    return matched;
  }

  _guideUrls(playlist) {
    const urls = [];
    (playlist.epgUrls || []).forEach((url) => {
      const value = String(url || "").trim();
      if (value && !urls.includes(value)) urls.push(value);
    });
    return urls;
  }

  _finishGuide(playlist, failures, successes, matched, done) {
    playlist._epgLoading = false;
    if (failures.length && !successes) {
      playlist.epgWarning = `Guide could not be loaded: ${failures[0]}`;
    } else if (successes && !matched) {
      playlist.epgWarning = "Guide downloaded, but its channel IDs did not match this playlist.";
    } else {
      playlist.epgWarning = "";
    }
    if (matched) playlist._epgAny = true;
    this._notifyNow(playlist);
    if (typeof done === "function") done(null, matched);
  }

  loadForPlaylist(playlist, done = () => {}) {
    if (!playlist) {
      done(new Error("Playlist not found"));
      return;
    }
    if (playlist._epgLoading) {
      done(null, 0);
      return;
    }

    const urls = this._guideUrls(playlist);
    if (!urls.length) {
      playlist._epgLoading = false;
      playlist.epgWarning = "";
      this._notifyNow(playlist);
      done(null, 0);
      return;
    }

    playlist._epgLoading = true;
    playlist.epgWarning = "";
    this._notifySoon(playlist);

    let left = urls.length;
    const failures = [];
    let successes = 0;
    let matched = 0;

    const oneDone = () => {
      left -= 1;
      if (left > 0) return;
      this._finishGuide(playlist, failures, successes, matched, done);
    };

    urls.forEach((url) => {
      KP.Net.text(url, { timeoutMs: 90000, maxBytes: EPG_MAX_BYTES, retries: 0 }, (error, text) => {
        if (error) {
          failures.push(error.message || String(error));
          this._log("guide-download", error);
          oneDone();
          return;
        }
        if (!text) {
          failures.push("The guide file was empty");
          oneDone();
          return;
        }
        try {
          const guide = KP.Parsers.parseXMLTV(text);
          successes += 1;
          matched += this._applyGuide(playlist, guide);
        } catch (parseError) {
          failures.push("The guide file could not be parsed");
          this._log("guide-parse", parseError);
        }
        this._notifySoon(playlist);
        oneDone();
      });
    });
  }

  _playlistForChannel(channel) {
    return channel ? KP.Store.getPlaylist(channel.playlistId) : null;
  }

  _queueShortEpg(playlist, channel, groupKey) {
    if (!playlist || playlist.type !== "xtream" || !channel || !channel.xtreamId) return;
    if (playlist.epgUrls && playlist.epgUrls.length && !playlist.epgWarning) return;
    const cache = playlist._shortEpg || (playlist._shortEpg = {});
    const key = String(channel.xtreamId);
    const record = cache[key];
    const now = Date.now();
    if (record) {
      if (record.loading) return;
      if (record.at && now - record.at < (record.empty ? EPG_EMPTY_MS : EPG_STALE_MS)) return;
    }
    const seenKey = `${playlist.id}:${key}`;
    if (this._seen.has(seenKey)) return;
    this._seen.add(seenKey);
    cache[key] = { loading: true, at: record ? record.at : 0, empty: false, error: "" };
    channel._epgLoading = true;
    playlist._epgPending = (playlist._epgPending || 0) + 1;
    playlist._epgLoading = true;
    this._queue.push({ playlist, channel, key, group: groupKey || "" });
    this._pump();
  }

  _fetchShortEpg(task) {
    const playlist = task.playlist;
    const channel = task.channel;
    const cache = playlist._shortEpg || (playlist._shortEpg = {});
    const record = cache[task.key] || (cache[task.key] = {});

    KP.Net.json(this._shortEpgUrl(playlist, channel), { timeoutMs: 25000, retries: 1 }, (error, response) => {
      const programmes = [];
      const list = !error && response ? (response.epg_listings || response.EPGListings) : null;
      if (Array.isArray(list)) {
        list.forEach((item) => {
          const start = this._startOf(item);
          const end = this._stopOf(item);
          if (!(start && end > start)) return;
          programmes.push({
            title: this._decodeValue(item.title) || "No programme information",
            desc: this._decodeValue(item.description || item.desc || ""),
            start,
            end
          });
        });
      }
      if (error) this._log(`short-guide ${task.key}`, error);
      record.loading = false;
      record.at = Date.now();
      record.empty = !programmes.length;
      record.error = error ? String(error.message || error) : "";
      channel._epgLoading = false;
      if (programmes.length) {
        this._mergeProgrammes(channel, programmes);
        playlist._epgAny = true;
      }
      this._seen.delete(`${playlist.id}:${task.key}`);
      this._active = Math.max(0, this._active - 1);
      playlist._epgPending = Math.max(0, (playlist._epgPending || 1) - 1);
      if (!playlist._epgPending) playlist._epgLoading = false;
      this._notifySoon(playlist);
      this._pump();
    });
  }

  _pump() {
    while (this._active < EPG_PARALLEL && this._queue.length) {
      this._active += 1;
      this._fetchShortEpg(this._queue.shift());
    }
  }

  ensureEpg(channel, groupKey) {
    const playlist = this._playlistForChannel(channel);
    if (playlist) this._queueShortEpg(playlist, channel, groupKey);
  }

  ensureEpgList(channels, groupKey) {
    (channels || []).forEach((channel) => this.ensureEpg(channel, groupKey));
  }

  /* Guide group changed: queued-but-unstarted rows for other groups are
     stale work; free them (channel may be re-queued on revisit) instead of
     letting a pressed-through backlog delay the group on screen. Tasks left
     untagged - playback, schedule, channel list - stay in place, and the
     already-running requests are not cancelled. */
  dropExternalGroup(groupKey) {
    if (!this._queue.length || !groupKey) return 0;
    let dropped = 0;
    const kept = [];
    this._queue.forEach((task) => {
      if (task.group && task.group !== groupKey) {
        dropped += 1;
        this._revokeQueued(task);
      } else {
        kept.push(task);
      }
    });
    if (dropped) this._queue = kept;
    return dropped;
  }

  _revokeQueued(task) {
    const playlist = task.playlist;
    const cache = playlist._shortEpg || (playlist._shortEpg = {});
    delete cache[task.key];
    this._seen.delete(`${playlist.id}:${task.key}`);
    task.channel._epgLoading = false;
    playlist._epgPending = Math.max(0, (playlist._epgPending || 1) - 1);
    if (!playlist._epgPending) playlist._epgLoading = false;
  }

  _resetShortEpg(playlist) {
    playlist._shortEpg = {};
    playlist._epgAny = false;
    playlist._epgPending = 0;
    playlist._epgLoading = false;
    this._queue = this._queue.filter((task) => task.playlist !== playlist);
    const prefix = `${playlist.id}:`;
    for (const key of Array.from(this._seen)) {
      if (key.startsWith(prefix)) this._seen.delete(key);
    }
    const timer = this._notifyTimers.get(playlist.id);
    if (timer) clearTimeout(timer);
    this._notifyTimers.delete(playlist.id);
  }

  retry(playlist) {
    const target = playlist || (KP.Store ? KP.Store.active() : null);
    if (!target) return;
    this._resetShortEpg(target);
    if (target.epgUrls && target.epgUrls.length) {
      this.loadForPlaylist(target, () => this._notifyNow(target));
    } else {
      this._notifyNow(target);
    }
  }

  forgetPlaylist(playlist) {
    if (!playlist) return;
    this._resetShortEpg(playlist);
  }

  epgLoading() {
    const playlist = KP.Store ? KP.Store.active() : null;
    return !!(playlist && (playlist._epgLoading || playlist._epgPending));
  }

  epgAny() {
    const playlist = KP.Store ? KP.Store.active() : null;
    return !!(playlist && playlist._epgAny);
  }

  statusForChannel(channel) {
    const playlist = this._playlistForChannel(channel);
    if (!playlist) return { loading: false, error: false };
    const key = channel && channel.xtreamId ? String(channel.xtreamId) : "";
    const record = key && playlist._shortEpg ? playlist._shortEpg[key] : null;
    const guideLoading = !!(playlist.epgUrls && playlist.epgUrls.length && playlist._epgLoading);
    const loading = !!(channel && (channel._epgLoading || (record && record.loading)) || guideLoading);
    const hasProgrammes = !!(channel && channel.programmes && channel.programmes.length);
    const error = !hasProgrammes && !loading &&
      !!((record && record.error) || playlist.epgWarning);
    return { loading, error };
  }
}

const kplayerEpg = new KPlayerEpg();
KP.Epg = kplayerEpg;

if (KP.Store) {
  KP.Store.ensureEpg = (channel) => kplayerEpg.ensureEpg(channel);
  KP.Store.ensureEpgList = (channels) => kplayerEpg.ensureEpgList(channels);
  KP.Store.retryEpg = (playlist) => kplayerEpg.retry(playlist);
  KP.Store.epgLoading = () => kplayerEpg.epgLoading();
  KP.Store.epgAny = () => kplayerEpg.epgAny();
  KP.Store.onEpg = (fn) => kplayerEpg.on(fn);
}
