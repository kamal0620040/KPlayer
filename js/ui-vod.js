/* KPlayer VOD browser and detail screen: Xtream movie/series categories,
   lazy category pages, episode lists, progress and My list. */
"use strict";

const VOD_COLUMNS = 6;

class KPlayerVodBrowse {
  constructor() {
    this._mode = "movies";
    this._cats = [];
    this._catIdx = 0;
    this._items = [];
    this._idx = 0;
    this._zone = "cats";
    this._loadingCats = false;
    this._loading = false;
    this._catsRetry = false;
    this._error = "";
    this._token = 0;
  }

  _el(id) {
    return document.getElementById(id);
  }

  _title() {
    if (this._mode === "movies") return "Movies";
    if (this._mode === "shows") return "Shows";
    return "My list";
  }

  _poster(item) {
    if (item && item.poster) return `<img src="${KP.Utils.esc(item.poster)}" alt=""/>`;
    return `<span class="poster-fb">${KP.Icons.inner(KP.Icons.kind(item), "ico")}</span>`;
  }

  _meta(item) {
    const rating = parseFloat(item && item.rating);
    const parts = [];
    if (item.year) parts.push(KP.Utils.esc(item.year));
    if (rating > 0) {
      parts.push(`<span class="rating">${KP.Icons.inner("star", "rating-ico")}${KP.Utils.esc(item.rating)}</span>`);
    }
    parts.push(item.kind === "series" ? "Series" : "Movie");
    return parts.join('<span class="vod-meta-sep"> · </span>');
  }

  _buildCats() {
    if (this._mode === "mylist") {
      const all = KP.Store.cachedVodItems().filter((item) => KP.Store.inMyList(item.key));
      this._cats = [{ key: "mylist", kind: "mylist", name: "My list", items: all }];
      this._catIdx = 0;
      this._items = all;
      return;
    }
    const source = KP.Store.vodCats();
    this._cats = this._mode === "movies" ? source.movies : source.series;
    if (this._catIdx >= this._cats.length) this._catIdx = 0;
    this._items = [];
  }

  open(mode) {
    this._mode = mode;
    this._catIdx = 0;
    this._idx = 0;
    this._zone = "cats";
    this._items = [];
    this._cats = [];
    this._error = "";
    this._loadingCats = false;
    this._loading = false;
    this._catsRetry = false;
    this._token += 1;
    if (mode === "mylist") {
      this._buildCats();
      KP.Shell.show("vod");
      this.render();
      return;
    }

    const playlist = KP.Store.active();
    if (!playlist || playlist.type !== "xtream") {
      this._error = "Movies and shows need an active Xtream Codes playlist.";
      KP.Shell.show("vod");
      this.render();
      return;
    }
    const playlistId = playlist.id;
    const token = this._token;
    this._loadingCats = true;
    KP.Shell.show("vod");
    this.render();
    KP.Store.loadVodCatsAll((error) => {
      if (token !== this._token || KP.Shell.state.view !== "vod") return;
      if (KP.Store.activeId() !== playlistId) return;
      this._loadingCats = false;
      this._buildCats();
      if (this._cats.length) {
        this._catsRetry = false;
        this._loadSelected(false);
      } else {
        this._catsRetry = !!error;
        this._error = error
          ? "Could not load categories. Press OK to retry."
          : "No categories found for this playlist.";
        this.render();
      }
    });
  }

  _loadSelected(goGrid) {
    const category = this._cats[this._catIdx];
    this._token += 1;
    const token = this._token;
    if (!category) {
      this._items = [];
      this._error = this._cats.length ? "Select a category" : (this._error || "No categories");
      this.render();
      return;
    }
    if (category.items) {
      this._items = category.items;
      this._idx = 0;
      this._error = "";
      if (goGrid) this._zone = "grid";
      this.render();
      return;
    }
    if (goGrid) this._zone = "cats";
    this._loading = true;
    this._items = [];
    this._idx = 0;
    this._error = "";
    this.render();
    KP.Store.loadVodCategory(category, (error, items) => {
      if (token !== this._token) return;
      this._loading = false;
      if (error) {
        this._error = "Could not load this category. Press OK to retry.";
        this._items = [];
        this._zone = "cats";
      } else {
        this._items = items || [];
        this._error = "";
        if (goGrid && this._items.length) this._zone = "grid";
      }
      if (KP.Shell.state.view === "vod") this.render();
    });
  }

