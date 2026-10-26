/* KPlayer search: live channels, programme titles and the active playlist's
   Xtream VOD index. Results are capped so the overlay stays responsive on
   providers with tens of thousands of entries. */
"use strict";

const SEARCH_SCOPES = ["all", "tv", "movies", "series"];

class KPlayerSearch {
  constructor() {
    this._query = "";
    this._scope = "all";
    this._channels = [];
    this._progs = [];
    this._vod = [];
    this._vodAll = [];
    this._vodLoaded = false;
    this._vodLoading = false;
    this._vodError = "";
    this._vodErrorQuery = "";
    this._indexRequested = false;
    this._token = 0;
    this._inputTimer = null;
    this._zone = "input";
    this._row = 0;
    this._col = 0;
    this._scopeReturn = "input";
  }

  _el(id) {
    return document.getElementById(id);
  }

  _scopeIndex() {
    return Math.max(0, SEARCH_SCOPES.indexOf(this._scope));
  }

  _placeholder() {
    if (this._scope === "tv") return "Search live TV channels and programmes";
    if (this._scope === "movies") return "Search movies";
    if (this._scope === "series") return "Search series";
    return "Search channels, movies and shows";
  }

  _idleTitle() {
    if (this._scope === "tv") return "Type a name to search live TV";
    if (this._scope === "movies") return "Type a name to search movies";
    if (this._scope === "series") return "Type a name to search series";
    return "Type a name to search live TV, movies and series";
  }

  _rows() {
    return [
      { key: "channels", items: this._channels, el: this._el("search-channels") },
      { key: "vod", items: this._vod, el: this._el("search-vod") },
      { key: "progs", items: this._progs, el: this._el("search-progs") }
    ];
  }

  _navRows() {
    return this._rows().filter((row) => row.items.length > 0);
  }

  _reveal(element, row) {
    const results = this._el("search-results");
    if (!results || !element || !row) return;
    const resultRect = results.getBoundingClientRect();
    const cardRect = element.getBoundingClientRect();
    const topPad = KP.Utils.designPx(16);
    const bottomPad = KP.Utils.designPx(28);
    const sidePad = KP.Utils.designPx(12);
    if (cardRect.top < resultRect.top + topPad) results.scrollTop += cardRect.top - (resultRect.top + topPad);
    else if (cardRect.bottom > resultRect.bottom - bottomPad) {
      results.scrollTop += cardRect.bottom - (resultRect.bottom - bottomPad);
    }
    const left = element.offsetLeft;
    const width = element.offsetWidth;
    const viewLeft = row.scrollLeft;
    const viewRight = viewLeft + row.clientWidth;
    if (left < viewLeft + sidePad) row.scrollLeft = Math.max(0, left - sidePad);
    else if (left + width > viewRight - sidePad) row.scrollLeft = left + width - row.clientWidth + sidePad;
  }

  _mergeVod(items) {
    const byKey = new Map();
    (this._vodAll || []).forEach((item) => byKey.set(item.key, item));
    (items || []).forEach((item) => {
      if (!item || !item.key) return;
      byKey.set(item.key, item);
    });
    this._vodAll = Array.from(byKey.values());
  }

  _loadIndex() {
    if (this._indexRequested || this._vodLoading) return;
    this._indexRequested = true;
    this._vodLoading = true;
    this._vodError = "";
    const token = this._token;
    const requestedQuery = this._query.toLowerCase().trim();
    try {
      KP.Store.loadVodSearchIndex((error, items) => {
        if (token !== this._token) return;
        this._vodLoading = false;
        this._vodLoaded = true;
        this._vodError = error ? "Movies and shows unavailable." : "";
        this._vodErrorQuery = error ? requestedQuery : "";
        if (error) KP.Utils.logWarn("search/vod-index", error);
        this._mergeVod(items || []);
        if (KP.Shell.state.view === "search") this.render();
      });
    } catch (error) {
      this._vodLoading = false;
      this._vodLoaded = true;
      this._vodError = "Movies and shows unavailable.";
      this._vodErrorQuery = requestedQuery;
      KP.Utils.logError("search/vod-index", error);
      if (KP.Shell.state.view === "search") this.render();
    }
  }

