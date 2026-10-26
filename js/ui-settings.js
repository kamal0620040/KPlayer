/* KPlayer settings: playback, guide, appearance, parental controls, backup
   and the branded About panel. */
"use strict";

const SETTINGS_SECTIONS = [
  {
    id: "playback",
    name: "Playback",
    rows: [
      { key: "bufferSize", label: "Buffer size", type: "choice", options: ["Small", "Medium", "Large", "Very large"] },
      { key: "decoder", label: "Decoder", type: "choice", options: ["Hardware", "Software"] },
      { key: "seekStepSec", label: "Seek step", type: "choice", options: [10, 20, 30, 60], fmt: (value) => `${value} sec` },
      { key: "zapInGroup", label: "Zap within channel group", type: "toggle" },
      { key: "lastChannelOnStart", label: "Play last channel on start", type: "toggle" }
    ]
  },
  {
    id: "guide",
    name: "TV guide",
    rows: [
      { key: "epgPastDays", label: "Keep past programme days", type: "choice", options: [1, 2, 3, 7], fmt: (value) => `${value} days` },
      { key: "epgUpdateHours", label: "EPG update interval", type: "choice", options: [6, 12, 24], fmt: (value) => `${value} hours` }
    ]
  },
  {
    id: "appearance",
    name: "Appearance",
    rows: [
      { key: "accent", label: "Accent color", type: "accent" }
    ]
  },
  {
    id: "parental",
    name: "Parental controls",
    rows: [
      { id: "setpin", label: "Set / change PIN", type: "action" },
      { id: "lockgroups", label: "Locked groups", type: "action" }
    ]
  },
  {
    id: "backup",
    name: "Backup & restore",
    rows: [
      { id: "export", label: "Export backup", type: "action" },
      { id: "import", label: "Restore from file", type: "action" }
    ]
  },
  { id: "about", name: "About", rows: [] }
];

class KPlayerSettings {
  constructor() {
    this._secIdx = 0;
    this._rowIdx = 0;
    this._zone = "sections";
    this._lockMode = false;
    this._parentalUnlocked = false;
    this._restoreInput = null;
  }

  _el(id) {
    return document.getElementById(id);
  }

  _settingsRows() {
    if (this._lockMode) {
      return KP.Shell.groups().map((group) => ({
        label: group.name,
        type: "locktoggle",
        group: group.name
      }));
    }
    return SETTINGS_SECTIONS[this._secIdx].rows;
  }

  _rowValue(row) {
    const settings = KP.Store.settings();
    if (row.type === "choice") {
      const value = settings[row.key];
      return row.fmt ? row.fmt(value) : String(value);
    }
    if (row.type === "toggle") return settings[row.key] ? "On" : "Off";
    if (row.type === "accent") return settings.accent;
    if (row.type === "locktoggle") {
      return settings.lockedGroups.indexOf(row.group) >= 0 ? "Locked" : "Open";
    }
    return "";
  }

  _showExtra(html) {
    const extra = this._el("set-extra");
    if (!extra) return;
    extra.dataset.keep = "1";
    extra.innerHTML = html;
  }

  _clearExtra() {
    const extra = this._el("set-extra");
    if (!extra) return;
    delete extra.dataset.keep;
    extra.innerHTML = "";
  }

  _renderAbout() {
    const count = KP.Utils.fmtNum(KP.Store.totalChannels());
    const playlists = KP.Store.playlists.length;
    this._showExtra(
      '<div class="about-hero">' +
        `<img class="about-logo" src="${KP.BRAND.icon}" alt=""/>` +
        '<div class="about-hero-text">' +
          `<div class="about-name">${KP.Utils.esc(KP.BRAND.name)}</div>` +
          `<div class="about-tagline">${KP.Utils.esc(KP.BRAND.tagline)}</div>` +
          `<div class="about-version">Version ${KP.Utils.esc(KP.BRAND.version)}</div>` +
        "</div>" +
      "</div>" +
      '<div class="about-stats">' +
        `<div class="about-stat"><span class="about-stat-value">${count}</span><span class="about-stat-label">Channels</span></div>` +
        `<div class="about-stat"><span class="about-stat-value">${playlists}</span><span class="about-stat-label">Playlists</span></div>` +
        `<div class="about-stat"><span class="about-stat-value">${KP.Utils.esc(KP.BRAND.version)}</span><span class="about-stat-label">Version</span></div>` +
      "</div>" +
      '<div class="about-text">A fast, focused IPTV player for Samsung Tizen TVs. KPlayer keeps playlists separate, ' +
        "loads guide data only when it is needed, and gives live TV, movies and series one consistent remote-first interface.</div>" +
      '<div class="about-features">' +
        '<span class="about-feature">Live TV</span>' +
        '<span class="about-feature">TV guide</span>' +
        '<span class="about-feature">Catch-up</span>' +
        '<span class="about-feature">Movies &amp; series</span>' +
        '<span class="about-feature">Search</span>' +
        '<span class="about-feature">Parental PIN</span>' +
      "</div>" +
      `<div class="about-foot">Made by ${KP.Utils.esc(KP.BRAND.author)} for ${KP.Utils.esc(KP.BRAND.platform)}. ` +
        "Playlists, favourites, recents, watch progress and settings are stored on this TV only.</div>"
    );
  }

