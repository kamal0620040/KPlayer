/* KPlayer schedule / catch-up view for a single channel. Only real EPG
   programmes are listed; past programmes use the provider's archive when it
   supports Xtream catch-up. */
"use strict";

class KPlayerSchedule {
  constructor() {
    this._channel = null;
    this._rows = [];
    this._idx = 0;
    this._zone = "list";
    this._day = 0;
  }

  _el(id) {
    return document.getElementById(id);
  }

  _dayStart(offset) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date.getTime() + offset * 86400e3;
  }

  _dayLabel(offset) {
    if (offset === -1) return "Yesterday";
    if (offset === 0) return "Today";
    if (offset === 1) return "Tomorrow";
    return new Date(this._dayStart(offset)).toLocaleDateString(undefined, {
      weekday: "long", day: "numeric", month: "long"
    });
  }

  _dayProgrammes(channel, start) {
    const out = [];
    const end = start + 86400e3;
    ((channel && channel.programmes) || []).forEach((programme) => {
      if (programme.start < end && programme.end > start) out.push(programme);
    });
    out.sort((a, b) => a.start - b.start);
    return out;
  }

  _build(channel, focusStart) {
    this._channel = channel;
    this._rows = [];
    this._idx = 0;
    [-1, 0, 1].forEach((offset) => {
      this._dayProgrammes(channel, this._dayStart(offset)).forEach((programme) => {
        this._rows.push({ off: offset, p: programme });
      });
    });
    const now = Date.now();
    this._rows.forEach((row, index) => {
      if (focusStart && row.p.start === focusStart) this._idx = index;
      else if (!focusStart && row.p.start <= now && row.p.end > now) this._idx = index;
    });
  }

  render() {
    const channel = this._channel;
    if (!channel) return;
    const rowPx = KP.Utils && KP.Utils.pixelRow ? KP.Utils.pixelRow(74) : KP.Utils.designPx(74);
    const headPx = KP.Utils && KP.Utils.pixelRow ? KP.Utils.pixelRow(58) : KP.Utils.designPx(58);
    const status = KP.Epg && !channel.isVod
      ? KP.Epg.statusForChannel(channel)
      : { loading: false, error: false };
    const loading = !this._rows.length && status.loading;
    const failed = !this._rows.length && !loading && status.error;
    this._el("sched-logo").innerHTML = KP.Logo.inner(channel);
    this._el("sched-name").textContent = channel.name;
    let html = "";
    let lastOffset = null;
    const offsets = [];
    let y = 0;
    this._rows.forEach((row, index) => {
      if (row.off !== lastOffset) {
        html += `<div class="sched-day-head">${this._dayLabel(row.off)}</div>`;
        y += headPx;
        lastOffset = row.off;
      }
      offsets[index] = y;
      y += rowPx;
      html += `<div class="sched-row${index === this._idx ? " focused" : ""}" data-i="${index}">` +
        `<span class="sched-time">${KP.Utils.fmtTime(row.p.start)}</span>` +
        `<span class="sched-title">${KP.Utils.esc(row.p.title)}</span>` +
        `<span class="sched-play">${KP.Icons.inner("play", "play-ico")}</span></div>`;
    });
    if (!html && loading) {
      html = '<div class="sk sk-sched-head"></div>';
      for (let index = 0; index < 7; index += 1) {
        html += '<div class="sched-row sk-sched" aria-hidden="true"><span class="sched-time sk"></span>' +
          '<span class="sched-title sk"></span><span class="sched-play"></span></div>';
      }
    } else if (!html) {
      const title = failed ? "Guide unavailable" : "No programme data";
      const text = failed
        ? "No guide data could be loaded for this channel. You can still watch it live."
        : "No guide data is available for this channel. You can still watch it live.";
      html = `<div class="sched-empty${failed ? " error" : ""}"><div class="sched-empty-title">${title}</div>` +
        `<div class="sched-empty-text">${text}</div></div>`;
    }
    this._el("sched-list").innerHTML = '<div id="sched-list-inner">' + html + "</div>";
    const inner = this._el("sched-list-inner");
    const shiftSource = KP.Utils && KP.Utils.pixelRow ? KP.Utils.pixelRow(300) : KP.Utils.designPx(300);
    const shift = Math.max(0, (offsets[this._idx] || 0) - shiftSource);
    inner.style.transform = `translateY(${KP.Utils.snapPixels(-shift, inner)}px)`;
    const currentOffset = this._rows[this._idx] ? this._rows[this._idx].off : 0;
    let days = "";
    [-1, 0, 1].forEach((offset) => {
      const date = new Date(this._dayStart(offset));
      const focused = this._zone === "days" ? this._day === offset : currentOffset === offset;
      days += `<div class="sched-day${focused ? " focused" : ""}">` +
        `<span class="sched-day-name">${date.toLocaleDateString(undefined, { weekday: "short" })}</span>` +
        `${date.getDate()} ${date.toLocaleDateString(undefined, { month: "short" })}</div>`;
    });
    this._el("sched-days").innerHTML = days;
    const row = this._rows[this._idx];
    this._el("sched-preview-logo").innerHTML = KP.Logo.inner(channel);
    if (loading) {
      this._el("sched-info-title").innerHTML = '<span class="sk sk-sched-info-title"></span>';
      this._el("sched-info-time").innerHTML = '<span class="sk sk-sched-info-time"></span>';
      this._el("sched-info-desc").innerHTML = '<span class="sk sk-sched-info-line"></span>' +
        '<span class="sk sk-sched-info-line"></span><span class="sk sk-sched-info-line"></span>';
    } else if (failed) {
      this._el("sched-info-title").textContent = "Guide unavailable";
      this._el("sched-info-time").textContent = "";
      this._el("sched-info-desc").textContent = "No guide data could be loaded for this channel. You can still watch it live.";
    } else if (row) {
      this._el("sched-info-title").textContent = row.p.title;
      this._el("sched-info-time").textContent = `${KP.Utils.fmtTime(row.p.start)} - ${KP.Utils.fmtTime(row.p.end)}`;
      this._el("sched-info-desc").textContent = row.p.desc || "";
    } else {
      this._el("sched-info-title").textContent = "No programme information";
      this._el("sched-info-time").textContent = "";
      this._el("sched-info-desc").textContent = "";
    }
    KP.Shell.refreshScrollFades();
  }

  open(channel, focusStart) {
    if (!channel) return;
    if (KP.Epg && !channel.isVod) KP.Epg.ensureEpg(channel);
    this._zone = "list";
    this._build(channel, focusStart);
    KP.Shell.show("schedule");
    this.render();
  }

  resume() {
    if (!this._channel) {
      KP.Views.guide.open();
      return;
    }
    KP.Shell.show("schedule");
    this.render();
  }

  _selectDay(offset) {
    this._day = offset;
    const index = this._rows.findIndex((row) => row.off === offset);
    if (index >= 0) this._idx = index;
    this.render();
  }

  handleKey(key) {
    if (!this._channel) {
      KP.Views.guide.open();
      return true;
    }
    if (this._zone === "days") {
      if (key === 38 || key === 40) {
        const days = [-1, 0, 1];
        let index = days.indexOf(this._day);
        index = key === 38 ? Math.max(0, index - 1) : Math.min(2, index + 1);
        this._selectDay(days[index]);
        return true;
      }
      if (key === 39 || key === 13) {
        this._zone = "list";
        this.render();
        return true;
      }
      if (key === 10009 || key === 461) {
        this._zone = "list";
        this.render();
        return true;
      }
      return false;
    }
    if (key === 38 || key === 40) {
      if (!this._rows.length) return true;
      this._idx = key === 38 ? Math.max(0, this._idx - 1) : Math.min(this._rows.length - 1, this._idx + 1);
      this.render();
      return true;
    }
    if (key === 37) {
      this._zone = "days";
      this._day = this._rows[this._idx] ? this._rows[this._idx].off : 0;
      this.render();
      return true;
    }
    if (key === 13) {
      const row = this._rows[this._idx];
      if (row && this._channel) {
        if (row.p.end <= Date.now()) KP.Playback.playProgramme(this._channel, row.p);
        else KP.Playback.playChannel(this._channel);
      }
      return true;
    }
    if (key === 10009 || key === 461) {
      KP.Shell.back();
      return true;
    }
    return false;
  }

  refresh() {
    if (!this._channel || !KP.Shell.state || KP.Shell.state.view !== "schedule") return;
    const row = this._rows[this._idx];
    const focusStart = row ? row.p.start : 0;
    const zone = this._zone;
    this._build(this._channel, focusStart);
    this._zone = zone;
    this.render();
  }

  init() {
    this._el("sched-days").addEventListener("click", (event) => {
      let target = event.target;
      while (target && target !== this._el("sched-days") && !(target.classList && target.classList.contains("sched-day"))) {
        target = target.parentNode;
      }
      if (!target || target === this._el("sched-days")) return;
      const index = Array.from(this._el("sched-days").children).indexOf(target);
      if (index < 0) return;
      this._zone = "days";
      this._selectDay(index - 1);
    });
    this._el("sched-list").addEventListener("click", (event) => {
      let target = event.target;
      while (target && target !== this._el("sched-list") && !(target.classList && target.classList.contains("sched-row"))) {
        target = target.parentNode;
      }
      if (!target || target === this._el("sched-list")) return;
      const programmeIndex = parseInt(target.getAttribute("data-i"), 10);
      if (!(programmeIndex >= 0)) return;
      this._idx = programmeIndex;
      this._zone = "list";
      const row = this._rows[this._idx];
      if (!row) return;
      if (row.p.end <= Date.now()) KP.Playback.playProgramme(this._channel, row.p);
      else KP.Playback.playChannel(this._channel);
    });
  }
}

KP.Views = KP.Views || {};
KP.Views.schedule = new KPlayerSchedule();
