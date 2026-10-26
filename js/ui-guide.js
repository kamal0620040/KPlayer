/* KPlayer EPG timeline: group panel, channel rail and programme grid. The row
   DOM is only rebuilt when the group or EPG data changes; moving focus updates
   classes in place so channel logos never reload while zapping the guide. */
"use strict";

const GUIDE_WINDOW_MIN = 150;
const GUIDE_FALLBACK_PX = 5.5;
const GUIDE_ROW_H = 96;
const GUIDE_OVERSCAN = 4;

class KPlayerGuide {
  constructor() {
    this._focus = {
      zone: "grid",
      railIdx: 1,
      rowsScroll: 0,
      builtKey: "",
      px: KP.Utils.designPx(GUIDE_FALLBACK_PX)
    };
    this._rowsWin = { start: 0, end: 0, groupKey: "", visible: 0, key: "" };
  }

  get _app() {
    return KP.Shell.state;
  }

  _el(id) {
    return document.getElementById(id);
  }

  _windowStart() {
    const date = new Date();
    date.setMinutes(date.getMinutes() - 30, 0, 0);
    date.setMinutes(Math.floor(date.getMinutes() / 30) * 30);
    return date.getTime();
  }

  _guideProgrammes(channel) {
    const start = this._windowStart();
    const end = start + GUIDE_WINDOW_MIN * 60e3;
    const out = [];
    ((channel && channel.programmes) || []).forEach((programme) => {
      if (programme.end > start && programme.start < end) out.push(programme);
    });
    out.sort((a, b) => a.start - b.start);
    return out;
  }

  _railElements() {
    return document.querySelectorAll("#view-guide .rail-ico");
  }

  _smartGuideGroup() {
    const app = this._app;
    if (app.gGroupTouched || app.gAutoPicked) return false;
    if (!KP.Store || !KP.Store.hasData()) return false;
    if (KP.Epg.epgLoading() || !KP.Epg.epgAny()) return false;
    const groups = KP.Shell.groups();
    const current = groups[app.gGroupIdx];
    if (!current) return false;
    let withEpg = current.channels.filter((channel) => channel.programmes && channel.programmes.length).length;
    if (withEpg > 0) {
      app.gAutoPicked = true;
      return false;
    }
    for (let index = 2; index < groups.length; index += 1) {
      withEpg = groups[index].channels.filter((channel) => channel.programmes && channel.programmes.length).length;
      if (withEpg >= 3) {
        app.gGroupIdx = index;
        app.gChanIdx = 0;
        app.gCellIdx = 0;
        app.gAutoPicked = true;
        return true;
      }
    }
    app.gAutoPicked = true;
    return false;
  }

  _groupKey(group) {
    const app = this._app;
    const first = group.channels[0] ? group.channels[0].id : "";
    const last = group.channels.length ? group.channels[group.channels.length - 1].id : "";
    return `${KP.Store ? KP.Store.activeId() : ""}|${app.gGroupIdx}|${group.id}|${group.name}|` +
      `${group.channels.length}|${first}|${last}`;
  }

  _rowPx() {
    return KP.Utils && KP.Utils.pixelRow ? KP.Utils.pixelRow(GUIDE_ROW_H) : KP.Utils.designPx(GUIDE_ROW_H);
  }

  _visibleRows() {
    const box = this._el("guide-rows");
    const rowHeight = this._rowPx();
    const height = box ? box.clientHeight : KP.Utils.designPx(620);
    return Math.max(3, Math.ceil((height || KP.Utils.designPx(620)) / rowHeight));
  }
  _programmeKey(channels, start, end, playingId) {
    let key = playingId || "";
    for (let index = start; index < end; index += 1) {
      const list = channels[index].programmes || [];
      const first = list.length ? list[0].start : 0;
      const last = list.length ? list[list.length - 1].end : 0;
      key += `|${list.length}:${first}:${last}`;
    }
    return key;
  }

  _emptyGroupMessage() {
    return KP.Store && KP.Store.playlists.length
      ? "Choose another group or add channels to this one."
      : "Add a playlist from the playlists icon to fill the guide.";
  }

