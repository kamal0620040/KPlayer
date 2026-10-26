/* KPlayer playback UI: channel switching, VOD progress, info panel, retry
   status and the remote-control behaviour while video is in the foreground. */
"use strict";

class KPlayerPlayback {
  constructor() {
    this._panelTimer = null;
    this._seekToastTimer = null;
    this._pbFocus = -1;
    this._vodCtx = null;
    this._pendingSeek = 0;
    this._seekTimer = null;
    this._seekActive = false;
    this._seekTarget = 0;
    this._seekOrigin = 0;
    this._statusShownAt = 0;
    this._statusHideTimer = null;
    this._statusTickTimer = null;
    this._statusMode = "live";
    this._statusBuffering = false;
    this._digitBuf = "";
    this._digitTimer = null;
    this._avOpen = false;
    this._avIdx = 0;
    this._avRows = [];
    this._avSel = { audio: -1, text: -1 };
    this._avDisplay = 0;
    this._holdKey = 0;
    this._holdLastDown = 0;
    this._holdArmTimer = null;
    this._holdInterval = null;
    if (typeof document !== "undefined") {
      document.addEventListener("keyup", (event) => {
        const code = event.keyCode || 0;
        if ((code === 37 || code === 39) && this._holdKey === code) this._endHold();
      }, false);
    }
  }

  get _app() {
    return KP.Shell.state;
  }

  _el(id) {
    return document.getElementById(id);
  }

  _desktop() {
    return !KP.Utils.isTizen();
  }

  _log(context, error) {
    KP.Utils.logWarn(`playback/${context}`, error);
  }

  _liveNow(channel) {
    return KP.Utils.nowNext(channel);
  }

  playChannel(channel, keepPanel = false, urlOverride = "") {
    if (!channel) return;
    this._resetSeek();
    this._resetStatus();
    this._clearDigits();
    this._resetAv();
    const app = this._app;
    const url = urlOverride || channel.url || "";
    app.playing = channel;
    if (!channel.isVod && this._vodCtx) {
      this._saveProgress();
      this._vodCtx = null;
      this._pendingSeek = 0;
    }
    if (KP.Store && !channel.isVod) {
      KP.Epg.ensureEpg(channel);
      if (url) KP.Store.pushRecent(channel.id);
    }
    this._el("player-placeholder").classList.add("hidden");
    const pausedBadge = this._el("ib-paused");
    if (pausedBadge) pausedBadge.classList.add("hidden");
    const programme = this._liveNow(channel).now;
    this._el("ib-logo").innerHTML = KP.Logo.inner(channel);
    if (channel.isVod) {
      this._el("ib-now").textContent = channel.name;
      this._el("ib-range").textContent = "0:00";
      this._el("ib-remain").textContent = "";
      this._el("ib-progress-fill").style.width = "0%";
    } else {
      this._el("ib-now").textContent = programme ? programme.title : channel.name;
      this._el("ib-range").textContent = programme
        ? `${KP.Utils.fmtTime(programme.start)} - ${KP.Utils.fmtTime(programme.end)}`
        : "";
      this._el("ib-remain").textContent = programme
        ? `${Math.max(0, Math.round((programme.end - Date.now()) / 60000))} min`
        : "";
      this._el("ib-progress-fill").style.width = `${KP.Utils.progress(programme)}%`;
    }
    const progressBox = document.querySelector("#info-bar .pb-progress");
    if (progressBox) progressBox.classList.toggle("vod", !!channel.isVod);
    if (channel.isVod) this._updateVodBar();
    this._el("ib-clock").textContent = KP.Utils.fmtTime(Date.now());
    this._renderCards();
    this._pbFocus = -1;
    this._renderPbFocus();
    this._el("info-bar").classList.remove("hidden");
    clearTimeout(this._panelTimer);
    if (!keepPanel || channel.isVod) {
      this._panelTimer = setTimeout(() => this.hideInfoBar(), channel.isVod ? 6000 : 4500);
    }
    KP.Shell.show("player");
    if (url && KP.Player) KP.Player.play(url, {
      isVod: !!channel.isVod,
      isLive: !channel.isVod && !urlOverride
    });
    if (!url) {
      this._setStatus("Channel unavailable", "This channel has no stream URL. Choose another channel.", true, false);
    }
    if (this._desktop()) {
      this._el("ph-title").textContent = `Playing ${channel.name}`;
      this._el("ph-sub").textContent = "Video plays on your TV";
      this._el("player-placeholder").classList.remove("hidden");
    }
  }

