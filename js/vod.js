/* KPlayer VOD: Xtream movie/series categories, lazy category pages, series
   episodes and the background search index. All caches are per playlist and
   stay in memory so switching categories feels instant on a TV. */
"use strict";

class KPlayerVod {
  _log(context, error) {
    KP.Utils.logWarn(`vod/${context}`, error);
  }

  _finish(done, error, value) {
    if (typeof done !== "function") return;
    try {
      done(error, value);
    } catch (callbackError) {
      KP.Utils.logError("vod/callback", callbackError);
    }
  }

  _activePlaylist() {
    return KP.Store ? KP.Store.active() : null;
  }

  _getPlaylist(id) {
    return KP.Store ? KP.Store.getPlaylist(id) : null;
  }

  _safeExt(value) {
    const extension = String(value || "").replace(/^\./, "").trim();
    return /^[a-z0-9]{1,8}$/i.test(extension) ? extension : "mp4";
  }

  _cleanText(value) {
    if (value == null) return "";
    return String(value)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;/g, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ")
      .trim();
  }

  applyInfo(item, info) {
    if (!item || !info || typeof info !== "object") return item;
    const plot = this._cleanText(info.plot || info.description);
    if (plot) item.plot = plot;
    const genre = this._cleanText(info.genre);
    if (genre) item.genre = genre;
    const year = String(info.releasedate || info.releaseDate || info.year || "").substring(0, 4);
    if (/^\d{4}$/.test(year)) item.year = year;
    const rating = info.rating == null ? "" : String(info.rating).trim();
    if (parseFloat(rating) > 0) item.rating = rating;
    const poster = info.cover_big || info.movie_image || info.stream_icon || "";
    if (poster && item.playlistId) {
      const playlist = this._getPlaylist(item.playlistId);
      if (playlist) item.poster = KP.Store.absoluteLogo(playlist.url, poster);
    }
    return item;
  }

  vodInfo(item, done) {
    if (!item) {
      this._finish(done, new Error("Movie not found"));
      return;
    }
    if (item._infoLoaded) {
      this._finish(done, null, item);
      return;
    }
    if (item._infoLoading) {
      item._infoWaiters = item._infoWaiters || [];
      if (typeof done === "function") item._infoWaiters.push(done);
      return;
    }
    const playlist = this._getPlaylist(item.playlistId);
    if (!playlist) {
      this._finish(done, new Error("Playlist not found"));
      return;
    }
    if (item.streamId == null) {
      this._finish(done, new Error("Movie is not playable"));
      return;
    }
    item._infoLoading = true;
    item._infoWaiters = item._infoWaiters || [];
    if (typeof done === "function") item._infoWaiters.push(done);
    KP.Net.json(KP.Parsers.Xtream.api(playlist.url, playlist.user, playlist.pass, "get_vod_info", {
      vod_id: item.streamId
    }), {
      timeoutMs: 30000,
      retries: 1
    }, (error, response) => {
      item._infoLoading = false;
      if (!error) {
        this.applyInfo(item, response && response.info);
        item._infoLoaded = true;
      } else {
        this._log(`info/${item.key}`, error);
      }
      const waiters = item._infoWaiters || [];
      item._infoWaiters = [];
      waiters.forEach((waiter) => this._finish(waiter, error, item));
    });
  }

  _nameOf(value) {
    return String(value == null ? "" : value).trim();
  }

  _mapRows(playlist, kind, rows, categoryId) {
    const items = (Array.isArray(rows) ? rows : []).map((row) => {
      if (kind === "movies") {
        return {
          key: `${playlist.id}:m:${row.stream_id}`,
          kind: "movie",
          name: this._nameOf(row.name) || "Untitled movie",
          poster: KP.Store.absoluteLogo(playlist.url, row.stream_icon || ""),
          rating: row.rating == null ? "" : String(row.rating),
          categoryId: categoryId || String(row.category_id || ""),
          playlistId: playlist.id,
          streamId: row.stream_id,
          ext: this._safeExt(row.container_extension),
          plot: String(row.plot || ""),
          genre: String(row.genre || ""),
          year: String(row.releaseDate || row.year || "").substring(0, 4)
        };
      }
      return {
        key: `${playlist.id}:s:${row.series_id}`,
        kind: "series",
        name: this._nameOf(row.name) || "Untitled show",
        poster: KP.Store.absoluteLogo(playlist.url, row.cover || row.stream_icon || ""),
        rating: row.rating == null ? "" : String(row.rating),
        categoryId: categoryId || String(row.category_id || ""),
        playlistId: playlist.id,
        seriesId: row.series_id,
        plot: String(row.plot || ""),
        genre: String(row.genre || ""),
        year: String(row.releaseDate || row.year || "").substring(0, 4)
      };
    });
    items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return items;
  }

