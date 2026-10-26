/* KPlayer store: playlist definitions, saved preferences and the active catalogue.
   Only small data is persisted in localStorage. Channels, EPG and VOD pages stay
   in memory and are rebuilt from the provider when needed. */
"use strict";

const STORE_KEY = "ktv.store.v1";
const STORE_DEFAULT_SETTINGS = {
  accent: "Blue",
  bufferSize: "Medium",
  decoder: "Hardware",
  seekStepSec: 30,
  lastChannelOnStart: false,
  zapInGroup: false,
  epgPastDays: 2,
  epgUpdateHours: 12,
  parentalPin: "",
  lockedGroups: [],
  jsonPlaylistUrl: ""
};

class KPlayerStore {
  constructor() {
    this._listeners = {};
    this._storageError = null;
    this._groupsCache = null;
    this._data = this._sanitizeState(null);
    try {
      const stored = localStorage.getItem(STORE_KEY);
      if (stored) this._data = this._sanitizeState(JSON.parse(stored));
    } catch (error) {
      this._storageError = error;
      KP.Utils.logError("store/load", error);
      this._data = this._sanitizeState(null);
    }
  }

  get playlists() {
    return this._data.playlists;
  }

  _log(context, error) {
    KP.Utils.logWarn(`store/${context}`, error);
  }