  open() {
    clearTimeout(this._inputTimer);
    this._inputTimer = null;
    this._query = "";
    this._scope = "all";
    this._channels = [];
    this._progs = [];
    this._vod = [];
    this._zone = "input";
    this._row = 0;
    this._col = 0;
    this._scopeReturn = "input";
    this._vodLoaded = false;
    this._vodLoading = false;
    this._vodError = "";
    this._vodErrorQuery = "";
    this._indexRequested = false;
    this._token += 1;
    const activeId = KP.Store.activeId();
    this._vodAll = KP.Store.cachedVodItems().filter((item) => !activeId || item.playlistId === activeId);
    const input = this._el("search-input");
    if (input) input.value = "";
    KP.Shell.show("search");
    this.render();
    if (input && input.focus) input.focus();
  }

  returnTo() {
    KP.Shell.show("search");
    this.render();
    if (this._navRows().length) {
      this._zone = "results";
      this._renderFocus();
    } else {
      this._zone = "input";
      const input = this._el("search-input");
      if (input && input.focus) input.focus();
    }
  }

  setScope(scope) {
    if (SEARCH_SCOPES.indexOf(scope) < 0 || scope === this._scope) return;
    clearTimeout(this._inputTimer);
    this._inputTimer = null;
    this._scope = scope;
    this._row = 0;
    this._col = 0;
    this.render();
  }

  _enterScopes(from) {
    this._zone = "scopes";
    this._scopeReturn = from || "input";
    const input = this._el("search-input");
    if (input && input.blur) input.blur();
    this._renderFocus();
  }

  _leaveScopes() {
    if (this._scopeReturn === "results" && this._navRows().length) {
      this._zone = "results";
      this._row = 0;
      this._col = 0;
    } else {
      this._zone = "input";
      const input = this._el("search-input");
      if (input && input.focus) input.focus();
    }
    this._renderFocus();
  }

  _leaveResults() {
    const input = this._el("search-input");
    if (input && input.blur) input.blur();
    this._zone = "input";
    KP.Shell.back();
  }