  loadCats(playlist, done) {
    if (!playlist) {
      this._finish(done, new Error("Playlist not found"));
      return;
    }
    if (playlist.type !== "xtream") {
      this._finish(done, null, { movies: [], series: [] });
      return;
    }
    if (playlist._vodCats) {
      this._finish(done, null, playlist._vodCats);
      return;
    }
    if (playlist._vodCatsLoading) {
      if (!playlist._vodCatWaiters) playlist._vodCatWaiters = [];
      if (typeof done === "function") playlist._vodCatWaiters.push(done);
      return;
    }

    playlist._vodCatsLoading = true;
    playlist._vodCatWaiters = playlist._vodCatWaiters || [];
    if (typeof done === "function") playlist._vodCatWaiters.push(done);
    const out = { movies: [], series: [] };
    const errors = [];
    let left = 2;

    const step = () => {
      left -= 1;
      if (left > 0) return;
      playlist._vodCatsLoading = false;
      const waiters = playlist._vodCatWaiters || [];
      playlist._vodCatWaiters = [];
      if (!out.movies.length && !out.series.length && errors.length) {
        playlist._vodError = `Could not load VOD categories: ${errors[0].message}`;
        this._log("categories", errors[0]);
        waiters.forEach((callback) => this._finish(callback, errors[0]));
        return;
      }
      out.warnings = errors.map((error) => error.message);
      playlist._vodCats = out;
      playlist._vodError = "";
      this._notify(playlist, "categories");
      waiters.forEach((callback) => this._finish(callback, null, out));
    };

    const load = (kind, action) => {
      KP.Net.json(KP.Parsers.Xtream.api(playlist.url, playlist.user, playlist.pass, action), { timeoutMs: 45000, retries: 1 }, (error, rows) => {
        if (error) {
          errors.push(error);
          this._log(`categories/${kind}`, error);
        } else if (Array.isArray(rows)) {
          out[kind] = rows.map((row) => ({
            catId: String(row.category_id),
            name: this._nameOf(row.category_name) || "Unnamed category"
          }));
        } else {
          const responseError = new Error(`The provider returned an invalid ${kind} category list`);
          errors.push(responseError);
          this._log(`categories/${kind}`, responseError);
        }
        step();
      });
    };

    load("movies", "get_vod_categories");
    load("series", "get_series_categories");
  }

  categories(playlist) {
    const target = playlist || this._activePlaylist();
    const out = { movies: [], series: [] };
    if (!target || !target._vodCats) return out;
    ["movies", "series"].forEach((kind) => {
      (target._vodCats[kind] || []).forEach((category) => {
        out[kind].push({
          key: `${target.id}|${kind}|${category.catId}`,
          name: category.name,
          kind,
          playlistId: target.id,
          catId: category.catId
        });
      });
    });
    return out;
  }

  loadCategory(category, done) {
    if (!category) {
      this._finish(done, new Error("Category not found"));
      return;
    }
    const playlist = this._getPlaylist(category.playlistId);
    if (!playlist) {
      this._finish(done, new Error("Playlist not found"));
      return;
    }
    if (playlist.type !== "xtream") {
      this._finish(done, new Error("Movies and shows need an Xtream Codes playlist"));
      return;
    }

    playlist._vodItems = playlist._vodItems || {};
    const cacheKey = `${category.kind}|${category.catId}`;
    if (playlist._vodItems[cacheKey]) {
      this._finish(done, null, playlist._vodItems[cacheKey]);
      return;
    }
    playlist._vodCategoryWaiters = playlist._vodCategoryWaiters || {};
    if (playlist._vodCategoryWaiters[cacheKey]) {
      if (typeof done === "function") playlist._vodCategoryWaiters[cacheKey].push(done);
      return;
    }
    playlist._vodCategoryWaiters[cacheKey] = typeof done === "function" ? [done] : [];

    const action = category.kind === "movies" ? "get_vod_streams" : "get_series";
    KP.Net.json(KP.Parsers.Xtream.api(playlist.url, playlist.user, playlist.pass, action, { category_id: category.catId }), {
      timeoutMs: 60000,
      retries: 1
    }, (error, rows) => {
      let items = null;
      if (!error) {
        if (!Array.isArray(rows)) {
          error = new Error("The provider returned an invalid list for this category");
        } else {
          items = this._mapRows(playlist, category.kind, rows, category.catId);
        }
      }
      if (error) {
        this._log(`category/${cacheKey}`, error);
      } else {
        playlist._vodItems[cacheKey] = items;
        this._notify(playlist, "category", cacheKey);
      }
      const waiters = playlist._vodCategoryWaiters[cacheKey] || [];
      delete playlist._vodCategoryWaiters[cacheKey];
      waiters.forEach((callback) => this._finish(callback, error, items));
    });
  }

