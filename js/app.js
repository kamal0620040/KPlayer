/* KPlayer application bootstrap: wires views, store events, remote-control
   routing, deep links and the first playlist load. */
"use strict";

class KPlayerApplication {
  constructor() {
    this._initialHash = "";
    this._lastActiveId = "";
    this._started = false;
    this._clockTimer = null;
  }

  _log(context, error) {
    KP.Utils.logError(`app/${context}`, error);
  }

  _playFirstChannel(keepPanel) {
    const groups = KP.Shell.groups();
    const recents = groups[1] && groups[1].channels ? groups[1].channels : [];
    const channel = recents[0] || KP.Shell.allChannels()[0];
    if (channel) {
      KP.Playback.playChannel(channel, !!keepPanel);
      return true;
    }
    return false;
  }

  _applyDeepLink(hash) {
    const name = String(hash || "").replace(/^#/, "");
    if (name === "guide") {
      KP.Views.guide.open();
      return true;
    }
    if (name === "channels") {
      KP.Views.channels.open();
      return true;
    }
    if (name === "schedule") {
      const channel = KP.Shell.allChannels()[0];
      if (channel) KP.Views.schedule.open(channel);
      else KP.Shell.show("player");
      return true;
    }
    if (name === "search") {
      KP.Views.search.open();
      return true;
    }
    if (name === "playlists") {
      KP.Views.playlists.open();
      return true;
    }
    if (name === "vod") {
      KP.Views.vod.open("movies");
      return true;
    }
    if (name === "voddetail") {
      const items = KP.Store.cachedVodItems();
      const item = items[4] || items[0];
      if (item) KP.Views.voddetail.open(item, "vod");
      else KP.Views.vod.open("movies");
      return true;
    }
    if (name === "settings") {
      KP.Views.settings.open();
      return true;
    }
    if (name === "pin") {
      KP.Shell.show("player");
      KP.Views.pin.open("set1", null);
      return true;
    }
    if (name === "panel") {
      if (!this._playFirstChannel(true)) KP.Shell.show("player");
      return true;
    }
    if (name === "menu") {
      if (this._playFirstChannel(true)) {
        KP.Shell.openMenu();
        KP.Playback.hideInfoBar();
      } else {
        KP.Shell.show("player");
      }
      return true;
    }
    return false;
  }

  _initBrand() {
    ["ib-logo", "pv-logo-slot", "gp-video-logo", "sched-logo", "sched-preview-logo"].forEach((id) => {
      const element = document.getElementById(id);
      if (element) element.innerHTML = KP.Icons.inner("tv", "ico");
    });
    const emptyIcon = document.getElementById("pv-empty-ico");
    if (emptyIcon) emptyIcon.innerHTML = KP.Icons.inner("play", "ico");
  }

  _initViews() {
    KP.Shell.init();
    if (KP.Playback && typeof KP.Playback.init === "function") {
      try {
        KP.Playback.init();
      } catch (error) {
        this._log("init/playback", error);
      }
    }
    ["pin", "channels", "guide", "schedule", "search", "playlists", "vod", "voddetail", "settings"].forEach((name) => {
      const view = KP.Views[name];
      if (view && typeof view.init === "function") {
        try {
          view.init();
        } catch (error) {
          this._log(`init/${name}`, error);
        }
      }
    });
  }

  _refreshDataViews(force) {
    const app = KP.Shell.state;
    KP.Shell.updatePlaceholder();
    if (app.view === "guide") KP.Views.guide.render(!!force);
    if (app.view === "channels") KP.Views.channels.render(!!force);
    if (app.view === "search") KP.Views.search.render();
    if (app.view === "playlists") KP.Views.playlists.refresh();
    if (app.view === "settings") KP.Views.settings.refresh();
    if (app.view === "schedule") KP.Views.schedule.refresh();
    if (app.view === "player" && app.playing) KP.Playback.refreshInfoBar();
  }

  _initStoreEvents() {
    this._lastActiveId = KP.Store.activeId();
    KP.Store.on("playlist", () => {
      KP.Shell.updatePlaceholder();
      if (KP.Shell.state.view === "playlists") KP.Views.playlists.refresh();
    });
    KP.Store.on("catalogue", () => {
      const app = KP.Shell.state;
      const activeId = KP.Store.activeId();
      if (activeId !== this._lastActiveId) {
        this._lastActiveId = activeId;
        app.gGroupIdx = 0;
        app.gChanIdx = 0;
        app.gCellIdx = 0;
        app.gGroupTouched = false;
        app.gAutoPicked = false;
        if (KP.Views.vod) KP.Views.vod.reset();
      }
      this._refreshDataViews(true);
      if (app.view === "vod") KP.Views.vod.refresh();
    });
    KP.Store.on("epg", () => {
      KP.Shell.updatePlaceholder();
      /* EPG data arrives in waves: coalesce and hold off while the user is
         scrolling so the guide does not rebuild under their thumbs */
      KP.Shell.deferDataRender(() => this._refreshDataViews(false));
    });
    KP.Store.on("vod", () => {
      if (KP.Shell.state.view === "vod") KP.Views.vod.refresh();
    });
    KP.Store.on("settings", () => {
      KP.Shell.applyAccent();
    });
    KP.Store.on("storage-error", (payload) => {
      KP.Shell.toast((payload && payload.message) || "Changes could not be saved on this TV.", 4800);
    });
  }

  _initKeys() {
    document.addEventListener("keydown", (event) => {
      try {
        if (KP.Views.pin.isOpen()) {
          if (KP.Views.pin.handleKey(event)) event.preventDefault();
          return;
        }
        const view = KP.Shell.state.view;
        if (event.key && event.key.indexOf("Media") === 0) {
          if (KP.Playback.handleMediaKey(event)) event.preventDefault();
          return;
        }
        if ((event.key === "Tools" || event.key === "Menu") && view === "player") {
          if (KP.Playback.toggleAvPanel()) event.preventDefault();
          return;
        }
        const key = event.keyCode;
        if (KP.Shell && KP.Shell.touchGesture) KP.Shell.touchGesture();
        let handled = false;
        if (view === "player") handled = KP.Playback.handleKey(key);
        else if (view === "channels") handled = KP.Views.channels.handleKey(key);
        else if (view === "guide") handled = KP.Views.guide.handleKey(key);
        else if (view === "schedule") handled = KP.Views.schedule.handleKey(key);
        else if (view === "search") handled = KP.Views.search.handleKey(key);
        else if (view === "playlists") handled = KP.Views.playlists.handleKey(key);
        else if (view === "vod") handled = KP.Views.vod.handleKey(key);
        else if (view === "voddetail") handled = KP.Views.voddetail.handleKey(key);
        else if (view === "settings") handled = KP.Views.settings.handleKey(key);
        else if (view === "menu") handled = KP.Shell.handleMenuKey(key);
        if (handled) event.preventDefault();
      } catch (error) {
        this._log("key", error);
      }
    });
  }

  _initTizenKeys() {
    try {
      if (!window.tizen || !window.tizen.tvinputdevice) return;
      ["MediaPlayPause", "MediaPlay", "MediaPause", "MediaFastForward", "MediaRewind", "MediaStop",
        "ChannelUp", "ChannelDown", "Menu", "Tools"].forEach((name) => {
        try {
          window.tizen.tvinputdevice.registerKey(name);
        } catch (error) {
          KP.Utils.logWarn(`app/register-key/${name}`, error);
        }
      });
    } catch (error) {
      this._log("tizen-keys", error);
    }
  }

  _tick() {
    const time = KP.Utils.fmtTime(Date.now());
    const clock = document.getElementById("ib-clock");
    if (clock) clock.textContent = time;
    const app = KP.Shell.state;
    if (app.view === "channels") {
      const channelClock = document.getElementById("ch-clock");
      if (channelClock) channelClock.textContent = time;
      KP.Views.channels.render();
    }
    if (app.view === "guide") KP.Views.guide.render();
    if (app.view === "player" && app.playing) KP.Playback.refreshInfoBar();
  }

  _initTimers() {
    this._clockTimer = setInterval(() => this._tick(), 30000);
  }

  _load() {
    KP.Store.loadAll(() => {
      KP.Shell.updatePlaceholder();
      const app = KP.Shell.state;
      if (app.view === "guide") KP.Views.guide.render(true);
      if (app.view === "channels") KP.Views.channels.render(true);
      if (app.view === "playlists") KP.Views.playlists.refresh();
      if (app.view === "settings") KP.Views.settings.refresh();

      if (!this._initialHash) {
        if (app.view !== "player") return;
        if (!KP.Store.hasData()) return;
        if (KP.Store.settings().lastChannelOnStart) {
          if (this._playFirstChannel(false)) return;
        }
        KP.Views.guide.open();
        return;
      }

      const retry = ["schedule", "voddetail", "panel", "menu"];
      if (retry.indexOf(this._initialHash) >= 0 && app.view === "player" && KP.Store.hasData()) {
        this._applyDeepLink(this._initialHash);
      }
    });
  }

  start() {
    if (this._started) return;
    this._started = true;
    try {
      KP.Logo.install();
      KP.installGlobalErrorHandler();
      this._initBrand();
      this._initViews();
      this._initStoreEvents();
      this._initKeys();
      this._initTizenKeys();
      this._initTimers();
      this._initialHash = String(location.hash || "").replace(/^#/, "");
      if (this._initialHash) {
        this._applyDeepLink(this._initialHash);
      } else if (!KP.Store.playlists.length) {
        KP.Views.playlists.open();
      }
      this._load();
    } catch (error) {
      this._log("start", error);
      KP.Utils.reportError("app/start", error, "KPlayer could not start correctly. Please restart the app.");
    }
  }
}

const kplayerApplication = new KPlayerApplication();
kplayerApplication.start();
