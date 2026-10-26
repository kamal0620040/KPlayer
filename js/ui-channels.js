/* KPlayer live channel list overlay with group switching and a live preview. */
"use strict";

const CHANNEL_ROW_H = 76;
const CHANNEL_OVERSCAN = 4;

class KPlayerChannels {
  constructor() {
    this._focus = { key: "", index: -1, shift: null, preview: "" };
    this._win = { start: 0, end: 0, key: "", groupKey: "", visible: 0 };
    this._digitBuf = "";
    this._digitTimer = null;
  }

  get _app() {
    return KP.Shell.state;
  }

  _el(id) {
    return document.getElementById(id);
  }

  _rowPx() {
    return KP.Utils && KP.Utils.pixelRow ? KP.Utils.pixelRow(CHANNEL_ROW_H) : KP.Utils.designPx(CHANNEL_ROW_H);
  }

  _visibleRows() {
    const box = this._el("channel-list");
    const rowHeight = this._rowPx();
    return Math.max(3, Math.ceil(((box && box.clientHeight) || KP.Utils.designPx(760)) / rowHeight));
  }

  _programmeKey(channels, start, end) {
    let key = "";
    for (let index = start; index < end; index += 1) {
      const list = channels[index].programmes || [];
      const first = list.length ? list[0].start : 0;
      const last = list.length ? list[list.length - 1].end : 0;
      key += `|${list.length}:${first}:${last}`;
    }
    return key;
  }

  _rowHtml(channel, index) {
    const next = KP.Utils.nowNext(channel);
    return `<div class="ch-row${index === this._app.chanIdx ? " focused" : ""}" data-ci="${index}">` +
      `<div class="ch-num">${channel.num}</div>` +
      KP.Logo.box(channel, "ch-logo") +
      `<div class="ch-main"><div class="ch-name">${KP.Utils.esc(channel.name)}</div>` +
      `<div class="ch-now">${KP.Utils.esc(next.now ? next.now.title : "No information")}</div></div>` +
      `<div class="ch-time">${next.now ? `${KP.Utils.fmtTime(next.now.start)} - ${KP.Utils.fmtTime(next.now.end)}` : ""}</div>` +
      "</div>";
  }

  _rowText(row, channel) {
    const next = KP.Utils.nowNext(channel);
    const nowElement = row.querySelector(".ch-now");
    const timeElement = row.querySelector(".ch-time");
    if (nowElement) nowElement.textContent = next.now ? next.now.title : "No information";
    if (timeElement) {
      timeElement.textContent = next.now
        ? `${KP.Utils.fmtTime(next.now.start)} - ${KP.Utils.fmtTime(next.now.end)}`
        : "";
    }
  }

