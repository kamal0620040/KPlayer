/* KPlayer playback engine: Samsung AVPlay wrapper with a safe desktop fallback.
   States: idle | opening | buffering | playing | paused | error | ended.
   A generation counter guarantees that callbacks from an old stream can never
   overwrite the state of the channel that is playing now. */
"use strict";

const PLAYER_STALL_POLL_MS = 2000;
const PLAYER_STALL_MS = 8000;
const PLAYER_STALL_RECOVERY_MS = 900;
const PLAYER_STALL_MAX_RECOVERIES = 2;
const PLAYER_STALL_RESET_MS = 90000;

class KPlayerEngine {
  constructor() {
    this._av = null;
    this._generation = 0;
    this._state = "idle";
    this._currentUrl = "";
    this._isVod = false;
    this._isLive = false;
    this._retried = false;
    this._retryable = false;
    this._watchTimer = null;
    this._retryTimer = null;
    this._stallTimer = null;
    this._lastPlayhead = -1;
    this._lastPlayheadAt = 0;
    this._playheadSamples = 0;
    this._stallRecoveries = 0;
    this._lastStallAt = 0;
    this._stallPending = false;
    this._recoverContext = false;
    this._userPaused = false;
    this._displayMode = "PLAYER_DISPLAY_MODE_LETTER_BOX";
    this._speed = 1;
    this._stateListener = () => {};
    this._displayElement = null;
    window.addEventListener("resize", () => this._applyRect(), false);
  }

  _log(context, error) {
    KP.Utils.logWarn(`player/${context}`, error);
  }

  _avp() {
    if (!this._av) {
      try {
        if (window.webapis && window.webapis.avplay) this._av = window.webapis.avplay;
      } catch (error) {
        this._log("lookup", error);
      }
    }
    return this._av;
  }

  _clearWatch() {
    if (!this._watchTimer) return;
    clearTimeout(this._watchTimer);
    this._watchTimer = null;
  }

  _clearRetry() {
    if (!this._retryTimer) return;
    clearTimeout(this._retryTimer);
    this._retryTimer = null;
  }

  _clearStallWatch() {
    if (this._stallTimer) clearInterval(this._stallTimer);
    this._stallTimer = null;
  }

  _armStallWatch() {
    this._clearStallWatch();
    if (!this._avp() || this._isVod) return;
    const token = this._generation;
    this._lastPlayhead = -1;
    this._lastPlayheadAt = Date.now();
    this._playheadSamples = 0;
    this._stallTimer = setInterval(() => this._pollStall(token), PLAYER_STALL_POLL_MS);
  }

  _readPlayhead() {
    const av = this._avp();
    if (av && av.getCurrentTime) {
      try {
        const value = av.getCurrentTime();
        if (typeof value === "number" && value >= 0) return value;
      } catch (error) {
        this._log("getCurrentTime", error);
      }
    }
    const video = this._videoElement();
    if (video && typeof video.currentTime === "number" && !video.paused) {
      return Math.round(video.currentTime * 1000);
    }
    return -1;
  }

  _notePlayhead(value) {
    if (this._state !== "playing" || this._stallPending) return;
    const playhead = Number(value);
    if (!isFinite(playhead) || playhead < 0) return;
    const now = Date.now();
    if (this._lastPlayhead < 0) {
      this._lastPlayhead = playhead;
      this._lastPlayheadAt = now;
      return;
    }
    if (Math.abs(playhead - this._lastPlayhead) < 250) return;
    this._lastPlayhead = playhead;
    this._lastPlayheadAt = now;
    this._playheadSamples += 1;
    if (this._lastStallAt && now - this._lastStallAt > PLAYER_STALL_RESET_MS) {
      this._stallRecoveries = 0;
    }
  }

  _pollStall(token) {
    if (token !== this._generation || this._state !== "playing" || this._stallPending) return;
    const playhead = this._readPlayhead();
    if (playhead >= 0) this._notePlayhead(playhead);
    if (this._playheadSamples < 2) return;
    if (Date.now() - this._lastPlayheadAt < PLAYER_STALL_MS) return;
    this._recoverStall(token);
  }