  _renderCards() {
    const boxes = this._el("pb-cards");
    if (!boxes) return;
    const app = this._app;
    if (app.playing && app.playing.isVod) {
      boxes.innerHTML = "";
      boxes.classList.add("hidden");
      return;
    }
    boxes.classList.remove("hidden");
    let cards = `<div class="pb-card" data-open="guide"><div class="pb-card-ico">${KP.Icons.inner("guide", "ico")}</div>TV guide</div>` +
      `<div class="pb-card" data-open="history"><div class="pb-card-ico">${KP.Icons.inner("clock", "ico")}</div>History</div>`;
    const recents = (KP.Shell.groups()[1] && KP.Shell.groups()[1].channels) || [];
    recents.slice(0, 8).forEach((channel) => {
      const playing = app.playing && app.playing.id === channel.id;
      cards += `<div class="pb-card${playing ? " playing" : ""}" data-chid="${KP.Utils.esc(channel.id)}">` +
        `<div class="pb-card-logo">${KP.Logo.inner(channel)}</div>` +
        `<div class="pb-card-prog"><div style="width:${KP.Utils.progress(this._liveNow(channel).now)}%"></div></div></div>`;
    });
    boxes.innerHTML = cards;
  }

  _refreshInfoBar() {
    const channel = this._app.playing;
    if (!channel || channel.isVod) return;
    const programme = this._liveNow(channel).now;
    this._el("ib-now").textContent = programme ? programme.title : channel.name;
    this._el("ib-range").textContent = programme
      ? `${KP.Utils.fmtTime(programme.start)} - ${KP.Utils.fmtTime(programme.end)}`
      : "";
    this._el("ib-remain").textContent = programme
      ? `${Math.max(0, Math.round((programme.end - Date.now()) / 60000))} min`
      : "";
    this._el("ib-progress-fill").style.width = `${KP.Utils.progress(programme)}%`;
  }

  refreshInfoBar() {
    this._refreshInfoBar();
  }

  _updateVodBar(atTime) {
    if (!KP.Player || !this._app.playing || !this._app.playing.isVod) return;
    const duration = KP.Player.getDuration();
    const time = typeof atTime === "number"
      ? atTime
      : (this._seekActive ? this._seekTarget : KP.Player.getTime());
    if (!(duration > 0)) return;
    this._el("ib-range").textContent = `${KP.Utils.fmtDuration(time)} / ${KP.Utils.fmtDuration(duration)}`;
    this._el("ib-progress-fill").style.width = `${Math.max(0, Math.min(100, time / duration * 100))}%`;
    this._el("ib-remain").textContent = `${KP.Utils.fmtDuration(Math.max(0, duration - time))} left`;
  }

  _pbCardEls() {
    return document.querySelectorAll("#pb-cards .pb-card");
  }

  _renderPbFocus() {
    const elements = this._pbCardEls();
    for (let index = 0; index < elements.length; index += 1) {
      elements[index].classList.toggle("focused", index === this._pbFocus);
    }
    if (this._pbFocus >= 0 && elements[this._pbFocus]) {
      const box = document.querySelector("#info-bar .pb-cards");
      if (box) {
        const boxRect = box.getBoundingClientRect();
        const itemRect = elements[this._pbFocus].getBoundingClientRect();
        if (itemRect.left < boxRect.left) box.scrollLeft -= (boxRect.left - itemRect.left) + KP.Utils.designPx(18);
        else if (itemRect.right > boxRect.right) box.scrollLeft += (itemRect.right - boxRect.right) + KP.Utils.designPx(18);
      }
    }
  }

  _activatePbCard() {
    const element = this._pbCardEls()[this._pbFocus];
    this._pbFocus = -1;
    this._renderPbFocus();
    if (element) element.click();
  }

  hideInfoBar() {
    const bar = this._el("info-bar");
    if (!bar) return;
    bar.classList.add("hidden");
    this._pbFocus = -1;
    this._renderPbFocus();
  }

  showInfoBar() {
    const bar = this._el("info-bar");
    if (!bar || !this._app.playing) {
      if (bar) bar.classList.add("hidden");
      return;
    }
    bar.classList.remove("hidden");
    this._markPaused();
    if (this._app.playing && this._app.playing.isVod) this._updateVodBar();
    clearTimeout(this._panelTimer);
    if (KP.Player && KP.Player.state() === "paused") return;
    this._panelTimer = setTimeout(() => this.hideInfoBar(), this._app.playing && this._app.playing.isVod ? 6000 : 4500);
  }

