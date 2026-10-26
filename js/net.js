/* KPlayer network helpers: one XHR implementation with timeouts, size caps and
   a single retry for transient failures. HTTP 4xx responses are never retried. */
"use strict";

const KPlayerNet = {
  text: (url, options = {}, done) => {
    const timeoutMs = options.timeoutMs || 60000;
    const maxBytes = options.maxBytes || 0;
    const retries = options.retries == null ? 1 : options.retries;
    let attempt = 0;

    const request = () => {
      attempt += 1;
      const xhr = new XMLHttpRequest();
      let finished = false;

      const finish = (error, text) => {
        if (finished) return;
        finished = true;
        if (error && !error.tooLarge && attempt <= retries && error.retryable) {
          setTimeout(request, 700);
          return;
        }
        if (typeof done === "function") done(error, text);
      };

      const tooLarge = () => {
        const error = new Error(`This file is larger than ${Math.round(maxBytes / 1e6)} MB`);
        error.tooLarge = true;
        error.retryable = false;
        finish(error);
        try {
          xhr.abort();
        } catch (abortError) {
          KP.Utils.logWarn("net/abort", abortError);
        }
      };

      xhr.open("GET", url, true);
      xhr.timeout = timeoutMs;
      xhr.onreadystatechange = () => {
        if (!maxBytes || xhr.readyState !== 2) return;
        try {
          const length = parseInt(xhr.getResponseHeader("Content-Length") || "0", 10);
          if (length && length > maxBytes) tooLarge();
        } catch (headerError) {
          KP.Utils.logWarn("net/headers", headerError);
        }
      };
      xhr.onprogress = () => {
        if (!maxBytes || finished) return;
        try {
          if (xhr.responseText && xhr.responseText.length > maxBytes) tooLarge();
        } catch (progressError) {
          KP.Utils.logWarn("net/progress", progressError);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 400) {
          const error = new Error(`HTTP ${xhr.status}`);
          error.status = xhr.status;
          error.retryable = xhr.status >= 500 || xhr.status === 429;
          finish(error);
          return;
        }
        finish(null, xhr.responseText);
      };
      xhr.onerror = () => {
        const error = new Error("Network error");
        error.retryable = true;
        finish(error);
      };
      xhr.ontimeout = () => {
        const error = new Error("Request timed out");
        error.retryable = true;
        finish(error);
      };
      try {
        xhr.send();
      } catch (error) {
        error.retryable = false;
        finish(error);
      }
    };

    request();
  },

  json: (url, options, done) => {
    KPlayerNet.text(url, options, (error, text) => {
      if (error) {
        done(error);
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch (parseError) {
        KP.Utils.logError("net/json", parseError);
        done(new Error("Invalid response from server"));
      }
    });
  }
};

KP.Net = KPlayerNet;