  _renderPreview(channel, loadingChannels, loadFailed, epgLoading) {
    const programme = !loadingChannels && !loadFailed && channel ? KP.Utils.nowNext(channel).now : null;
    const awaitingEpg = !loadingChannels && !loadFailed && !!channel && !programme &&
      !(channel.programmes && channel.programmes.length) && !!epgLoading;
    const meta = document.querySelector(".gp-meta");
    if (meta) meta.classList.toggle("hidden", !loadingChannels && !programme && !awaitingEpg);
    if (loadingChannels) {
      this._el("gp-video-logo").innerHTML = KP.Icons.inner("tv", "ico");
      this._el("gp-title").innerHTML = '<span class="sk sk-gp-title"></span>';
      this._el("gp-range").textContent = "";
      this._el("gp-remain").textContent = "";
      this._el("gp-prog").style.width = "0%";
      this._el("gp-desc").innerHTML = '<span class="sk sk-gp-line"></span>' +
        '<span class="sk sk-gp-line"></span><span class="sk sk-gp-line"></span>';
    } else if (loadFailed) {
      this._el("gp-video-logo").innerHTML = KP.Icons.inner("tv", "ico");
      this._el("gp-title").textContent = "Playlist not loaded";
      this._el("gp-range").textContent = "";
      this._el("gp-remain").textContent = "";
      this._el("gp-prog").style.width = "0%";
      this._el("gp-desc").textContent = "Open Playlists from the left rail to check the source.";
    } else if (channel) {
      this._el("gp-video-logo").innerHTML = KP.Logo.inner(channel);
      this._el("gp-title").textContent = programme ? programme.title : channel.name;
      if (awaitingEpg) {
        this._el("gp-range").innerHTML = '<span class="sk sk-gp-range"></span>';
        this._el("gp-remain").innerHTML = '<span class="sk sk-gp-remain"></span>';
        this._el("gp-prog").style.width = "0%";
        this._el("gp-desc").innerHTML = '<span class="sk sk-gp-line"></span>' +
          '<span class="sk sk-gp-line"></span><span class="sk sk-gp-line"></span>';
        return;
      }
      this._el("gp-range").textContent = programme
        ? `${KP.Utils.fmtTime(programme.start)} - ${KP.Utils.fmtTime(programme.end)}`
        : "";
      this._el("gp-remain").textContent = programme
        ? `${Math.max(0, Math.round((programme.end - Date.now()) / 60000))} min`
        : "";
      this._el("gp-prog").style.width = `${KP.Utils.progress(programme)}%`;
      this._el("gp-desc").textContent = programme ? (programme.desc || "") : "";
    } else {
      this._el("gp-video-logo").innerHTML = KP.Icons.inner("tv", "ico");
      this._el("gp-title").textContent = "No channels";
      this._el("gp-range").textContent = "";
      this._el("gp-remain").textContent = "";
      this._el("gp-prog").style.width = "0%";
      this._el("gp-desc").textContent = "";
    }
  }

  _renderGroups(groups, selected, loading) {
    let html = "";
    if (loading) {
      const rowHeight = KP.Utils.designPx(62);
      const count = Math.max(7, Math.ceil((this._el("guide-groups").clientHeight || KP.Utils.designPx(620)) / rowHeight));
      for (let index = 0; index < count; index += 1) {
        html += '<div class="g-sk-row"><span class="g-sk-name sk"></span><span class="g-sk-count sk"></span></div>';
      }
    } else {
      groups.forEach((group, index) => {
        html += `<div class="g-item${index === selected ? (this._focus.zone === "panel" ? " focused" : " sel") : ""}" ` +
          `title="${KP.Utils.esc(group.name)}"><span class="g-item-name">${KP.Utils.esc(group.name)}</span>` +
          `<span class="g-count">${group.channels.length}</span></div>`;
      });
    }
    const box = this._el("guide-groups");
    box.innerHTML = html;
    const elements = box.children;
    if (!loading && elements[selected]) {
      const want = elements[selected].offsetTop - (box.clientHeight - elements[selected].offsetHeight) / 2;
      box.scrollTop = KP.Utils.snapPixels(Math.max(0, Math.min(want, box.scrollHeight - box.clientHeight)), box);
    }
  }