  _markPaused() {
    const badge = this._el("ib-paused");
    const paused = !!this._app.playing && KP.Player && KP.Player.state() === "paused";
    if (badge) badge.classList.toggle("hidden", !paused);
  }

  _togglePause() {
    if (!KP.Player) return;
    const state = KP.Player.state();
    if (state === "playing") {
      if (!KP.Player.pause()) return;
      this._showSeekToast("Paused");
      this.showInfoBar();
    } else if (state === "paused") {
      if (!KP.Player.resume()) return;
      this._showSeekToast("Resumed");
      this.showInfoBar();
    } else {
      this.showInfoBar();
    }
  }

  toggleInfoBar() {
    const bar = this._el("info-bar");
    clearTimeout(this._panelTimer);
    if (bar.classList.contains("hidden")) {
      this.showInfoBar();
      this._pbFocus = -1;
      this._renderPbFocus();
    } else {
      this.hideInfoBar();
    }
  }

  _showSeekToast(text) {
    const element = this._el("seek-toast");
    if (!element) return;
    element.textContent = text;
    element.classList.remove("hidden");
    clearTimeout(this._seekToastTimer);
    this._seekToastTimer = setTimeout(() => element.classList.add("hidden"), 1600);
  }

  _pressDigit(digit) {
    this._digitBuf = (this._digitBuf + digit).substring(0, 4);
    const box = this._el("digit-entry");
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
    const box = this._el("digit-entry");
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
    const match = KP.Shell.allChannels().find((channel) => channel.num === number);
    if (!match) {
      KP.Shell.toast(`No channel ${number}`, 2200);
      return;
    }
    const groups = KP.Shell.groups();
    const group = groups.find((item) => (item.channels || []).indexOf(match) >= 0);
    if (group && KP.Store && KP.Store.isGroupLocked(group.name)) {
      KP.Views.pin.guardGroup(group.name, () => this.playChannel(match));
      return;
    }
    this.playChannel(match);
  }

  _trackLabel(track, index, prefix) {
    let lang = "";
    try {
      const info = JSON.parse(track.info || "{}");
      lang = info.language || info.lang || "";
    } catch (error) {
      lang = "";
    }
    const code = lang ? lang.toUpperCase() : "";
    return code && code !== "UND" ? `${prefix} ${index + 1} · ${code}` : `${prefix} ${index + 1}`;
  }

  _buildAvRows() {
    const rows = [];
    const tracks = KP.Player ? KP.Player.tracks() : { audio: [], video: [], text: [] };
    if (tracks.audio.length > 1) {
      rows.push({
        type: "audio",
        label: "Audio track",
        values: ["Default", ...tracks.audio.map((track, index) => this._trackLabel(track, index, "Audio"))]
      });
    }
    if (tracks.text.length) {
      rows.push({
        type: "text",
        label: "Subtitles",
        values: ["Off", ...tracks.text.map((track, index) => this._trackLabel(track, index, "Subtitle"))]
      });
    }
    rows.push({ type: "fit", label: "Video fit", values: ["Letterbox", "Stretch"] });
    if (this._app.playing && this._app.playing.isVod) {
      rows.push({ type: "speed", label: "Playback speed", values: ["0.5x", "0.75x", "1x", "1.25x", "1.5x", "2x"] });
    }
    return rows;
  }

  _avValueFor(row) {
    if (row.type === "audio") return row.values[this._avSel.audio + 1] || "Default";
    if (row.type === "text") return row.values[this._avSel.text + 1] || "Off";
    if (row.type === "fit") return this._avDisplay === 0 ? "Letterbox" : "Stretch";
    if (row.type === "speed") {
      const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
      const labels = ["0.5x", "0.75x", "1x", "1.25x", "1.5x", "2x"];
      const speed = KP.Player ? (KP.Player.speed() || 1) : 1;
      const index = speeds.findIndex((value) => Math.abs(value - speed) < 0.01);
      return labels[index < 0 ? 2 : index];
    }
    return "";
  }

  _renderAvPanel() {
    const box = this._el("av-rows");
    if (!box) return;
    if (!this._avRows.length) {
      box.innerHTML = '<div class="av-empty">No audio or video options for this stream</div>';
      return;
    }
    box.innerHTML = this._avRows.map((row, index) =>
      `<div class="av-row${index === this._avIdx ? " focused" : ""}">` +
      `<span class="av-label">${KP.Utils.esc(row.label)}</span>` +
      `<span class="av-val">${KP.Utils.esc(this._avValueFor(row))}</span></div>`
    ).join("");
  }