  render() {
    const query = this._query.toLowerCase().trim();
    const idle = !query;
    const active = KP.Store ? KP.Store.active() : null;
    const dataReady = !!(KP.Store && KP.Store.hasData());
    const liveLoading = !dataReady && !!(active && active.status === "loading");
    const liveError = !dataReady && !!(active && active.status === "error");
    const showTv = this._scope === "all" || this._scope === "tv";
    const showVod = this._scope !== "tv";
    const showMovies = this._scope === "all" || this._scope === "movies";
    const showSeries = this._scope === "all" || this._scope === "series";

    document.querySelectorAll("#search-scopes .search-scope").forEach((chip) => {
      chip.classList.toggle("sel", chip.getAttribute("data-scope") === this._scope);
    });
    const input = this._el("search-input");
    if (input) input.placeholder = this._placeholder();
    const idleElement = this._el("search-idle");
    idleElement.textContent = this._idleTitle();
    idleElement.classList.toggle("hidden", !idle);
    this._el("search-results").classList.toggle("hidden", idle);

    const sectionChannels = document.querySelector('.search-section[data-sec="channels"]');
    const sectionVod = document.querySelector('.search-section[data-sec="vod"]');
    const sectionProgs = document.querySelector('.search-section[data-sec="progs"]');
    if (sectionChannels) sectionChannels.classList.toggle("hidden", !showTv);
    if (sectionVod) {
      sectionVod.classList.toggle("hidden", !showVod);
      sectionVod.textContent = this._scope === "movies"
        ? "Movies"
        : (this._scope === "series" ? "Series" : "Movies & shows");
    }
    if (sectionProgs) sectionProgs.classList.toggle("hidden", !showTv);
    this._el("search-channels").classList.toggle("hidden", !showTv);
    this._el("search-vod").classList.toggle("hidden", !showVod);
    this._el("search-progs").classList.toggle("hidden", !showTv);

    if (idle) {
      this._channels = [];
      this._progs = [];
      this._vod = [];
      this._el("search-channels").innerHTML = "";
      this._el("search-vod").innerHTML = "";
      this._el("search-progs").innerHTML = "";
      this._renderFocus();
      return;
    }

    const channels = [];
    const programmes = [];
    let channelsHtml = "";
    let programsHtml = "";
    if (showTv) {
      const all = KP.Shell.allChannels();
      for (const channel of all) {
        if (channels.length >= 50 && programmes.length >= 50) break;
        if (channels.length < 50 && channel.name.toLowerCase().indexOf(query) >= 0) {
          channels.push(channel);
          channelsHtml += `<div class="search-card" data-kind="channels" data-i="${channels.length - 1}">` +
            `${KP.Logo.box(channel, "sc-logo")}<div class="sc-name">${KP.Utils.esc(channel.name)}</div></div>`;
        }
        if (programmes.length >= 50) continue;
        const list = channel.programmes || [];
        for (const programme of list) {
          if (programme.title.toLowerCase().indexOf(query) < 0) continue;
          programmes.push({ ch: channel, p: programme });
          programsHtml += `<div class="search-card poster" data-kind="progs" data-i="${programmes.length - 1}">` +
            `<div class="sc-poster">${KP.Logo.inner(channel)}</div>` +
            `<div class="sc-title">${KP.Utils.esc(programme.title)}</div>` +
            `<div class="sc-sub">${KP.Utils.esc(channel.name)}</div></div>`;
          if (programmes.length >= 50) break;
        }
      }
    }

    const liveEpgLoading = showTv && !liveLoading && !liveError && !programmes.length &&
      !!(KP.Epg && KP.Epg.epgLoading());
    if (liveEpgLoading) {
      for (let index = 0; index < 5; index += 1) {
        programsHtml += '<div class="search-card poster sk-card" aria-hidden="true">' +
          '<div class="sc-poster sk"></div><div class="sc-title sk-line"></div>' +
          '<div class="sc-sub sk-line"></div></div>';
      }
    }
    if (query.length < 2 && this._vodError) {
      this._vodError = "";
      this._vodErrorQuery = "";
    }
    if (liveLoading) {
      for (let index = 0; index < 5; index += 1) {
        channelsHtml += '<div class="search-card sk-channel" aria-hidden="true">' +
          '<div class="sc-logo sk"></div><div class="sc-name sk"></div></div>';
        programsHtml += '<div class="search-card poster sk-card" aria-hidden="true">' +
          '<div class="sc-poster sk"></div><div class="sc-title sk-line"></div>' +
          '<div class="sc-sub sk-line"></div></div>';
      }
    }

    if (showVod && query.length >= 2 && this._vodError && query !== this._vodErrorQuery) {
      this._vodLoaded = false;
      this._indexRequested = false;
      this._vodError = "";
    }
    if (showVod && query.length >= 2 && !this._vodLoaded) this._loadIndex();
    let vod = [];
    if (showVod && query) {
      this._vodAll.forEach((item) => {
        const kindOk = (item.kind === "movie" && showMovies) || (item.kind === "series" && showSeries);
        if (kindOk && item.name && item.name.toLowerCase().indexOf(query) >= 0) vod.push(item);
      });
      vod.sort((a, b) => a.name.localeCompare(b.name));
      vod = vod.slice(0, 50);
    }
    let vodHtml = "";
    vod.forEach((item, index) => {
      const poster = item.poster
        ? `<img src="${KP.Utils.esc(item.poster)}" alt=""/>`
        : `<span class="poster-fb">${KP.Icons.inner(KP.Icons.kind(item), "ico")}</span>`;
      vodHtml += `<div class="search-card poster vod" data-kind="vod" data-i="${index}">` +
        `<div class="sc-poster">${poster}</div>` +
        `<div class="sc-title">${KP.Utils.esc(item.name)}</div>` +
        `<div class="sc-sub">${item.kind === "series" ? "Series" : "Movie"}` +
        `${item.year ? ` · ${KP.Utils.esc(item.year)}` : ""}</div></div>`;
    });
    if (showVod && !vodHtml && query.length >= 2 && this._vodLoading) {
      for (let index = 0; index < 5; index += 1) {
        vodHtml += '<div class="search-card poster sk-card"><div class="sc-poster sk"></div>' +
          '<div class="sc-title sk-line"></div><div class="sc-sub sk-line"></div></div>';
      }
    }

    this._channels = channels;
    this._progs = programmes;
    this._vod = vod;
    const liveHint = liveError ? "Live TV unavailable" : "No channels";
    this._el("search-channels").innerHTML = showTv
      ? (channelsHtml || `<div class="search-hint">${liveHint}</div>`)
      : "";
    const vodEmpty = this._scope === "movies" ? "No movies" : (this._scope === "series" ? "No series" : "No movies or shows");
    const vodHint = this._vodError
      ? "Movies and shows unavailable. Change the search to retry."
      : vodEmpty;
    this._el("search-vod").innerHTML = showVod
      ? (vodHtml || `<div class="search-hint">${vodHint}</div>`)
      : "";
    this._el("search-progs").innerHTML = showTv
      ? (programsHtml || `<div class="search-hint">${liveError ? "Live TV unavailable" : "No programmes"}</div>`)
      : "";
    this._renderFocus();
  }