  _rowHtml(channel, channelIndex, app, start, windowEnd, epgLoading) {
    let cells = "";
    const programmes = this._guideProgrammes(channel);
    programmes.forEach((programme, programmeIndex) => {
      const sliceStart = Math.max(programme.start, start);
      const sliceEnd = Math.min(programme.end, windowEnd);
      const left = (sliceStart - start) / 60e3 * this._focus.px;
      const width = Math.max(KP.Utils.designPx(6), (sliceEnd - sliceStart) / 60e3 * this._focus.px - KP.Utils.designPx(5));
      const classes = `gcell${programme.end <= Date.now() ? " past" : ""}` +
        `${this._focus.zone === "grid" && channelIndex === app.gChanIdx && programmeIndex === app.gCellIdx ? " focused" : ""}`;
      cells += `<div class="${classes}" data-ci="${channelIndex}" data-pi="${programmeIndex}" ` +
        `style="left:${Math.max(0, left)}px;width:${width}px">` +
        `<div class="gcell-title">${KP.Utils.esc(programme.title)}</div>` +
        `<div class="gcell-time">${KP.Utils.fmtTime(programme.start)} - ${KP.Utils.fmtTime(programme.end)}</div></div>`;
    });
    if (!programmes.length && epgLoading) {
      cells = `<span class="sk-gcell sk" style="left:0;width:${KP.Utils.designPx(300)}px"></span>` +
        `<span class="sk-gcell sk" style="left:${KP.Utils.designPx(305)}px;width:${KP.Utils.designPx(250)}px"></span>` +
        `<span class="sk-gcell sk" style="left:${KP.Utils.designPx(560)}px;width:${KP.Utils.designPx(300)}px"></span>`;
    }
    const playing = app.playing && app.playing.id === channel.id;
    const focused = this._focus.zone === "grid" && channelIndex === app.gChanIdx;
    return `<div class="grow${focused ? " focused-row" : ""}" data-ci="${channelIndex}">` +
      `<div class="gnum${playing ? " playing" : ""}">${channel.num}</div>` +
      KP.Logo.box(channel, "glogo") +
      `<div class="gname${playing ? " playing" : ""}">${KP.Utils.esc(channel.name)}</div>` +
      `<div class="gcells">${playing ? `<span class="gplaymark">${KP.Icons.inner("play", "play-ico")}</span>` : ""}` +
      `${cells}</div></div>`;
  }

  _updateFocus(group) {
    const app = this._app;
    const rows = this._el("guide-rows").querySelectorAll(".grow[data-ci]");
    rows.forEach((row) => {
      const index = parseInt(row.getAttribute("data-ci"), 10);
      row.classList.toggle("focused-row", this._focus.zone === "grid" && index === app.gChanIdx);
    });
    const cells = document.querySelectorAll("#guide-rows .gcell");
    cells.forEach((cell) => {
      const on = this._focus.zone === "grid" &&
        parseInt(cell.getAttribute("data-ci"), 10) === app.gChanIdx &&
        parseInt(cell.getAttribute("data-pi"), 10) === app.gCellIdx;
      cell.classList.toggle("focused", on);
    });
    this._railElements().forEach((element, index) => {
      element.classList.toggle("focused", this._focus.zone === "rail" && index === this._focus.railIdx);
    });
    const groups = this._el("guide-groups").children;
    for (let index = 0; index < groups.length; index += 1) {
      groups[index].classList.toggle("focused", this._focus.zone === "panel" && index === app.gGroupIdx);
      groups[index].classList.toggle("sel", index === app.gGroupIdx && this._focus.zone !== "panel");
    }
    this._scrollRows(group);
  }