  _avAdjust(direction) {
    const row = this._avRows[this._avIdx];
    if (!row || !KP.Player) return;
    if (row.type === "audio" || row.type === "text") {
      const total = row.values.length;
      const next = (this._avSel[row.type] + 1 + direction + total) % total;
      this._avSel[row.type] = next - 1;
      const type = row.type === "audio" ? "AUDIO" : "TEXT";
      if (next === 0) {
        KP.Player.selectTrack(type, -1);
      } else {
        const tracks = KP.Player.tracks();
        const list = row.type === "audio" ? tracks.audio : tracks.text;
        const track = list[next - 1];
        KP.Player.selectTrack(type, track ? track.index : -1);
      }
    } else if (row.type === "fit") {
      this._avDisplay = (this._avDisplay + direction + 2) % 2;
      KP.Player.setDisplayMode(this._avDisplay === 0
        ? "PLAYER_DISPLAY_MODE_LETTER_BOX"
        : "PLAYER_DISPLAY_MODE_FULL_SCREEN");
    } else if (row.type === "speed") {
      const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
      const speed = KP.Player.speed() || 1;
      let index = speeds.findIndex((value) => Math.abs(value - speed) < 0.01);
      if (index < 0) index = 2;
      KP.Player.setSpeed(speeds[(index + direction + speeds.length) % speeds.length]);
    }
    this._renderAvPanel();
  }

  openAvPanel() {
    if (!this._app.playing || !KP.Player) return;
    this._avOpen = true;
    this._avIdx = 0;
    this._avRows = this._buildAvRows();
    this._renderAvPanel();
    const panel = this._el("av-panel");
    if (panel) panel.classList.remove("hidden");
  }

  closeAvPanel() {
    this._avOpen = false;
    const panel = this._el("av-panel");
    if (panel) panel.classList.add("hidden");
  }

  toggleAvPanel() {
    if (!KP.Player) return false;
    if (this._avOpen) this.closeAvPanel();
    else this.openAvPanel();
    return true;
  }

  _resetAv() {
    this.closeAvPanel();
    this._avSel = { audio: -1, text: -1 };
  }

  _jumpToLive() {
    if (!KP.Player) return;
    const url = KP.Player.url();
    if (!url) return;
    this._resetSeek();
    KP.Player.play(url, { isVod: false, isLive: true });
    this._showSeekToast("Jumped to live");
  }

  _zapChannels() {
    const channels = KP.Shell.allChannels();
    const settings = KP.Store ? KP.Store.settings() : null;
    if (!settings || !settings.zapInGroup) return channels;
    const playing = this._app.playing;
    if (!playing || playing.isVod || !playing.group) return channels;
    const scoped = channels.filter((channel) => channel.group === playing.group);
    return scoped.length > 1 ? scoped : channels;
  }

  _resetSeek() {
    clearTimeout(this._seekTimer);
    this._seekTimer = null;
    this._seekActive = false;
    this._seekTarget = 0;
    this._seekOrigin = 0;
  }

  _commitSeek() {
    this._seekTimer = null;
    if (!this._seekActive || !KP.Player) return;
    const duration = KP.Player.getDuration();
    if (!(duration > 0)) {
      this._resetSeek();
      return;
    }
    const target = Math.max(0, Math.min(duration - 500, this._seekTarget));
    this._seekTarget = target;
    KP.Player.seekTo(target);
    this._updateVodBar(target);
  }

  seekBy(seconds) {
    if (!KP.Player) return;
    const duration = KP.Player.getDuration();
    if (!(duration > 0)) return;
    if (!this._seekActive) {
      this._seekActive = true;
      this._seekOrigin = KP.Player.getTime();
      this._seekTarget = this._seekOrigin;
    }
    this._seekTarget = Math.max(0, Math.min(duration - 500, this._seekTarget + seconds * 1000));
    clearTimeout(this._seekTimer);
    this._seekTimer = setTimeout(() => this._commitSeek(), 350);
    this.showInfoBar();
    this._updateVodBar(this._seekTarget);
    const moved = Math.round((this._seekTarget - this._seekOrigin) / 1000);
    this._showSeekToast(`${moved > 0 ? "+" : ""}${moved}s · ${KP.Utils.fmtDuration(this._seekTarget)}`);
  }

