/* KPlayer shell: shared app state, view switching, menu, theme, toasts and
   global UI helpers. Views only render their own DOM and use this shell for
   navigation so Back and overlays behave consistently. */
"use strict";

const SHELL_VIEWS = ["player", "channels", "guide", "schedule", "search", "playlists", "vod", "voddetail", "settings"];
const SHELL_ACCENTS = {
  Pink: "#e91e63",
  Purple: "#9c27b0",
  Indigo: "#3f51b5",
  Blue: "#4f8dff",
  Cyan: "#00bcd4",
  Teal: "#009688",
  Green: "#4caf50",
  Lime: "#cddc39",
  Yellow: "#ffeb3b",
  Amber: "#ffc107"
};

class KPlayerShell {
  constructor() {
    this.state = {
      view: "player",
      groupIdx: 2,
      chanIdx: 0,
      gGroupIdx: 2,
      gChanIdx: 0,
      gCellIdx: 0,
      gGroupTouched: false,
      gAutoPicked: false,
      playing: null
    };
    this._menuIdx = 2;
    this._navStack = [];
    this._backing = false;
    this._exitArmedAt = 0;
    this._exitTimer = null;
    this._toastTimer = null;
    this._scrollFadeObserver = typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => this.refreshScrollFades())
      : null;
  }

  _log(context, error) {
    KP.Utils.logWarn(`shell/${context}`, error);
  }

  _recordNav(from, to, forward) {
    if (!forward || this._backing) return;
    if (!from || from === to || to === "menu") return;
    if (SHELL_VIEWS.indexOf(from) < 0) return;
    if (this._navStack.length && this._navStack[this._navStack.length - 1] === from) return;
    this._navStack.push(from);
    if (this._navStack.length > 24) this._navStack.shift();
  }

  groups() {
    if (KP.Store && KP.Store.hasData()) return KP.Store.groups();
    return [
      { id: "fav", name: "Favorites", channels: [] },
      { id: "recent", name: "Recent channels", channels: [] }
    ];
  }

  allChannels() {
    if (KP.Store && KP.Store.hasData() && KP.Store.activeChannels) return KP.Store.activeChannels();
    let out = [];
    this.groups().forEach((group) => {
      if (group.id !== "fav" && group.id !== "recent") out = out.concat(group.channels);
    });
    return out;
  }

  currentGroup() {
    return this.groups()[this.state.groupIdx] || { name: "Channels", channels: [] };
  }

  _blurHiddenInput(view) {
    const active = document.activeElement;
    if (!active || (active.tagName !== "INPUT" && active.tagName !== "TEXTAREA")) return;
    const owner = active.closest ? active.closest(".view") : null;
    if (owner && owner.id !== `view-${view}`) active.blur();
  }

  show(view, push) {
    const from = this.state.view === "menu" ? "player" : this.state.view;
    this.state.view = view;
    this._blurHiddenInput(view);
    const base = view === "menu" ? "player" : view;
    SHELL_VIEWS.forEach((name) => {
      const element = document.getElementById(`view-${name}`);
      if (!element) return;
      element.classList.toggle("hidden", name !== base);
      element.classList.toggle("active", name === base);
    });
    const menu = document.getElementById("view-menu");
    if (menu) menu.classList.toggle("hidden", view !== "menu");
    if (KP.Player) KP.Player.attachTo(view === "guide" ? document.querySelector(".gp-video") : null);
    if (view === "player" && !this.state.playing) {
      const placeholder = document.getElementById("player-placeholder");
      if (placeholder) placeholder.classList.remove("hidden");
      if (KP.Playback) KP.Playback.hideInfoBar();
      this.updatePlaceholder();
    }
    this._recordNav(from, view, push !== false);
    if (view === "player" && !this.state.playing) this._navStack.length = 0;
    setTimeout(() => this.refreshScrollFades(), 0);
  }

  _restoreView(name) {
    try {
      this._backing = true;
      if (name === "channels" && KP.Views.channels && KP.Views.channels.restore) KP.Views.channels.restore();
      else if (name === "search" && KP.Views.search && KP.Views.search.returnTo) KP.Views.search.returnTo();
      else if (name === "schedule" && KP.Views.schedule && KP.Views.schedule.resume) KP.Views.schedule.resume();
      else if (name === "voddetail" && KP.Views.voddetail && KP.Views.voddetail.restore) KP.Views.voddetail.restore();
      else if (name === "vod" && KP.Views.vod) {
        this.show("vod");
        KP.Views.vod.refresh();
      } else if (name === "playlists" && KP.Views.playlists) KP.Views.playlists.open();
      else if (name === "guide" && KP.Views.guide) KP.Views.guide.open();
      else if (name === "settings" && KP.Views.settings) KP.Views.settings.open();
      else if (SHELL_VIEWS.indexOf(name) >= 0) this.show(name);
      else this.armExit();
    } catch (error) {
      this._log("back", error);
      if (SHELL_VIEWS.indexOf(name) >= 0) this.show(name);
    } finally {
      this._backing = false;
    }
  }

  back() {
    const current = this.state.view === "menu" ? "player" : this.state.view;
    while (this._navStack.length) {
      const previous = this._navStack.pop();
      if (!previous || previous === current) continue;
      this._restoreView(previous);
      return;
    }
    this.armExit();
  }

  _updateScrollFade(element) {
    if (!element) return;
    if (element.classList.contains("scroll-fade-x")) {
      const left = element.scrollLeft;
      const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
      element.classList.toggle("fade-x-left", left > 1);
      element.classList.toggle("fade-x-right", maxLeft > 1 && left < maxLeft - 1);
      return;
    }
    let top = 0;
    let maxTop = 0;
    if (element.classList.contains("scroll-shift-y")) {
      const inner = element.firstElementChild;
      if (inner) {
        top = Math.max(0, Math.round(element.getBoundingClientRect().top - inner.getBoundingClientRect().top));
        maxTop = Math.max(0, Math.round(inner.getBoundingClientRect().height - element.clientHeight));
      }
    } else {
      top = element.scrollTop;
      maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
    }
    const overflowing = maxTop > 1;
    element.classList.toggle("fade-y-top", overflowing && top > 1);
    element.classList.toggle("fade-y-bottom", overflowing && top < maxTop - 1);
  }

  _bindScrollFade(element, axis, shifted) {
    if (!element || element.getAttribute("data-fade-bound")) return;
    element.setAttribute("data-fade-bound", "1");
    element.classList.add(axis === "x" ? "scroll-fade-x" : "scroll-fade-y");
    if (shifted) element.classList.add("scroll-shift-y");
    element.addEventListener("scroll", () => this._updateScrollFade(element), false);
    if (this._scrollFadeObserver) {
      this._scrollFadeObserver.observe(element, { childList: true, subtree: true, characterData: true });
    }
    this._updateScrollFade(element);
  }

  refreshScrollFades() {
    document.querySelectorAll(".scroll-fade-y, .scroll-fade-x").forEach((element) => {
      this._updateScrollFade(element);
    });
  }

  /* Remote-key navigation bookkeeping. Data-driven re-renders (EPG arrival,
     catalogue updates) consult this so a full rebuild never fires while the
     user is actively scrolling - that rebuild churn reads as a UI shake. */
  touchGesture() {
    this._gestureAt = Date.now();
  }

  _gestureQuiet() {
    return Date.now() - (this._gestureAt || 0) >= 420;
  }

  /* Coalesced, gesture-aware render scheduling. Latest job wins (renders are
     idempotent full refreshes); pending work retries until navigation quiets
     down instead of interrupting an in-flight scroll gesture. */
  deferDataRender(job, delay) {
    if (!this._deferredJobs) this._deferredJobs = [];
    if (this._deferredJobs.length >= 24) this._deferredJobs = [];
    this._deferredJobs.push(job);
    if (this._deferTimer) return;
    const run = () => {
      this._deferTimer = null;
      if (this._deferredJobs.length >= 1 && !this._gestureQuiet()) {
        this._deferTimer = setTimeout(run, 280);
        return;
      }
      const jobs = this._deferredJobs;
      this._deferredJobs = [];
      jobs.forEach((entry) => {
        try {
          entry();
        } catch (error) {
          this._log("defer-render", error);
        }
      });
    };
    this._deferTimer = setTimeout(run, delay || 300);
  }

  _applyRowScales() {
    if (!KP.Utils || !KP.Utils.pixelRow) return;
    const root = document.documentElement.style;
    root.setProperty("--g-row-px", `${KP.Utils.pixelRow(96)}px`);
    root.setProperty("--ch-row-px", `${KP.Utils.pixelRow(76)}px`);
    root.setProperty("--sch-row-px", `${KP.Utils.pixelRow(74)}px`);
    root.setProperty("--sch-head-px", `${KP.Utils.pixelRow(58)}px`);
  }

  initScrollFades() {
    this._applyRowScales();
    this._bindScrollFade(document.getElementById("channel-list"), "y", true);
    this._bindScrollFade(document.getElementById("guide-groups"), "y", false);
    this._bindScrollFade(document.getElementById("guide-rows"), "y", true);
    this._bindScrollFade(document.querySelector(".search-results"), "y", false);
    this._bindScrollFade(document.getElementById("set-rows"), "y", true);
    this._bindScrollFade(document.querySelector(".vod-cats"), "y", true);
    this._bindScrollFade(document.querySelector(".vod-scroll"), "y", true);
    this._bindScrollFade(document.getElementById("pl-list"), "y", false);
    this._bindScrollFade(document.getElementById("pl-json-list"), "y", false);
    document.querySelectorAll(".search-row").forEach((element) => this._bindScrollFade(element, "x", false));
    this._bindScrollFade(document.getElementById("pb-cards"), "x", false);
    window.addEventListener("resize", () => {
      this._applyRowScales();
      this.refreshScrollFades();
    }, false);
  }

  toast(text, duration) {
    const element = document.getElementById("app-toast");
    if (!element) return;
    element.textContent = text;
    element.classList.remove("hidden");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.hideToast(), duration || 3200);
  }

  hideToast() {
    const element = document.getElementById("app-toast");
    if (element) element.classList.add("hidden");
  }

  _exitApp() {
    this.hideToast();
    if (KP.Player) {
      try {
        KP.Player.stop();
      } catch (error) {
        this._log("exit/player", error);
      }
    }
    try {
      if (window.tizen && window.tizen.application && window.tizen.application.getCurrentApplication) {
        window.tizen.application.getCurrentApplication().exit();
        return;
      }
    } catch (error) {
      this._log("exit/tizen", error);
    }
    try {
      window.close();
    } catch (error) {
      this._log("exit/window", error);
    }
  }

  armExit() {
    const now = Date.now();
    if (now - this._exitArmedAt < 2500) {
      this._exitArmedAt = 0;
      clearTimeout(this._exitTimer);
      this._exitApp();
      return;
    }
    this._exitArmedAt = now;
    this.toast("Press Back again to exit", 2500);
    clearTimeout(this._exitTimer);
    this._exitTimer = setTimeout(() => {
      this._exitArmedAt = 0;
      this.hideToast();
    }, 2500);
  }

  updatePlaceholder() {
    const placeholder = document.getElementById("player-placeholder");
    const title = document.getElementById("ph-title");
    const sub = document.getElementById("ph-sub");
    if (!title || !sub) return;
    const hasPlaylists = !!(KP.Store && KP.Store.playlists.length);
    const hasData = !!(KP.Store && KP.Store.hasData());
    const active = KP.Store ? KP.Store.active() : null;
    const loading = !hasData && !!(active && active.status === "loading");
    if (placeholder) placeholder.classList.toggle("ph-wait", loading);
    if (!hasPlaylists) {
      title.textContent = "Welcome to KPlayer";
      sub.textContent = "Press OK to add your M3U or Xtream playlist";
    } else if (loading) {
      title.textContent = active.name;
      sub.textContent = "";
    } else if (!hasData) {
      title.textContent = active && active.status === "error" ? "Playlist unavailable" : "Playlist is empty";
      sub.textContent = "Open Playlists to check the source";
    } else {
      title.textContent = "Ready to watch";
      sub.textContent = "OK: open channels · ◀ ▶: menu · Back: exit";
    }
  }

  applyAccent() {
    if (!KP.Store) return;
    const settings = KP.Store.settings();
    const hex = SHELL_ACCENTS[settings.accent] || SHELL_ACCENTS.Blue;
    const number = parseInt(hex.slice(1), 16);
    const red = (number >> 16) & 255;
    const green = (number >> 8) & 255;
    const blue = number & 255;
    const shade = (factor) => `rgb(${Math.round(red * factor)},${Math.round(green * factor)},${Math.round(blue * factor)})`;
    const root = document.documentElement.style;
    root.setProperty("--accent", hex);
    root.setProperty("--accent-dim", `rgba(${red},${green},${blue},0.35)`);
    root.setProperty("--focus-row", shade(0.42));
    root.setProperty("--selected", shade(0.28));
    root.setProperty("--edge", shade(0.55));
  }

  _menuEls() {
    return document.querySelectorAll("#view-menu .menu-item");
  }

  renderMenu() {
    this._menuEls().forEach((element, index) => element.classList.toggle("focused", index === this._menuIdx));
  }

  openMenu() {
    this._menuIdx = 2;
    this.renderMenu();
    if (KP.Playback) KP.Playback.hideInfoBar();
    this.show("menu");
  }

  menuAction(action) {
    const views = KP.Views || {};
    if (action === "guide" && views.guide) views.guide.open();
    else if (action === "search" && views.search) views.search.open();
    else if (action === "tv" && views.channels) views.channels.open();
    else if (action === "movies" && views.vod) views.vod.open("movies");
    else if (action === "shows" && views.vod) views.vod.open("shows");
    else if (action === "playlists" && views.playlists) views.playlists.open();
    else if (action === "mylist" && views.vod) views.vod.open("mylist");
    else if (action === "settings" && views.settings) views.settings.open();
  }

  handleMenuKey(key) {
    if (key === 10009 || key === 461 || key === 39) {
      this.show("player", false);
      return true;
    }
    if (key === 38) {
      this._menuIdx = Math.max(0, this._menuIdx - 1);
      this.renderMenu();
      return true;
    }
    if (key === 40) {
      this._menuIdx = Math.min(this._menuEls().length - 1, this._menuIdx + 1);
      this.renderMenu();
      return true;
    }
    if (key === 13) {
      const element = this._menuEls()[this._menuIdx];
      if (element) this.menuAction(element.getAttribute("data-act"));
      return true;
    }
    return false;
  }

  init() {
    this.initScrollFades();
    const menuLogo = document.querySelector(".menu-logo");
    if (menuLogo && !menuLogo.querySelector("img")) {
      menuLogo.innerHTML = `${KP.brandMark("menu-brand-img")}<span>KPlayer</span>`;
    }
    const placeholderBrand = document.querySelector(".ph-brand");
    if (placeholderBrand) placeholderBrand.innerHTML = `${KP.Icons.inner("play", "ph-brand-ico")}<span>KPlayer</span>`;
    this.applyAccent();
    this.updatePlaceholder();
  }
}

const kplayerShell = new KPlayerShell();
KP.Shell = kplayerShell;
KP.ACCENTS = SHELL_ACCENTS;