  _updateNowLine() {
    const start = this._windowStart();
    this._el("guide-nowline").style.transform =
      `translateX(${KP.Utils.designPx(478) + (Date.now() - start) / 60e3 * this._focus.px}px)`;
  }

  _renderMove(group, channelChanged) {
    this._updateFocus(group);
    const channel = group.channels[this._app.gChanIdx];
    if (channelChanged) {
      if (KP.Epg && channel) KP.Epg.ensureEpgList([channel], this._groupKey(group));
      this._renderPreview(channel, false, false, !!(KP.Epg && KP.Epg.epgLoading()));
    }
    this._updateNowLine();
    KP.Shell.refreshScrollFades();
  }

  _scrollRows(group) {
    const app = this._app;
    const box = this._el("guide-rows");
    const inner = this._el("guide-rows-inner");
    const row = inner.querySelector(`.grow[data-ci="${app.gChanIdx}"]`);
    if (!row || !group.channels.length) return;
    const visible = box.clientHeight;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    const max = Math.max(0, inner.offsetHeight - visible);
    if (top < this._focus.rowsScroll) this._focus.rowsScroll = top;
    else if (bottom > this._focus.rowsScroll + visible) this._focus.rowsScroll = bottom - visible;
    this._focus.rowsScroll = Math.max(0, Math.min(this._focus.rowsScroll, max));
    /* the guide cannot rely on scrollTop: the simulator hosts the app inside a
       scaled frame where Blink snaps scroll offsets back to integer CSS pixels
       and rows shimmer on fractional device pixels. A snapped transform keeps
       every shift on a whole device pixel instead. */
    inner.style.transform = `translateY(${KP.Utils.snapPixels(-this._focus.rowsScroll, inner)}px)`;
  }