  /* Held arrow: some remote firmwares do not auto-repeat keydowns, so holding
     the key reads as a single press. After a short arm window, driven moves
     advance at a fixed cadence - but only while no platform autorepeat is
     feeding fresh keydowns (their cadence refreshes _holdLastDown and keeps
     the interval idle, so both paths accumulate without double counting). */
  _trackHold(key) {
    const wasHeld = this._holdKey === key;
    this._holdKey = key;
    this._holdLastDown = Date.now();
    if (wasHeld) {
      /* a repeat keydown proves the firmware advances on its own; the
         driven cadence must stay idle for the rest of this hold */
      this._holdRepeats = true;
    } else {
      this._stopHoldTimers();
      this._holdRepeats = false;
      this._holdArmTimer = setTimeout(() => this._startHoldAdvance(key), 450);
    }
  }

  _startHoldAdvance(key) {
    if (this._holdKey !== key) return;
    const direction = key === 39 ? 1 : -1;
    const step = KP.Store ? (KP.Store.settings().seekStepSec || 30) : 30;
    let drives = 0;
    this._holdInterval = setInterval(() => {
      if (this._holdKey !== key || KP.Player.state() === "error") {
        this._endHold();
        return;
      }
      /* firmware autorepeats handle the acceleration themselves; drive only
         when the platform stays silent after the initial press */
      if (this._holdRepeats || Date.now() - this._holdLastDown < 220) return;
      if (drives >= 30) {
        this._endHold();
        return;
      }
      drives += 1;
      this.seekBy(direction * step);
    }, 200);
  }

  _noteHoldKey(key) {
    this._trackHold(key);
  }

  _endHold() {
    this._holdKey = 0;
    this._stopHoldTimers();
  }

  _stopHoldTimers() {
    if (this._holdArmTimer) {
      clearTimeout(this._holdArmTimer);
      this._holdArmTimer = null;
    }
    if (this._holdInterval) {
      clearInterval(this._holdInterval);
      this._holdInterval = null;
    }
  }

  _stopHold() {
    this._endHold();
  }

  _zap(direction) {
    const channels = this._zapChannels();
    if (!channels.length) return;
    const app = this._app;
    let index = app.playing ? channels.indexOf(app.playing) : -1;
    if (index < 0) index = 0;
    else index = (index + direction + channels.length) % channels.length;
    this.playChannel(channels[index]);
  }

  playProgramme(channel, programme) {
    if (!channel || !programme) return;
    const playlist = KP.Store.getPlaylist(channel.playlistId);
    if (playlist && playlist.type === "xtream" && channel.xtreamId && programme.end <= Date.now()) {
      const duration = Math.max(1, Math.round((programme.end - programme.start) / 60000));
      const url = KP.Parsers.Xtream.timeshiftUrl(
        playlist.url,
        playlist.user,
        playlist.pass,
        channel.xtreamId,
        new Date(programme.start),
        duration
      );
      this.playChannel(channel, true, url);
      return;
    }
    this.playChannel(channel);
  }

  playVod(item, episode, resume, episodes) {
    if (!item) return false;
    let selected = episode;
    const list = episodes || [];
    if (item.kind === "series" && !selected) {
      if (list.length) selected = list[0];
      else return false;
    }
    const url = KP.Vod.url(item, selected || null);
    if (!url) {
      this._setStatus("This item is not playable", "The playlist is missing or the provider did not supply a stream.", true, false);
      return false;
    }
    const key = selected ? `${item.key}:e:${selected.id}` : item.key;
    let from = this._vodCtx && this._vodCtx.from ? this._vodCtx.from : "vod";
    if (this._app.view === "voddetail" && KP.Views.voddetail && KP.Views.voddetail._from) {
      from = KP.Views.voddetail._from;
    }
    this._vodCtx = { key, item, episode: selected || null, episodes: list, from };
    this._pendingSeek = resume && KP.Store ? KP.Store.getProgress(key) : 0;
    const label = selected
      ? `${item.name} S${selected.season} E${selected.episode}`
      : item.name;
    const pseudo = {
      id: key,
      isVod: true,
      kind: item.kind,
      num: "",
      name: label,
      playlistId: item.playlistId,
      logoText: String(item.name || "?").substring(0, 2).toUpperCase(),
      url,
      programmes: []
    };
    this.playChannel(pseudo, true);
    return true;
  }