  render() {
    const sections = SETTINGS_SECTIONS;
    this._el("set-sections").innerHTML = sections.map((section, index) =>
      `<div class="set-sec${index === this._secIdx && this._zone === "sections" ? " focused" : ""}">` +
      `${KP.Utils.esc(section.name)}</div>`
    ).join("");

    const section = sections[this._secIdx];
    this._el("set-title").textContent = this._lockMode ? "Locked groups" : section.name;
    const rows = this._settingsRows();
    if (this._rowIdx >= rows.length) this._rowIdx = Math.max(0, rows.length - 1);
    const accent = KP.Store.settings().accent;
    const accentColor = (KP.ACCENTS && KP.ACCENTS[accent]) || "#4f8dff";
    const rowsHtml = rows.map((row, index) => {
      const dot = row.type === "accent"
        ? `<span class="accent-dot" style="background:${accentColor}"></span>`
        : "";
      return `<div class="set-row${index === this._rowIdx && this._zone === "rows" ? " focused" : ""}" data-i="${index}">` +
        dot + KP.Utils.esc(row.label) +
        `<span class="set-val">${KP.Utils.esc(this._rowValue(row))}</span>` +
        (row.type === "action" ? `<span class="set-chev">${KP.Icons.inner("chevRight", "key-ico")}</span>` : "") +
        "</div>";
    }).join("");
    this._el("set-rows").innerHTML = `<div id="set-rows-inner">${rowsHtml}</div>`;
    const inner = this._el("set-rows-inner");
    const rowElements = inner.children;
    if (this._zone === "rows" && rowElements[this._rowIdx]) {
      inner.style.transform = `translateY(${-KP.Utils.centerShift(this._el("set-rows"), inner, rowElements[this._rowIdx])}px)`;
    } else {
      inner.style.transform = "";
    }
    KP.Shell.refreshScrollFades();

    if (section.id === "about" && !this._lockMode) this._renderAbout();
    else if (!this._el("set-extra").dataset.keep) this._clearExtra();
  }

  _cycle(row, direction) {
    const settings = KP.Store.settings();
    if (row.type === "choice") {
      let index = row.options.indexOf(settings[row.key]);
      if (index < 0) index = 0;
      index = (index + direction + row.options.length) % row.options.length;
      KP.Store.setSetting(row.key, row.options[index]);
    } else if (row.type === "toggle") {
      KP.Store.setSetting(row.key, !settings[row.key]);
    } else if (row.type === "accent" && KP.ACCENTS) {
      const names = Object.keys(KP.ACCENTS);
      let index = names.indexOf(settings.accent);
      index = (index + direction + names.length) % names.length;
      KP.Store.setSetting("accent", names[index]);
      KP.Shell.applyAccent();
    }
    this.render();
  }

  _export() {
    try {
      const json = KP.Store.exportData();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      this._showExtra(
        '<div class="set-note">Backup contains your playlists (including passwords), favourites, recents, progress and settings. Keep it private.</div>' +
        `<textarea readonly>${KP.Utils.esc(json)}</textarea>` +
        `<a class="set-link" href="${url}" download="kplayer-backup.json">Download backup file</a>`
      );
    } catch (error) {
      KP.Utils.reportError("settings/export", error, "The backup could not be created.");
    }
  }

  _restore() {
    if (this._restoreInput) this._restoreInput.click();
  }

  _action(row) {
    if (this._lockMode) {
      KP.Store.toggleLockedGroup(row.group);
      this.render();
      return;
    }
    if (row.id === "setpin") {
      KP.Views.pin.open("set1", () => this.render());
      return;
    }
    if (row.id === "lockgroups") {
      if (!KP.Store.settings().parentalPin) {
        KP.Shell.toast("Set a PIN before locking groups.", 3600);
        return;
      }
      this._lockMode = true;
      this._rowIdx = 0;
      this._clearExtra();
      this.render();
      return;
    }
    if (row.id === "export") this._export();
    else if (row.id === "import") this._restore();
  }

