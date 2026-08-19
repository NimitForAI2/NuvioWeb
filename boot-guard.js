(function installNuvioBootGuard(window, document) {
  "use strict";

  if (typeof window.globalThis === "undefined") {
    window.globalThis = window;
  }

  if (window.NuvioBootGuard) {
    return;
  }

  var OVERLAY_ID = "nuvio-boot-error";
  var SPLASH_ID = "nuvio-boot-splash";
  // Boot splash is structured in phases so it never looks frozen on weak 4K
  // panels (e.g. Samsung M70H):
  //   0 – WARMUP_MS         : quiet breathing glow while the WebView decodes the
  //                           icon and paints the first app frame (cheap to render)
  //   WARMUP_MS – ~+3s      : the cinematic reveal fires on a warmed-up GPU
  // The splash may begin fading once the app is ready AND at least SPLASH_MIN_MS
  // has elapsed (so a fast boot still shows a complete moment), and is always
  // gone by SPLASH_MAX_MS regardless.
  var SPLASH_WARMUP_MS = 4000; // quiet buffer before the reveal animation starts
  // Floor must clear the END of the reveal, not just the warm-up: the reveal
  // starts at ~4s and its last beat (signature rise) finishes ~6.7s, so fading
  // may only begin at 6800ms. Otherwise a fast boot would cut the reveal off
  // right as it starts — the exact problem on weak panels we're avoiding.
  var SPLASH_MIN_MS = 6800;    // floor: earliest the splash may fade once ready
  var SPLASH_MAX_MS = 8000;    // ceiling: hard cap, splash never outlives this
  var SPLASH_FADE_MS = 620;
  var COMPATIBILITY_INFO_TIMEOUT_MS = 1500;
  var DEFAULT_COMPATIBILITY_MESSAGES = {
    unsupported_device_title: "TV not supported",
    unsupported_device_message:
      "This TV does not meet the minimum requirements for this version of Next.",
    unsupported_device_current_platform: "Current platform",
    unsupported_device_current_firmware: "Current firmware",
    unsupported_device_required_platform: "Required platform",
    unsupported_device_close: "Close",
    unsupported_device_unavailable: "Unavailable"
  };
  var SUPPORTED_LOCALES = [
    "ar",
    "bs",
    "cs",
    "de",
    "el",
    "es",
    "es-419",
    "fr",
    "he",
    "hi",
    "hu",
    "id",
    "it",
    "ja",
    "lt",
    "nl",
    "no",
    "pl",
    "pt-br",
    "pt-pt",
    "ro",
    "ru",
    "sk",
    "sl",
    "sv",
    "ta",
    "tr",
    "vi",
    "zh-cn"
  ];
  var active = true;
  var lastStage = "Loading startup files";
  var splashShownAt = 0;

  // --- Boot splash: cinematic icon reveal -----------------------------------
  // A choreographed sequence (fade + scale-settle → single wide accent sweep →
  // signature rise → held "settled" beat with a soft breathing glow), not a
  // passive loop. Runs to completion before dismissing. Pure DOM/CSS using only
  // transform/opacity so it stays smooth on weak Tizen WebViews; if anything
  // here fails it must never block boot.
  function showSplash() {
    try {
      if (!document.body || document.getElementById(SPLASH_ID)) {
        return;
      }
      var style = document.createElement("style");
      style.id = SPLASH_ID + "-style";
      // Reveal beats are offset by the warm-up so the expensive animation only
      // fires after assets have had time to decode. w = warm-up in seconds.
      var w = SPLASH_WARMUP_MS / 1000;
      var dLogo = (w + 0.05).toFixed(2) + "s";
      var dBloom = (w + 0.15).toFixed(2) + "s";
      var dBreathe = (w + 1.2).toFixed(2) + "s";
      var dRim = (w + 1.0).toFixed(2) + "s";
      var dSweep = (w + 0.95).toFixed(2) + "s";
      var dSign = (w + 1.55).toFixed(2) + "s";
      style.textContent =
        "#" + SPLASH_ID + "{position:fixed;z-index:2147483646;left:0;top:0;width:100%;height:100%;" +
        "background:radial-gradient(130% 130% at 50% 42%,#12203a 0%,#0a1120 42%,#05080f 72%,#03060b 100%);" +
        "display:flex;align-items:center;justify-content:center;opacity:1;" +
        "transition:opacity " + SPLASH_FADE_MS + "ms ease;}" +
        "#" + SPLASH_ID + ".nuvio-splash-hide{opacity:0;}" +
        // stage centers the mark; the glow blooms behind it
        "#" + SPLASH_ID + " .nuvio-splash-stage{position:relative;display:flex;" +
        "align-items:center;justify-content:center;}" +
        // WARM-UP glow: a low-cost breathing pulse that runs immediately during
        // the buffer window, so the screen is alive (not frozen) before the reveal.
        "#" + SPLASH_ID + " .nuvio-splash-warm{position:absolute;left:50%;top:50%;" +
        "width:42vw;max-width:520px;height:42vw;max-height:520px;transform:translate(-50%,-50%);" +
        "border-radius:50%;pointer-events:none;" +
        "background:radial-gradient(circle,rgba(70,120,210,.20) 0%,rgba(50,90,180,.08) 45%,rgba(0,0,0,0) 70%);" +
        "animation:nuvioWarm 2.4s ease-in-out 0s infinite;}" +
        // REVEAL glow: blooms in after the warm-up, then gently breathes
        "#" + SPLASH_ID + " .nuvio-splash-glow{position:absolute;left:50%;top:50%;" +
        "width:60vw;max-width:720px;height:60vw;max-height:720px;transform:translate(-50%,-50%) scale(.6);" +
        "border-radius:50%;opacity:0;pointer-events:none;" +
        "background:radial-gradient(circle,rgba(88,150,255,.38) 0%,rgba(60,110,220,.16) 38%,rgba(0,0,0,0) 68%);" +
        "animation:nuvioGlowBloom 1s ease " + dBloom + " forwards,nuvioGlowBreathe 3.4s ease-in-out " + dBreathe + " infinite;}" +
        // logo wrapper clips the moving shine to the icon box
        "#" + SPLASH_ID + " .nuvio-splash-logo{position:relative;width:30vw;max-width:380px;" +
        "min-width:200px;overflow:hidden;border-radius:26px;opacity:0;transform:scale(.82);" +
        "box-shadow:0 24px 80px rgba(0,0,0,.55);" +
        "animation:nuvioLogoReveal 1.05s cubic-bezier(.16,1,.3,1) " + dLogo + " forwards;}" +
        "#" + SPLASH_ID + " .nuvio-splash-logo img{display:block;width:100%;height:auto;}" +
        // rim-light that fades in along the icon edge after it settles
        "#" + SPLASH_ID + " .nuvio-splash-logo:after{content:'';position:absolute;inset:0;" +
        "border-radius:26px;pointer-events:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);" +
        "opacity:0;animation:nuvioRim 1s ease " + dRim + " forwards;}" +
        // single deliberate diagonal sweep across the icon (one pass, not a loop)
        "#" + SPLASH_ID + " .nuvio-splash-shine{position:absolute;top:-25%;bottom:-25%;width:48%;" +
        "left:-70%;transform:skewX(-16deg);opacity:0;" +
        "background:linear-gradient(105deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.72) 50%,rgba(255,255,255,0) 100%);" +
        "animation:nuvioSweep 1.35s cubic-bezier(.5,.02,.3,1) " + dSweep + " forwards;}" +
        // signature rises + tightens beneath the mark
        "#" + SPLASH_ID + " .nuvio-splash-sign{position:absolute;left:50%;bottom:12vh;transform:translate(-50%,14px);" +
        "font-family:-apple-system,'Segoe UI',Roboto,sans-serif;font-size:1.5vw;" +
        "letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.38);" +
        "font-weight:600;opacity:0;white-space:nowrap;" +
        "animation:nuvioSignRise 1.1s cubic-bezier(.16,1,.3,1) " + dSign + " forwards;}" +
        "#" + SPLASH_ID + " .nuvio-splash-sign b{color:rgba(255,255,255,.72);font-weight:700;}" +
        "@keyframes nuvioWarm{0%,100%{opacity:.5;transform:translate(-50%,-50%) scale(.96);}" +
        "50%{opacity:.9;transform:translate(-50%,-50%) scale(1.04);}}" +
        "@keyframes nuvioLogoReveal{0%{opacity:0;transform:scale(.82);}" +
        "60%{opacity:1;transform:scale(1.03);}100%{opacity:1;transform:scale(1);}}" +
        "@keyframes nuvioGlowBloom{0%{opacity:0;transform:translate(-50%,-50%) scale(.6);}" +
        "100%{opacity:1;transform:translate(-50%,-50%) scale(1);}}" +
        "@keyframes nuvioGlowBreathe{0%,100%{opacity:.85;}50%{opacity:1;}}" +
        "@keyframes nuvioRim{to{opacity:1;}}" +
        "@keyframes nuvioSweep{0%{left:-70%;opacity:0;}12%{opacity:1;}88%{opacity:1;}100%{left:130%;opacity:0;}}" +
        "@keyframes nuvioSignRise{0%{opacity:0;transform:translate(-50%,14px);letter-spacing:.16em;}" +
        "100%{opacity:1;transform:translate(-50%,0);letter-spacing:.06em;}}";
      document.head.appendChild(style);

      var splash = document.createElement("div");
      splash.id = SPLASH_ID;
      splash.setAttribute("role", "img");
      splash.setAttribute("aria-label", "Next");
      // The warm-up glow keeps the screen alive during the asset buffer; then the
      // real app icon reveals in, a glow blooms, one shine sweeps, the signature
      // rises. Plain <img> (no CSS mask) so it renders on older Tizen WebViews
      // too. If the image is missing the wrapper simply shows the dark background
      // + glow — never a broken image.
      splash.innerHTML =
        '<div class="nuvio-splash-stage">' +
        '<div class="nuvio-splash-warm"></div>' +
        '<div class="nuvio-splash-glow"></div>' +
        '<div class="nuvio-splash-logo">' +
        '<img src="assets/images/tizenIcon.png" alt="Next" ' +
        'onerror="this.style.display=\'none\'" />' +
        '<div class="nuvio-splash-shine"></div>' +
        "</div>" +
        "</div>" +
        '<div class="nuvio-splash-sign">Built by <b>Nimit</b></div>';
      document.body.appendChild(splash);
      splashShownAt = Date.now();
    } catch (ignored) {
      // Splash is cosmetic; never let it break startup.
    }
  }

  function hideSplash() {
    try {
      var splash = document.getElementById(SPLASH_ID);
      if (!splash) {
        return;
      }
      // Enforce the floor so a fast boot still shows a complete moment: the
      // splash won't fade until at least SPLASH_MIN_MS has elapsed. This is
      // called by guard.ready() (app ready), the window-load net, and the
      // SPLASH_MAX_MS ceiling — whichever comes first past the floor wins.
      var elapsed = Date.now() - (splashShownAt || 0);
      var wait = Math.max(0, SPLASH_MIN_MS - elapsed);
      window.setTimeout(function fadeSplash() {
        splash.className = "nuvio-splash-hide";
        window.setTimeout(function removeSplash() {
          if (splash && splash.parentNode) {
            splash.parentNode.removeChild(splash);
          }
          var s = document.getElementById(SPLASH_ID + "-style");
          if (s && s.parentNode) {
            s.parentNode.removeChild(s);
          }
        }, SPLASH_FADE_MS);
      }, wait);
    } catch (ignored) {
      // no-op
    }
  }

  function text(value) {
    if (value === undefined || value === null || value === "") {
      return "Unavailable";
    }
    return String(value);
  }

  function parseJson(value) {
    try {
      return JSON.parse(String(value || "")) || {};
    } catch (ignored) {
      return {};
    }
  }

  function parseMajor(value) {
    var match = String(value || "").match(/^(\d{1,3})/);
    return match ? Number(match[1] || 0) : 0;
  }

  function parseChromeMajor() {
    var userAgent = String((window.navigator && window.navigator.userAgent) || "");
    var match = userAgent.match(/(?:Chrome|Chromium)\/(\d{2,3})/i);
    return match ? Number(match[1] || 0) : 0;
  }

  function mergeDeviceInfo(target, source) {
    var key;
    if (!source) {
      return target;
    }
    for (key in source) {
      if (
        Object.prototype.hasOwnProperty.call(source, key) &&
        source[key] !== undefined &&
        source[key] !== null &&
        source[key] !== ""
      ) {
        target[key] = source[key];
      }
    }
    return target;
  }

  function normalizeLocale(value) {
    var raw = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
    var language;
    if (!raw || raw === "system") {
      return "en";
    }
    if (raw === "pt") return "pt-br";
    if (raw === "zh") return "zh-cn";
    if (raw.indexOf("es-419") === 0) return "es-419";
    if (raw.indexOf("pt-br") === 0) return "pt-br";
    if (raw.indexOf("pt-pt") === 0) return "pt-pt";
    if (raw.indexOf("zh-cn") === 0) return "zh-cn";
    if (SUPPORTED_LOCALES.indexOf(raw) !== -1) return raw;
    language = raw.split("-")[0];
    return SUPPORTED_LOCALES.indexOf(language) !== -1 ? language : "en";
  }

  function getStoredLocale() {
    var activeProfileId = "1";
    var settings;
    var storedProfileId;
    try {
      storedProfileId = JSON.parse(window.localStorage.getItem("activeProfileId"));
      if (storedProfileId !== undefined && storedProfileId !== null && storedProfileId !== "") {
        activeProfileId = String(storedProfileId);
      }
      settings = JSON.parse(window.localStorage.getItem("themeSettings"));
      if (settings && settings.__profileScoped && settings.profiles) {
        settings = settings.profiles[activeProfileId] || settings.profiles["1"] || null;
      }
      return settings && settings.language ? normalizeLocale(settings.language) : "";
    } catch (ignored) {
      return "";
    }
  }

  function getPreferredLocale() {
    var stored = getStoredLocale();
    var languages;
    if (stored) {
      return stored;
    }
    languages = window.navigator && window.navigator.languages;
    if (languages && languages.length) {
      return normalizeLocale(languages[0]);
    }
    return normalizeLocale(window.navigator && window.navigator.language);
  }

  function parseMessagesXml(source) {
    var messages = {};
    var parser;
    var xml;
    var nodes;
    var index;
    var name;
    if (typeof window.DOMParser !== "function") {
      return messages;
    }
    try {
      parser = new window.DOMParser();
      xml = parser.parseFromString(String(source || ""), "application/xml");
      nodes = xml.getElementsByTagName("string");
      for (index = 0; index < nodes.length; index += 1) {
        name = String(nodes[index].getAttribute("name") || "");
        if (Object.prototype.hasOwnProperty.call(DEFAULT_COMPATIBILITY_MESSAGES, name)) {
          messages[name] = String(nodes[index].textContent || "").replace(/\\'/g, "'");
        }
      }
    } catch (ignored) {}
    return messages;
  }

  function loadCompatibilityMessages(callback) {
    var locale = getPreferredLocale();
    var path = locale === "en" ? "res/values/strings.xml" : "res/values-" + locale + "/strings.xml";
    var xhr;
    var done = false;
    var timeoutId = 0;

    function finish(localized) {
      if (done) {
        return;
      }
      done = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      callback(mergeDeviceInfo(mergeDeviceInfo({}, DEFAULT_COMPATIBILITY_MESSAGES), localized));
    }

    if (typeof window.XMLHttpRequest !== "function") {
      finish({});
      return;
    }

    try {
      xhr = new window.XMLHttpRequest();
      xhr.open("GET", path, true);
      xhr.onreadystatechange = function onMessagesLoaded() {
        if (xhr.readyState !== 4) {
          return;
        }
        if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
          finish(parseMessagesXml(xhr.responseText));
        } else {
          finish({});
        }
      };
      xhr.onerror = function onMessagesError() {
        finish({});
      };
      timeoutId = window.setTimeout(function onMessagesTimeout() {
        finish({});
      }, COMPATIBILITY_INFO_TIMEOUT_MS);
      xhr.send(null);
    } catch (ignored) {
      finish({});
    }
  }

  function formatPlatform(info) {
    var label = info.platform === "tizen" ? "Samsung Tizen" : "LG webOS";
    var version = info.platformVersion ? " " + info.platformVersion : "";
    var engine = info.chromeMajor ? " · Chromium " + info.chromeMajor : "";
    var model = info.modelName ? " · " + info.modelName : "";
    return label + version + engine + model;
  }

  function exitUnsupportedApp(platform) {
    try {
      if (platform === "webos") {
        if (window.webOSSystem && typeof window.webOSSystem.close === "function") {
          window.webOSSystem.close();
          return;
        }
        if (window.PalmSystem && typeof window.PalmSystem.close === "function") {
          window.PalmSystem.close();
          return;
        }
      }
      if (
        platform === "tizen" &&
        window.tizen &&
        window.tizen.application &&
        typeof window.tizen.application.getCurrentApplication === "function"
      ) {
        window.tizen.application.getCurrentApplication().exit();
        return;
      }
      if (typeof window.close === "function") {
        window.close();
      }
    } catch (ignored) {}
  }

  function showUnsupportedDevice(info, options, messages) {
    var overlay;
    var card;
    var logo;
    var title;
    var description;
    var details;
    var rows;
    var index;
    var row;
    var label;
    var value;
    var close;

    if (!document.body) {
      return;
    }

    removeOverlay();

    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "alert");
    overlay.setAttribute("dir", info.locale === "ar" || info.locale === "he" ? "rtl" : "ltr");
    overlay.style.cssText =
      "position:fixed;z-index:2147483647;left:0;top:0;width:100%;height:100%;" +
      "box-sizing:border-box;background:#0d0d0d;color:#f5f5f5;font-family:Arial,sans-serif;" +
      "display:flex;align-items:center;justify-content:center;padding:64px;";

    card = document.createElement("div");
    card.style.cssText = "width:100%;max-width:1050px;text-align:center;";

    logo = document.createElement("img");
    logo.src = "assets/brand/app_logo_wordmark.png";
    logo.alt = "Next";
    logo.style.cssText = "display:block;width:240px;max-width:38vw;height:auto;margin:0 auto 34px;";

    title = document.createElement("div");
    title.style.cssText = "font-size:44px;line-height:1.15;font-weight:700;margin-bottom:20px;";
    title.textContent = messages.unsupported_device_title;

    description = document.createElement("div");
    description.style.cssText =
      "font-size:25px;line-height:1.45;color:#c9c9c9;margin:0 auto 30px;max-width:900px;";
    description.textContent = messages.unsupported_device_message;

    details = document.createElement("div");
    details.style.cssText =
      "box-sizing:border-box;text-align:left;background:#181818;border:1px solid #343434;" +
      "border-radius:18px;padding:10px 28px;margin:0 auto 32px;max-width:960px;";

    rows = [
      [messages.unsupported_device_current_platform, formatPlatform(info)],
      [
        messages.unsupported_device_current_firmware,
        info.firmwareVersion || messages.unsupported_device_unavailable
      ],
      [messages.unsupported_device_required_platform, options.requiredLabel]
    ];

    for (index = 0; index < rows.length; index += 1) {
      row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:flex-start;justify-content:space-between;padding:18px 0;" +
        (index ? "border-top:1px solid #303030;" : "");
      label = document.createElement("div");
      label.style.cssText = "font-size:20px;line-height:1.35;color:#a9a9a9;padding-right:28px;";
      label.textContent = rows[index][0];
      value = document.createElement("div");
      value.style.cssText = "font-size:21px;line-height:1.35;font-weight:700;text-align:right;";
      value.textContent = rows[index][1];
      row.appendChild(label);
      row.appendChild(value);
      details.appendChild(row);
    }

    close = document.createElement("button");
    close.type = "button";
    close.textContent = messages.unsupported_device_close;
    close.style.cssText =
      "min-width:190px;padding:17px 30px;border:2px solid #ffffff;border-radius:12px;" +
      "background:#ffffff;color:#111111;font-size:23px;font-weight:700;";
    close.onclick = function closeUnsupportedApp() {
      exitUnsupportedApp(info.platform);
    };
    close.onkeydown = function closeUnsupportedAppWithRemote(event) {
      var keyCode = Number(event && event.keyCode);
      var key = String((event && event.key) || "");
      if (key === "Enter" || key === "OK" || keyCode === 13) {
        exitUnsupportedApp(info.platform);
      }
    };

    card.appendChild(logo);
    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(details);
    card.appendChild(close);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.documentElement.lang = info.locale;
    active = false;

    try {
      close.focus();
    } catch (ignored) {}
  }

  function readWebOsInfo() {
    var palmInfo = parseJson(window.PalmSystem && window.PalmSystem.deviceInfo);
    var firmwareVersion =
      palmInfo.firmwareVersion ||
      palmInfo.platformVersion ||
      (palmInfo.platformVersionMajor
        ? String(palmInfo.platformVersionMajor) + "." + String(palmInfo.platformVersionMinor || 0)
        : "");
    var platformVersion = palmInfo.sdkVersion || "";
    return {
      platform: "webos",
      platformVersion: platformVersion,
      platformMajor: parseMajor(platformVersion),
      firmwareVersion: firmwareVersion,
      modelName: palmInfo.modelName || "",
      chromeMajor: parseChromeMajor()
    };
  }

  function enrichWebOsInfo(info, callback) {
    var finished = false;
    var timeoutId = 0;

    function finish(details) {
      if (finished) {
        return;
      }
      finished = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      if (details) {
        info.platformVersion = details.sdkVersion || info.platformVersion;
        info.platformMajor = parseMajor(info.platformVersion) || info.platformMajor;
        info.firmwareVersion = details.version || details.firmwareVersion || info.firmwareVersion;
        info.modelName = details.modelName || info.modelName;
      }
      callback(info);
    }

    if (!window.webOS || typeof window.webOS.deviceInfo !== "function") {
      finish(null);
      return;
    }

    timeoutId = window.setTimeout(function onWebOsInfoTimeout() {
      finish(null);
    }, COMPATIBILITY_INFO_TIMEOUT_MS);

    try {
      window.webOS.deviceInfo(function onWebOsDeviceInfo(details) {
        finish(details || null);
      });
    } catch (ignored) {
      finish(null);
    }
  }

  function readTizenInfo() {
    var platformVersion = "";
    var firmwareVersion = "";
    var modelName = "";
    try {
      if (window.tizen && window.tizen.systeminfo) {
        platformVersion = String(
          window.tizen.systeminfo.getCapability("http://tizen.org/feature/platform.version") || ""
        );
      }
    } catch (ignored) {}
    try {
      if (window.webapis && window.webapis.productinfo) {
        firmwareVersion = String(window.webapis.productinfo.getFirmware() || "");
        modelName = String(window.webapis.productinfo.getModel() || "");
      }
    } catch (ignored) {}
    if (!platformVersion) {
      platformVersion =
        (String((window.navigator && window.navigator.userAgent) || "").match(
          /Tizen[\s\/]([0-9.]+)/i
        ) || [])[1] || "";
    }
    return {
      platform: "tizen",
      platformVersion: platformVersion,
      platformMajor: parseMajor(platformVersion),
      firmwareVersion: firmwareVersion,
      modelName: modelName,
      chromeMajor: parseChromeMajor()
    };
  }

  function compatibilityDecision(info, options) {
    var minVersion = Number(options.minVersion || 0);
    var minChrome = Number(options.minChrome || 0);
    var hasPlatformVersion = info.platformMajor > 0 && minVersion > 0;
    var hasChromeVersion = info.chromeMajor > 0 && minChrome > 0;
    if (
      (hasPlatformVersion && info.platformMajor < minVersion) ||
      (hasChromeVersion && info.chromeMajor < minChrome)
    ) {
      return "unsupported";
    }
    if (hasPlatformVersion || hasChromeVersion) {
      return "supported";
    }
    return "unknown";
  }

  function runCompatibilityGate(options, onSupported) {
    var info;
    var decision;
    var locale = getPreferredLocale();

    function renderUnsupported(resolvedInfo) {
      resolvedInfo.locale = locale;
      loadCompatibilityMessages(function onCompatibilityMessages(messages) {
        showUnsupportedDevice(resolvedInfo, options, messages);
      });
    }

    if (!options || (options.platform !== "webos" && options.platform !== "tizen")) {
      onSupported();
      return;
    }

    if (options.platform === "tizen") {
      info = readTizenInfo();
      decision = compatibilityDecision(info, options);
      if (decision === "unsupported") {
        renderUnsupported(info);
        return;
      }
      onSupported();
      return;
    }

    info = readWebOsInfo();
    decision = compatibilityDecision(info, options);
    if (decision === "supported") {
      onSupported();
      return;
    }
    enrichWebOsInfo(info, function onWebOsInfo(resolvedInfo) {
      if (compatibilityDecision(resolvedInfo, options) === "unsupported") {
        renderUnsupported(resolvedInfo);
      } else {
        onSupported();
      }
    });
  }

  function loadScript(source) {
    var script = document.createElement("script");
    script.async = false;
    script.defer = false;
    script.src = source;
    script.onerror = function handleStartupScriptError() {
      guard.scriptFailed(source);
    };
    guard.stage("Loading " + source);
    document.body.appendChild(script);
  }

  function removeOverlay() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }

  function showError(message, details, code) {
    if (!active || !document.body) {
      return;
    }

    // A hard boot error supersedes the splash.
    hideSplash();
    removeOverlay();

    var overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "alert");
    overlay.style.cssText =
      "position:fixed;z-index:2147483647;left:0;top:0;width:100%;height:100%;" +
      "box-sizing:border-box;background:#0d0d0d;color:#f5f5f5;font-family:Arial,sans-serif;" +
      "display:flex;align-items:center;justify-content:center;padding:64px;";

    var card = document.createElement("div");
    card.style.cssText = "width:100%;max-width:1120px;text-align:center;";

    var title = document.createElement("div");
    title.style.cssText = "font-size:44px;line-height:1.15;font-weight:700;margin-bottom:22px;";
    title.textContent = "Next could not start";

    var description = document.createElement("div");
    description.style.cssText =
      "font-size:25px;line-height:1.45;color:#c9c9c9;margin:0 auto 30px;max-width:920px;";
    description.textContent = text(message);

    var diagnostic = document.createElement("div");
    diagnostic.style.cssText =
      "box-sizing:border-box;text-align:left;white-space:pre-wrap;word-break:break-word;" +
      "font-family:monospace;font-size:19px;line-height:1.45;color:#dddddd;background:#181818;" +
      "border:1px solid #343434;border-radius:14px;padding:22px 26px;margin:0 auto 32px;max-width:980px;";
    diagnostic.textContent =
      "Code: " +
      text(code || "BOOT-ERROR") +
      "\n" +
      "Stage: " +
      text(lastStage) +
      "\n" +
      "Details: " +
      text(details);

    var retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.style.cssText =
      "min-width:190px;padding:17px 30px;border:2px solid #ffffff;border-radius:12px;" +
      "background:#ffffff;color:#111111;font-size:23px;font-weight:700;";
    retry.onclick = function retryBoot() {
      window.location.reload();
    };
    retry.onkeydown = function retryBootWithRemote(event) {
      var keyCode = Number(event && event.keyCode);
      var key = String((event && event.key) || "");
      if (key === "Enter" || key === "OK" || keyCode === 13) {
        window.location.reload();
      }
    };

    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(diagnostic);
    card.appendChild(retry);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    try {
      retry.focus();
    } catch (ignored) {}
  }

  function formatRuntimeError(message, source, line, column, error) {
    var parts = [];
    var errorText = error && (error.stack || error.message);
    if (errorText) {
      parts.push(String(errorText));
    } else if (message) {
      parts.push(String(message));
    }
    if (source) {
      parts.push(String(source) + ":" + Number(line || 0) + ":" + Number(column || 0));
    }
    return parts.join("\n");
  }

  var guard = {
    stage: function stage(name) {
      if (active && name) {
        lastStage = String(name);
      }
    },

    fail: function fail(message, details, code) {
      showError(message, details, code);
    },

    scriptFailed: function scriptFailed(source) {
      showError("A required startup file could not be loaded.", text(source), "BOOT-ASSET");
    },

    ready: function ready() {
      active = false;
      hideSplash();
      removeOverlay();
    },

    runCompatibilityGate: runCompatibilityGate,

    loadScript: loadScript,

    isActive: function isActive() {
      return active;
    }
  };

  window.NuvioBootGuard = guard;

  // Show the boot splash as early as possible.
  if (document.body) {
    showSplash();
  } else if (typeof document.addEventListener === "function") {
    document.addEventListener("DOMContentLoaded", showSplash, { once: true });
  }

  // Safety nets so the splash ALWAYS clears even if the app never calls
  // guard.ready(): dismiss after window load, and enforce a hard maximum
  // lifetime. hideSplash() itself holds the SPLASH_MIN_MS floor, so these nets
  // can never cut the reveal short — they only ensure it eventually leaves.
  // The splash is cosmetic and must never trap the UI.
  try {
    if (typeof window.addEventListener === "function") {
      window.addEventListener(
        "load",
        function onWindowLoadedSplash() {
          window.setTimeout(hideSplash, 900);
        },
        { once: true }
      );
    }
  } catch (ignored) {}
  window.setTimeout(hideSplash, SPLASH_MAX_MS);

  var previousOnError = window.onerror;
  window.onerror = function onBootError(message, source, line, column, error) {
    if (active) {
      showError(
        "Something went wrong while the application was starting.",
        formatRuntimeError(message, source, line, column, error),
        "BOOT-RUNTIME"
      );
    }
    if (typeof previousOnError === "function") {
      return previousOnError.apply(window, arguments);
    }
    return false;
  };

  if (typeof window.addEventListener === "function") {
    window.addEventListener("unhandledrejection", function onBootRejection(event) {
      var reason = event && event.reason;
      if (active) {
        showError(
          "Something went wrong while the application was starting.",
          reason && (reason.stack || reason.message) ? reason.stack || reason.message : reason,
          "BOOT-PROMISE"
        );
      }
    });
  }

})(window, document);