  _autoplayNext() {
    if (!this._vodCtx || !this._vodCtx.episode || !this._vodCtx.episodes || !this._vodCtx.episodes.length) return;
    let current = -1;
    this._vodCtx.episodes.forEach((episode, index) => {
      if (String(episode.id) === String(this._vodCtx.episode.id)) current = index;
    });
    if (current >= 0 && current + 1 < this._vodCtx.episodes.length) {
      this.playVod(this._vodCtx.item, this._vodCtx.episodes[current + 1], false, this._vodCtx.episodes);
    }
  }

  _saveProgress() {
    if (!this._vodCtx || !KP.Player || !KP.Store) return;
    const time = this._seekActive ? this._seekTarget : KP.Player.getTime();
    if (time > 0) KP.Store.setProgress(this._vodCtx.key, time);
  }

  _returnToVod() {
    if (!this._vodCtx || !this._vodCtx.item) return false;
    this._saveProgress();
    this._resetSeek();
    if (KP.Player) KP.Player.stop();
    this._vodCtx = null;
    this._app.playing = null;
    this._pbFocus = -1;
    this.hideInfoBar();
    KP.Shell.back();
    return true;
  }

  _setStatus(title, detail, isError, canRetry) {
    const element = this._el("player-status");
    const titleElement = this._el("ps-title");
    const detailElement = this._el("ps-detail");
    if (!element) return;
    element.classList.remove("hidden");
    this._markPaused();
    element.classList.toggle("error", !!isError);
    element.classList.toggle("retryable", !!canRetry);
    if (titleElement) titleElement.textContent = title;
    if (detailElement) detailElement.textContent = detail || "";
  }

  _hideStatus() {
    const element = this._el("player-status");
    if (element) element.classList.add("hidden");
  }

  _stopStatusTick() {
    if (!this._statusTickTimer) return;
    clearInterval(this._statusTickTimer);
    this._statusTickTimer = null;
  }

  _resetStatus() {
    this._stopStatusTick();
    clearTimeout(this._statusHideTimer);
    this._statusHideTimer = null;
    this._statusShownAt = 0;
    this._statusMode = "live";
    this._statusBuffering = false;
    this._hideStatus();
  }

  _statusTick() {
    if (!this._statusShownAt) return;
    const seconds = Math.max(1, Math.floor((Date.now() - this._statusShownAt) / 1000));
    const detail = this._el("ps-detail");
    if (!detail) return;
    if (this._statusMode === "seek") {
      detail.textContent = seconds >= 5 ? "Still seeking..." : "";
    } else if (this._statusMode === "failover") {
      detail.textContent = seconds >= 6 ? "Still trying backup source..." : "";
    } else if (this._statusMode === "reconnect" || this._statusMode === "stall" || this._statusMode === "retry") {
      detail.textContent = seconds >= 6 ? "Still reconnecting..." : "";
    } else if (this._statusBuffering) {
      detail.textContent = seconds >= 6 ? "Still buffering..." : "";
    } else {
      detail.textContent = seconds >= 8 ? "Still opening..." : "";
    }
  }

  _startStatusTick(mode) {
    this._stopStatusTick();
    this._statusMode = mode;
    this._statusTickTimer = setInterval(() => this._statusTick(), 1000);
  }