  render(force = false) {
    const app = this._app;
    const active = KP.Store ? KP.Store.active() : null;
    const dataReady = !!(KP.Store && KP.Store.hasData());
    const loading = !dataReady && !!(active && active.status === "loading");
    const loadFailed = !dataReady && !!(active && active.status === "error");
    const stateKey = loading ? "loading" : loadFailed ? "error" : dataReady ? "ready" : "empty";
    const groups = KP.Shell.groups();
    if (!loading && app.groupIdx >= groups.length) app.groupIdx = 0;
    const group = KP.Shell.currentGroup();
    if (app.chanIdx >= group.channels.length) app.chanIdx = Math.max(0, group.channels.length - 1);

    if (KP.Epg && group.channels.length) {
      const visible = [];
      const from = Math.max(0, app.chanIdx - 2);
      const to = Math.min(group.channels.length, app.chanIdx + 8);
      for (let index = from; index < to; index += 1) visible.push(group.channels[index]);
      KP.Epg.ensureEpgList(visible);
    }

    this._el("ch-group-name").textContent = dataReady ? group.name : "Channels";
    this._el("ch-clock").textContent = KP.Utils.fmtTime(Date.now());
    const groupKey = `${KP.Store.activeId() || ""}|${stateKey}|${app.groupIdx}|${group.name}|${group.channels.length}|` +
      `${group.channels[0] ? group.channels[0].id : ""}|` +
      `${group.channels.length ? group.channels[group.channels.length - 1].id : ""}`;
    let inner = this._el("channel-list-inner");
    const visibleRows = this._visibleRows();
    const totalRows = group.channels.length;
    /* Middle-pin scroll: the highlight walks the visible rows freely and, once
       it would settle outside the middle slot, the list slides one row per
       key press beneath it until the head or tail stops it. No pads, no
       bands, no catch-up jumps. */
    const fullyVisible = Math.max(2, Math.floor(
      (this._el("channel-list").clientHeight || KP.Utils.designPx(760)) / this._rowPx()
    ));
    const pinSlot = Math.max(1, Math.round((fullyVisible - 1) / 2));
    let winStart = totalRows
      ? Math.max(0, Math.min(app.chanIdx - pinSlot, Math.max(0, totalRows - fullyVisible)))
      : 0;
    const winEnd = Math.min(totalRows, winStart + visibleRows + CHANNEL_OVERSCAN * 2);
    const dataKey = this._programmeKey(group.channels, winStart, winEnd);
    const key = `${groupKey}|${winStart}|${winEnd}|${visibleRows}|${dataKey}`;
    const rebuild = force || !inner || key !== this._win.key;

    if (rebuild) {
      let html = "";
      const rowHeight = this._rowPx();
      if (loading) {
        const skeletonRows = Math.max(3, Math.min(20, visibleRows + 2));
        for (let index = 0; index < skeletonRows; index += 1) {
          html += '<div class="ch-row sk-ch" aria-hidden="true"><div class="ch-num sk"></div>' +
            '<div class="ch-logo sk"></div><div class="ch-main">' +
            '<span class="sk sk-ch-name"></span><span class="sk sk-ch-now"></span></div>' +
            '<div class="ch-time sk sk-ch-time"></div></div>';
        }
      } else {
        if (winStart > 0) html += `<div class="ch-spacer" style="height:${winStart * rowHeight}px"></div>`;
        for (let index = winStart; index < winEnd; index += 1) {
          html += this._rowHtml(group.channels[index], index);
        }
        if (winEnd < totalRows) {
          html += `<div class="ch-spacer" style="height:${(totalRows - winEnd) * rowHeight}px"></div>`;
        }
      }
      if (!html && loadFailed) {
        html = '<div class="ch-row"><div class="ch-name">Playlist unavailable</div></div>';
      }
      this._el("channel-list").innerHTML = `<div id="channel-list-inner">` +
        (html || '<div class="ch-row"><div class="ch-name">No channels</div></div>') + "</div>";
      inner = this._el("channel-list-inner");
      this._focus.key = key;
      this._focus.index = app.chanIdx;
      this._focus.shift = null;
      this._focus.preview = "";
      this._win = { start: winStart, end: winEnd, key, groupKey, visible: visibleRows };
    } else {
      if (this._focus.index !== app.chanIdx) {
        const oldRow = inner.querySelector(`.ch-row[data-ci="${this._focus.index}"]`);
        if (oldRow) oldRow.classList.remove("focused");
        const nextRow = inner.querySelector(`.ch-row[data-ci="${app.chanIdx}"]`);
        if (nextRow) nextRow.classList.add("focused");
        this._focus.index = app.chanIdx;
      }
      const start = Math.max(winStart, app.chanIdx - 4);
      const end = Math.min(winEnd, app.chanIdx + 12);
      for (let index = start; index < end; index += 1) {
        if (!group.channels[index]) continue;
        const row = inner.querySelector(`.ch-row[data-ci="${index}"]`);
        if (row) this._rowText(row, group.channels[index]);
      }
    }

    const focusedRow = inner.querySelector(`.ch-row[data-ci="${app.chanIdx}"]`);
    let shift = 0;
    if (group.channels.length && focusedRow) {
      shift = winStart * this._rowPx();
    }
    if (this._focus.shift !== shift) {
      inner.style.transform = `translateY(${KP.Utils.snapPixels(-shift, inner)}px)`;
      this._focus.shift = shift;
    }
    KP.Shell.refreshScrollFades();

    const channel = group.channels[app.chanIdx];
    const previewKey = loading ? `state|loading|${active ? active.id : ""}`
      : loadFailed ? `state|error|${active ? active.id : ""}`
      : channel ? `${channel.id}|${channel.logo || ""}` : `state|empty|${group.id}`;
    if (this._focus.preview !== previewKey) {
      this._el("pv-logo-slot").innerHTML = channel && !loading && !loadFailed
        ? KP.Logo.inner(channel) : KP.Icons.inner("tv", "ico");
      this._focus.preview = previewKey;
    }
    this._el("view-channels").classList.toggle("preview-empty", !loading && !channel);
    this._el("pv-empty").classList.toggle("hidden", loading || !!channel);
    if (loading) {
      this._el("pv-title").innerHTML = '<span class="sk sk-pv-title"></span>';
      this._el("pv-time").innerHTML = '<span class="sk sk-pv-time"></span>';
      this._el("pv-desc").innerHTML = '<span class="sk sk-pv-line"></span>' +
        '<span class="sk sk-pv-line"></span><span class="sk sk-pv-line"></span>';
    } else if (loadFailed) {
      const title = "Playlist unavailable";
      const description = "Open Playlists to check the source, or press Back to return.";
      this._el("pv-empty-title").textContent = title;
      this._el("pv-empty-desc").textContent = description;
      this._el("pv-title").textContent = title;
      this._el("pv-time").textContent = "";
      this._el("pv-desc").textContent = description;
    } else if (channel) {
      const programme = KP.Utils.nowNext(channel).now;
      const awaitingEpg = !programme && !(channel.programmes && channel.programmes.length) &&
        !!(KP.Epg && KP.Epg.epgLoading());
      this._el("pv-title").textContent = programme ? programme.title : channel.name;
      if (awaitingEpg) {
        this._el("pv-time").innerHTML = '<span class="sk sk-pv-time"></span>';
        this._el("pv-desc").innerHTML = '<span class="sk sk-pv-line"></span>' +
          '<span class="sk sk-pv-line"></span><span class="sk sk-pv-line"></span>';
      } else {
        this._el("pv-time").textContent = programme
          ? `${KP.Utils.fmtTime(programme.start)} - ${KP.Utils.fmtTime(programme.end)}`
          : "";
        this._el("pv-desc").textContent = programme ? (programme.desc || "") : "";
      }
    } else {
      let title = "No channels here";
      let description = "Choose another group or add a playlist to start watching.";
      if (group.id === "fav") {
        title = "No favourites yet";
        description = "Mark channels as favourites and they will appear here.";
      } else if (group.id === "recent") {
        title = "Nothing watched yet";
        description = "Channels you watch will appear here.";
      }
      this._el("pv-empty-title").textContent = title;
      this._el("pv-empty-desc").textContent = description;
      this._el("pv-title").textContent = "No channels";
      this._el("pv-time").textContent = "";
      this._el("pv-desc").textContent = description;
    }
  }