  _recoverStall(token) {
    if (token !== this._generation || this._stallPending) return;
    const now = Date.now();
    if (this._lastStallAt && now - this._lastStallAt > PLAYER_STALL_RESET_MS) {
      this._stallRecoveries = 0;
    }
    this._stallPending = true;
    this._clearStallWatch();
    if (this._stallRecoveries >= PLAYER_STALL_MAX_RECOVERIES) {
      this._stallPending = false;
      this._setState("error", {
        title: "Channel stopped responding",
        detail: "The stream stalled repeatedly and could not recover.",
        retryable: true
      });
      return;
    }
    this._stallRecoveries += 1;
    this._lastStallAt = now;
    this._setState("buffering", { pct: 0, stall: true, attempt: this._stallRecoveries });
    this._clearRetry();
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (token !== this._generation) return;
      this._stallPending = false;
      this._recoverContext = true;
      this._retried = false;
      this._start(this._currentUrl);
    }, PLAYER_STALL_RECOVERY_MS);
  }

  _armWatch() {
    if (this._watchTimer) return;
    const token = this._generation;
    this._watchTimer = setTimeout(() => {
      this._watchTimer = null;
      if (token !== this._generation || (this._state !== "opening" && this._state !== "buffering")) return;
      this._setState("error", this._timeoutInfo());
    }, 15000);
  }

  _setState(next, info = {}) {
    this._state = next;
    if (next === "opening" || next === "buffering") this._armWatch();
    else this._clearWatch();
    if (next === "playing") {
      this._stallPending = false;
      this._recoverContext = false;
      this._armStallWatch();
    } else {
      this._clearStallWatch();
    }
    if (next === "error" || next === "idle" || next === "ended") {
      this._stallPending = false;
      this._recoverContext = false;
    }
    if (next === "error") this._retryable = !info || info.retryable !== false;
    else this._retryable = false;
    try {
      this._stateListener(next, info);
    } catch (error) {
      KP.Utils.logError("player/state-listener", error);
    }
  }

  _displayRect() {
    if (!this._displayElement) return [0, 0, 1920, 1080];
    const rect = this._displayElement.getBoundingClientRect();
    const viewWidth = window.innerWidth || 1920;
    const viewHeight = window.innerHeight || 1080;
    const scaleX = 1920 / viewWidth;
    const scaleY = 1080 / viewHeight;
    return [
      Math.round(rect.left * scaleX),
      Math.round(rect.top * scaleY),
      Math.round(rect.width * scaleX),
      Math.round(rect.height * scaleY)
    ];
  }

  _applyRect() {
    const av = this._avp();
    if (!av || !av.setDisplayRect) return;
    try {
      const [left, top, width, height] = this._displayRect();
      av.setDisplayRect(left, top, width, height);
    } catch (error) {
      this._log("setDisplayRect", error);
    }
  }

  _teardown() {
    this._clearWatch();
    this._clearRetry();
    this._clearStallWatch();
    const av = this._avp();
    if (!av) return;
    try {
      const playerState = av.getState && av.getState();
      if (playerState === "PLAYING" || playerState === "PAUSED" || playerState === "READY") {
        if (av.stop) av.stop();
      }
    } catch (error) {
      this._log("teardown/stop", error);
    }
    try {
      if (av.close) av.close();
    } catch (error) {
      this._log("teardown/close", error);
    }
  }

  _videoElement() {
    return document.getElementById("samsung_tizen_web_videoplayer");
  }

  _wireVideo() {
    const video = this._videoElement();
    if (!video || video.__kplayerWired) return;
    video.__kplayerWired = true;
    let seeking = false;
    let seekFlipTimer = null;

    const clearSeekFlip = () => {
      if (!seekFlipTimer) return;
      clearTimeout(seekFlipTimer);
      seekFlipTimer = null;
    };

    video.addEventListener("seeking", () => {
      if (this._userPaused) return;
      seeking = true;
      clearSeekFlip();
      seekFlipTimer = setTimeout(() => {
        seekFlipTimer = null;
        if (!seeking) return;
        seeking = false;
        this._setState("buffering", { pct: 0, buffering: true });
      }, 2200);
      this._setState("buffering", { pct: 0, seek: true });
    });

    video.addEventListener("waiting", () => {
      if (this._userPaused) return;
      this._setState("buffering", seeking ? { pct: 0, seek: true } : { pct: 0, buffering: true });
    });

    video.addEventListener("playing", () => {
      seeking = false;
      clearSeekFlip();
      if (this._userPaused) {
        this._setState("paused");
        return;
      }
      this._setState("playing");
      this._notePlayhead(Math.round(video.currentTime * 1000));
    });

    video.addEventListener("timeupdate", () => {
      if (this._state === "playing") this._notePlayhead(Math.round(video.currentTime * 1000));
    });

    video.addEventListener("seeked", () => {
      seeking = false;
      clearSeekFlip();
      if (!video.paused && video.readyState >= 3) this._setState("playing");
      else if (this._state === "buffering") this._setState("buffering", { pct: 0, buffering: true });
    });
  }

  _hlsVariant(url) {
    return url && /\.ts(\?|$)/i.test(url) ? url.replace(/\.ts(\?|$)/i, ".m3u8$1") : url;
  }

  _isMovieUrl(url) {
    return /\/(movie|series)\//i.test(url || "") ||
      /\.(mkv|mp4|m4v|avi|mov|webm)(\?|$)/i.test(url || "");
  }

  _isVodPlayback() {
    return this._isVod || this._isMovieUrl(this._currentUrl);
  }

  _configureBuffer(url) {
    const av = this._avp();
    if (!av || !av.setBufferingParam || !this._isMovieUrl(url)) return;
    try {
      av.setBufferingParam("PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", 15);
    } catch (error) {
      this._log("setBufferingParam", error);
    }
  }

  _describeError(error, url) {
    const video = this._videoElement();
    const videoError = video && video.error ? video.error : null;
    const code = videoError ? videoError.code : (error && error.code);
    if (code === 4) {
      return { title: "Video format not supported", detail: "This stream's video format cannot be decoded. Try another channel or movie.", retryable: false };
    }
    if (code === 3) {
      return { title: "Video decode failed", detail: "This video format cannot be decoded by the player. Try another title.", retryable: false };
    }
    if (code === 2) {
      return { title: "Stream unavailable", detail: "The stream stopped responding. Check your connection and try again.", retryable: true };
    }
    if (this._isMovieUrl(url)) {
      return { title: "Movie unavailable", detail: "This movie could not be opened. It may be offline or use an unsupported format.", retryable: true };
    }
    return { title: "Channel unavailable", detail: "This channel could not be opened. It may be offline or at its connection limit.", retryable: true };
  }

  _timeoutInfo() {
    if (this._isMovieUrl(this._currentUrl)) {
      return { title: "Movie unavailable", detail: "The video is taking too long to load. It may be offline or use an unsupported format.", retryable: true };
    }
    return { title: "Channel unavailable", detail: "The channel is taking too long to load. It may be offline or at its connection limit.", retryable: true };
  }

  _start(url) {
    if (!url) return;
    this._currentUrl = url;
    this._userPaused = false;
    const token = ++this._generation;
    const av = this._avp();
    if (!av) {
      this._setState("playing");
      return;
    }

    this._teardown();
    this._configureBuffer(url);
    this._setState("opening", this._recoverContext ? { recover: true } : {});

    const listener = {
      onbufferingstart: () => {
        if (token === this._generation) {
          this._setState("buffering", this._recoverContext ? { pct: 0, recover: true } : { pct: 0 });
        }
      },
      onbufferingprogress: (pct) => {
        if (token === this._generation) {
          this._setState("buffering", this._recoverContext ? { pct, recover: true } : { pct });
        }
      },
      onbufferingcomplete: () => {
        if (token !== this._generation) return;
        if (this._userPaused) {
          this._setState("paused");
          return;
        }
        this._setState("playing");
      },
      oncurrentplaytime: (time) => {
        if (token === this._generation) this._notePlayhead(time);
      },
      onstreamcompleted: () => {
        if (token === this._generation) this._setState("ended");
      },
      onerror: (error) => {
        if (token !== this._generation) return;
        const desc = this._describeError(error, this._currentUrl);
        const nextUrl = this._hlsVariant(this._currentUrl);
        const canRetryVariant = nextUrl !== this._currentUrl;
        if (!this._retried && (canRetryVariant || desc.retryable)) {
          this._retried = true;
          this._clearRetry();
          this._retryTimer = setTimeout(() => {
            this._retryTimer = null;
            if (token === this._generation) this._start(canRetryVariant ? nextUrl : this._currentUrl);
          }, 1200);
          this._setState("buffering", {
            pct: 0,
            retry: true,
            recover: this._recoverContext
          });
          return;
        }
        this._setState("error", desc);
      },
      onevent: () => {},
      ondrmevent: () => {}
    };

    try {
      av.open(url);
      this._wireVideo();
      av.setListener(listener);
      this._applyRect();
      if (av.setDisplayMethod) {
        try {
          av.setDisplayMethod(this._displayMode);
        } catch (error) {
          this._log("setDisplayMethod", error);
        }
      }
      av.prepareAsync(() => {
        if (token !== this._generation) return;
        this._wireVideo();
        try {
          av.play();
        } catch (error) {
          listener.onerror(error);
          return;
        }
        const video = this._videoElement();
        if (video && (video.readyState < 2 || video.paused)) {
          this._setState("buffering", { pct: 0, buffering: true });
        } else {
          this._setState("playing");
        }
      }, (error) => {
        if (token === this._generation) listener.onerror(error);
      });
    } catch (error) {
      listener.onerror(error);
    }
  }

  play(url, options = {}) {
    if (!url) return;
    this._isVod = options.isVod != null ? !!options.isVod : this._isMovieUrl(url);
    this._isLive = options.isLive != null ? !!options.isLive : (!this._isVod && !this._isMovieUrl(url));
    if (url === this._currentUrl && (this._state === "playing" || this._state === "buffering")) return;
    this._retried = false;
    this._retryable = false;
    this._stallRecoveries = 0;
    this._lastStallAt = 0;
    this._stallPending = false;
    this._recoverContext = false;
    this._speed = 1;
    this._start(url);
  }

  initSurface(holder) {
    if (!KP.Utils.isTizen() || !holder) return;
    if (holder.querySelector('object[type="application/avplayer"]')) return;
    try {
      const object = document.createElement("object");
      object.id = "av-player";
      object.setAttribute("type", "application/avplayer");
      holder.appendChild(object);
    } catch (error) {
      KP.Utils.reportError("player/create-surface", error, "The video surface could not be created.");
    }
  }

  retry() {
    if (!this._currentUrl || this._state !== "error" || !this._retryable) return false;
    this._retried = false;
    this._stallRecoveries = 0;
    this._lastStallAt = 0;
    this._stallPending = false;
    this._recoverContext = false;
    this._start(this._currentUrl);
    return true;
  }

  canRetry() {
    return this._state === "error" && this._retryable && !!this._currentUrl;
  }

  stop() {
    this._generation += 1;
    this._teardown();
    this._currentUrl = "";
    this._userPaused = false;
    this._retried = false;
    this._stallRecoveries = 0;
    this._lastStallAt = 0;
    this._stallPending = false;
    this._recoverContext = false;
    this._setState("idle");
  }

  pause() {
    if (this._state !== "playing") return false;
    const av = this._avp();
    if (!av || !av.pause) return false;
    try {
      av.pause();
      this._userPaused = true;
      this._setState("paused");
      return true;
    } catch (error) {
      this._log("pause", error);
      return false;
    }
  }

  resume() {
    if (this._state !== "paused") return false;
    const av = this._avp();
    if (!av) return false;
    try {
      if (typeof av.resume === "function") av.resume();
      else av.play();
      this._userPaused = false;
      this._setState("playing");
      return true;
    } catch (error) {
      this._log("resume", error);
      return false;
    }
  }

  seekTo(milliseconds) {
    const av = this._avp();
    if (!av || !av.seekTo) return;
    try {
      av.seekTo(milliseconds, () => {}, (error) => {
        this._log("seek", error);
      });
    } catch (error) {
      this._log("seek", error);
    }
  }

  setSpeed(speed) {
    const av = this._avp();
    this._speed = typeof speed === "number" && speed > 0 ? speed : 1;
    if (!av || !av.setSpeed) return;
    try {
      av.setSpeed(this._speed);
    } catch (error) {
      this._log("setSpeed", error);
    }
  }

  getTime() {
    const av = this._avp();
    if (!av) return 0;
    try {
      const video = this._videoElement();
      if (video && typeof video.currentTime === "number") return Math.round(video.currentTime * 1000);
      return av.getCurrentTime ? av.getCurrentTime() : 0;
    } catch (error) {
      this._log("getTime", error);
      return 0;
    }
  }

  getDuration() {
    const av = this._avp();
    if (!av || !av.getDuration) return 0;
    try {
      return av.getDuration();
    } catch (error) {
      this._log("getDuration", error);
      return 0;
    }
  }

  state() {
    return this._state;
  }

  url() {
    return this._currentUrl;
  }

  speed() {
    return this._speed;
  }

  onState(fn) {
    this._stateListener = typeof fn === "function" ? fn : () => {};
  }

  attachTo(element) {
    const next = element || null;
    if (this._displayElement === next) return;
    this._displayElement = next;
    this._applyRect();
  }

  tracks() {
    const result = { audio: [], video: [], text: [] };
    const av = this._avp();
    if (!av || !av.getTrackInfo) return result;
    try {
      const tracks = av.getTrackInfo() || [];
      for (const track of tracks) {
        const item = { index: track.index, info: track.extra_info || "" };
        if (track.type === "AUDIO") result.audio.push(item);
        else if (track.type === "VIDEO") result.video.push(item);
        else if (track.type === "TEXT") result.text.push(item);
      }
    } catch (error) {
      this._log("tracks", error);
    }
    return result;
  }

  selectTrack(type, index) {
    const av = this._avp();
    if (!av || !av.setSelectTrack) return;
    try {
      av.setSelectTrack(type, index);
    } catch (error) {
      this._log("selectTrack", error);
    }
  }

  setDisplayMode(mode) {
    if (typeof mode === "string" && mode.indexOf("PLAYER_DISPLAY_MODE_") === 0) this._displayMode = mode;
    const av = this._avp();
    if (!av || !av.setDisplayMethod) return;
    try {
      av.setDisplayMethod(this._displayMode);
    } catch (error) {
      this._log("setDisplayMode", error);
    }
  }
}

KP.Player = new KPlayerEngine();
window.Player = KP.Player;