  _onPlayerState(playerState, info = {}) {
    const element = this._el("player-status");
    const playing = this._app.playing;
    const live = !(playing && playing.isVod);
    const wasShown = !!this._statusShownAt;

    if (playerState === "buffering" || playerState === "opening") {
      clearTimeout(this._statusHideTimer);
      if (!wasShown) this._statusShownAt = Date.now();
      this._statusBuffering = playerState === "buffering";
      const reason = info.reason || "";
      const recovering = !!(info.stall || info.recover || info.retry);
      const mode = recovering ? "reconnect" : info.seek ? "seek" : (live ? "live" : "vod");
      let title;
      if (recovering) {
        title = info.stall ? "Stream stalled. Reconnecting..." : "Reconnecting...";
      } else {
        title = info.seek ? "Seeking..." :
          playerState === "opening"
            ? (live ? "Opening live channel" : "Opening movie")
            : (live ? "Buffering live channel" : "Buffering movie");
      }
      if (wasShown && this._statusMode !== mode) this._statusShownAt = Date.now();
      this._setStatus(title, "", false, false);
      if (!wasShown || this._statusMode !== mode) this._startStatusTick(mode);
      else this._statusMode = mode;
      return;
    }

    if (playerState === "error") {
      this._statusBuffering = false;
      this._resetSeek();
      this.closeAvPanel();
      clearTimeout(this._statusHideTimer);
      this._stopStatusTick();
      this._statusShownAt = 0;
      this._saveProgress();
      const name = playing ? (playing.name || "") : "";
      let message = info.detail || info.message || "The stream could not be opened.";
      if (name) message = `${name}: ${message}`;
      message += info.retryable
        ? " Press OK to try again, or press Back to go back."
        : " Press Back to go back.";
      this._setStatus(info.title || "Stream unavailable", message, true, !!info.retryable);
      return;
    }

    this._statusBuffering = false;
    const elapsed = this._statusShownAt ? Date.now() - this._statusShownAt : 999;
    this._statusShownAt = 0;
    this._stopStatusTick();
    clearTimeout(this._statusHideTimer);
    this._statusHideTimer = setTimeout(() => {
      if (KP.Player.state() !== "error" && element) element.classList.add("hidden");
    }, Math.max(0, 650 - elapsed));

    if (playerState === "playing") {
      if (info && info.recover && KP.Shell && KP.Shell.toast) KP.Shell.toast("Stream reconnected", 3200);
      if (!this._desktop()) this._el("player-placeholder").classList.add("hidden");
      if (this._seekActive && !this._holdKey) this._resetSeek();
      if (this._pendingSeek > 0 && KP.Player) {
        KP.Player.seekTo(this._pendingSeek);
        this._pendingSeek = 0;
      }
      this._updateVodBar();
    }
    if (playerState === "paused") {
      if (this._vodCtx) this._saveProgress();
      const bar = this._el("info-bar");
      if (bar && !bar.classList.contains("hidden")) this.showInfoBar();
    }
    this._markPaused();
    if (playerState === "ended" && this._vodCtx) {
      KP.Store.clearProgress(this._vodCtx.key);
      this._autoplayNext();
    }
  }

  stop() {
    this._endHold();
    this._resetSeek();
    this._clearDigits();
    this._resetAv();
    if (KP.Player) KP.Player.stop();
    this._app.playing = null;
    this._vodCtx = null;
    this._pendingSeek = 0;
    this._pbFocus = -1;
    this._markPaused();
    this.hideInfoBar();
    this._resetStatus();
    const placeholder = this._el("player-placeholder");
    if (placeholder) placeholder.classList.remove("hidden");
    KP.Shell.updatePlaceholder();
  }