  _renderFocus() {
    document.querySelectorAll("#search-scopes .search-scope").forEach((chip) => chip.classList.remove("focused"));
    document.querySelectorAll("#search-results .search-card").forEach((card) => card.classList.remove("focused"));
    document.querySelectorAll("#search-results .search-section").forEach((section) => section.classList.remove("active"));

    if (this._zone === "scopes") {
      const chips = document.querySelectorAll("#search-scopes .search-scope");
      if (chips[this._scopeIndex()]) chips[this._scopeIndex()].classList.add("focused");
      return;
    }
    if (this._zone !== "results") return;
    const rows = this._navRows();
    if (!rows.length) return;
    if (this._row >= rows.length) this._row = rows.length - 1;
    if (this._row < 0) this._row = 0;
    const row = rows[this._row];
    const cards = row.el.querySelectorAll(".search-card");
    if (!cards.length) return;
    if (this._col >= cards.length) this._col = cards.length - 1;
    if (this._col < 0) this._col = 0;
    cards[this._col].classList.add("focused");
    const section = document.querySelector(`.search-section[data-sec="${row.key}"]`);
    if (section) section.classList.add("active");
    this._reveal(cards[this._col], row.el);
  }

  _activate() {
    const rows = this._navRows();
    const row = rows[this._row];
    if (!row) return;
    const item = row.items[this._col];
    if (!item) return;
    if (row.key === "channels") KP.Playback.playChannel(item);
    else if (row.key === "progs") KP.Playback.playChannel(item.ch);
    else if (row.key === "vod" && KP.Views.voddetail) KP.Views.voddetail.open(item, "search");
  }

