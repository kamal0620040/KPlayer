/* Mock of Samsung webapis.avplay for headless QA.
   Injected via page.evaluateOnNewDocument BEFORE any app script runs.
   Behaviour:
   - open(url) resets; prepareAsync emits onbufferingstart/progress/complete then success (~720ms)
   - play()/resume() start a 500ms tick: playhead += 500 + oncurrentplaytime
   - pause() stops the tick, state PAUSED
   - URLs containing "fail"     -> prepareAsync failure (after retry variant also fails)
   - URLs containing "complete" -> onstreamcompleted after playhead > 5000 (stream ended)
   - getTrackInfo returns 2 audio tracks (eng/hin) + 1 video track
   - window.__AV exposes driver controls: freeze(), failPrepare(), complete(), logs, selects()
*/
(function mockAvplayBoot() {
  "use strict";
  if (window.webapis && window.webapis.avplay) return;
  const logs = [];
  const av = {
    url: "",
    state: "NONE",
    playhead: 0,
    playing: false,
    frozen: false,
    failPrepare: false,
    completed: false,
    tick: null,
    bufTimers: [],
    completeTimer: null,
    listener: null,
    selects: []
  };
  function emit(name, arg) {
    try {
      if (av.listener && typeof av.listener[name] === "function") av.listener[name](arg);
    } catch (error) {
      logs.push(["emit-error", name, String(error && error.message || error)]);
    }
  }
  function clearStreamTimers() {
    if (av.tick) { clearInterval(av.tick); av.tick = null; }
    av.bufTimers.forEach(clearTimeout);
    av.bufTimers = [];
    if (av.completeTimer) { clearTimeout(av.completeTimer); av.completeTimer = null; }
  }
  function startTicking() {
    if (av.tick) return;
    av.tick = setInterval(function () {
      if (!av.playing || av.frozen) return;
      av.playhead += 500;
      emit("oncurrentplaytime", av.playhead);
      if ((av.completed || /complete/i.test(av.url)) && av.playhead > 5000) emit("onstreamcompleted");
    }, 500);
  }
  function schedulePrepare(success, failure) {
    clearStreamTimers();
    av.playhead = 0;
    av.playing = false;
    av.state = "IDLE";
    if (av.failPrepare || /fail/i.test(av.url)) {
      av.bufTimers.push(setTimeout(function () {
        av.state = "NONE";
        if (failure) failure({ name: "PlayerError", message: "Mock prepare failed for " + av.url });
      }, 120));
      return;
    }
    av.bufTimers.push(setTimeout(function () {
      av.state = "READY";
      emit("onbufferingstart");
    }, 80));
    [25, 55, 85].forEach(function (pct, i) {
      av.bufTimers.push(setTimeout(function () { emit("onbufferingprogress", pct); }, 200 + i * 150));
    });
    av.bufTimers.push(setTimeout(function () {
      emit("onbufferingcomplete");
      if (success) success();
    }, 720));
  }
  window.webapis = {
    avplay: {
      open: function (url) {
        logs.push(["open", String(url || "")]);
        av.url = String(url || "");
        av.state = "IDLE";
        av.playhead = 0;
        av.playing = false;
        av.frozen = false;
        av.completed = false;
        clearStreamTimers();
      },
      setListener: function (l) { av.listener = l; },
      unsetListener: function () { av.listener = null; },
      attachShowContainer: function () {},
      setDisplayRect: function () {},
      setDisplayMethod: function () {},
      setBufferingParam: function () {},
      setSpeed: function () {},
      setStreamingProperty: function () {},
      addStreamingProperty: function () {},
      prepare: function (cb) { schedulePrepare(cb); },
      prepareAsync: function (success, failure) {
        logs.push(["prepareAsync", av.url]);
        schedulePrepare(success, failure);
      },
      play: function () {
        logs.push(["play", av.url]);
        av.playing = true;
        av.state = "PLAYING";
        startTicking();
      },
      pause: function () {
        logs.push(["pause"]);
        av.playing = false;
        av.state = "PAUSED";
      },
      resume: function () {
        logs.push(["resume"]);
        av.playing = true;
        av.state = "PLAYING";
        startTicking();
      },
      stop: function () {
        logs.push(["stop"]);
        av.playing = false;
        clearStreamTimers();
        av.state = "IDLE";
      },
      close: function () {
        logs.push(["close"]);
        clearStreamTimers();
        av.state = "NONE";
        av.playing = false;
      },
      seekTo: function (ms, ok) {
        logs.push(["seekTo", ms]);
        av.playhead = Math.max(0, Number(ms) || 0);
        if (ok) ok();
      },
      jumpForward: function (ms) { logs.push(["jumpForward", ms]); },
      jumpBackward: function (ms) { logs.push(["jumpBackward", ms]); },
      getDuration: function () { return av.url && /\.m3u8|\.ts/i.test(av.url) ? 0 : 3600000; },
      getCurrentTime: function () { return av.playhead; },
      getState: function () { return av.state; },
      getTrackInfo: function () {
        return [
          { type: "AUDIO", index: 0, extra_info: '{"track_language":"eng","track_name":"English 5.1"}' },
          { type: "AUDIO", index: 1, extra_info: '{"track_language":"hin","track_name":"Hindi"}' },
          { type: "VIDEO", index: 0, extra_info: '{"width":1920,"height":1080}' }
        ];
      },
      getCurrentStreamInfo: function () { return '{"width":1920,"height":1080}'; },
      setSelectTrack: function (type, index) {
        logs.push(["setSelectTrack", type, index]);
        av.selects.push([type, index]);
      },
      setSilentSubtitle: function () {}
    }
  };
  window.__AV = {
    freeze: function (v) { av.frozen = !!v; },
    failPrepare: function (v) { av.failPrepare = !!v; },
    complete: function (v) { av.completed = !!v; },
    url: function () { return av.url; },
    state: function () { return av.state; },
    playhead: function () { return av.playhead; },
    selects: function () { return av.selects.slice(); },
    logs: logs
  };
})();