  render(force = false) {
    const app = this._app;
    let groups = KP.Shell.groups();
    const active = KP.Store ? KP.Store.active() : null;
    const loading = !!(active && active.status === "loading");
    const dataReady = !!(KP.Store && KP.Store.hasData());
    const hasPlaylists = !!(KP.Store && KP.Store.playlists.length);
    const loadingChannels = hasPlaylists && !dataReady && loading;
    const loadFailed = hasPlaylists && !dataReady && !loading;

    this._smartGuideGroup();
    if (app.gGroupIdx >= groups.length) app.gGroupIdx = 0;
    let group = groups[app.gGroupIdx];
    if (!group) {
      group = { id: "", name: "Channels", channels: [] };
      if (!groups.length) groups = [group];
    }

    this._el("guide-date").textContent = `${new Date().toLocaleDateString(undefined, {
      weekday: "short", day: "numeric", month: "short"
    })}, ${KP.Utils.fmtTime(Date.now())}`;
    this._el("guide-pl-name").textContent = active
      ? active.name
      : (KP.Store && KP.Store.playlists.length ? "Choose playlist" : "No playlist");
    this._el("guide-pl-name").title = active ? active.name : "";
    this._el("guide-pl-chev").innerHTML = KP.Icons.inner("chevDown", "key-ico");

    this._renderGroups(groups, app.gGroupIdx, loadingChannels);

    if (app.gChanIdx >= group.channels.length) app.gChanIdx = Math.max(0, group.channels.length - 1);
    if (group.channels.length && KP.Epg) {
      const currentKey = this._groupKey(group);
      if (KP.Epg.dropExternalGroup) KP.Epg.dropExternalGroup(currentKey);
      const visible = [];
      const from = Math.max(0, app.gChanIdx - 2);
      const to = Math.min(group.channels.length, app.gChanIdx + 8);
      for (let index = from; index < to; index += 1) visible.push(group.channels[index]);
      if (app.playing) visible.push(app.playing);
      KP.Epg.ensureEpgList(visible, currentKey);
    }

    const epgBusy = !!(KP.Epg && KP.Epg.epgLoading());
    const groupAny = group.channels.some((channel) => channel.programmes && channel.programmes.length);
    const noEpg = !loadingChannels && !loadFailed && dataReady &&
      group.channels.length > 0 && !epgBusy && !groupAny;
    this._el("guide-times").classList.toggle("noepg", noEpg);

    const rowsBox = this._el("guide-rows");
    const rowsInner = this._el("guide-rows-inner");
    const timelineWidth = (rowsBox ? rowsBox.clientWidth : this._el("guide-times").clientWidth) - KP.Utils.designPx(478);
    this._focus.px = timelineWidth > 60 ? timelineWidth / GUIDE_WINDOW_MIN : GUIDE_FALLBACK_PX;
    const start = this._windowStart();
    let times = "";
    for (let minute = 0; minute < GUIDE_WINDOW_MIN; minute += 30) {
      const align = minute ? "translateX(-50%)" : "none";
      times += `<div class="g-time" style="left:${minute * this._focus.px}px;transform:${align}">${KP.Utils.fmtTime(start + minute * 60e3)}</div>`;
    }
    if (noEpg) {
      times += '<div class="gnoepg-note" title="Add an EPG URL in Playlists or switch groups">' +
        '<span class="gnoepg-strong">No guide data for this group</span>' +
        '<span class="gnoepg-sub">Add an EPG URL in Playlists</span></div>';
    }
    this._el("guide-times").innerHTML = times;

    const programmes = this._guideProgrammes(group.channels[app.gChanIdx]);
    if (app.gCellIdx >= programmes.length) app.gCellIdx = Math.max(0, programmes.length - 1);
    const visibleRows = this._visibleRows();
    const totalRows = group.channels.length;
    const groupKey = this._groupKey(group);
    const previous = this._rowsWin;
    let winStart = 0;
    if (previous.groupKey === groupKey && previous.visible === visibleRows) {
      winStart = previous.start;
    }
    if (totalRows) {
      if (app.gChanIdx < winStart) {
        winStart = Math.max(0, app.gChanIdx - GUIDE_OVERSCAN);
      } else if (app.gChanIdx >= winStart + visibleRows + GUIDE_OVERSCAN * 2 ||
                 (previous.groupKey !== groupKey && app.gChanIdx >= visibleRows)) {
        winStart = Math.max(0, app.gChanIdx - visibleRows + 1);
      }
      winStart = Math.max(0, Math.min(winStart, Math.max(0, totalRows - visibleRows)));
    }
    const winEnd = Math.min(totalRows, winStart + visibleRows + GUIDE_OVERSCAN * 2);
    const dataKey = this._programmeKey(group.channels, winStart, winEnd, app.playing ? app.playing.id : "");
    const key = `${groupKey}|${loadingChannels}|${loadFailed}|${epgBusy}|${winStart}|${winEnd}|${visibleRows}|${dataKey}`;
    if (force || key !== this._rowsWin.key) {
      let rows = "";
      const windowEnd = start + GUIDE_WINDOW_MIN * 60e3;
      if (loadingChannels) {
        const skeletonRows = Math.max(4, Math.min(20, visibleRows || 6));
        for (let skeleton = 0; skeleton < skeletonRows; skeleton += 1) {
          rows += '<div class="grow sk-grow"><span class="sk-num sk"></span><span class="sk-glogo sk"></span>' +
            '<span class="sk-gname sk"></span><span class="sk-gcells">' +
            `<span class="sk-gcell sk" style="left:0;width:${KP.Utils.designPx(300)}px"></span>` +
            `<span class="sk-gcell sk" style="left:${KP.Utils.designPx(305)}px;width:${KP.Utils.designPx(250)}px"></span>` +
            `<span class="sk-gcell sk" style="left:${KP.Utils.designPx(560)}px;width:${KP.Utils.designPx(300)}px"></span></span></div>`;
        }
      } else {
        const rowHeight = this._rowPx();
        if (winStart > 0) rows += `<div class="gspacer" style="height:${winStart * rowHeight}px"></div>`;
        for (let index = winStart; index < winEnd; index += 1) {
          rows += this._rowHtml(group.channels[index], index, app, start, windowEnd, epgBusy);
        }
        if (winEnd < totalRows) {
          rows += `<div class="gspacer" style="height:${(totalRows - winEnd) * rowHeight}px"></div>`;
        }
      }
      let empty;
      if (loadFailed) {
        empty = '<div class="gempty"><div class="gempty-title">Playlist not loaded</div><div class="gempty-text">' +
          "Open Playlists from the left rail to check the source, or add another playlist." +
          "</div></div>";
      } else {
        empty = '<div class="gempty"><div class="gempty-title">No channels here</div><div class="gempty-text">' +
          `${this._emptyGroupMessage()}</div></div>`;
      }
      rowsInner.innerHTML = loadingChannels ? rows : (rows || empty);
      this._rowsWin = {
        start: winStart,
        end: winEnd,
        groupKey,
        visible: visibleRows,
        key
      };
    }
    this._updateFocus(group);
    this._updateNowLine();

    this._renderPreview(group.channels[app.gChanIdx], loadingChannels, loadFailed, epgBusy);
    KP.Shell.refreshScrollFades();
  }

