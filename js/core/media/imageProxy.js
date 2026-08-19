import { Environment } from "../../platform/environment.js";
import {
  isWebOsCompanionServiceAvailable,
  requestWebOsCompanionService
} from "../../platform/webos/webosCompanionService.js";

const WEBOS_IMAGE_PROXY_PORT = 2710;
const WEBOS_IMAGE_PROXY_PATH = "/image-proxy";
const WEBOS_IMAGE_PROXY_STATUS_TIMEOUT_MS = 5000;

let webOsImageProxyBaseUrl = "";
let webOsImageProxyReady = false;
let webOsImageProxyReadyPromise = null;
const webOsImageProxyReadyListeners = new Set();

function isImgurHost(hostname = "") {
  const host = String(hostname || "")
    .trim()
    .toLowerCase();
  return host === "i.imgur.com" || host.endsWith(".imgur.com");
}

function isProxyableImgurImageUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") && isImgurHost(parsed.hostname)
    );
  } catch (_) {
    return false;
  }
}

export function isWebOsImageProxyUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
      parsed.pathname === WEBOS_IMAGE_PROXY_PATH
    );
  } catch (_) {
    return false;
  }
}

function normalizeLocalBaseUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost")
    ) {
      return "";
    }
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch (_) {
    return "";
  }
}

function getDefaultWebOsImageProxyBaseUrl() {
  return `http://127.0.0.1:${WEBOS_IMAGE_PROXY_PORT}`;
}

function notifyWebOsImageProxyReady() {
  webOsImageProxyReadyListeners.forEach((listener) => {
    try {
      listener(webOsImageProxyBaseUrl || getDefaultWebOsImageProxyBaseUrl());
    } catch (_) {
      // Listener failures must not break image rendering.
    }
  });
}

function withTimeout(promise, timeoutMs) {
  let timeoutId = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("webOS image proxy status timed out")),
      timeoutMs
    );
  });
  return Promise.race([promise, timeoutPromise]).then(
    (value) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      return value;
    },
    (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      throw error;
    }
  );
}

export function isWebOsImageProxyReady() {
  return !Environment.isWebOS() || webOsImageProxyReady;
}

export function onWebOsImageProxyReady(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  webOsImageProxyReadyListeners.add(listener);
  return () => {
    webOsImageProxyReadyListeners.delete(listener);
  };
}

export function ensureWebOsImageProxyReady({ force = false } = {}) {
  if (!Environment.isWebOS() || !isWebOsCompanionServiceAvailable()) {
    return Promise.resolve(false);
  }
  if (webOsImageProxyReady && !force) {
    return Promise.resolve(true);
  }
  if (webOsImageProxyReadyPromise && !force) {
    return webOsImageProxyReadyPromise;
  }

  webOsImageProxyReadyPromise = withTimeout(
    requestWebOsCompanionService({ method: "status", parameters: {} }),
    WEBOS_IMAGE_PROXY_STATUS_TIMEOUT_MS
  )
    .then((result) => {
      const baseUrl = normalizeLocalBaseUrl(result?.payload?.url);
      if (!baseUrl) {
        return false;
      }
      webOsImageProxyBaseUrl = baseUrl;
      webOsImageProxyReady = true;
      notifyWebOsImageProxyReady();
      return true;
    })
    .catch(() => false)
    .then((ready) => {
      webOsImageProxyReadyPromise = null;
      return ready;
    });

  return webOsImageProxyReadyPromise;
}

export function proxifyImageUrl(value = "", options = {}) {
  const normalized = String(value || "").trim();
  if (!normalized || !Environment.isWebOS() || !isProxyableImgurImageUrl(normalized)) {
    return normalized;
  }
  if (!webOsImageProxyReady) {
    void ensureWebOsImageProxyReady();
    if (options.requireReady !== false) {
      return "";
    }
  }
  const encoded = encodeURIComponent(normalized);
  const baseUrl = webOsImageProxyBaseUrl || getDefaultWebOsImageProxyBaseUrl();
  return `${baseUrl}${WEBOS_IMAGE_PROXY_PATH}?url=${encoded}`;
}

// --- Poster downsizing (Tizen/weak-GPU perf) --------------------------------
// Full-resolution posters/backdrops force the TV's WebView to decode large
// images, which stutters catalog grids on monitor-class Samsung sets. When a
// provider URL embeds a resizable width token, rewrite it to a card-sized
// variant so far less pixel data is decoded. Purely a URL rewrite; if the
// pattern is unknown the original URL is returned unchanged.
const POSTER_TARGET_WIDTH = 342; // TMDB "w342" — good on a 1080p card grid
const BACKDROP_TARGET_WIDTH = 780; // TMDB "w780" — landscape backdrops

function resizeTmdbImageUrl(url, targetWidth) {
  // Matches https://image.tmdb.org/t/p/<size>/<file> where <size> is
  // "original" or "w\d+"; swaps it for the target width.
  return url.replace(
    /(https?:\/\/image\.tmdb\.org\/t\/p\/)(original|w\d+)(\/)/i,
    (_match, prefix, _size, suffix) => `${prefix}w${targetWidth}${suffix}`
  );
}

function resizeMetahubImageUrl(url, targetWidth) {
  // Stremio metahub posters: .../poster/medium/... or /large/ or /small/.
  // Prefer "medium" for grid cards to cut decode cost.
  if (targetWidth <= 400) {
    return url.replace(
      /(\/poster\/)(large|medium|small)(\/)/i,
      (_match, prefix, _size, suffix) => `${prefix}medium${suffix}`
    );
  }
  return url;
}

export function resizeImageUrlForDisplay(value = "", { kind = "poster" } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  const targetWidth = kind === "backdrop" ? BACKDROP_TARGET_WIDTH : POSTER_TARGET_WIDTH;
  let resized = resizeTmdbImageUrl(normalized, targetWidth);
  if (resized === normalized) {
    resized = resizeMetahubImageUrl(normalized, targetWidth);
  }
  return resized;
}

export function normalizeImageUrl(value = "", options = {}) {
  return proxifyImageUrl(value, options);
}