  handleKey(key) {
    const app = this._app;
    const isVod = !!(app.playing && app.playing.isVod);
    const step = KP.Store ? (KP.Store.settings().seekStepSec || 30) : 30;

    if ((this._holdKey === 37 || this._holdKey === 39) && key !== this._holdKey) this._endHold();
    if (key === 13 && KP.Player && KP.Player.state() === "error") {
      if (KP.Player.canRetry()) KP.Player.retry();
      return true;
    }

    if (this._avOpen) {
      if (key === 10009 || key === 461) this.closeAvPanel();
      else if (this._avRows.length) {
        if (key === 38) {
          this._avIdx = Math.max(0, this._avIdx - 1);
          this._renderAvPanel();
        } else if (key === 40) {
          this._avIdx = Math.min(this._avRows.length - 1, this._avIdx + 1);
          this._renderAvPanel();
        } else if (key === 37) this._avAdjust(-1);
        else if (key === 39 || key === 13) this._avAdjust(1);
      }
      return true;
    }

    const digit = KP.Utils.digitFromKey(key);
    if (digit >= 0 && KP.Store && KP.Store.hasData()) {
      this._pressDigit(digit);
      return true;
    }

    if (!isVod && (key === 427 || key === 428 || key === 33 || key === 34 || key === 176 || key === 177)) {
      this._zap(key === 427 || key === 33 || key === 176 ? 1 : -1);
      return true;
    }

    if (this._pbFocus >= 0) {
      const cards = this._pbCardEls().length;
      if (key === 37 || key === 39) {
        if (cards) this._pbFocus = (this._pbFocus + (key === 39 ? 1 : -1) + cards) % cards;
        this._renderPbFocus();
      } else if (key === 13) {
        this._activatePbCard();
      } else if (key === 38 || key === 40 || key === 10009 || key === 461) {
        this._pbFocus = -1;
        this._renderPbFocus();
        if (key === 10009 || key === 461) this.hideInfoBar();
        else if (!isVod) {
          clearTimeout(this._panelTimer);
          this._panelTimer = setTimeout(() => this.hideInfoBar(), 4500);
        }
      }
      return true;
    }

    if (key === 13) {
      if (KP.Store && !KP.Store.hasData()) KP.Views.playlists.open();
      else if (app.playing && isVod) this._togglePause();
      else if (app.playing && KP.Player && KP.Player.state() === "paused") this._jumpToLive();
      else if (app.playing) this.toggleInfoBar();
      else KP.Views.channels.open();
    } else if (key === 10009 || key === 461) {
      if (KP.Store && !KP.Store.hasData()) {
        if (!KP.Store.playlists.length) KP.Shell.armExit();
        else KP.Views.playlists.open();
        return true;
      }
      if (isVod && this._returnToVod()) return true;
      if (this._app.playing) this.stop();
      KP.Shell.back();
      return true;
    } else if (key === 37 || key === 39) {
      if (isVod && KP.Player.getDuration() > 0) {
        this._trackHold(key);
        this.seekBy(key === 39 ? step : -step);
      } else if (isVod) {
        this._endHold();
      } else if (!app.playing) KP.Shell.openMenu();
      else if (key === 37) KP.Shell.openMenu();
      else if (key === 39) this.toggleInfoBar();
    } else if (key === 38 || key === 40) {
      const bar = this._el("info-bar");
      if (isVod) {
        if (key === 40) {
          this.showInfoBar();
          if (this._pbCardEls().length) {
            this._pbFocus = 0;
            this._renderPbFocus();
          }
        } else if (bar.classList.contains("hidden")) {
          this.showInfoBar();
        } else {
          this.hideInfoBar();
        }
      } else if (!bar.classList.contains("hidden")) {
        clearTimeout(this._panelTimer);
        if (this._pbCardEls().length) {
          this._pbFocus = 0;
          this._renderPbFocus();
        }
      } else {
        this._zap(key === 40 ? 1 : -1);
      }
    } else {
      return false;
    }
    return true;
  }

  handleMediaKey(event) {
    if (!KP.Player) return false;
    if (event.repeat) return true;
    const key = event.key;
    const seekable = KP.Player.getDuration() > 0;
    const isVod = !!(this._app.playing && this._app.playing.isVod);
    if (key === "MediaPlayPause" || key === "MediaPlay" || key === "MediaPause") {
      this._togglePause();
      return true;
    }
    if (key === "MediaFastForward" && isVod && seekable) {
      this.seekBy(60);
      return true;
    }
    if (key === "MediaRewind" && isVod && seekable) {
      this.seekBy(-60);
      return true;
    }
    if (key === "MediaStop") {
      this.stop();
      return true;
    }
    return false;
  }

  init() {
    if (KP.Player) {
      KP.Player.initSurface(this._el("av-holder"));
      KP.Player.onState((state, info) => this._onPlayerState(state, info));
    }
    const cards = this._el("pb-cards");
    if (cards) {
      cards.addEventListener("click", (event) => {
        let target = event.target;
        while (target && target !== cards && !target.getAttribute("data-chid") && !target.getAttribute("data-open")) {
          target = target.parentNode;
        }
        if (!target || target === cards) return;
        if (target.getAttribute("data-open") === "guide") {
          KP.Views.guide.open();
          return;
        }
        if (target.getAttribute("data-open") === "history") {
          this.hideInfoBar();
          KP.Shell.state.groupIdx = 1;
          KP.Shell.state.chanIdx = 0;
          KP.Shell.show("channels");
          KP.Views.channels.render();
          return;
        }
        const id = target.getAttribute("data-chid");
        const recents = (KP.Shell.groups()[1] && KP.Shell.groups()[1].channels) || [];
        const channel = recents.find((item) => item.id === id);
        if (channel) this.playChannel(channel);
      });
    }
    setInterval(() => {
      if (!this._vodCtx || !KP.Player || !KP.Store || KP.Player.state() !== "playing") return;
      this._saveProgress();
    }, 15000);
    setInterval(() => {
      const app = this._app;
      if (app.view !== "player" || !app.playing) return;
      this._el("ib-clock").textContent = KP.Utils.fmtTime(Date.now());
      if (!app.playing.isVod) return;
      if (!this._el("info-bar").classList.contains("hidden")) this._updateVodBar();
    }, 500);
  }
}

KP.Playback = new KPlayerPlayback();