  open() {
    if (!KP.Store || !KP.Store.hasData()) {
      if (KP.Store && KP.Store.playlists.length) {
        this.render();
        KP.Shell.show("guide");
      } else {
        KP.Views.playlists.open();
      }
      return;
    }
    KP.Shell.show("guide");
    const group = KP.Shell.groups()[this._app.gGroupIdx];
    if (this._focus.zone === "grid" && (!group || !group.channels.length)) this._focus.zone = "panel";
    this.render(true);
  }

  _changeGroup(next) {
    const app = this._app;
    const groups = KP.Shell.groups();
    if (!groups.length) return;
    next = (next + groups.length) % groups.length;
    const group = groups[next];
    const apply = () => {
      app.gGroupIdx = next;
      app.gChanIdx = 0;
      app.gCellIdx = 0;
      app.gGroupTouched = true;
      app.gAutoPicked = true;
      this.render(true);
    };
    if (KP.Store.isGroupLocked(group.name)) KP.Views.pin.guardGroup(group.name, apply);
    else apply();
  }

  _railAction(action) {
    if (action === "search") KP.Views.search.open();
    else if (action === "playlists") KP.Views.playlists.open();
    else if (action === "tv") KP.Views.channels.open();
    else if (action === "movies") KP.Views.vod.open("movies");
    else if (action === "shows") KP.Views.vod.open("shows");
    else if (action === "mylist") KP.Views.vod.open("mylist");
    else if (action === "settings") KP.Views.settings.open();
  }

  _activateCell() {
    const app = this._app;
    const group = KP.Shell.groups()[app.gGroupIdx] || { channels: [] };
    const channel = group.channels[app.gChanIdx];
    if (!channel) return;
    const list = this._guideProgrammes(channel);
    if (app.gCellIdx >= list.length) app.gCellIdx = Math.max(0, list.length - 1);
    const programme = list[app.gCellIdx];
    if (!programme) {
      KP.Playback.playChannel(channel);
      return;
    }
    const now = Date.now();
    if (programme.start <= now && programme.end > now) KP.Playback.playChannel(channel);
    else KP.Views.schedule.open(channel, programme.start);
  }