  loadSearchIndex(playlist, done) {
    const target = playlist || this._activePlaylist();
    if (!target) {
      this._finish(done, new Error("Playlist not found"), []);
      return;
    }
    if (target.type !== "xtream") {
      this._finish(done, null, []);
      return;
    }

    let job = target._vodSearch;
    if (!job) {
      job = target._vodSearch = { items: [], loaded: false, loading: false, waiters: [], errors: [] };
    }
    if (job.loaded) {
      this._finish(done, null, job.items);
      return;
    }
    if (typeof done === "function") job.waiters.push(done);
    if (job.loading) return;

    job.loading = true;
    job.errors = [];
    let left = 2;
    let all = [];
    const errors = [];

    const step = () => {
      left -= 1;
      if (left > 0) return;
      if (target._vodSearch !== job) return;
      job.loading = false;
      job.loaded = true;
      job.items = all;
      job.errors = errors;
      job.at = Date.now();
      const waiters = job.waiters;
      job.waiters = [];
      const failure = !all.length && errors.length ? errors[0] : null;
      waiters.forEach((callback) => this._finish(callback, failure, all));
    };

    const load = (kind, action) => {
      KP.Net.json(KP.Parsers.Xtream.api(target.url, target.user, target.pass, action), { timeoutMs: 120000, retries: 0 }, (error, rows) => {
        if (target._vodSearch !== job) return;
        if (error) {
          errors.push(error);
          this._log(`search/${kind}`, error);
        } else if (Array.isArray(rows)) {
          all = all.concat(this._mapRows(target, kind, rows));
        } else {
          const responseError = new Error(`The provider returned an invalid ${kind} list`);
          errors.push(responseError);
          this._log(`search/${kind}`, responseError);
        }
        step();
      });
    };

    load("movies", "get_vod_streams");
    load("series", "get_series");
  }

  retrySearchIndex(playlist, done) {
    const target = playlist || this._activePlaylist();
    if (!target) {
      this._finish(done, new Error("Playlist not found"), []);
      return;
    }
    target._vodSearch = null;
    this.loadSearchIndex(target, done);
  }

  cachedItems(playlist) {
    let out = [];
    const list = playlist ? [playlist] : (KP.Store ? KP.Store.playlists : []);
    (list || []).forEach((item) => {
      if (!item._vodItems) return;
      Object.keys(item._vodItems).forEach((key) => {
        out = out.concat(item._vodItems[key]);
      });
    });
    return out;
  }

  findItem(key, playlist) {
    const list = playlist ? [playlist] : (KP.Store ? KP.Store.playlists : []);
    for (const item of list || []) {
      if (item._vodSearch && item._vodSearch.loaded) {
        const found = item._vodSearch.items.find((candidate) => candidate.key === key);
        if (found) return found;
      }
      if (!item._vodItems) continue;
      for (const cacheKey of Object.keys(item._vodItems)) {
        const found = (item._vodItems[cacheKey] || []).find((candidate) => candidate.key === key);
        if (found) return found;
      }
    }
    return null;
  }

