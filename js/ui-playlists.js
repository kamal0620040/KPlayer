/* KPlayer playlists: manage sources, multi-select imports and remote-first dialogs. */
"use strict";

const JSON_PLAYLIST_LIMIT = 1000;
const PL_ROW_H = 128;
const PL_ROW_GAP = 16;
const PL_OVERSCAN = 2;
const JSON_ROW_H = 96;
const JSON_ROW_GAP = 8;
const JSON_OVERSCAN = 2;
const PL_BACK_KEYS = [27, 461, 10009];
const PL_MENU_KEYS = [18, 93, 10135];
const PL_SOURCE_ORDER = ["m3u", "xtream", "json"];

class KPlayerPlaylists {
  constructor() {
    this._type = "m3u";
    this._listKey = "";
    this._listWin = { start: 0, end: 0, visible: 0 };
    this._listForceCenter = false;
    this._flow = "";
    this._flowKey = "";
    this._sheet = null;
    this._dialog = null;
    this._busy = false;
    this._jsonItems = [];
    this._jsonSelected = new Set();
    this._jsonSource = "";
    this._jsonError = "";
    this._jsonBusy = false;
    this._jsonTruncated = false;
    this._jsonWin = { start: 0, end: 0, visible: 0 };
    this._jsonToken = 0;
    this._jsonJumpKey = "";
    this._resizeTimer = null;
  }

  _el(id) {
    return document.getElementById(id);
  }

  _isBack(key) {
    return PL_BACK_KEYS.indexOf(key) >= 0;
  }

  _isMenu(key) {
    return PL_MENU_KEYS.indexOf(key) >= 0;
  }

  _icon(name, className) {
    return KP.Icons.inner(name, className || "ico");
  }

  _listKeys() {
    return ["add"].concat(KP.Store.playlists.map((playlist) => playlist.id));
  }

  _resolveListKey() {
    const keys = this._listKeys();
    if (keys.indexOf(this._listKey) >= 0) return;
    const activeId = KP.Store.activeId();
    this._listKey = activeId && keys.indexOf(activeId) > 0 ? activeId : "add";
  }

  _playlist(id) {
    return KP.Store.playlists.find((playlist) => playlist.id === id) || null;
  }

  _playlistIndex(id) {
    return KP.Store.playlists.findIndex((playlist) => playlist.id === id);
  }

  _host(url) {
    const match = /^https?:\/\/([^/]+)/i.exec(String(url || ""));
    return match ? match[1] : "";
  }