  handleKey(key) {
    if (this._inputTimer && (key === 13 || key === 38 || key === 40)) {
      clearTimeout(this._inputTimer);
      this._inputTimer = null;
      this.render();
    }
    if (this._zone === "scopes") {
      if (key === 37 || key === 39) {
        let index = this._scopeIndex() + (key === 39 ? 1 : -1);
        if (index < 0) index = SEARCH_SCOPES.length - 1;
        if (index >= SEARCH_SCOPES.length) index = 0;
        this.setScope(SEARCH_SCOPES[index]);
        this._renderFocus();
        return true;
      }
      if (key === 13 || key === 40) {
        this._leaveScopes();
        return true;
      }
      if (key === 10009 || key === 461) {
        this._zone = "input";
        const input = this._el("search-input");
        if (input && input.focus) input.focus();
        this._renderFocus();
        return true;
      }
      return true;
    }

    if (this._zone === "results") {
      const rows = this._navRows();
      if (key === 10009 || key === 461 || !rows.length) {
        this._leaveResults();
        return true;
      }
      if (this._row >= rows.length) this._row = rows.length - 1;
      if (key === 38) {
        if (this._row === 0) {
          this._enterScopes("results");
          return true;
        }
        this._row = Math.max(0, this._row - 1);
        this._col = 0;
      } else if (key === 40) {
        this._row = Math.min(rows.length - 1, this._row + 1);
        this._col = 0;
      } else if (key === 37) {
        this._col = Math.max(0, this._col - 1);
      } else if (key === 39) {
        this._col = Math.min(rows[this._row].items.length - 1, this._col + 1);
      } else if (key === 13) {
        this._activate();
        return true;
      } else {
        return false;
      }
      this._renderFocus();
      return true;
    }

    if (key === 10009 || key === 461) {
      this._leaveResults();
      return true;
    }
    if (key === 38) {
      this._enterScopes("input");
      return true;
    }
    if (key === 13 || key === 40) {
      if (this._navRows().length) {
        this._zone = "results";
        this._row = 0;
        this._col = 0;
        const input = this._el("search-input");
        if (input && input.blur) input.blur();
        this._renderFocus();
      }
      return true;
    }
    return false;
  }

  init() {
    const input = this._el("search-input");
    if (input) {
      input.addEventListener("input", () => {
        this._query = input.value;
        this._zone = "input";
        this._row = 0;
        this._col = 0;
        clearTimeout(this._inputTimer);
        this._inputTimer = null;
        if (!this._query.trim()) {
          this.render();
          return;
        }
        this._inputTimer = setTimeout(() => {
          this._inputTimer = null;
          if (KP.Shell.state.view === "search") this.render();
        }, 250);
      });
      input.addEventListener("focus", () => {
        if (this._zone !== "input") {
          this._zone = "input";
          this._renderFocus();
        }
      });
    }
    const scopes = this._el("search-scopes");
    if (scopes) {
      scopes.addEventListener("click", (event) => {
        let target = event.target;
        while (target && target !== scopes && !(target.classList && target.classList.contains("search-scope"))) {
          target = target.parentNode;
        }
        if (!target || target === scopes) return;
        const scope = target.getAttribute("data-scope");
        if (!scope) return;
        const field = this._el("search-input");
        if (field && field.blur) field.blur();
        this._zone = "scopes";
        this.setScope(scope);
        this._renderFocus();
      });
    }
    const results = this._el("search-results");
    if (results) {
      results.addEventListener("click", (event) => {
        let target = event.target;
        while (target && target !== results && !(target.classList && target.classList.contains("search-card"))) {
          target = target.parentNode;
        }
        if (!target || target === results) return;
        const kind = target.getAttribute("data-kind");
        const index = parseInt(target.getAttribute("data-i"), 10);
        if (!kind || !(index >= 0)) return;
        const rows = this._navRows();
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
          if (rows[rowIndex].key !== kind) continue;
          this._zone = "results";
          this._row = rowIndex;
          this._col = Math.min(index, rows[rowIndex].items.length - 1);
          this._renderFocus();
          this._activate();
          return;
        }
      });
    }
  }
}

KP.Views = KP.Views || {};
KP.Views.search = new KPlayerSearch();