  open() {
    const groups = KP.Shell.groups();
    const active = KP.Store ? KP.Store.active() : null;
    const loading = !KP.Store.hasData() && !!(active && active.status === "loading");
    this._app.groupIdx = groups.length > 2 || loading ? 2 : 0;
    this._app.chanIdx = 0;
    this._focus.key = "";
    this._win.key = "";
    KP.Shell.show("channels");
    this.render(true);
  }

  restore() {
    KP.Shell.show("channels");
    this.render(true);
  }

  _changeGroup(next) {
    const active = KP.Store ? KP.Store.active() : null;
    if (!KP.Store.hasData() && active && active.status === "loading") return;
    const groups = KP.Shell.groups();
    if (!groups.length) return;
    next = (next + groups.length) % groups.length;
    const group = groups[next];
    const apply = () => {
      this._app.groupIdx = next;
      this._app.chanIdx = 0;
      this.render();
    };
    if (KP.Store.isGroupLocked(group.name)) KP.Views.pin.guardGroup(group.name, apply);
    else apply();
  }

  handleKey(key) {
    const app = this._app;
    const group = KP.Shell.currentGroup();
    const digit = KP.Utils.digitFromKey(key);
    if (digit >= 0) {
      if (group.channels.length) this._pressDigit(digit);
      return true;
    }
    if (key === 38) app.chanIdx = Math.max(0, app.chanIdx - 1);
    else if (key === 40) app.chanIdx = Math.min(group.channels.length - 1, app.chanIdx + 1);
    else if (key === 37) this._changeGroup(app.groupIdx - 1);
    else if (key === 39) this._changeGroup(app.groupIdx + 1);
    else if (key === 13) {
      const channel = group.channels[app.chanIdx];
      if (channel) KP.Playback.playChannel(channel);
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

  reset() {
    this._app.groupIdx = 2;
    this._app.chanIdx = 0;
    this._focus.key = "";
    this._focus.index = -1;
    this._focus.preview = "";
    this._win.key = "";
    this._win.groupKey = "";
    this._clearDigits();
  }

  _pressDigit(digit) {
    this._digitBuf = (this._digitBuf + digit).substring(0, 4);
    const box = document.getElementById("digit-entry");
    if (box) {
      box.textContent = this._digitBuf;
      box.classList.remove("hidden");
    }
    clearTimeout(this._digitTimer);
    this._digitTimer = setTimeout(() => this._commitDigits(), 2200);
  }

  _clearDigits() {
    clearTimeout(this._digitTimer);
    this._digitTimer = null;
    this._digitBuf = "";
    const box = document.getElementById("digit-entry");
    if (box) {
      box.textContent = "";
      box.classList.add("hidden");
    }
  }

  _commitDigits() {
    const buffer = this._digitBuf;
    this._clearDigits();
    if (!buffer) return;
    const number = parseInt(buffer, 10);
    const app = this._app;
    const channels = KP.Shell.currentGroup().channels || [];
    let index = channels.findIndex((channel) => channel.num === number);
    if (index < 0) {
      const all = KP.Shell.allChannels();
      const channel = all.find((item) => item.num === number);
      if (channel) {
        const groups = KP.Shell.groups();
        for (let g = 0; g < groups.length && index < 0; g += 1) {
          const gi = groups[g].channels.indexOf(channel);
          if (gi >= 0) {
            index = gi;
            if (g !== app.groupIdx && KP.Store.isGroupLocked(groups[g].name)) {
              KP.Views.pin.guardGroup(groups[g].name, () => {
                app.groupIdx = g;
                app.chanIdx = gi;
                this.render();
              });
              return;
            }
            app.groupIdx = g;
          }
        }
      }
    }
    if (index < 0) {
      KP.Shell.toast(`No channel ${number}`, 2200);
      return;
    }
    app.chanIdx = index;
    this.render();
  }

  init() {
    const list = this._el("channel-list");
    if (!list) return;
    list.addEventListener("click", (event) => {
      let target = event.target;
      while (target && target !== list && !(target.classList && target.classList.contains("ch-row"))) {
        target = target.parentNode;
      }
      if (!target || target === list) return;
      const index = parseInt(target.getAttribute("data-ci"), 10);
      if (!(index >= 0)) return;
      this._app.chanIdx = index;
      this.render();
    });
  }
}

KP.Views = KP.Views || {};
KP.Views.channels = new KPlayerChannels();