  _emptyMessage() {
    if (this._error) return this._error;
    if (!this._cats.length) return "Nothing to show.";
    const category = this._cats[this._catIdx];
    if (this._zone === "cats" && category && category.items) return "Nothing here yet";
    if (this._zone === "cats" && !this._items.length) return "Press OK to open this category";
    return "Nothing here yet";
  }

  _applyShift() {
    const catBox = document.querySelector(".vod-cats");
    const catList = this._el("vod-cat-list");
    const catElement = catList.children[this._catIdx];
    if (!this._loadingCats && catElement) {
      catList.style.transform = `translateY(${-KP.Utils.centerShift(catBox, catList, catElement)}px)`;
    } else {
      catList.style.transform = "";
    }
    const grid = this._el("vod-grid");
    const cards = grid.children;
    const loadingItems = !this._items.length && (this._loading || this._loadingCats);
    if (loadingItems) {
      grid.style.transform = "";
      return;
    }
    if (this._zone === "grid") {
      const scroller = document.querySelector(".vod-scroll");
      grid.style.transform = cards[this._idx] && scroller
        ? `translateY(${-KP.Utils.centerShift(scroller, grid, cards[this._idx])}px)`
        : "";
    } else {
      grid.style.transform = "";
    }
    if (KP.Shell && KP.Shell.refreshScrollFades) KP.Shell.refreshScrollFades();
  }

  _renderFocus() {
    const catElements = this._el("vod-cat-list").children;
    for (let index = 0; index < catElements.length; index += 1) {
      if (catElements[index].classList.contains("sk-cat")) {
        catElements[index].classList.remove("focused", "sel");
        continue;
      }
      catElements[index].classList.toggle("focused", this._zone === "cats" && index === this._catIdx);
      catElements[index].classList.toggle("sel", index === this._catIdx && this._zone !== "cats");
    }
    const cards = this._el("vod-grid").children;
    for (let index = 0; index < cards.length; index += 1) {
      cards[index].classList.toggle("focused", this._zone === "grid" && index === this._idx);
    }
    this._applyShift();
  }

  render() {
    const modeTitle = this._title();
    const current = this._cats[this._catIdx];
    const catName = current && current.name && current.name !== modeTitle ? current.name : "";
    this._el("vod-title").innerHTML = `<span class="vod-title-mode">${KP.Utils.esc(modeTitle)}</span>` +
      (catName ? `<span class="vod-title-sep">/</span><span class="vod-title-cat">${KP.Utils.esc(catName)}</span>` : "");

    const loadingItems = !this._items.length && (this._loading || this._loadingCats);
    let catsHtml = "";
    if (this._loadingCats && !this._cats.length) {
      const box = document.querySelector(".vod-cats");
      const count = Math.max(9, Math.ceil((((box ? box.clientHeight : KP.Utils.designPx(1026)) - KP.Utils.designPx(54))) / KP.Utils.designPx(65)));
      for (let index = 0; index < count; index += 1) {
        catsHtml += '<div class="vod-cat sk-cat"><span class="sk-cat-name sk"></span><span class="sk-cat-count sk"></span></div>';
      }
    } else {
      this._cats.forEach((category, index) => {
        let className = "vod-cat";
        if (index === this._catIdx) className += this._zone === "cats" ? " focused" : " sel";
        catsHtml += `<div class="${className}" title="${KP.Utils.esc(category.name)}">` +
          `<span class="vod-cat-name">${KP.Utils.esc(category.name)}</span>` +
          `<span class="g-count">${category.items ? category.items.length : ""}</span></div>`;
      });
    }
    this._el("vod-cat-list").innerHTML = catsHtml;

    let gridHtml = "";
    if (loadingItems) {
      for (let index = 0; index < 12; index += 1) {
        gridHtml += '<div class="vod-card sk-card"><div class="vod-poster sk"></div>' +
          '<div class="vod-card-name sk-line sk"></div><div class="vod-card-meta sk-line sk"></div></div>';
      }
    } else {
      this._items.forEach((item, index) => {
        gridHtml += `<div class="vod-card${this._zone === "grid" && this._idx === index ? " focused" : ""}">` +
          `<div class="vod-poster">${this._poster(item)}</div>` +
          `<div class="vod-card-name">${KP.Utils.esc(item.name)}</div>` +
          `<div class="vod-card-meta">${this._meta(item)}</div></div>`;
      });
    }
    this._el("vod-grid").innerHTML = gridHtml;
    document.querySelector(".vod-scroll").classList.toggle("hidden", !this._items.length && !loadingItems);
    const empty = this._el("vod-empty");
    empty.classList.toggle("hidden", loadingItems || this._items.length > 0);
    empty.classList.toggle("error", !!this._error);
    if (!loadingItems && !this._items.length) empty.textContent = this._emptyMessage();
    this._renderFocus();
  }

