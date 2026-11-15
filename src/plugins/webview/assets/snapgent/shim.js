// SPDX-License-Identifier: GPL-3.0-or-later
// shim.js - the chrome.* surface snapgent's core expects, implemented on top
// of the Acode WebView page bridge (window.webview).
//
// Injected at document_start (and again before the core on page finished), so
// the core always sees a complete API. State lives on window.__zsShimState so a
// second injection rebinds the transport without dropping listeners the core
// already registered.
//
// Only the members the extension actually uses are provided; everything else is
// deliberately absent so a future provider cannot silently depend on an API
// that does not exist in an embedded WebView.
(function () {
  "use strict";

  // core/main.js prints this as the extension version in its status bar.
  window.__zsExtVersion = "3.9.5";

  var S = window.__zsShimState;
  if (S && S.ready) return;
  if (!S) {
    S = window.__zsShimState = {
      listeners: new Set(),
      pending: new Map(),
      nextCid: 1,
      bound: false,
      installed: false,
      ready: false,
    };
  }

  var lastError;

  function post(payload) {
    try {
      if (window.webview && typeof window.webview.postMessage === "function") {
        window.webview.postMessage(payload);
        return true;
      }
    } catch (e) {}
    return false;
  }

  function call(payload, done) {
    var cid = S.nextCid++;
    S.pending.set(cid, done);
    payload.cid = cid;
    if (!post(payload)) {
      // No host side: fail fast instead of hanging the agent loop.
      S.pending.delete(cid);
      done({ ok: false, error: "snapgent host unavailable" });
    }
  }

  function receive(raw) {
    var frame;
    try {
      frame = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (e) {
      return;
    }
    if (!frame || typeof frame !== "object") return;

    if (frame.kind === "status") {
      // main.js's listener reads a FLAT "zs-status" message (msg.connected,
      // msg.servers, ...), exactly what background.js broadcasts.
      var status = frame.status || {};
      var message = { type: "zs-status" };
      for (var key in status) {
        if (Object.prototype.hasOwnProperty.call(status, key)) message[key] = status[key];
      }
      for (var fn of Array.from(S.listeners)) {
        try {
          fn(message);
        } catch (e) {}
      }
      return;
    }

    var cb = S.pending.get(frame.cid);
    if (cb) {
      S.pending.delete(frame.cid);
      cb(frame);
    }
  }

  // The Acode bridge is installed at document start and dispatches raw strings.
  function bindReceiver() {
    if (S.bound) return true;
    try {
      if (!window.webview || typeof window.webview.onMessage !== "function") return false;
      window.webview.onMessage(receive);
      S.bound = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  if (!bindReceiver()) {
    try {
      var attempts = 0;
      var timer = setInterval(function () {
        if (bindReceiver() || ++attempts > 100) clearInterval(timer);
      }, 20);
    } catch (e) {}
    try {
      document.addEventListener("DOMContentLoaded", bindReceiver, { once: true });
    } catch (e) {}
  }

  function finish() {
    if (S.bound && S.installed) S.ready = true;
  }

  if (S.installed) {
    finish();
    return;
  }

  var runtime = {
    // core/main.js shows "ext vX" from this.
    getManifest: function () {
      return { version: window.__zsExtVersion || "0.0.0" };
    },
    get lastError() {
      return lastError;
    },
    sendMessage: function (msg, cb) {
      call({ kind: "runtime", msg: msg }, function (frame) {
        if (frame.ok) {
          lastError = undefined;
          if (cb) cb(frame.reply);
        } else {
          lastError = { message: frame.error || "bridge unavailable" };
          if (cb) cb(undefined);
          lastError = undefined;
        }
      });
      return undefined;
    },
    onMessage: {
      addListener: function (fn) {
        S.listeners.add(fn);
      },
      removeListener: function (fn) {
        S.listeners.delete(fn);
      },
      hasListener: function (fn) {
        return S.listeners.has(fn);
      },
    },
  };
  runtime.__snapgentShim = true;

  function normaliseKeys(keys) {
    if (keys == null) return null;
    if (typeof keys === "string") return [keys];
    if (Array.isArray(keys)) return keys;
    if (typeof keys === "object") return Object.keys(keys);
    return null;
  }

  var local = {
    get: function (keys, cb) {
      call({ kind: "storageGet", keys: normaliseKeys(keys) }, function (frame) {
        var value = frame.ok ? frame.value || {} : {};
        if (cb) cb(value);
      });
      return undefined;
    },
    set: function (items, cb) {
      call({ kind: "storageSet", items: items || {} }, function () {
        if (cb) cb();
      });
      return undefined;
    },
    remove: function (keys, cb) {
      var list = normaliseKeys(keys) || [];
      call({ kind: "storageRemove", keys: list }, function () {
        if (cb) cb();
      });
      return undefined;
    },
  };

  var shim = Object.freeze({
    runtime: Object.freeze(runtime),
    storage: Object.freeze({ local: Object.freeze(local) }),
  });

  // We run in the page's own world, so window.chrome already exists on
  // Chromium pages and is not writable. Each step below is a weaker but still
  // working option; the last one only adds the two members the core reads.
  function installChrome() {
    var existing = window.chrome;
    if (existing && existing.runtime && existing.runtime.__snapgentShim) return true;
    try {
      Object.defineProperty(window, "chrome", {
        value: shim,
        writable: false,
        configurable: false,
      });
      return true;
    } catch (e) {}
    try {
      window.chrome = shim;
      return true;
    } catch (e) {}
    try {
      existing.runtime = shim.runtime;
      existing.storage = shim.storage;
      return true;
    } catch (e) {}
    return false;
  }

  if (installChrome()) {
    S.installed = true;
    finish();
  } else {
    try {
      console.error("[snapgent] could not install the chrome.* shim on this page");
    } catch (e) {}
  }
})();
