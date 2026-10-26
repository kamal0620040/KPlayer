/* KPlayer PIN overlay: set, confirm and verify the four digit parental PIN. */
"use strict";

const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "back"];

class KPlayerPin {
  constructor() {
    this._open = false;
    this._mode = "";
    this._value = "";
    this._temp = "";
    this._padIdx = 1;
    this._onDone = null;
  }

  _el(id) {
    return document.getElementById(id);
  }

  _title() {
    if (this._mode === "verify") return "Enter PIN";
    if (this._mode === "set2") return "Repeat the PIN";
    return "Set a PIN";
  }

  _render() {
    let dots = "";
    for (let index = 0; index < 4; index += 1) {
      dots += `<span class="pin-dot${index < this._value.length ? " filled" : ""}"></span>`;
    }
    this._el("pin-dots").innerHTML = dots;
    this._el("pin-pad").innerHTML = PIN_KEYS.map((key, index) =>
      `<div class="pin-key${key === "back" ? " back" : ""}${index === this._padIdx ? " focused" : ""}">${
        key === "back" ? KP.Icons.inner("back", "key-ico") : KP.Utils.esc(key)
      }</div>`
    ).join("");
  }

  open(mode, onDone) {
    this._open = true;
    this._mode = mode;
    this._value = "";
    this._temp = "";
    this._padIdx = 1;
    this._onDone = typeof onDone === "function" ? onDone : null;
    this._el("pin-title").textContent = this._title();
    this._el("pin-msg").textContent = "";
    this._el("pin-overlay").classList.remove("hidden");
    this._render();
  }

  close() {
    this._open = false;
    this._el("pin-overlay").classList.add("hidden");
  }

  _complete() {
    const callback = this._onDone;
    if (this._mode === "set1") {
      this._temp = this._value;
      this._mode = "set2";
      this._value = "";
      this._el("pin-title").textContent = this._title();
      this._el("pin-msg").textContent = "";
      this._render();
      return;
    }
    if (this._mode === "set2") {
      if (this._value === this._temp) {
        KP.Store.setSetting("parentalPin", this._value);
        this.close();
        if (callback) callback(true);
        return;
      }
      this._mode = "set1";
      this._value = "";
      this._temp = "";
      this._el("pin-title").textContent = this._title();
      this._el("pin-msg").textContent = "PINs did not match. Start again.";
      this._render();
      return;
    }
    if (this._mode === "verify") {
      if (KP.Store.checkPin(this._value)) {
        this.close();
        if (callback) callback(true);
        return;
      }
      this._value = "";
      this._el("pin-msg").textContent = "Wrong PIN";
      this._render();
    }
  }

  _press(key) {
    if (key === "back") this._value = this._value.slice(0, -1);
    else if (key === "C") this._value = "";
    else if (/^[0-9]$/.test(key) && this._value.length < 4) this._value += key;
    this._render();
    if (this._value.length === 4) this._complete();
  }

  _digitFromEvent(event) {
    if (event.key && /^[0-9]$/.test(event.key)) return event.key;
    if (event.keyCode >= 48 && event.keyCode <= 57) return String(event.keyCode - 48);
    if (event.keyCode >= 96 && event.keyCode <= 105) return String(event.keyCode - 96);
    return "";
  }

  handleKey(event) {
    const key = event.keyCode;
    const digit = this._digitFromEvent(event);
    if (digit) {
      this._press(digit);
      return true;
    }
    if (key === 8) {
      this._press("back");
      return true;
    }
    if (key === 38) this._padIdx = Math.max(0, this._padIdx - 3);
    else if (key === 40) this._padIdx = Math.min(11, this._padIdx + 3);
    else if (key === 37) this._padIdx = Math.max(0, this._padIdx - 1);
    else if (key === 39) this._padIdx = Math.min(11, this._padIdx + 1);
    else if (key === 13) {
      if (PIN_KEYS[this._padIdx]) this._press(PIN_KEYS[this._padIdx]);
      return true;
    } else if (key === 10009 || key === 461) {
      const callback = this._onDone;
      this.close();
      if (callback) callback(false);
      return true;
    } else {
      return false;
    }
    this._render();
    return true;
  }

  guardGroup(name, proceed) {
    if (KP.Store.isGroupLocked(name)) {
      this.open("verify", (ok) => {
        if (ok) proceed();
      });
    } else {
      proceed();
    }
  }

  isOpen() {
    return this._open;
  }

  init() {
    const pad = this._el("pin-pad");
    if (!pad) return;
    pad.addEventListener("click", (event) => {
      let target = event.target;
      while (target && target !== pad && !(target.classList && target.classList.contains("pin-key"))) {
        target = target.parentNode;
      }
      if (!target || target === pad) return;
      const keys = Array.from(pad.children);
      const index = keys.indexOf(target);
      if (index < 0) return;
      this._padIdx = index;
      if (PIN_KEYS[index]) this._press(PIN_KEYS[index]);
    });
  }
}

KP.Views = KP.Views || {};
const kplayerPin = new KPlayerPin();
KP.Views.pin = kplayerPin;