  _columns() {
    const grid = this._el("vod-grid");
    if (!grid || !grid.children.length) return VOD_COLUMNS;
    const top = grid.children[0].offsetTop;
    let count = 0;
    for (let index = 0; index < grid.children.length; index += 1) {
      if (grid.children[index].offsetTop !== top) break;
      count += 1;
    }
    return Math.max(1, count);
  }

  _openDetail() {
    const item = this._items[this._idx];
    if (item && KP.Views.voddetail) KP.Views.voddetail.open(item, "vod");
  }

  handleKey(key) {
    if (key === 10009 || key === 461) {
      KP.Shell.back();
      return true;
    }
    if (this._zone === "cats") {
      if (!this._cats.length) {
        if (this._catsRetry && (key === 13 || key === 39)) this.open(this._mode);
        return true;
      }
      if (key === 38 || key === 40) {
        this._catIdx = Math.max(0, Math.min(this._cats.length - 1, this._catIdx + (key === 40 ? 1 : -1)));
        this._token += 1;
        this._items = [];
        this._idx = 0;
        this._error = "";
        this.render();
      } else if (key === 39 || key === 13) {
        this._loadSelected(true);
      }
      return true;
    }
    const columns = this._columns();
    if (key === 38) this._idx = Math.max(0, this._idx - columns);
    else if (key === 40) this._idx = Math.min(Math.max(0, this._items.length - 1), this._idx + columns);
    else if (key === 37) {
      if (this._idx % columns === 0) this._zone = "cats";
      else this._idx -= 1;
    } else if (key === 39) this._idx = Math.min(Math.max(0, this._items.length - 1), this._idx + 1);
    else if (key === 13) {
      this._openDetail();
      return true;
    } else {
      return false;
    }
    this._renderFocus();
    return true;
  }

  refresh() {
    if (KP.Shell.state.view !== "vod") return;
    this.render();
  }

  reset() {
    this._token += 1;
    this._cats = [];
    this._items = [];
    this._catIdx = 0;
    this._idx = 0;
    this._error = "";
    this._loading = false;
    this._loadingCats = false;
    this._catsRetry = false;
  }

  init() {
    const cats = this._el("vod-cat-list");
    if (cats) {
      cats.addEventListener("click", (event) => {
        let target = event.target;
        while (target && target !== cats && !(target.classList && target.classList.contains("vod-cat"))) {
          target = target.parentNode;
        }
        if (!target || target === cats || target.classList.contains("sk-cat")) return;
        const index = Array.from(cats.children).indexOf(target);
        if (index < 0 || index >= this._cats.length) return;
        this._catIdx = index;
        this._zone = "cats";
        this._loadSelected(true);
      });
    }
    const grid = this._el("vod-grid");
    if (grid) {
      grid.addEventListener("click", (event) => {
        let target = event.target;
        while (target && target !== grid && !(target.classList && target.classList.contains("vod-card"))) {
          target = target.parentNode;
        }
        if (!target || target === grid || target.classList.contains("sk-card")) return;
        const index = Array.from(grid.children).indexOf(target);
        if (index < 0 || index >= this._items.length) return;
        this._idx = index;
        this._zone = "grid";
        this._openDetail();
      });
    }
  }
}

class KPlayerVodDetail {
  constructor() {
    this._item = null;
    this._episodes = [];
    this._zone = "actions";
    this._actIdx = 0;
    this._epIdx = 0;
    this._season = 0;
    this._seasons = [];
    this._error = "";
    this._loading = false;
    this._loadingInfo = false;
    this._episodesRetry = false;
    this._infoError = "";
    this._from = "vod";
    this._acts = [];
  }

  _el(id) {
    return document.getElementById(id);
  }