  seriesInfo(item, done) {
    if (!item) {
      this._finish(done, new Error("Show not found"));
      return;
    }
    if (item._seriesLoaded) {
      this._finish(done, null, {
        info: item._seriesInfo || {},
        episodes: item._seriesEpisodes || []
      });
      return;
    }
    if (item._seriesLoading) {
      item._seriesWaiters = item._seriesWaiters || [];
      if (typeof done === "function") item._seriesWaiters.push(done);
      return;
    }
    const playlist = this._getPlaylist(item.playlistId);
    if (!playlist) {
      this._finish(done, new Error("Playlist not found"));
      return;
    }

    item._seriesLoading = true;
    item._seriesWaiters = item._seriesWaiters || [];
    if (typeof done === "function") item._seriesWaiters.push(done);
    KP.Net.json(KP.Parsers.Xtream.api(playlist.url, playlist.user, playlist.pass, "get_series_info", { series_id: item.seriesId }), {
      timeoutMs: 45000,
      retries: 1
    }, (error, response) => {
      item._seriesLoading = false;
      const waiters = item._seriesWaiters || [];
      item._seriesWaiters = [];
      if (error) {
        waiters.forEach((waiter) => this._finish(waiter, error));
        return;
      }
      const episodes = [];
      let bySeason = response && response.episodes ? response.episodes : {};
      if (Array.isArray(bySeason)) bySeason = { 1: bySeason };
      if (bySeason && typeof bySeason === "object") {
        Object.keys(bySeason).forEach((season) => {
          const list = bySeason[season];
          if (!Array.isArray(list)) return;
          list.forEach((episode) => {
            if (episode.id == null) return;
            episodes.push({
              season: parseInt(season, 10) || 1,
              episode: episode.episode_num == null ? episodes.length + 1 : episode.episode_num,
              title: this._nameOf(episode.title),
              id: episode.id,
              ext: this._safeExt(episode.container_extension),
              duration: episode.info && episode.info.duration ? episode.info.duration : ""
            });
          });
        });
      }
      episodes.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
      this.applyInfo(item, response && response.info);
      item._seriesInfo = (response && response.info) || {};
      item._seriesEpisodes = episodes;
      item._seriesLoaded = true;
      waiters.forEach((waiter) => this._finish(waiter, null, {
        info: item._seriesInfo,
        episodes
      }));
    });
  }

  url(item, episode) {
    if (!item) return "";
    const playlist = this._getPlaylist(item.playlistId);
    if (!playlist) {
      this._log("url", new Error(`Playlist not found for ${item.key}`));
      return "";
    }
    if (item.kind === "series") {
      if (!episode || episode.id == null) return "";
      return KP.Parsers.Xtream.seriesUrl(playlist.url, playlist.user, playlist.pass, episode.id, this._safeExt(episode.ext));
    }
    if (item.streamId == null) return "";
    return KP.Parsers.Xtream.vodUrl(playlist.url, playlist.user, playlist.pass, item.streamId, this._safeExt(item.ext));
  }

  _notify(playlist, kind, key) {
    if (!KP.Store) return;
    KP.Store.notify("vod", {
      playlistId: playlist ? playlist.id : "",
      kind,
      key: key || ""
    });
  }

  invalidate(playlist) {
    if (!playlist) return;
    const categoryWaiters = playlist._vodCatWaiters || [];
    playlist._vodCatWaiters = [];
    categoryWaiters.forEach((callback) => this._finish(callback, null, { movies: [], series: [] }));
    const searchJob = playlist._vodSearch;
    if (searchJob) {
      searchJob.loaded = true;
      const searchWaiters = searchJob.waiters || [];
      searchJob.waiters = [];
      searchWaiters.forEach((callback) => this._finish(callback, null, searchJob.items || []));
    }
    playlist._vodCats = null;
    playlist._vodItems = null;
    playlist._vodCategoryWaiters = {};
    playlist._vodSearch = null;
    playlist._vodError = "";
    delete playlist._vodCatsLoading;
  }
}

const kplayerVod = new KPlayerVod();
KP.Vod = kplayerVod;

if (KP.Store) {
  KP.Store.loadVodCatsAll = (done) => {
    const playlist = kplayerVod._activePlaylist();
    if (!playlist || playlist.type !== "xtream") {
      if (typeof done === "function") done();
      return;
    }
    kplayerVod.loadCats(playlist, (error, data) => {
      if (typeof done === "function") done(error, data);
    });
  };
  KP.Store.vodCats = () => kplayerVod.categories(kplayerVod._activePlaylist());
  KP.Store.loadVodCategory = (category, done) => kplayerVod.loadCategory(category, done);
  KP.Store.loadVodSearchIndex = (done) => kplayerVod.loadSearchIndex(kplayerVod._activePlaylist(), done);
  KP.Store.retryVodSearch = (done) => kplayerVod.retrySearchIndex(kplayerVod._activePlaylist(), done);
  KP.Store.cachedVodItems = () => kplayerVod.cachedItems();
  KP.Store.findVodItem = (key) => kplayerVod.findItem(key);
  KP.Store.seriesInfo = (item, done) => kplayerVod.seriesInfo(item, done);
  KP.Store.vodInfo = (item, done) => kplayerVod.vodInfo(item, done);
  KP.Store.vodUrl = (item, episode) => kplayerVod.url(item, episode);
  KP.Store.invalidateVod = (playlist) => kplayerVod.invalidate(playlist);
}