  handleKey(key) {
    const app = this._app;
    const groups = KP.Shell.groups();
    const group = groups[app.gGroupIdx] || groups[0] || { name: "", channels: [] };
    const rails = this._railElements();

    if (this._focus.zone === "rail") {
      if (key === 38 && rails.length) this._focus.railIdx = (this._focus.railIdx - 1 + rails.length) % rails.length;
      else if (key === 40 && rails.length) this._focus.railIdx = (this._focus.railIdx + 1) % rails.length;
      else if (key === 39) this._focus.zone = "panel";
      else if (key === 13) {
        const rail = rails[this._focus.railIdx];
        if (rail) {
          this._railAction(rail.getAttribute("data-r"));
          return true;
        }
      } else if (key === 10009 || key === 461) {
        KP.Shell.back();
        return true;
      } else {
        this.render();
        return true;
      }
      this.render();
      return true;
    }

    if (this._focus.zone === "panel") {
      if (key === 38 || key === 40) {
        this._changeGroup(app.gGroupIdx + (key === 40 ? 1 : -1));
        return true;
      }
      if (key === 37) {
        this._focus.zone = "rail";
        this.render();
        return true;
      }
      if (key === 39 || key === 13) {
        const enterGrid = () => {
          this._focus.zone = "grid";
          app.gChanIdx = 0;
          app.gCellIdx = 0;
          app.gGroupTouched = true;
          this.render();
        };
        if (KP.Store.isGroupLocked(group.name)) KP.Views.pin.guardGroup(group.name, enterGrid);
        else enterGrid();
        return true;
      }
      if (key === 10009 || key === 461) {
        KP.Shell.back();
        return true;
      }
      this.render();
      return true;
    }

    if (key === 38 || key === 40) {
      if (key === 38) app.gChanIdx = Math.max(0, app.gChanIdx - 1);
      else app.gChanIdx = Math.min(group.channels.length - 1, app.gChanIdx + 1);
      const length = group.channels[app.gChanIdx] ? this._guideProgrammes(group.channels[app.gChanIdx]).length : 0;
      if (app.gCellIdx >= length) app.gCellIdx = Math.max(0, length - 1);
    } else if (key === 37) {
      if (app.gCellIdx > 0) app.gCellIdx -= 1;
      else this._focus.zone = "panel";
    } else if (key === 39) {
      const channel = group.channels[app.gChanIdx];
      if (channel) app.gCellIdx = Math.max(0, Math.min(this._guideProgrammes(channel).length - 1, app.gCellIdx + 1));
    } else if (key === 13) {
      this._activateCell();
      return true;
    } else if (key === 10009 || key === 461) {
      KP.Shell.back();
      return true;
    } else {
      return false;
    }
    if (app.gChanIdx >= this._rowsWin.start && app.gChanIdx < this._rowsWin.end) {
      this._renderMove(group, key === 38 || key === 40);
    } else {
      this.render();
    }
    return true;
  }

  init() {
    this._railElements().forEach((element, index) => {
      element.addEventListener("click", () => {
        this._focus.railIdx = index;
        this._focus.zone = "rail";
        this.render();
        this._railAction(element.getAttribute("data-r"));
      });
    });
    const switchButton = document.querySelector("#view-guide .gpanel-playlist");
    if (switchButton) switchButton.addEventListener("click", () => KP.Views.playlists.open());
    this._el("guide-groups").addEventListener("click", (event) => {
      let target = event.target;
      while (target && target !== this._el("guide-groups") && !(target.classList && target.classList.contains("g-item"))) {
        target = target.parentNode;
      }
      if (!target || target === this._el("guide-groups")) return;
      const children = Array.from(this._el("guide-groups").children);
      const index = children.indexOf(target);
      if (index < 0) return;
      const group = KP.Shell.groups()[index];
      const apply = () => {
        this._focus.zone = "panel";
        this._app.gGroupIdx = index;
        this._app.gChanIdx = 0;
        this._app.gCellIdx = 0;
        this._app.gGroupTouched = true;
        this.render(true);
      };
      if (group && KP.Store.isGroupLocked(group.name)) KP.Views.pin.guardGroup(group.name, apply);
      else apply();
    });
    const rows = this._el("guide-rows");
    rows.addEventListener("click", (event) => {
      let target = event.target;
      while (target && target !== rows && !(target.hasAttribute && target.hasAttribute("data-ci"))) {
        target = target.parentNode;
      }
      if (!target || target === rows) return;
      const channelIndex = parseInt(target.getAttribute("data-ci"), 10);
      const programmeIndex = parseInt(target.getAttribute("data-pi"), 10);
      if (!(channelIndex >= 0) || !(programmeIndex >= 0)) return;
      this._app.gChanIdx = channelIndex;
      this._app.gCellIdx = programmeIndex;
      this._focus.zone = "grid";
      this._activateCell();
    });
  }
}

KP.Views = KP.Views || {};
KP.Views.guide = new KPlayerGuide();