  _poster(item) {
    if (item && item.poster) return `<img src="${KP.Utils.esc(item.poster)}" alt=""/>`;
    return `<span class="poster-fb">${KP.Icons.inner(KP.Icons.kind(item), "ico")}</span>`;
  }

  _meta(item) {
    const rating = parseFloat(item && item.rating);
    const parts = [];
    if (item.year) parts.push(KP.Utils.esc(item.year));
    if (rating > 0) {
      parts.push(`<span class="rating">${KP.Icons.inner("star", "rating-ico")}${KP.Utils.esc(item.rating)}</span>`);
    }
    if (item.genre) parts.push(KP.Utils.esc(item.genre));
    parts.push(item.kind === "series" ? "Series" : "Movie");
    return parts.join('<span class="vod-meta-sep"> · </span>');
  }

  open(item, from) {
    if (!item) return;
    this._item = item;
    this._episodes = item.kind === "series" && item._seriesLoaded ? (item._seriesEpisodes || []) : [];
    this._zone = "actions";
    this._actIdx = 0;
    this._epIdx = 0;
    this._season = 0;
    this._seasons = [];
    this._error = "";
    this._infoError = "";
    this._episodesRetry = false;
    this._loading = !!(item.kind === "series" && item.seriesId && !item._seriesLoaded);
    this._loadingInfo = !!(item.kind === "movie" && !item._infoLoaded);
    this._from = from === "search" ? "search" : "vod";
    KP.Shell.show("voddetail");
    this.render();
    if (item.kind === "movie") {
      if (this._loadingInfo) {
        KP.Store.vodInfo(item, (error) => {
          if (this._item !== item) return;
          this._loadingInfo = false;
          if (error) this._infoError = error.message || "";
          this.render();
        });
      }
    } else if (item.kind === "series") {
      if (!item.seriesId) {
        this._loading = false;
        this._error = "Episodes are only available from Xtream Codes playlists.";
        this.render();
        return;
      }
      KP.Store.seriesInfo(item, (error, info) => {
        if (this._item !== item) return;
        this._loading = false;
        if (error) {
          this._episodesRetry = true;
          this._error = "Could not load episodes. Press OK to retry.";
        } else if (info) {
          this._episodesRetry = false;
          this._episodes = info.episodes || [];
          if (!this._episodes.length) this._error = "No episodes listed for this show.";
        }
        this.render();
      });
    }
  }

  _syncSeasons() {
    const seasons = [];
    this._episodes.forEach((episode) => {
      const season = parseInt(episode.season, 10) || 1;
      if (seasons.indexOf(season) < 0) seasons.push(season);
    });
    seasons.sort((a, b) => a - b);
    this._seasons = seasons;
    if (this._seasons.indexOf(this._season) < 0) this._season = this._seasons.length ? this._seasons[0] : 0;
  }

  _seasonEpisodes() {
    return this._episodes.filter((episode) => (parseInt(episode.season, 10) || 1) === this._season);
  }

  _revealSeason() {
    const box = this._el("vd-seasons");
    if (!box) return;
    const focused = box.querySelector(".vd-season.focused");
    if (!focused) return;
    const left = focused.offsetLeft;
    const width = focused.offsetWidth;
    const pad = KP.Utils.designPx(12);
    if (left < box.scrollLeft + pad) box.scrollLeft = Math.max(0, left - pad);
    else if (left + width > box.scrollLeft + box.clientWidth - pad) {
      box.scrollLeft = left + width - box.clientWidth + pad;
    }
  }