  _defaultName(url) {
    let base = url;
    try {
      const parsed = KP.Parsers.xtreamFromGetUrl(url);
      if (parsed) base = parsed.base;
    } catch (error) {
      KP.Utils.logWarn("playlists/default-name", error);
    }
    return String(base || "Playlist").replace(/^https?:\/\//i, "").split("/")[0] || "Playlist";
  }

  _jsonType(url) {
    try {
      return KP.Parsers.xtreamFromGetUrl(url) ? "Xtream" : "M3U";
    } catch (error) {
      KP.Utils.logWarn("playlists/json-type", error);
      return "M3U";
    }
  }

  _findSavedFor(item) {
    if (!item) return null;
    let targetUrl = item.url;
    let targetUser = "";
    try {
      const parsed = KP.Parsers.xtreamFromGetUrl(item.url);
      if (parsed) {
        targetUrl = parsed.base;
        targetUser = parsed.user;
      }
    } catch (error) {
      KP.Utils.logWarn("playlists/json-match", error);
    }
    return KP.Store.playlists.find((playlist) =>
      playlist.url === targetUrl && (playlist.user || "") === targetUser) || null;
  }

  _updatedLabel(value) {
    const timestamp = Number(value) || 0;
    if (!timestamp) return "";
    const diff = Math.max(0, Date.now() - timestamp);
    if (diff < 60 * 1000) return "Updated just now";
    if (diff < 60 * 60 * 1000) return `Updated ${Math.max(1, Math.floor(diff / 60000))}m ago`;
    if (diff < 24 * 60 * 60 * 1000) return `Updated ${Math.max(1, Math.floor(diff / 3600000))}h ago`;
    if (diff < 48 * 60 * 60 * 1000) return "Updated yesterday";
    if (diff < 7 * 24 * 60 * 60 * 1000) return `Updated ${Math.floor(diff / 86400000)}d ago`;
    const date = new Date(timestamp);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `Updated ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }

  _metaHtml(playlist) {
    const type = playlist.type === "xtream" ? "Xtream" : "M3U";
    const sep = '<span class="sep">·</span>';
    if (playlist.status === "loading") {
      return `${type}${sep}<span class="pl-meta-spinner"></span>Loading`;
    }
    if (playlist.status === "error") {
      return `${type}${sep}<span class="bad">${KP.Utils.esc(playlist.error || "Could not load")}</span>`;
    }
    const parts = [type];
    const count = playlist._channels ? playlist._channels.length : 0;
    if (count) {
      parts.push(`${KP.Utils.fmtNum(count)} channels`);
      if (playlist.epgUrls && playlist.epgUrls.length) parts.push("EPG");
      parts.push(this._updatedLabel(playlist.updatedAt) || "Updated this session");
    } else if (playlist.status === "ready") {
      parts.push("No channels");
      parts.push(this._updatedLabel(playlist.updatedAt) || "Updated this session");
    } else {
      parts.push("Not loaded");
    }
    return parts.join(sep);
  }

  _addRowHtml() {
    return '<div class="pl-row is-add" data-key="add" role="listitem" aria-label="Add playlist">' +
      `<span class="pl-row-ico">${this._icon("plus")}</span>` +
      '<div class="pl-row-main"><span class="pl-row-name">Add playlist</span>' +
        '<span class="pl-row-meta">M3U link, Xtream login or JSON list</span></div></div>';
  }

  _playlistRowHtml(playlist, index, activeId) {
    const active = playlist.id === activeId;
    return `<div class="pl-row${active ? " is-active" : ""}" data-key="${KP.Utils.esc(playlist.id)}" data-i="${index}" role="listitem"` +
      ` aria-label="${KP.Utils.esc(playlist.name)}${active ? ", active" : ""}">` +
      `<span class="pl-row-ico">${this._icon("playlist")}</span>` +
      '<div class="pl-row-main">' +
      `<span class="pl-row-name">${KP.Utils.esc(playlist.name)}</span>` +
      `<span class="pl-row-meta">${this._metaHtml(playlist)}</span></div>` +
      (active ? `<span class="pl-check">${this._icon("check")}</span>` : "") +
      `<span class="pl-more">${this._icon("more")}</span></div>`;
  }

  _listVisible() {
    const list = this._el("pl-list");
    const stride = KP.Utils.designPx(PL_ROW_H + PL_ROW_GAP);
    const height = list && list.clientHeight ? list.clientHeight : KP.Utils.designPx(760);
    return Math.max(3, Math.floor(height / stride));
  }

  _windowFor(total, focus, visible, current, force) {
    if (!total) return { start: 0, end: 0, visible };
    let start = force ? focus - Math.floor(visible / 2) : (current.start || 0);
    if (focus >= 0) {
      if (!force && current.visible !== visible) start = focus - Math.floor(visible / 2);
      if (!force) {
        if (focus < start + 1) start = focus - 1;
        else if (focus > start + visible - 1) start = focus - visible + 1;
      }
    }
    start = Math.max(0, Math.min(start, Math.max(0, total - visible)));
    const end = Math.min(total, start + visible + PL_OVERSCAN * 2);
    return { start, end, visible };
  }

  _renderList() {
    const list = this._el("pl-list");
    if (!list) return;
    this._resolveListKey();
    const keys = this._listKeys();
    const activeId = KP.Store.activeId();
    const total = keys.length;
    const focus = Math.max(0, keys.indexOf(this._listKey));
    const visible = this._listVisible();
    const win = this._windowFor(total, focus, visible, this._listWin, this._listForceCenter);
    const stride = KP.Utils.designPx(PL_ROW_H + PL_ROW_GAP);
    this._listForceCenter = false;
    let html = win.start > 0 ? `<div class="pl-list-spacer" style="height:${win.start * stride}px"></div>` : "";
    for (let index = win.start; index < win.end; index += 1) {
      if (index === 0) html += this._addRowHtml();
      else {
        const playlist = KP.Store.playlists[index - 1];
        if (playlist) html += this._playlistRowHtml(playlist, index - 1, activeId);
      }
    }
    if (win.end < total) {
      html += `<div class="pl-list-spacer" style="height:${(total - win.end) * stride}px"></div>`;
    }
    list.innerHTML = html;
    this._listWin = win;
    list.scrollTop = KP.Utils.snapPixels(win.start * stride, list);
  }

  _clearFocus() {
    document.querySelectorAll("#view-playlists .focused").forEach((element) => element.classList.remove("focused"));
  }

  _applyFocus() {
    this._clearFocus();
    const list = this._el("pl-list");
    const choices = this._el("pl-type-list");
    if (list) list.classList.remove("has-focus");
    if (choices) choices.classList.remove("has-focus");

    if (this._dialog) {
      const field = this._el("pl-dialog-field");
      if (field && this._dialog.kind === "rename" && this._dialog.key === "input") field.classList.add("focused");
      document.querySelectorAll("#pl-dialog-actions [data-dialog-action]").forEach((button) => {
        button.classList.toggle("focused", button.getAttribute("data-dialog-action") === this._dialog.key);
      });
      return;
    }

    if (this._sheet) {
      document.querySelectorAll("#pl-sheet-options [data-sheet-action]").forEach((option) => {
        option.classList.toggle("focused", option.getAttribute("data-sheet-action") === this._sheet.key);
      });
      return;
    }

    if (this._flow) {
      const backBtn = this._el("pl-flow-back");
      if (backBtn) backBtn.classList.toggle("focused", this._flowKey === "flow-back");
      if (this._flow === "chooser") {
        if (choices) choices.classList.toggle("has-focus", this._flowKey !== "flow-back");
        document.querySelectorAll("#pl-type-list .pl-choice").forEach((choice) => {
          choice.classList.toggle("focused", `type:${choice.getAttribute("data-type")}` === this._flowKey);
        });
        return;
      }
      if (this._flow === "json") {
        const jsonField = document.querySelector('[data-field="plf-json"]');
        if (jsonField) jsonField.classList.toggle("focused", this._flowKey === "plf-json");
        const load = this._el("plj-load");
        if (load) load.classList.toggle("focused", this._flowKey === "plj-load");
        const add = this._el("plj-add");
        if (add) add.classList.toggle("focused", this._flowKey === "plj-add");
        document.querySelectorAll("#pl-json-list .pl-json-row").forEach((row) => {
          row.classList.toggle("focused", `json:${row.getAttribute("data-j")}` === this._flowKey);
        });
        return;
      }
      const field = document.querySelector(`[data-field="${this._flowKey}"]`);
      if (field) field.classList.add("focused");
      if (this._flowKey === "plf-add") {
        const add = this._el("plf-add");
        if (add) add.classList.add("focused");
      }
      return;
    }

    if (!list) return;
    list.classList.add("has-focus");
    list.querySelectorAll(".pl-row").forEach((row) => {
      row.classList.toggle("focused", row.getAttribute("data-key") === this._listKey);
    });
  }

  _renderFlow() {
    const flow = this._el("pl-addflow");
    if (!flow) return;
    flow.classList.toggle("hidden", !this._flow);
    if (!this._flow) return;
    const chooser = this._flow === "chooser";
    const form = this._flow === "m3u" || this._flow === "xtream";
    const json = this._flow === "json";
    flow.classList.toggle("is-json", json);
    const titles = {
      chooser: "Choose a source",
      m3u: "M3U link",
      xtream: "Xtream login",
      json: "JSON list"
    };
    this._el("pl-flow-step").textContent = "Add playlist";
    this._el("pl-flow-title").textContent = titles[this._flow] || "Add playlist";
    this._el("pl-type-list").classList.toggle("hidden", !chooser);
    this._el("pl-addform").classList.toggle("hidden", !form);
    this._el("pl-json-panel").classList.toggle("hidden", !json);
    if (form) {
      this._el("pl-addform").classList.toggle("m3u", this._flow === "m3u");
      this._el("plf-url-label").textContent = this._flow === "xtream" ? "Server URL" : "Playlist URL";
      const url = this._el("plf-url");
      if (url) {
        url.placeholder = this._flow === "xtream"
          ? "https://provider.example:8080"
          : "https://provider.example/playlist.m3u";
      }
    }
    if (json) this._renderJsonList();
  }

  _renderSheet() {
    if (!this._sheet) return;
    const playlist = this._playlist(this._sheet.id);
    if (!playlist) {
      this._sheet = null;
      return;
    }
    this._el("pl-sheet-title").textContent = playlist.name;
    const options = [
      { key: "reload", label: "Reload", icon: "reload" },
      { key: "rename", label: "Rename", icon: "edit" },
      { key: "remove", label: "Remove", icon: "trash" }
    ];
    this._el("pl-sheet-options").innerHTML = options.map((option) =>
      `<div class="pl-sheet-option" data-sheet-action="${option.key}" role="button">` +
      `${this._icon(option.icon)}<span>${option.label}</span></div>`).join("");
  }

  _renderDialog() {
    if (!this._dialog) return;
    const playlist = this._playlist(this._dialog.id);
    if (!playlist) {
      this._dialog = null;
      return;
    }
    const rename = this._dialog.kind === "rename";
    this._el("pl-dialog-title").textContent = rename ? "Rename playlist" : "Remove playlist?";
    this._el("pl-dialog-text").textContent = rename
      ? "Choose a short name for this source."
      : `${playlist.name} will be removed from this TV.`;
    this._el("pl-dialog-field").classList.toggle("hidden", !rename);
    const input = this._el("pl-dialog-input");
    if (input) input.placeholder = "Playlist name";
    this._el("pl-dialog-actions").innerHTML = rename
      ? '<button class="pl-button quiet" data-dialog-action="cancel" type="button">Cancel</button>' +
        '<button class="pl-button primary" data-dialog-action="save" type="button">Save</button>'
      : '<button class="pl-button quiet" data-dialog-action="cancel" type="button">Cancel</button>' +
        '<button class="pl-button danger" data-dialog-action="remove" type="button">Remove</button>';
  }

  _renderModal() {
    const modal = this._el("pl-modal");
    if (!modal) return;
    const show = !!(this._sheet || this._dialog);
    modal.classList.toggle("hidden", !show);
    this._el("pl-sheet").classList.toggle("hidden", !this._sheet);
    this._el("pl-dialog").classList.toggle("hidden", !this._dialog);
  }

  render() {
    this._renderList();
    this._renderFlow();
    this._renderSheet();
    this._renderDialog();
    this._renderModal();
    this._applyFocus();
    KP.Shell.refreshScrollFades();
  }

  _setInline(id, text, kind) {
    const element = this._el(id);
    if (!element) return;
    element.textContent = text || "";
    element.className = `pl-inline${kind ? ` ${kind}` : ""}`;
  }

  _setButtonBusy(id, busy, label) {
    const button = this._el(id);
    if (!button) return;
    button.disabled = !!busy;
    button.setAttribute("aria-busy", busy ? "true" : "false");
    button.innerHTML = busy ? `<span class="spinner"></span>${KP.Utils.esc(label)}` : KP.Utils.esc(label);
  }

  _setJsonInput() {
    const input = this._el("plf-json");
    if (input && !input.value) input.value = KP.Store.settings().jsonPlaylistUrl || "";
  }

  _openAddFlow() {
    if (this._busy || this._flow) return;
    this._type = "m3u";
    this._flow = "chooser";
    this._flowKey = "type:m3u";
    this._sheet = null;
    this._dialog = null;
    this._listKey = "add";
    this._jsonItems = [];
    this._jsonSelected = new Set();
    this._jsonSource = "";
    this._jsonError = "";
    this._jsonBusy = false;
    this._jsonTruncated = false;
    this._jsonWin = { start: 0, end: 0, visible: 0 };
    this._jsonJumpKey = "";
    this._jsonToken += 1;
    ["plf-name", "plf-url", "plf-user", "plf-pass", "plf-epg", "plf-json"].forEach((id) => {
      const input = this._el(id);
      if (input) input.value = "";
    });
    ["plf-msg", "plj-msg", "pl-dialog-msg"].forEach((id) => this._setInline(id, "", ""));
    this._setButtonBusy("plf-add", false, "Add playlist");
    this._setButtonBusy("plj-load", false, "Load list");
    this._setButtonBusy("plj-add", false, "Add selected");
    this._el("plj-add").classList.add("dim");
    this._renderFlow();
    const flow = this._el("pl-addflow");
    if (flow) flow.scrollTop = 0;
    this.render();
  }

  _leaveFlow() {
    if (this._busy) return;
    this._flow = "";
    this._flowKey = "";
    this._sheet = null;
    this._dialog = null;
    this._listKey = "add";
    this.render();
  }

  _backToChooser() {
    if (this._busy) return;
    if (this._jsonBusy) {
      this._cancelJsonLoad();
      return;
    }
    this._flow = "chooser";
    this._flowKey = `type:${this._type}`;
    this._setInline("plf-msg", "", "");
    this._setInline("plj-msg", "", "");
    this.render();
  }

  _flowBack() {
    if (!this._flow || this._busy) return;
    if (this._flow === "chooser") {
      this._leaveFlow();
      return;
    }
    if (this._jsonBusy) {
      this._cancelJsonLoad();
      return;
    }
    this._backToChooser();
  }

  _enterFlowType(type) {
    if (PL_SOURCE_ORDER.indexOf(type) < 0) return;
    this._type = type;
    if (type === "json") {
      this._flow = "json";
      this._setJsonInput();
      const first = this._jsonFirstSelectable();
      this._flowKey = first >= 0 ? `json:${first}` : "plf-json";
    } else {
      this._flow = type;
      this._flowKey = "plf-name";
      this._setInline("plf-msg", "", "");
    }
    this.render();
  }

  _formFields() {
    if (this._flow === "xtream") {
      return ["plf-name", "plf-url", "plf-user", "plf-pass", "plf-epg", "plf-add"];
    }
    return ["plf-name", "plf-url", "plf-epg", "plf-add"];
  }

  _flowFields() {
    if (this._flow === "chooser") return PL_SOURCE_ORDER.map((type) => `type:${type}`);
    if (this._flow === "json") {
      const fields = ["plf-json", "plj-load"];
      this._jsonItems.forEach((item, index) => {
        if (!this._findSavedFor(item)) fields.push(`json:${index}`);
      });
      fields.push("plj-add");
      return fields;
    }
    return this._formFields();
  }

  _flowMove(key) {
    const fields = this._flowFields();
    let index = fields.indexOf(this._flowKey);
    if (index < 0) index = 0;
    if (this._flowKey === "flow-back") {
      if (key === 40) {
        this._flowKey = this._flow === "chooser" ? "type:m3u" : (this._flow === "json" ? "plf-json" : fields[0]);
        this.render();
      }
      return;
    }
    if (this._flow === "chooser") {
      const current = PL_SOURCE_ORDER.indexOf(String(this._flowKey).replace("type:", ""));
      const safe = current < 0 ? 0 : current;
      const row = Math.floor(safe / 2);
      const col = safe % 2;
      let target = null;
      if (key === 37 && col > 0) target = safe - 1;
      else if (key === 39 && col < 1) target = safe + 1;
      else if (key === 38 && row === 0) {
        this._flowKey = "flow-back";
        this.render();
        return;
      }
      else if (key === 40 && row < 1 && safe + 2 < PL_SOURCE_ORDER.length) target = safe + 2;
      if (target !== null) this._flowKey = `type:${PL_SOURCE_ORDER[target]}`;
      this.render();
      return;
    }
    if (this._flow === "json") {
      const current = this._flowKey;
      const item = /^json:(\d+)$/.exec(current || "");
      const itemIndex = item ? parseInt(item[1], 10) : -1;
      const pageUp = key === 33 || key === 176 || key === 427;
      const pageDown = key === 34 || key === 177 || key === 428;
      let target = current;
      if (key === 39 && current === "plf-json") target = "plj-load";
      else if (key === 37 && current === "plj-load") target = "plf-json";
      else if (key === 39 && itemIndex >= 0) {
        this._jsonJumpKey = current;
        target = "plj-add";
      } else if (key === 37 && current === "plj-add") {
        const back = /^json:\d+$/.test(this._jsonJumpKey) ? this._jsonJumpKey : "";
        const last = this._jsonLastSelectable();
        target = back || (last >= 0 ? `json:${last}` : "plj-load");
      } else if (pageUp || pageDown) {
        if (itemIndex >= 0) {
          const jumped = this._jsonPageSelectable(itemIndex, pageDown ? 1 : -1);
          if (jumped !== itemIndex) target = `json:${jumped}`;
        }
      } else if (key === 38) {
        if (current === "plj-add") {
          const last = this._jsonLastSelectable();
          target = last >= 0 ? `json:${last}` : "plj-load";
        } else if (itemIndex >= 0) {
          const previous = this._jsonPreviousSelectable(itemIndex);
          target = previous >= 0 ? `json:${previous}` : "plf-json";
        } else if (current === "plf-json") {
          target = "flow-back";
        }
      } else if (key === 40) {
        if (current === "plf-json" || current === "plj-load") {
          const first = this._jsonFirstSelectable();
          target = first >= 0 ? `json:${first}` : current;
        } else if (itemIndex >= 0) {
          const next = this._jsonNextSelectable(itemIndex);
          target = next >= 0 ? `json:${next}` : "plj-add";
        }
      }
      if (target !== current) this._flowKey = target;
      this.render();
      return;
    }
    if (key === 38) {
      if (index === 0) {
        this._flowKey = "flow-back";
        this.render();
        return;
      }
      index -= 1;
    } else if (key === 40) index += 1;
    else return;
    index = Math.max(0, Math.min(fields.length - 1, index));
    this._flowKey = fields[index] || "";
    this.render();
  }

  _flowActivate() {
    const current = this._flowKey;
    if (current === "flow-back") {
      this._flowBack();
      return;
    }
    if (this._flow === "chooser") {
      this._enterFlowType(String(current).replace("type:", ""));
      return;
    }
    if (this._flow === "json") {
      if (current === "plf-json") {
        const input = this._el("plf-json");
        if (input) {
          input.focus();
          if (input.select) input.select();
        }
      } else if (current === "plj-load") {
        this._loadJson();
      } else if (current === "plj-add") {
        this._addSelectedJson();
      } else {
        const item = /^json:(\d+)$/.exec(current || "");
        if (item) this._toggleJson(parseInt(item[1], 10));
      }
      return;
    }
    if (current === "plf-add") {
      this._submit();
      return;
    }
    const input = this._el(current);
    if (input && input.tagName === "INPUT") {
      input.focus();
      if (input.select) input.select();
    }
  }

  _openSheet(id, action) {
    if (this._busy || !id || id === "add") return;
    const playlist = this._playlist(id);
    if (!playlist) return;
    this._listKey = id;
    this._sheet = { id, key: action || "reload" };
    this._dialog = null;
    this.render();
  }

  _closeSheet() {
    this._sheet = null;
    this.render();
  }

  _sheetMove(key) {
    if (!this._sheet) return;
    const order = ["reload", "rename", "remove"];
    let index = order.indexOf(this._sheet.key);
    if (key === 38) index -= 1;
    else if (key === 40) index += 1;
    else return;
    index = Math.max(0, Math.min(order.length - 1, index));
    this._sheet.key = order[index];
    this.render();
  }

  _sheetActivate() {
    if (!this._sheet) return;
    const action = this._sheet.key;
    const id = this._sheet.id;
    if (action === "reload") {
      this._sheet = null;
      this._reloadPlaylist(this._playlist(id));
    } else if (action === "rename") {
      this._openRename(id);
    } else {
      this._openRemove(id);
    }
  }

  _openRename(id) {
    const playlist = this._playlist(id);
    if (!playlist) return;
    this._sheet = null;
    this._dialog = { kind: "rename", id, key: "input" };
    this._listKey = id;
    this._setInline("pl-dialog-msg", "", "");
    this.render();
    const input = this._el("pl-dialog-input");
    if (input) {
      input.value = playlist.name;
      input.focus();
      if (input.select) input.select();
    }
  }

  _openRemove(id) {
    const playlist = this._playlist(id);
    if (!playlist) return;
    this._sheet = null;
    this._dialog = { kind: "remove", id, key: "cancel" };
    this._listKey = id;
    this._setInline("pl-dialog-msg", "", "");
    this.render();
  }

  _closeDialog() {
    const active = document.activeElement;
    if (active && active.id === "pl-dialog-input") active.blur();
    this._dialog = null;
    this._setInline("pl-dialog-msg", "", "");
    this.render();
  }

  _dialogMove(key) {
    if (!this._dialog) return;
    if (this._dialog.kind === "remove") {
      if (key === 37 || key === 38) this._dialog.key = "cancel";
      else if (key === 39 || key === 40) this._dialog.key = "remove";
      this.render();
      return;
    }
    if (key === 38) {
      if (this._dialog.key !== "input") this._dialog.key = "input";
    } else if (key === 40) {
      if (this._dialog.key === "input") this._dialog.key = "cancel";
    } else if (key === 37) {
      if (this._dialog.key === "save") this._dialog.key = "cancel";
    } else if (key === 39) {
      if (this._dialog.key === "cancel") this._dialog.key = "save";
    }
    this.render();
  }

  _dialogActivate() {
    if (!this._dialog) return;
    const key = this._dialog.key;
    if (key === "input") {
      const input = this._el("pl-dialog-input");
      if (input) {
        input.focus();
        if (input.select) input.select();
      }
    } else if (key === "cancel") {
      this._closeDialog();
    } else if (key === "save") {
      this._saveRename();
    } else if (key === "remove") {
      this._removePlaylist(this._dialog.id);
    }
  }

  _saveRename() {
    if (!this._dialog || this._dialog.kind !== "rename") return;
    const playlist = this._playlist(this._dialog.id);
    const input = this._el("pl-dialog-input");
    if (!playlist || !input) {
      this._closeDialog();
      return;
    }
    const name = input.value.trim();
    if (!name) {
      this._setInline("pl-dialog-msg", "Enter a name for this playlist.", "bad");
      input.focus();
      return;
    }
    const id = playlist.id;
    this._dialog = null;
    if (document.activeElement === input) input.blur();
    let renamed = false;
    try {
      renamed = KP.Store.rename(id, name);
    } catch (error) {
      KP.Utils.logError("playlists/rename", error);
    }
    this._listKey = id;
    this.render();
    KP.Shell.toast(renamed ? "Playlist renamed" : "Could not rename this playlist");
  }

  _removePlaylist(id) {
    const playlist = this._playlist(id);
    if (!playlist) {
      this._closeDialog();
      return;
    }
    const keys = this._listKeys();
    const currentKeyIndex = keys.indexOf(id);
    const nextKey = keys[currentKeyIndex + 1] || keys[currentKeyIndex - 1] || "add";
    const wasActive = KP.Store.activeId() === id;
    const app = KP.Shell.state;
    const stopped = !!(app.playing && app.playing.playlistId === id);
    this._dialog = null;
    this._sheet = null;
    this._listKey = nextKey;
    if (stopped) KP.Playback.stop();
    KP.Store.remove(id);
    if (wasActive) this._resetBrowseState();
    const remaining = this._listKeys();
    if (remaining.indexOf(this._listKey) < 0) this._listKey = "add";
    KP.Shell.updatePlaceholder();
    this.render();
    KP.Shell.toast(`Removed ${playlist.name}`);
  }

  _resetBrowseState() {
    const app = KP.Shell.state;
    app.gGroupIdx = 0;
    app.gChanIdx = 0;
    app.gCellIdx = 0;
    app.gGroupTouched = false;
    app.gAutoPicked = false;
    if (KP.Views.vod) KP.Views.vod.reset();
  }

  _reloadPlaylist(playlist) {
    if (!playlist || playlist.status === "loading") {
      this.render();
      return;
    }
    this._sheet = null;
    this._listKey = playlist.id;
    KP.Store.loadPlaylist(playlist, (error) => {
      if (!KP.Store.getPlaylist(playlist.id)) return;
      KP.Shell.updatePlaceholder();
      if (KP.Shell.state.view === "playlists") this.render();
      if (error) KP.Shell.toast(`Could not reload ${playlist.name}`);
      else {
        const count = playlist._channels ? playlist._channels.length : 0;
        KP.Shell.toast(`${playlist.name} reloaded · ${KP.Utils.fmtNum(count)} channels`);
      }
    });
    this.render();
  }

  _activatePlaylist(playlist) {
    if (!playlist) return;
    this._flow = "";
    this._flowKey = "";
    this._sheet = null;
    this._dialog = null;
    this._listKey = playlist.id;
    this._listForceCenter = true;
    KP.Store.setActive(playlist.id);
    this._resetBrowseState();
    this.render();
    if (playlist.status !== "loading" && (!playlist._channels || !playlist._channels.length)) {
      KP.Store.loadPlaylist(playlist, (error) => {
        if (!KP.Store.getPlaylist(playlist.id)) return;
        KP.Shell.updatePlaceholder();
        if (error) KP.Shell.toast(`Could not load ${playlist.name}`);
      });
    }
    KP.Shell.updatePlaceholder();
    KP.Shell.show("player");
  }

  _activateKey(key) {
    if (key === "add") {
      this._openAddFlow();
      return;
    }
    const playlist = this._playlist(key);
    if (playlist) this._activatePlaylist(playlist);
  }

  _moveList(delta) {
    const keys = this._listKeys();
    let index = keys.indexOf(this._listKey);
    if (index < 0) index = 0;
    index = Math.max(0, Math.min(keys.length - 1, index + delta));
    const key = keys[index];
    if (key === this._listKey) return;
    this._listKey = key;
    if (index > this._listWin.start && index < this._listWin.start + this._listWin.visible) {
      this._applyFocus();
      return;
    }
    this.render();
  }

  _jsonFocusIndex() {
    const match = /^json:(\d+)$/.exec(this._flowKey || "");
    return match ? parseInt(match[1], 10) : -1;
  }

  _jsonFirstSelectable() {
    return this._jsonItems.findIndex((item) => !this._findSavedFor(item));
  }

  _jsonLastSelectable() {
    for (let index = this._jsonItems.length - 1; index >= 0; index -= 1) {
      if (!this._findSavedFor(this._jsonItems[index])) return index;
    }
    return -1;
  }

  _jsonPreviousSelectable(index) {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (!this._findSavedFor(this._jsonItems[cursor])) return cursor;
    }
    return -1;
  }

  _jsonNextSelectable(index) {
    for (let cursor = index + 1; cursor < this._jsonItems.length; cursor += 1) {
      if (!this._findSavedFor(this._jsonItems[cursor])) return cursor;
    }
    return -1;
  }

  _jsonPageSelectable(index, direction) {
    const step = Math.max(1, this._jsonVisibleRows() - 1);
    let cursor = index;
    for (let count = 0; count < step; count += 1) {
      const next = direction < 0 ? this._jsonPreviousSelectable(cursor) : this._jsonNextSelectable(cursor);
      if (next < 0) break;
      cursor = next;
    }
    return cursor;
  }

  _jsonVisibleRows() {
    const list = this._el("pl-json-list");
    const stride = KP.Utils.designPx(JSON_ROW_H + JSON_ROW_GAP);
    const height = list && list.clientHeight ? list.clientHeight : KP.Utils.designPx(520);
    return Math.max(3, Math.floor(height / stride));
  }

  _renderJsonList() {
    const list = this._el("pl-json-list");
    if (!list) return;
    const add = this._el("plj-add");
    if (add) {
      add.classList.toggle("dim", this._jsonSelected.size === 0);
      add.setAttribute("aria-label", `Add selected playlists (${this._jsonSelected.size})`);
    }
    if (this._jsonBusy) {
      list.innerHTML = '<div class="pl-json-empty"><span class="spinner"></span> Loading playlists...</div>';
      return;
    }
    if (this._jsonError) {
      list.innerHTML = '<div class="pl-json-empty">No playlists loaded. Check the JSON link and try again.</div>';
      return;
    }
    if (!this._jsonItems.length) {
      list.innerHTML = `<div class="pl-json-empty">${this._jsonSource
        ? "No valid playlists were found in that JSON."
        : "Load a JSON link to see playlists."}</div>`;
      return;
    }
    const total = this._jsonItems.length;
    const visible = this._jsonVisibleRows();
    const focus = this._jsonFocusIndex();
    const win = this._windowFor(total, focus, visible, this._jsonWin, false);
    const stride = KP.Utils.designPx(JSON_ROW_H + JSON_ROW_GAP);
    let html = win.start > 0 ? `<div class="pl-json-spacer" style="height:${win.start * stride}px"></div>` : "";
    for (let index = win.start; index < win.end; index += 1) {
      const item = this._jsonItems[index];
      if (!item) continue;
      const saved = this._findSavedFor(item);
      const checked = this._jsonSelected.has(item.url);
      const focused = this._flowKey === `json:${index}`;
      const type = this._jsonType(item.url);
      const host = this._host(item.url);
      html += `<div class="pl-json-row${saved ? " saved" : ""}${checked && !saved ? " checked" : ""}${focused ? " focused" : ""}"` +
        ` data-j="${index}" role="checkbox" aria-checked="${checked && !saved ? "true" : "false"}">` +
        `<span class="pl-json-check">${checked && !saved ? this._icon("check") : ""}</span>` +
        '<span class="pl-json-main">' +
        `<span class="pl-json-name">${KP.Utils.esc(item.name)}</span>` +
        `<span class="pl-json-sub">${type}${host ? ` · ${KP.Utils.esc(host)}` : ""}</span></span>` +
        (saved ? '<span class="pl-json-note">Saved</span>' : "") +
        "</div>";
    }
    if (win.end < total) {
      html += `<div class="pl-json-spacer" style="height:${(total - win.end) * stride}px"></div>`;
    }
    list.innerHTML = html;
    this._jsonWin = win;
    list.scrollTop = KP.Utils.snapPixels(win.start * stride, list);
  }

  _toggleJson(index) {
    const item = this._jsonItems[index];
    if (!item) return;
    if (this._findSavedFor(item)) {
      this._flowKey = `json:${index}`;
      this._setInline("plj-msg", "This playlist is already saved.", "");
      this.render();
      return;
    }
    if (this._jsonSelected.has(item.url)) this._jsonSelected.delete(item.url);
    else this._jsonSelected.add(item.url);
    this._flowKey = `json:${index}`;
    this._setInline("plj-msg", "", "");
    this._listKey = "add";
    this.render();
  }

  _loadJson() {
    if (this._jsonBusy) return;
    const input = this._el("plf-json");
    const raw = input ? input.value.trim() : "";
    if (!raw) {
      this._setInline("plj-msg", "Enter the JSON link first.", "bad");
      this._flowKey = "plf-json";
      this.render();
      return;
    }
    if (!/^https?:\/\//i.test(raw)) {
      this._setInline("plj-msg", "The JSON link must start with http:// or https://", "bad");
      this._flowKey = "plf-json";
      this.render();
      return;
    }
    const token = ++this._jsonToken;
    this._jsonBusy = true;
    this._flowKey = "plj-load";
    this._jsonSource = raw;
    this._jsonError = "";
    this._jsonItems = [];
    this._jsonSelected = new Set();
    this._jsonTruncated = false;
    this._jsonWin = { start: 0, end: 0, visible: 0 };
    this._jsonJumpKey = "";
    KP.Store.setSetting("jsonPlaylistUrl", raw);
    this._setInline("plj-msg", "Loading playlists...", "busy");
    this._setButtonBusy("plj-load", true, "Loading...");
    this.render();
    KP.Net.json(raw, { timeoutMs: 30000, maxBytes: 2e6 }, (error, data) => {
      if (token !== this._jsonToken) return;
      this._jsonBusy = false;
      this._setButtonBusy("plj-load", false, "Load list");
      if (error) {
        this._jsonError = error.message || "Could not load the JSON link.";
        this._setInline("plj-msg", `Could not load the JSON list: ${this._jsonError}`, "bad");
        this.render();
        return;
      }
      if (!Array.isArray(data)) {
        this._jsonError = "The JSON must be an array of playlists.";
        this._setInline("plj-msg", "The JSON must be a list of playlists with name and URL fields.", "bad");
        this.render();
        return;
      }
      const seen = new Set();
      let skipped = 0;
      data.forEach((row) => {
        if (this._jsonItems.length >= JSON_PLAYLIST_LIMIT) {
          skipped += 1;
          return;
        }
        if (!row || typeof row !== "object") {
          skipped += 1;
          return;
        }
        const url = String(row.url || "").trim();
        if (!/^https?:\/\//i.test(url) || seen.has(url)) {
          skipped += 1;
          return;
        }
        seen.add(url);
        this._jsonItems.push({
          name: String(row.name || "").trim() || this._defaultName(url),
          url
        });
      });
      this._jsonTruncated = data.length > JSON_PLAYLIST_LIMIT;
      if (!this._jsonItems.length) {
        this._jsonError = "No valid playlists were found in that JSON.";
        this._setInline("plj-msg", "No valid playlists were found. Each entry needs a name and an http(s) URL.", "bad");
        this.render();
        return;
      }
      const count = this._jsonItems.length;
      const firstSelectable = this._jsonFirstSelectable();
      const extra = this._jsonTruncated
        ? ` Showing the first ${JSON_PLAYLIST_LIMIT}.`
        : (skipped ? ` Skipped ${skipped} invalid or duplicate entr${skipped === 1 ? "y" : "ies"}.` : "");
      const hint = count > 12 ? " CH Up/Down jumps; Right goes to Add selected." : "";
      this._flowKey = firstSelectable >= 0 ? `json:${firstSelectable}` : "plf-json";
      this._setInline("plj-msg", `${count} playlist${count === 1 ? "" : "s"} loaded. Select one or more.${extra}${hint}`, "");
      KP.Shell.toast(`Loaded ${count} playlist${count === 1 ? "" : "s"}`);
      this.render();
    });
  }

  _cancelJsonLoad() {
    if (!this._jsonBusy) return;
    this._jsonToken += 1;
    this._jsonBusy = false;
    this._setButtonBusy("plj-load", false, "Load list");
    this._setInline("plj-msg", "", "");
    this._flow = "chooser";
    this._flowKey = "type:json";
    this.render();
  }

  _addSelectedJson() {
    if (this._jsonBusy || this._busy) return;
    const selected = this._jsonItems.filter((item) => this._jsonSelected.has(item.url));
    if (!selected.length) {
      this._setInline("plj-msg", "Select at least one playlist.", "bad");
      this._flowKey = "plj-add";
      this.render();
      return;
    }
    this._busy = true;
    this._flowKey = "plj-add";
    this._setButtonBusy("plj-add", true, "Adding...");
    this.render();
    setTimeout(() => {
      const added = [];
      try {
        selected.forEach((item) => {
          if (this._findSavedFor(item)) return;
          const playlist = KP.Store.add({ name: item.name, url: item.url });
          if (playlist) added.push(playlist);
        });
      } catch (error) {
        KP.Utils.logError("playlists/json-add", error);
      }
      this._busy = false;
      this._setButtonBusy("plj-add", false, "Add selected");
      if (!added.length) {
        this._setInline("plj-msg", "Those playlists are already saved.", "");
        this.render();
        return;
      }
      const first = added[0];
      this._flow = "";
      this._flowKey = "";
      this._listKey = first.id;
      this._listForceCenter = true;
      this._jsonSelected = new Set();
      KP.Store.setActive(first.id);
      this._resetBrowseState();
      this.render();
      KP.Shell.updatePlaceholder();
      KP.Shell.toast(`Added ${added.length} playlist${added.length === 1 ? "" : "s"}`);
      if (!first._channels || !first._channels.length) {
        KP.Store.loadPlaylist(first, (error) => {
          if (!KP.Store.getPlaylist(first.id)) return;
          KP.Shell.updatePlaceholder();
          if (error) KP.Shell.toast(`Could not load ${first.name}`);
        });
      }
      KP.Shell.show("player");
    }, 40);
  }

  _submit() {
    if (this._busy) return;
    const raw = this._el("plf-url").value.trim();
    if (!raw) {
      this._setInline("plf-msg", "Enter the playlist URL first.", "bad");
      this._flowKey = "plf-url";
      this.render();
      return;
    }
    let parsed = null;
    try {
      parsed = KP.Parsers.xtreamFromGetUrl(raw);
    } catch (error) {
      KP.Utils.logWarn("playlists/parse-url", error);
    }
    const type = parsed ? "xtream" : this._type;
    const url = parsed ? parsed.base : raw;
    const useFormCredentials = !parsed && type === "xtream";
    const user = parsed ? parsed.user : (useFormCredentials ? this._el("plf-user").value.trim() : "");
    const pass = parsed ? parsed.pass : (useFormCredentials ? this._el("plf-pass").value : "");
    if (!/^https?:\/\//i.test(url)) {
      this._setInline("plf-msg", "The URL must start with http:// or https://", "bad");
      this._flowKey = "plf-url";
      this.render();
      return;
    }
    if (type === "xtream" && (!user || !pass)) {
      this._setInline("plf-msg", "Enter the username and password for Xtream Codes.", "bad");
      this._flowKey = user ? "plf-pass" : "plf-user";
      this.render();
      return;
    }
    const epg = this._el("plf-epg").value.trim();
    if (epg && !/^https?:\/\//i.test(epg)) {
      this._setInline("plf-msg", "The EPG link must start with http:// or https://", "bad");
      this._flowKey = "plf-epg";
      this.render();
      return;
    }
    const duplicate = KP.Store.playlists.some((playlist) =>
      playlist.url === url && (playlist.user || "") === (user || ""));
    if (duplicate) {
      this._setInline("plf-msg", "This playlist is already added. Use Reload from its menu.", "bad");
      this._flowKey = "plf-url";
      this.render();
      return;
    }
    const name = this._el("plf-name").value.trim() || this._defaultName(raw);
    const previousActiveId = KP.Store.activeId();
    this._busy = true;
    this._flowKey = "plf-add";
    this._setButtonBusy("plf-add", true, "Adding...");
    this._setInline("plf-msg", `Loading channels from ${name}...`, "busy");
    this.render();
    let playlist = null;
    try {
      playlist = KP.Store.add({ name, type, url, user, pass, epgUrls: epg ? [epg] : [] });
    } catch (error) {
      KP.Utils.logError("playlists/add", error);
    }
    if (!playlist) {
      this._busy = false;
      this._setButtonBusy("plf-add", false, "Add playlist");
      this._setInline("plf-msg", "This playlist could not be added.", "bad");
      this.render();
      return;
    }
    KP.Store.loadPlaylist(playlist, (error) => {
      this._busy = false;
      this._setButtonBusy("plf-add", false, "Add playlist");
      if (error) {
        try {
          KP.Store.remove(playlist.id);
          if (previousActiveId && KP.Store.getPlaylist(previousActiveId)) {
            KP.Store.setActive(previousActiveId);
          }
        } catch (cleanupError) {
          KP.Utils.logWarn("playlists/add-cleanup", cleanupError);
        }
        this._setInline("plf-msg", `Could not add ${name}: ${error.message || error}`, "bad");
        this._flowKey = "plf-url";
        this.render();
        KP.Shell.updatePlaceholder();
        return;
      }
      this._flow = "";
      this._flowKey = "";
      this._listKey = playlist.id;
      this._listForceCenter = true;
      KP.Store.setActive(playlist.id);
      this._resetBrowseState();
      this.render();
      KP.Shell.updatePlaceholder();
      const count = playlist._channels ? playlist._channels.length : 0;
      KP.Shell.toast(count ? `Loaded ${KP.Utils.fmtNum(count)} channels` : "Playlist added");
      KP.Shell.show("player");
    });
  }

  _handleListKey(key) {
    if (this._isBack(key)) {
      if (!KP.Store.playlists.length) KP.Shell.armExit();
      else KP.Shell.back();
      return true;
    }
    if (this._isMenu(key)) {
      if (this._listKey !== "add") this._openSheet(this._listKey, "reload");
      return true;
    }
    if (key === 38 || key === 40) {
      this._moveList(key === 40 ? 1 : -1);
      return true;
    }
    if (key === 39) {
      if (this._listKey !== "add") this._openSheet(this._listKey, "reload");
      return true;
    }
    if (key === 13) {
      this._activateKey(this._listKey);
      return true;
    }
    return false;
  }

  _handleFlowKey(key, active) {
    const input = active && active.tagName === "INPUT" && this._el("pl-addflow").contains(active);
    if (input) {
      if (this._isBack(key)) {
        active.blur();
        this._applyFocus();
        return true;
      }
      if (key === 13) {
        active.blur();
        if (active.id === "plf-json") this._loadJson();
        else this._flowMove(40);
        return true;
      }
      if (key === 38 || key === 40) {
        active.blur();
        this._flowMove(key);
        return true;
      }
      return false;
    }
    if (this._isBack(key)) {
      this._flowBack();
      return true;
    }
    if (key === 33 || key === 34 || key === 176 || key === 177 || key === 427 || key === 428) {
      if (this._flow === "json") {
        this._flowMove(key);
        return true;
      }
    }
    if (key === 38 || key === 40 || key === 37 || key === 39) {
      this._flowMove(key);
      return true;
    }
    if (key === 13) {
      this._flowActivate();
      return true;
    }
    if (this._isMenu(key)) return true;
    return false;
  }

  _handleSheetKey(key) {
    if (this._isBack(key)) {
      this._closeSheet();
      return true;
    }
    if (key === 38 || key === 40) {
      this._sheetMove(key);
      return true;
    }
    if (key === 13) {
      this._sheetActivate();
      return true;
    }
    return true;
  }

  _handleDialogKey(key, active) {
    const input = active && active.id === "pl-dialog-input";
    if (input) {
      if (this._isBack(key)) {
        this._closeDialog();
        return true;
      }
      if (key === 13) {
        this._saveRename();
        return true;
      }
      if (key === 40) {
        if (!this._dialog) return true;
        active.blur();
        this._dialog.key = "cancel";
        this._applyFocus();
        return true;
      }
      if (key === 38) {
        active.blur();
        this._applyFocus();
        return true;
      }
      return false;
    }
    if (this._isBack(key)) {
      this._closeDialog();
      return true;
    }
    if (key === 38 || key === 40 || key === 37 || key === 39) {
      this._dialogMove(key);
      return true;
    }
    if (key === 13) {
      this._dialogActivate();
      return true;
    }
    return true;
  }

  handleKey(key) {
    if (this._busy) return true;
    const active = document.activeElement;
    if (this._dialog) return this._handleDialogKey(key, active);
    if (this._sheet) return this._handleSheetKey(key);
    if (this._flow) return this._handleFlowKey(key, active);
    return this._handleListKey(key);
  }

  open() {
    this._flow = "";
    this._flowKey = "";
    this._sheet = null;
    this._dialog = null;
    this._busy = false;
    this._jsonBusy = false;
    this._jsonToken += 1;
    this._resolveListKey();
    this._listForceCenter = true;
    KP.Shell.show("playlists");
    this.render();
    const active = document.activeElement;
    if (active && active.tagName === "INPUT") active.blur();
    this._applyFocus();
    KP.Shell.refreshScrollFades();
  }

  refresh() {
    if (KP.Shell.state.view === "playlists") this.render();
  }

  _bindInput(input, handler) {
    if (!input) return;
    input.addEventListener("focus", handler);
  }

  init() {
    document.querySelectorAll("#view-playlists [data-pl-icon]").forEach((element) => {
      element.innerHTML = this._icon(element.getAttribute("data-pl-icon"));
    });
    const list = this._el("pl-list");
    if (list) {
      list.addEventListener("click", (event) => {
        const row = event.target.closest ? event.target.closest(".pl-row") : null;
        if (!row) return;
        const key = row.getAttribute("data-key");
        if (row.classList.contains("is-add")) {
          this._listKey = "add";
          this._openAddFlow();
          return;
        }
        this._listKey = key;
        if (event.target.closest(".pl-more")) this._openSheet(key, "reload");
        else this._activateKey(key);
      });
    }
    const typeList = this._el("pl-type-list");
    if (typeList) {
      typeList.addEventListener("click", (event) => {
        const choice = event.target.closest ? event.target.closest(".pl-choice") : null;
        if (!choice) return;
        this._enterFlowType(choice.getAttribute("data-type"));
      });
    }
    const add = this._el("plf-add");
    if (add) add.addEventListener("click", () => this._submit());
    const flowBack = this._el("pl-flow-back");
    if (flowBack) flowBack.addEventListener("click", () => this._flowBack());
    const jsonLoad = this._el("plj-load");
    if (jsonLoad) jsonLoad.addEventListener("click", () => this._loadJson());
    const jsonAdd = this._el("plj-add");
    if (jsonAdd) jsonAdd.addEventListener("click", () => this._addSelectedJson());
    const jsonList = this._el("pl-json-list");
    if (jsonList) {
      jsonList.addEventListener("click", (event) => {
        const row = event.target.closest ? event.target.closest(".pl-json-row") : null;
        if (!row) return;
        const index = parseInt(row.getAttribute("data-j"), 10);
        if (index >= 0) this._toggleJson(index);
      });
    }
    const sheetOptions = this._el("pl-sheet-options");    if (sheetOptions) {
      sheetOptions.addEventListener("click", (event) => {
        const option = event.target.closest ? event.target.closest("[data-sheet-action]") : null;
        if (!option) return;
        this._sheet.key = option.getAttribute("data-sheet-action");
        this._sheetActivate();
      });
    }
    const dialogActions = this._el("pl-dialog-actions");
    if (dialogActions) {
      dialogActions.addEventListener("click", (event) => {
        const button = event.target.closest ? event.target.closest("[data-dialog-action]") : null;
        if (!button) return;
        this._dialog.key = button.getAttribute("data-dialog-action");
        this._dialogActivate();
      });
    }
    const scrim = this._el("pl-scrim");
    if (scrim) {
      scrim.addEventListener("click", () => {
        if (this._dialog) this._closeDialog();
        else if (this._sheet) this._closeSheet();
      });
    }
    ["plf-name", "plf-url", "plf-user", "plf-pass", "plf-epg", "plf-json"].forEach((id) => {
      this._bindInput(this._el(id), () => {
        if (!this._flow) return;
        this._flowKey = id;
        this._applyFocus();
      });
    });
    this._bindInput(this._el("pl-dialog-input"), () => {
      if (!this._dialog) return;
      this._dialog.key = "input";
      this._applyFocus();
    });
    this._setJsonInput();
    window.addEventListener("resize", () => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => {
        if (KP.Shell.state.view === "playlists") this.render();
      }, 120);
    }, false);
  }
}

KP.Views = KP.Views || {};
KP.Views.playlists = new KPlayerPlaylists();