  _uid() {
    return `pl${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  }

  _initials(name) {
    const parts = String(name || "?").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  absoluteLogo(base, value) {
    const source = String(value || "").trim();
    if (!source) return "";
    if (/^https?:\/\//i.test(source)) return source;
    if (source.startsWith("//")) return `http:${source}`;
    if (source.startsWith("data:")) return source;
    const root = String(base || "").replace(/\/+$/, "");
    return `${root}${source.charAt(0) === "/" ? "" : "/"}${source}`;
  }

  _defaultSettings() {
    return { ...STORE_DEFAULT_SETTINGS, lockedGroups: [] };
  }

  _defaults() {
    return {
      playlists: [],
      activePlaylistId: "",
      favorites: [],
      recents: [],
      mylist: [],
      progress: {},
      settings: this._defaultSettings()
    };
  }

  _normalizePlaylist(playlist) {
    if (!playlist || typeof playlist !== "object") return null;
    const normalized = {
      id: String(playlist.id || this._uid()),
      name: String(playlist.name || "Playlist").trim() || "Playlist",
      type: playlist.type === "xtream" ? "xtream" : "m3u",
      url: String(playlist.url || "").trim(),
      user: String(playlist.user || ""),
      pass: String(playlist.pass || ""),
      epgUrls: Array.isArray(playlist.epgUrls)
        ? playlist.epgUrls.filter((url) => typeof url === "string" && url.trim()).map((url) => url.trim())
        : [],
      updatedAt: Number(playlist.updatedAt) > 0 ? Number(playlist.updatedAt) : 0
    };
    if (normalized.type !== "xtream" && KP.Parsers && KP.Parsers.xtreamFromGetUrl) {
      const xtream = KP.Parsers.xtreamFromGetUrl(normalized.url);
      if (xtream) {
        normalized.type = "xtream";
        normalized.url = xtream.base;
        normalized.user = xtream.user;
        normalized.pass = xtream.pass;
      }
    }
    return normalized;
  }

  _sanitizeState(raw) {
    const clean = this._defaults();
    if (!raw || typeof raw !== "object") return clean;
    if (Array.isArray(raw.playlists)) {
      const ids = new Set();
      raw.playlists.forEach((item) => {
        const playlist = this._normalizePlaylist(item);
        if (!playlist) return;
        if (ids.has(playlist.id)) playlist.id = this._uid();
        ids.add(playlist.id);
        clean.playlists.push(playlist);
      });
    }
    clean.activePlaylistId = String(raw.activePlaylistId || "");
    if (clean.activePlaylistId && !clean.playlists.some((playlist) => playlist.id === clean.activePlaylistId)) {
      clean.activePlaylistId = "";
    }
    if (!clean.activePlaylistId && clean.playlists.length) clean.activePlaylistId = clean.playlists[0].id;
    clean.favorites = Array.isArray(raw.favorites)
      ? raw.favorites.filter((id) => typeof id === "string")
      : [];
    clean.recents = Array.isArray(raw.recents)
      ? raw.recents.filter((id) => typeof id === "string")
      : [];
    clean.mylist = Array.isArray(raw.mylist)
      ? raw.mylist.filter((key) => typeof key === "string")
      : [];
    clean.progress = raw.progress && typeof raw.progress === "object" ? raw.progress : {};
    const rawSettings = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
    clean.settings = { ...this._defaultSettings(), ...rawSettings };
    Object.entries(STORE_DEFAULT_SETTINGS).forEach(([key, value]) => {
      if (clean.settings[key] === undefined) clean.settings[key] = value;
    });
    if (!Array.isArray(clean.settings.lockedGroups)) clean.settings.lockedGroups = [];
    else clean.settings.lockedGroups = clean.settings.lockedGroups.slice();
    clean.settings.parentalPin = String(clean.settings.parentalPin || "");
    clean.settings.jsonPlaylistUrl = String(clean.settings.jsonPlaylistUrl || "");
    return clean;
  }

  on(event, fn) {
    if (typeof fn !== "function") return () => {};
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
    return () => {
      const list = this._listeners[event] || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    };
  }

  notify(event, payload) {
    const list = (this._listeners[event] || []).slice();
    for (const listener of list) {
      try {
        listener(payload);
      } catch (error) {
        KP.Utils.logError(`store/notify/${event}`, error);
      }
    }
  }

  _snapshot() {
    return {
      playlists: this._data.playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        type: playlist.type,
        url: playlist.url,
        user: playlist.user || "",
        pass: playlist.pass || "",
        epgUrls: (playlist.epgUrls || []).slice(),
        updatedAt: playlist.updatedAt || 0
      })),
      activePlaylistId: this._data.activePlaylistId,
      favorites: this._data.favorites.slice(),
      recents: this._data.recents.slice(),
      mylist: this._data.mylist.slice(),
      progress: this._data.progress,
      settings: this._data.settings
    };
  }

  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this._snapshot()));
      this._storageError = null;
      return true;
    } catch (error) {
      this._storageError = error;
      KP.Utils.logError("store/save", error);
      this.notify("storage-error", {
        error,
        message: "KPlayer could not save changes on this TV. Storage may be full or unavailable."
      });
      return false;
    }
  }

  active() {
    const playlists = this._data.playlists;
    return playlists.find((playlist) => playlist.id === this._data.activePlaylistId) || playlists[0] || null;
  }

  activeId() {
    const playlist = this.active();
    return playlist ? playlist.id : "";
  }

  getPlaylist(id) {
    return this._data.playlists.find((playlist) => playlist.id === id) || null;
  }

  hasData() {
    const playlist = this.active();
    return !!(playlist && playlist._channels && playlist._channels.length);
  }

  totalChannels() {
    return this._data.playlists.reduce((total, playlist) => total + (playlist._channels || []).length, 0);
  }

  _channelItem(playlist, item, index) {
    return {
      id: `${playlist.id}:${index}`,
      num: index + 1,
      name: String(item.name || "Channel").trim(),
      logoText: this._initials(item.name),
      logo: this.absoluteLogo(playlist.type === "xtream" ? playlist.url : "", item.logo),
      url: item.url || "",
      epgId: item.epgId || "",
      group: String(item.group || "Ungrouped").trim() || "Ungrouped",
      programmes: [],
      xtreamId: item.xtreamId || null,
      playlistId: playlist.id
    };
  }

  _normalizeChannels(playlist, rawChannels) {
    return (rawChannels || []).map((item, index) => this._channelItem(playlist, item, index));
  }

  _normalizeChannelsChunked(playlist, rawChannels, done) {
    const source = rawChannels || [];
    const result = [];
    let index = 0;
    const step = () => {
      try {
        const started = Date.now();
        while (index < source.length) {
          result.push(this._channelItem(playlist, source[index], index));
          index += 1;
          if (Date.now() - started >= 12) {
            setTimeout(step, 0);
            return;
          }
        }
        done(null, result);
      } catch (error) {
        done(error);
      }
    };
    setTimeout(step, 0);
  }

  _loadM3U(playlist, done) {
    const xtream = KP.Parsers.xtreamFromGetUrl(playlist.url || "");
    if (xtream) {
      playlist.type = "xtream";
      playlist.url = xtream.base;
      playlist.user = xtream.user;
      playlist.pass = xtream.pass;
      this._loadXtream(playlist, done);
      return;
    }
    KP.Net.text(playlist.url, { timeoutMs: 45000, maxBytes: 60e6 }, (error, text) => {
      if (error) {
        if (error.tooLarge) {
          done(new Error("This playlist is too large for M3U mode. Use an Xtream Codes link instead."));
          return;
        }
        done(error);
        return;
      }
      if (!text || !text.includes("#EXTM3U")) {
        done(new Error("This URL is not an M3U playlist"));
        return;
      }
      KP.Parsers.parseM3UChunked(text, { maxChannels: 50000 }, (parseError, parsed) => {
        if (parseError) {
          KP.Utils.logError("store/parse-m3u", parseError);
          done(new Error("The M3U playlist could not be parsed"));
          return;
        }
        if (!parsed || !parsed.channels.length) {
          done(new Error("No channels found in this playlist"));
          return;
        }
        this._normalizeChannelsChunked(playlist, parsed.channels, (normalizeError, channels) => {
          if (normalizeError) {
            KP.Utils.logError("store/normalize-m3u", normalizeError);
            done(new Error("The M3U playlist could not be prepared"));
            return;
          }
          playlist._channels = channels;
          playlist.warning = parsed.truncated
            ? "Only the first 50,000 entries were loaded. Use Xtream Codes for huge providers."
            : "";
          this._groupsCache = null;
          if (KP.Epg) KP.Epg.loadForPlaylist(playlist, () => {});
          done(null);
        });
      });
    });
  }

  _loadXtream(playlist, done) {
    const api = KP.Parsers.Xtream.api;
    KP.Net.json(api(playlist.url, playlist.user, playlist.pass, "get_live_categories"), { timeoutMs: 45000 }, (error, categories) => {
      if (error) {
        done(error);
        return;
      }
      if (!Array.isArray(categories)) {
        done(new Error("Login failed. Check the URL, username and password."));
        return;
      }
      const names = new Map();
      categories.forEach((category) => {
        names.set(String(category.category_id), category.category_name);
      });
      KP.Net.json(api(playlist.url, playlist.user, playlist.pass, "get_live_streams"), { timeoutMs: 60000 }, (streamError, streams) => {
        if (streamError) {
          done(streamError);
          return;
        }
        if (!Array.isArray(streams)) {
          done(new Error("The provider did not return any channels."));
          return;
        }
        playlist._channels = this._normalizeChannels(playlist, streams.map((stream) => ({
          name: stream.name,
          logo: stream.stream_icon || "",
          group: names.get(String(stream.category_id)) || "Ungrouped",
          epgId: stream.epg_channel_id || "",
          xtreamId: stream.stream_id,
          url: KP.Parsers.Xtream.liveUrl(playlist.url, playlist.user, playlist.pass, stream.stream_id, "ts")
        })));
        this._groupsCache = null;
        if (playlist.epgUrls && playlist.epgUrls.length && KP.Epg) {
          KP.Epg.loadForPlaylist(playlist, () => {});
        }
        done(null);
      });
    });
  }

  loadPlaylist(playlist, done) {
    if (!playlist) {
      done(new Error("Playlist not found"));
      return;
    }
    const playlistId = playlist.id;
    playlist.status = "loading";
    playlist.error = "";
    playlist.epgWarning = "";
    playlist.warning = "";
    playlist._shortEpg = {};
    playlist._epgPending = 0;
    playlist._epgAny = false;
    playlist._epgLoading = false;
    if (KP.Vod) KP.Vod.invalidate(playlist);
    this.notify("playlist", playlist);

    const finish = (error) => {
      if (!this.getPlaylist(playlistId)) {
        done(new Error("Playlist was removed"));
        return;
      }
      playlist.status = error ? "error" : "ready";
      playlist.error = error ? String(error.message || error) : "";
      if (!error) {
        playlist.updatedAt = Date.now();
        this.save();
      }
      this.notify("playlist", playlist);
      this.notify("catalogue", playlist);
      done(error);
    };

    try {
      if (playlist.type === "m3u") this._loadM3U(playlist, finish);
      else if (playlist.type === "xtream") this._loadXtream(playlist, finish);
      else finish(new Error("Unknown playlist type"));
    } catch (error) {
      KP.Utils.logError("store/load-playlist", error);
      finish(error);
    }
  }

  loadAll(done = () => {}) {
    if (!this._data.playlists.length) {
      done();
      return;
    }
    const order = this._data.playlists.slice();
    const activeIndex = order.findIndex((playlist) => playlist.id === this.activeId());
    if (activeIndex > 0) {
      const active = order.splice(activeIndex, 1)[0];
      order.unshift(active);
    }
    let left = order.length;
    let finished = false;
    order.forEach((playlist) => {
      this.loadPlaylist(playlist, () => {
        left -= 1;
        if (left === 0 && !finished) {
          finished = true;
          done();
        }
      });
    });
  }

  groups() {
    const playlist = this.active();
    const channels = (playlist && playlist._channels) || [];
    const playlistId = playlist ? playlist.id : "";
    const favoritesKey = this._data.favorites.join("\u0001");
    const recentsKey = this._data.recents.join("\u0001");
    const cache = this._groupsCache;
    if (cache && cache.playlistId === playlistId && cache.channels === channels &&
        cache.favoritesKey === favoritesKey && cache.recentsKey === recentsKey) {
      return cache.groups;
    }

    const all = [];
    const byId = new Map();
    channels.forEach((channel) => {
      byId.set(channel.id, channel);
      all.push(channel);
    });
    const favorites = this._data.favorites.map((id) => byId.get(id)).filter(Boolean);
    const recents = this._data.recents.map((id) => byId.get(id)).filter(Boolean);
    const result = [
      { id: "fav", name: "Favorites", channels: favorites },
      { id: "recent", name: "Recent channels", channels: recents }
    ];
    const byGroup = new Map();
    all.forEach((channel) => {
      if (!byGroup.has(channel.group)) {
        const group = { id: `g:${channel.group}`, name: channel.group, channels: [] };
        byGroup.set(channel.group, group);
        result.push(group);
      }
      byGroup.get(channel.group).channels.push(channel);
    });
    this._groupsCache = {
      playlistId,
      channels,
      favoritesKey,
      recentsKey,
      groups: result,
      all
    };
    return result;
  }

  activeChannels() {
    this.groups();
    return this._groupsCache ? this._groupsCache.all : [];
  }

  setActive(id) {
    if (!this.getPlaylist(id)) return false;
    this._data.activePlaylistId = id;
    this.save();
    this.notify("catalogue");
    return true;
  }

  add(playlist) {
    const normalized = this._normalizePlaylist(playlist);
    if (!normalized) return null;
    this._data.playlists.push(normalized);
    if (!this._data.activePlaylistId) this._data.activePlaylistId = normalized.id;
    this.save();
    this.notify("playlist", normalized);
    return normalized;
  }

  rename(id, name) {
    const playlist = this.getPlaylist(id);
    const clean = String(name || "").trim();
    if (!playlist || !clean) return false;
    playlist.name = clean;
    this.save();
    this.notify("playlist", playlist);
    return true;
  }

  remove(id) {
    const index = this._data.playlists.findIndex((playlist) => playlist.id === id);
    if (index < 0) return false;
    const removed = this._data.playlists.splice(index, 1)[0];
    if (this._data.activePlaylistId === id) {
      this._data.activePlaylistId = this._data.playlists[0] ? this._data.playlists[0].id : "";
    }
    const prefix = `${id}:`;
    this._data.favorites = this._data.favorites.filter((channelId) => !channelId.startsWith(prefix));
    this._data.recents = this._data.recents.filter((channelId) => !channelId.startsWith(prefix));
    this._data.mylist = this._data.mylist.filter((key) => !key.startsWith(prefix));
    Object.keys(this._data.progress).forEach((key) => {
      if (key.startsWith(prefix)) delete this._data.progress[key];
    });
    if (KP.Epg) KP.Epg.forgetPlaylist(removed);
    if (KP.Vod) KP.Vod.invalidate(removed);
    this.save();
    this.notify("playlist", removed);
    this.notify("catalogue");
    return true;
  }

  toggleFavorite(channelId) {
    const index = this._data.favorites.indexOf(channelId);
    if (index >= 0) this._data.favorites.splice(index, 1);
    else this._data.favorites.unshift(channelId);
    this.save();
    this.notify("catalogue");
  }

  isFavorite(channelId) {
    return this._data.favorites.includes(channelId);
  }

  pushRecent(channelId) {
    if (!channelId) return;
    const index = this._data.recents.indexOf(channelId);
    if (index >= 0) this._data.recents.splice(index, 1);
    this._data.recents.unshift(channelId);
    this._data.recents = this._data.recents.slice(0, 20);
    this.save();
  }

  inMyList(key) {
    return this._data.mylist.includes(key);
  }

  toggleMyList(key) {
    const index = this._data.mylist.indexOf(key);
    if (index >= 0) this._data.mylist.splice(index, 1);
    else this._data.mylist.unshift(key);
    this.save();
  }

  getProgress(key) {
    return this._data.progress[key] || 0;
  }

  setProgress(key, milliseconds) {
    this._data.progress[key] = milliseconds;
    this.save();
  }

  clearProgress(key) {
    delete this._data.progress[key];
    this.save();
  }

  settings() {
    return this._data.settings;
  }

  setSetting(key, value) {
    this._data.settings[key] = value;
    this.save();
    this.notify("settings", { key, value });
  }

  isGroupLocked(name) {
    return !!this._data.settings.parentalPin && this._data.settings.lockedGroups.includes(name);
  }

  toggleLockedGroup(name) {
    const index = this._data.settings.lockedGroups.indexOf(name);
    if (index >= 0) this._data.settings.lockedGroups.splice(index, 1);
    else this._data.settings.lockedGroups.push(name);
    this.save();
    this.notify("settings", { key: "lockedGroups" });
  }

  checkPin(pin) {
    return !!this._data.settings.parentalPin && this._data.settings.parentalPin === pin;
  }

  exportData() {
    return JSON.stringify(this._snapshot(), null, 2);
  }

  importData(json) {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new Error("This file is not valid JSON");
    }
    if (!parsed || !Array.isArray(parsed.playlists)) throw new Error("Not a valid KPlayer backup file");
    const clean = this._sanitizeState(parsed);
    clean.playlists.forEach((playlist) => {
      delete playlist._channels;
      delete playlist._vodCats;
      delete playlist._vodItems;
      delete playlist.status;
      delete playlist.error;
    });
    this._data = clean;
    this.save();
    this.notify("catalogue");
    this.notify("settings", { key: "*" });
    return true;
  }

  storageError() {
    return this._storageError;
  }
}

const kplayerStore = new KPlayerStore();
KP.Store = kplayerStore;
window.CAT = kplayerStore;