  render() {
    const item = this._item;
    if (!item) return;
    this._syncSeasons();
    this._el("vd-poster").innerHTML = this._poster(item);
    this._el("vd-title").textContent = item.name;
    this._el("vd-meta").innerHTML = this._meta(item);
    const desc = this._el("vd-desc");
    if ((this._loading || this._loadingInfo) && !item.plot) {
      desc.classList.add("sk-desc");
      desc.innerHTML = '<span class="sk"></span><span class="sk"></span>' +
        '<span class="sk"></span><span class="sk"></span>';
    } else {
      desc.classList.remove("sk-desc");
      desc.textContent = item.plot || (this._infoError ? "Description unavailable." : "No description available.");
    }

    const progress = KP.Store.getProgress(item.key);
    const actions = [];
    if (progress > 0) actions.push({ id: "resume", label: "Resume" });
    let playLabel = "Play";
    const seasonEpisodes = this._seasonEpisodes();
    const playBusy = item.kind === "series" && this._loading;
    if (!playBusy && item.kind === "series" && seasonEpisodes.length) {
      playLabel = `Play S${seasonEpisodes[0].season} E${seasonEpisodes[0].episode}`;
    }
    actions.push({ id: "play", label: playLabel, busy: playBusy });
    actions.push({ id: "mylist", label: KP.Store.inMyList(item.key) ? "Remove from My list" : "Add to My list" });
    this._acts = actions;
    if (this._zone === "actions") this._actIdx = Math.max(0, Math.min(this._actIdx, actions.length - 1));
    this._el("vd-actions").innerHTML = actions.map((action, index) =>
      `<span class="vd-btn${this._zone === "actions" && index === this._actIdx ? " focused" : ""}` +
      `${action.busy ? " busy" : ""}" data-act="${action.id}" data-i="${index}">` +
      `${action.busy ? '<span class="spinner"></span>' : ""}${KP.Utils.esc(action.label)}</span>`
    ).join("");

    const showSeasons = item.kind === "series" && this._seasons.length > 1;
    this._el("vd-seasons").innerHTML = showSeasons
      ? this._seasons.map((season) => {
        const classes = ["vd-season"];
        if (season === this._season) classes.push("sel");
        if (this._zone === "seasons" && season === this._season) classes.push("focused");
        return `<span class="${classes.join(" ")}" data-season="${season}">Season ${season}</span>`;
      }).join("")
      : "";
    this._el("vd-seasons").classList.toggle("hidden", !showSeasons);

    if (this._zone === "episodes") {
      this._epIdx = Math.max(0, Math.min(this._epIdx, seasonEpisodes.length - 1));
    }
    let episodesHtml = "";
    if (this._loading) {
      episodesHtml += '<div class="vd-ep-head">Episodes</div>';
      for (let index = 0; index < 5; index += 1) {
        episodesHtml += '<div class="vd-ep sk-ep"><span class="vd-ep-num sk"></span>' +
          '<span class="vd-ep-name sk"></span><span class="vd-ep-dur sk"></span></div>';
      }
    } else if (seasonEpisodes.length) {
      episodesHtml += '<div class="vd-ep-head">Episodes</div>';
      seasonEpisodes.forEach((episode, index) => {
        episodesHtml += `<div class="vd-ep${this._zone === "episodes" && index === this._epIdx ? " focused" : ""}" data-ep="${index}">` +
          `<span class="vd-ep-num">S${episode.season} E${episode.episode}</span>${KP.Utils.esc(episode.title || "")}` +
          `<span class="vd-ep-dur">${KP.Utils.esc(episode.duration || "")}</span></div>`;
      });
    } else if (item.kind === "series" && this._error) {
      episodesHtml = `<div class="vd-ep-head">Episodes</div><div class="vd-note">${KP.Utils.esc(this._error)}</div>`;
    }
    this._el("vd-episodes").innerHTML = episodesHtml;
    if (this._zone === "seasons") this._revealSeason();
    if (this._zone === "episodes") this._revealEpisode();
  }