  _enterSection(index) {
    this._secIdx = index;
    this._rowIdx = 0;
    this._zone = "rows";
    this._clearExtra();
    const section = SETTINGS_SECTIONS[index];
    if (section.id === "parental" && KP.Store.settings().parentalPin && !this._parentalUnlocked) {
      KP.Views.pin.open("verify", (ok) => {
        if (!ok) return;
        this._parentalUnlocked = true;
        this._zone = "rows";
        this._rowIdx = 0;
        this.render();
      });
      return;
    }
    this.render();
  }

  open() {
    this._secIdx = 0;
    this._rowIdx = 0;
    this._zone = "sections";
    this._lockMode = false;
    this._parentalUnlocked = false;
    KP.Shell.show("settings");
    this.render();
  }

  refresh() {
    if (KP.Shell.state.view === "settings") this.render();
  }

  handleKey(key) {
    if (this._zone === "sections") {
      if (key === 38 || key === 40) {
        this._clearExtra();
        this._secIdx = key === 38
          ? Math.max(0, this._secIdx - 1)
          : Math.min(SETTINGS_SECTIONS.length - 1, this._secIdx + 1);
      } else if (key === 39 || key === 13) {
        this._enterSection(this._secIdx);
        return true;
      } else if (key === 10009 || key === 461) {
        KP.Shell.back();
        return true;
      } else {
        return false;
      }
      this.render();
      return true;
    }

    const rows = this._settingsRows();
    if (key === 38) this._rowIdx = Math.max(0, this._rowIdx - 1);
    else if (key === 40) this._rowIdx = Math.min(Math.max(0, rows.length - 1), this._rowIdx + 1);
    else if (key === 37) {
      const row = rows[this._rowIdx];
      if (row && row.type !== "action" && !this._lockMode) this._cycle(row, -1);
      else {
        this._zone = "sections";
        if (this._lockMode) this._lockMode = false;
      }
    } else if (key === 39) {
      const row = rows[this._rowIdx];
      if (row && row.type !== "action" && !this._lockMode) this._cycle(row, 1);
    } else if (key === 13) {
      if (rows[this._rowIdx]) this._action(rows[this._rowIdx]);
      return true;
    } else if (key === 10009 || key === 461) {
      if (this._lockMode) this._lockMode = false;
      else {
        this._zone = "sections";
        this._clearExtra();
      }
    } else {
      return false;
    }
    this.render();
    return true;
  }

  _readRestore(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        KP.Store.importData(String(reader.result));
        this._showExtra('<div class="set-note set-busy"><span class="spinner"></span>Restoring backup...</div>');
        KP.Store.loadAll(() => {
          KP.Shell.applyAccent();
          KP.Shell.updatePlaceholder();
          if (KP.Views.playlists) KP.Views.playlists.refresh();
          this._showExtra('<div class="set-note">Backup restored.</div>');
          this.render();
        });
      } catch (error) {
        KP.Utils.logError("settings/restore", error);
        this._showExtra('<div class="set-note">Restore failed. Check that the file is a KPlayer backup.</div>');
      }
    };
    reader.onerror = () => {
      this._showExtra('<div class="set-note">The backup file could not be read.</div>');
    };
    reader.readAsText(file);
  }

  init() {
    const sections = this._el("set-sections");
    if (sections) {
      sections.addEventListener("click", (event) => {
        let target = event.target;
        while (target && target !== sections && !(target.classList && target.classList.contains("set-sec"))) {
          target = target.parentNode;
        }
        if (!target || target === sections) return;
        const index = Array.from(sections.children).indexOf(target);
        if (index >= 0) this._enterSection(index);
      });
    }
    const rows = this._el("set-rows");
    if (rows) {
      rows.addEventListener("click", (event) => {
        let target = event.target;
        while (target && target !== rows && !(target.classList && target.classList.contains("set-row"))) {
          target = target.parentNode;
        }
        if (!target || target === rows) return;
        const index = parseInt(target.getAttribute("data-i"), 10);
        if (!(index >= 0)) return;
        this._zone = "rows";
        this._rowIdx = index;
        const row = this._settingsRows()[index];
        if (row && row.type === "action") this._action(row);
        else this.render();
      });
    }

    this._restoreInput = document.createElement("input");
    this._restoreInput.type = "file";
    this._restoreInput.id = "restore-file";
    this._restoreInput.accept = ".json,application/json";
    this._restoreInput.style.display = "none";
    document.body.appendChild(this._restoreInput);
    this._restoreInput.addEventListener("change", () => {
      this._readRestore(this._restoreInput.files && this._restoreInput.files[0]);
      this._restoreInput.value = "";
    });
  }
}

KP.Views = KP.Views || {};
KP.Views.settings = new KPlayerSettings();