  _revealEpisode() {
    const list = this._el("vd-episodes");
    if (!list) return;
    const focused = list.querySelector(".vd-ep.focused");
    if (!focused) return;
    const head = list.querySelector(".vd-ep-head");
    const headHeight = head ? head.offsetHeight : 0;
    const top = focused.offsetTop;
    const bottom = top + focused.offsetHeight;
    if (top < list.scrollTop + headHeight) {
      list.scrollTop = KP.Utils.snapPixels(Math.max(0, top - headHeight), list);
    } else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = KP.Utils.snapPixels(bottom - list.clientHeight, list);
    }
  }

  _play(resume) {
    const item = this._item;
    if (!item) return;
    if (item.kind === "series" && this._loading) return;
    if (item.kind === "series" && this._episodesRetry) {
      this.open(item, this._from);
      return;
    }
    if (item.kind === "series") {
      const seasonEpisodes = this._seasonEpisodes();
      if (!seasonEpisodes.length) {
        this._error = this._error || "No episodes are available for this show.";
        this.render();
        return;
      }
      KP.Playback.playVod(item, seasonEpisodes[0], !!resume, this._episodes);
      return;
    }
    KP.Playback.playVod(item, null, !!resume, this._episodes);
  }

  _activateAction() {
    const action = this._acts[this._actIdx];
    if (!action) return;
    if (action.id === "mylist") {
      KP.Store.toggleMyList(this._item.key);
      this.render();
      return;
    }
    this._play(action.id === "resume");
  }

  restore() {
    if (!this._item) {
      KP.Views.vod.open("movies");
      return;
    }
    KP.Shell.show("voddetail");
    this.render();
  }

  _return() {
    KP.Shell.back();
  }

  handleKey(key) {
    if (!this._item) {
      KP.Views.vod.open("movies");
      return true;
    }
    if (this._zone === "actions") {
      if (key === 37) this._actIdx = Math.max(0, this._actIdx - 1);
      else if (key === 39) this._actIdx = Math.min(this._acts.length - 1, this._actIdx + 1);
      else if (key === 40 && this._item.kind === "series" && this._episodes.length) {
        if (this._seasons.length > 1) {
          this._zone = "seasons";
        } else {
          this._zone = "episodes";
          this._epIdx = 0;
        }
      } else if (key === 13) {
        this._activateAction();
        return true;
      } else if (key === 10009 || key === 461) {
        this._return();
        return true;
      } else {
        return false;
      }
      this.render();
      return true;
    }
    if (this._zone === "seasons") {
      if (key === 37 || key === 39) {
        const current = this._seasons.indexOf(this._season);
        const step = key === 39 ? 1 : -1;
        this._season = this._seasons[(current + step + this._seasons.length) % this._seasons.length];
        this._epIdx = 0;
      } else if (key === 40 || key === 13) {
        this._zone = "episodes";
        this._epIdx = 0;
      } else if (key === 38 || key === 10009 || key === 461) {
        this._zone = "actions";
      } else {
        return false;
      }
      this.render();
      return true;
    }
    const seasonEpisodes = this._seasonEpisodes();
    if (key === 38) {
      if (this._epIdx === 0) this._zone = this._seasons.length > 1 ? "seasons" : "actions";
      else this._epIdx -= 1;
    } else if (key === 40) {
      this._epIdx = Math.min(seasonEpisodes.length - 1, this._epIdx + 1);
    } else if (key === 13) {
      const episode = seasonEpisodes[this._epIdx];
      if (episode) KP.Playback.playVod(this._item, episode, false, this._episodes);
      return true;
    } else if (key === 10009 || key === 461) {
      this._zone = "actions";
    } else {
      return false;
    }
    this.render();
    return true;
  }

  init() {
    const actions = this._el("vd-actions");
    if (actions) {
      actions.addEventListener("click", (event) => {
        let target = event.target;
        while (target && target !== actions && !(target.classList && target.classList.contains("vd-btn"))) {
          target = target.parentNode;
        }
        if (!target || target === actions) return;
        const index = parseInt(target.getAttribute("data-i"), 10);
        if (!(index >= 0)) return;
        this._zone = "actions";
        this._actIdx = index;
        this._activateAction();
      });
    }
    const seasons = this._el("vd-seasons");
    if (seasons) {
      seasons.addEventListener("click", (event) => {
        let target = event.target;
        while (target && target !== seasons && !(target.classList && target.classList.contains("vd-season"))) {
          target = target.parentNode;
        }
        if (!target || target === seasons) return;
        const season = parseInt(target.getAttribute("data-season"), 10);
        if (!(season > 0)) return;
        this._season = season;
        this._epIdx = 0;
        this._zone = "seasons";
        this.render();
      });
    }
    const episodes = this._el("vd-episodes");
    if (episodes) {
      episodes.addEventListener("click", (event) => {
        let target = event.target;
        while (target && target !== episodes && !(target.classList && target.classList.contains("vd-ep"))) {
          target = target.parentNode;
        }
        if (!target || target === episodes) return;
        const index = parseInt(target.getAttribute("data-ep"), 10);
        if (!(index >= 0)) return;
        const episode = this._seasonEpisodes()[index];
        if (episode) KP.Playback.playVod(this._item, episode, false, this._episodes);
      });
    }
  }
}

KP.Views = KP.Views || {};
KP.Views.vod = new KPlayerVodBrowse();
KP.Views.voddetail = new KPlayerVodDetail();
