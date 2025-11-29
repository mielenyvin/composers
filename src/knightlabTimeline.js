// src/knightlabTimeline.js

const SOUND_CLOUD_PROXY_BASE = "/api/soundcloud";
const SOUND_CLOUD_RESOLVE_ENDPOINT = `${SOUND_CLOUD_PROXY_BASE}/playlist`;
const SOUND_CLOUD_STREAMS_ENDPOINT = `${SOUND_CLOUD_PROXY_BASE}/streams`;
const SOUND_CLOUD_TRANSCODING_ENDPOINT = `${SOUND_CLOUD_PROXY_BASE}/transcoding`;

// Keep only one audio element playing at a time
let activeAudio = null;
let activeAudioButton = null;

// Attach global SoundCloud stop handler only once
let stopSoundHandlerAttached = false;

function stopActiveAudio(resetPosition = true) {
  if (activeAudio) {
    activeAudio.pause();
    if (resetPosition) {
      activeAudio.currentTime = 0;
    }
  }

  if (activeAudioButton) {
    activeAudioButton.dataset.state = "paused";
    activeAudioButton.textContent = "▶";
  }

  activeAudio = null;
  activeAudioButton = null;
}


async function fetchSoundCloudPlaylist(playlistUrl) {
  const url = `${SOUND_CLOUD_RESOLVE_ENDPOINT}?url=${encodeURIComponent(
    playlistUrl
  )}`;

  const response = await fetch(url);
  if (!response.ok) {
    const err = new Error(`SoundCloud resolve error: ${response.status}`);
    err.status = response.status;
    throw err;
  }

  return response.json();
}

async function fetchSoundCloudStreamUrl(trackId) {
  if (!trackId) {
    throw new Error("No trackId provided for SoundCloud streams");
  }

  const resp = await fetch(
    `${SOUND_CLOUD_STREAMS_ENDPOINT}/${encodeURIComponent(trackId)}`
  );

  if (!resp.ok) {
    const err = new Error(`SoundCloud streams error: ${resp.status}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  console.debug("[SC] Streams endpoint response (proxied)", { trackId, data });

  if (!data || !data.url) {
    throw new Error("No playable SoundCloud stream URL found");
  }

  // Это уже финальный MP3/CDN URL, который можно отдавать <audio>
  return data.url;
}

// Helper to resolve media.transcodings via backend proxy
async function fetchSoundCloudTranscodingUrl(transcodingUrl) {
  if (!transcodingUrl) {
    throw new Error("No transcoding url provided");
  }

  const resp = await fetch(
    `${SOUND_CLOUD_TRANSCODING_ENDPOINT}?url=${encodeURIComponent(transcodingUrl)}`
  );

  if (!resp.ok) {
    const err = new Error(`SoundCloud transcoding error: ${resp.status}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  console.debug("[SC] Transcoding endpoint response (proxied)", {
    transcodingUrl,
    data,
  });

  if (!data || !data.url) {
    throw new Error("SoundCloud transcoding response missing url");
  }

  return data.url;
}

async function resolveSoundCloudStreamUrl(track) {
  if (!track) {
    throw new Error("No track provided");
  }

  // First try media.transcodings, like in the original working version
  const transcodings =
    track.media && Array.isArray(track.media.transcodings)
      ? track.media.transcodings
      : [];

  if (transcodings.length) {
    let chosen = transcodings.find(
      (t) =>
        t &&
        t.format &&
        t.format.protocol === "progressive"
    );

    if (!chosen) {
      chosen = transcodings[0];
    }

    if (chosen && chosen.url) {
      try {
        const finalUrl = await fetchSoundCloudTranscodingUrl(chosen.url);
        console.debug("[SC] Using transcoding URL", {
          trackId: track.id,
          transcodingUrl: chosen.url,
          finalUrl,
        });
        return finalUrl;
      } catch (err) {
        console.error(
          "[SC] Transcoding proxy failed, falling back to streams endpoint",
          err
        );
      }
    }
  }

  if (!track.id) {
    throw new Error("No track id provided");
  }

  // Fallback - use streams endpoint
  return fetchSoundCloudStreamUrl(track.id);
}

function appendSoundCloudAttribution(container) {
  if (!container) return;

  const attribution = document.createElement("div");
  attribution.className = "sc-attribution";
  attribution.style.marginTop = "6px";
  attribution.style.display = "flex";
  attribution.style.justifyContent = "flex-start";

  const attributionLink = document.createElement("a");
  attributionLink.href = "https://soundcloud.com";
  attributionLink.target = "_blank";
  attributionLink.rel = "noopener noreferrer";

  const attributionImg = document.createElement("img");
  attributionImg.src =
    "/timeline/images/powered_by_black-4339b4c3c9cf88da9bfb15a16c4f6914.png";
  attributionImg.alt = "Powered by SoundCloud";
  attributionImg.style.height = "23px";
  attributionImg.style.display = "block";
  attributionImg.style.cursor = "pointer";

  attributionLink.appendChild(attributionImg);
  attribution.appendChild(attributionLink);
  container.appendChild(attribution);
}

function showFallbackPlayer(container, playlistUrl) {
  if (!playlistUrl) {
    container.innerHTML =
      '<div class="sc-player__status sc-player__status--error">SoundCloud временно вернул 429 (rate limit).</div>';
    container.dataset.soundcloudReady = "fallback";
    return;
  }

  const encoded = encodeURIComponent(playlistUrl);
  const iframeSrc =
    "https://w.soundcloud.com/player/?url=" +
    encoded +
    "&visual=false&show_artwork=false&show_teaser=false&color=%23000000&show_user=false&buying=false&sharing=false&show_playcount=false";

  container.innerHTML = `
    <iframe
      width="100%"
      height="360"
      scrolling="no"
      frameborder="no"
      allow="autoplay"
      src="${iframeSrc}"
    ></iframe>
  `;
  container.dataset.soundcloudReady = "fallback";
}

function renderSoundCloudPlayer(container, tracks = [], playlistUrl = "") {
  container.innerHTML = "";

  if (!tracks.length) {
    container.innerHTML =
      '<div class="sc-player__status sc-player__status--error">No tracks found</div>';
    container.dataset.soundcloudReady = "error";
    return;
  }

  const list = document.createElement("div");
  list.className = "sc-track-list";
  // Simple neutral list styling (inline to avoid CSS coupling)
  list.style.margin = "0";
  list.style.padding = "0";
  list.style.fontFamily = "inherit";
  list.style.fontSize = "14px";

  tracks.forEach((track, index) => {
    const row = document.createElement("div");
    row.className = "sc-track";
    // Simple horizontal row with only a divider line between tracks
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.margin = "0";
    row.style.borderBottom = "1px solid #ddd";
    row.style.borderRadius = "0";
    row.style.background = "transparent";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "sc-track__button";
    button.dataset.state = "paused";
    button.setAttribute("aria-label", `Play ${track.title || "track"}`);
    // Use Play symbol
    button.textContent = "▶";
    // Remove decoration: no shadows, no rounded corners, no margins
    button.style.margin = "0";
    // Make the button narrower and shorter
    button.style.padding = "0 4px";
    button.style.borderRadius = "0";
    button.style.boxShadow = "none";
    button.style.background = "transparent";
    button.style.border = "none";
    button.style.color = "#000";
    button.style.fontFamily = "inherit";
    // Slightly smaller icon size to match the smaller button
    button.style.fontSize = "12px";
    button.style.lineHeight = "1";
    button.style.cursor = "pointer";

    const title = document.createElement("div");
    title.className = "sc-track__title";
    title.textContent = track.title || `Track ${index + 1}`;
    title.style.margin = "0";
    title.style.padding = "0";
    title.style.fontWeight = "normal";

    // Lazy-load audio stream URL on first play
    const audio = new Audio();
    audio.preload = "none";
    audio.addEventListener("ended", () => stopActiveAudio());

    button.addEventListener("click", async () => {
      if (button.disabled) {
        return;
      }

      // Switching to a different track stops the current one
      if (activeAudio && activeAudio !== audio) {
        stopActiveAudio();
      }

      // Resolve stream URL once before the first play
      if (!audio.src) {
        button.disabled = true;
        const previousText = button.textContent;
        button.textContent = "⏳";

        try {
          const url = await resolveSoundCloudStreamUrl(track);
          audio.src = url;
          audio.load();
        } catch (err) {
          console.error("Unable to load SoundCloud stream", err);
          button.dataset.state = "paused";
          button.textContent = "▶";
          button.disabled = false;
          if (err && err.status === 429 && playlistUrl) {
            showFallbackPlayer(container, playlistUrl);
          }
          return;
        }

        button.textContent = previousText;
        button.disabled = false;
      }

      if (audio.paused) {
        try {
          await audio.play();
          activeAudio = audio;
          activeAudioButton = button;
          button.dataset.state = "playing";
          button.textContent = "⏸";
        } catch (err) {
          console.error("Unable to play SoundCloud track", err);
          button.dataset.state = "paused";
          button.textContent = "▶";
          if (err && err.status === 429 && playlistUrl) {
            showFallbackPlayer(container, playlistUrl);
          }
        }
      } else {
        stopActiveAudio();
      }
    });

    row.appendChild(button);
    row.appendChild(title);
    list.appendChild(row);
  });

  container.appendChild(list);
  appendSoundCloudAttribution(container);
  container.dataset.soundcloudReady = "true";
}

async function hydrateSoundCloudPlayer(container, onReady) {
  const finalize = () => {
    if (typeof onReady === "function") {
      // Defer slightly so layout has time to settle
      setTimeout(() => onReady(), 0);
    }
  };
  if (
    !container ||
    container.dataset.soundcloudReady === "true" ||
    container.dataset.soundcloudReady === "loading" ||
    container.dataset.soundcloudReady === "error"
  ) {
    finalize();
    return;
  }

  const playlistUrl = container.getAttribute("data-soundcloud-playlist");
  if (!playlistUrl) {
    finalize();
    return;
  }

  container.dataset.soundcloudReady = "loading";
  container.innerHTML =
    '<div class="sc-player__status">Loading tracks from SoundCloud...</div>';

  try {
    const playlist = await fetchSoundCloudPlaylist(playlistUrl);
    const tracks =
      Array.isArray(playlist.tracks) && playlist.tracks.length
        ? playlist.tracks
        : playlist && playlist.kind === "track"
          ? [playlist]
          : [];
    renderSoundCloudPlayer(container, tracks, playlistUrl);
    finalize();
  } catch (error) {
    console.error("Failed to build SoundCloud player", error);
    const isRateLimited = error && error.status === 429;
    if (isRateLimited) {
      showFallbackPlayer(container, playlistUrl);
    } else {
      container.innerHTML =
        '<div class="sc-player__status sc-player__status--error">Could not load SoundCloud playlist</div>';
      container.dataset.soundcloudReady = "error";
    }
    finalize();
  }
}

function initSoundCloudPlayers(onAllReady) {
  const containers = document.querySelectorAll("[data-soundcloud-playlist]");

  if (!containers.length) {
    if (typeof onAllReady === "function") {
      onAllReady();
    }
    return;
  }

  let remaining = containers.length;

  containers.forEach((container) => {
    hydrateSoundCloudPlayer(container, () => {
      remaining -= 1;
      if (remaining === 0 && typeof onAllReady === "function") {
        onAllReady();
      }
    });
  });
}

export function initKnightlabTimeline(containerId) {
  // Global click handler for the "stop-sound" button inside slides
  if (!stopSoundHandlerAttached) {
    document.addEventListener("click", function (event) {
      if (!event.target || event.target.id !== "stop-sound") {
        return;
      }

      stopActiveAudio();

      const iframe = document.querySelector(
        'iframe[src*="w.soundcloud.com/player"]'
      );
      if (!iframe) {
        return;
      }

      const sc = window.SC;
      if (!sc || !sc.Widget) {
        return;
      }

      try {
        // SC is loaded globally from index.html
        const widget = sc.Widget(iframe);
        widget.pause();
      } catch (e) {
        console.error("Could not control SoundCloud widget:", e);
      }
    });

    stopSoundHandlerAttached = true;
  }

  // Instead of document.getElementById("timeline-embed")
  const embed = document.getElementById(containerId);
  if (!embed) {
    console.error(`Timeline container with id "${containerId}" not found`);
    return null;
  }

  // JSON is now served by Vue via public/timeline
  const timelineJson = "/timeline/timeline.json";

  // Per-slide timenav height mapping (by event index in timeline.config.events)
  // Index 0 = first event slide (second visual screen, after the title)
  const TIMENAV_HEIGHT_BY_INDEX = {
    0: 27, // first event slide
    1: 27, // 4 lines
    2: 27,
    3: 27, // Handel
    4: 27, // 5 lines Haydn
    5: 37, // Mozart
    6: 37, // 6 lines Beethoven
    7: 40, // 7 lines Paganini
    8: 40,
    9: 40,
    10: 40,
    11: 40,
    12: 40,
    13: 40,
    14: 40,
    15: 40,
    16: 40,
    17: 40,
    18: 40,
    19: 40,
    20: 40,
    21: 40,
    22: 40,
    23: 40,
    24: 40,
    25: 40,
    26: 40,
    27: 40,
    28: 40,
    29: 40,
    30: 40,
    31: 40,
    32: 40, // Rachmaninoff
    33: 37,
    34: 27,
    35: 27,
    36: 27
    // add more indexes here if needed
  };

  const DEFAULT_TIMENAV_HEIGHT = 50;
  // Base timenav height for title and non-overridden slides
  // 75 = initial, later can be 26/50 when collapsed/expanded



  let baseTimenavHeight = 75;
  let baseHeightRecalcTimeout = null;

  function recalcBaseTimenavHeight() {
    if (baseHeightRecalcTimeout) {
      clearTimeout(baseHeightRecalcTimeout);
    }

    // Defer to make sure the timeline DOM is rendered before measuring heights
    baseHeightRecalcTimeout = setTimeout(() => {
      baseHeightRecalcTimeout = null;

      const embedEl = document.getElementById(containerId);
      const firstBlockEl = document.getElementById("firstblock");
      const headlineEl = document.querySelector(".tl-text-headline-container");

      if (!embedEl || !firstBlockEl || !headlineEl) {
        return;
      }

      const availableHeight = embedEl.offsetHeight;
      if (!availableHeight) {
        return;
      }

      const textHeight = firstBlockEl.offsetHeight + headlineEl.offsetHeight;
      const percent = Math.max(
        10,
        Math.min(90, Math.round(100 * (1 - textHeight / availableHeight)))
      );

      if (!Number.isFinite(percent)) {
        return;
      }

      baseTimenavHeight = percent - 2;

      if (window.timeline && window.timeline.options) {
        window.timeline.options.timenav_height_percentage = percent;
      }

      const idForHeight =
        (window.timeline && window.timeline.current_id) ||
        window.location.hash ||
        "";
      applyTimenavHeight(idForHeight);
    }, 120);
  }

  let isCollapsed = false;
  const COLLAPSED_TIMENAV_HEIGHT = 20;
  const MOBILE_WIDTH_BREAKPOINT = 640;

  // Helper to compute dynamic timenav height percent for the current slide
  function computeDynamicTimenavPercent(index) {
    // Only for event slides, not for the title (index === -1)
    if (index < 0) {
      return null;
    }

    const embedEl = document.getElementById(containerId);
    if (!embedEl) return null;

    const slideEl =
      document.querySelector(".tl-slide.tl-slide-visible") ||
      document.querySelector(".tl-slide.tl-slide-current");
    const textContentContainer =
      (slideEl &&
        slideEl.querySelector(".tl-text-content-container")) ||
      null;
    const textEl =
      (slideEl && slideEl.querySelector(".tl-text-content")) || null;
    const textInner =
      (textEl && (textEl.firstElementChild || textEl)) ||
      (textContentContainer && textContentContainer.firstElementChild) ||
      null;
    const scPlayerEl =
      (slideEl && slideEl.querySelector(".sc-player")) || null;
    const slideTextEl =
      (slideEl && slideEl.querySelector(".tl-text")) || null;

    const headlineEl =
      (slideEl && slideEl.querySelector(".tl-text-headline-container")) ||
      document.querySelector(".tl-text-headline-container");
    const compContentNodes = document.querySelectorAll("#comp-content");
    const compContentEl =
      index >= 0 && compContentNodes[index] ? compContentNodes[index] : null;
    const compContentHeightComputed =
      compContentEl && window.getComputedStyle
        ? parseFloat(
          window
            .getComputedStyle(compContentEl, null)
            .getPropertyValue("height")
        ) || compContentEl.offsetHeight || 0
        : compContentEl
          ? compContentEl.offsetHeight
          : 0;
    const headlineHeightComputed =
      headlineEl && window.getComputedStyle
        ? parseFloat(
          window
            .getComputedStyle(headlineEl, null)
            .getPropertyValue("height")
        ) || headlineEl.offsetHeight || 0
        : headlineEl
          ? headlineEl.offsetHeight
          : 0;

    const availableHeight = embedEl.offsetHeight;
    if (!availableHeight) {
      return null;
    }

    let contentHeight = 0;
    const candidates = [
      textInner,
      textEl,
      textContentContainer,
      scPlayerEl,
      slideTextEl,
      compContentEl,
    ].filter(Boolean);

    if (candidates.length) {
      contentHeight = Math.max(
        ...candidates.map((el) =>
          Math.max(el.scrollHeight || 0, el.offsetHeight || 0)
        )
      );
    } else if (headlineEl && compContentEl) {
      contentHeight = headlineEl.offsetHeight + compContentEl.offsetHeight;
    }

    // Add computed heights for headline + comp-content (by slide index) when available
    if (compContentHeightComputed || headlineHeightComputed) {
      const combined =
        (compContentHeightComputed || 0) + (headlineHeightComputed || 0);
      if (combined > contentHeight) {
        contentHeight = combined;
      }
    }

    // Small extra headroom for the text block
    contentHeight += 10;

    const rawPercent = Math.round(
      100 * (1 - contentHeight / availableHeight)
    );

    if (!Number.isFinite(rawPercent)) {
      return null;
    }

    // At least 27% timenav height
    const clamped = rawPercent < 27 ? 27 : rawPercent;

    // Debug heights for diagnosing overlap
    console.log("[timenav-height]", {
      slideIndex: index,
      availableHeight,
      contentHeight,
      rawPercent,
      clampedPercent: clamped,
      textInnerHeight: textInner ? textInner.offsetHeight : null,
      textElHeight: textEl ? textEl.offsetHeight : null,
      textContentContainerHeight: textContentContainer
        ? textContentContainer.offsetHeight
        : null,
      scPlayerHeight: scPlayerEl ? scPlayerEl.offsetHeight : null,
      slideTextHeight: slideTextEl ? slideTextEl.offsetHeight : null,
      headlineElHeight: headlineEl ? headlineEl.offsetHeight : null,
      compContentHeight: compContentEl ? compContentEl.offsetHeight : null,
      compContentHeightComputed,
    });

    return clamped;
  }

  // Apply timenav/story heights based on current slide
  function applyTimenavHeight(uniqueId) {
    if (
      !window.timeline ||
      !window.timeline.config ||
      !Array.isArray(window.timeline.config.events)
    ) {
      return;
    }

    // Base percentage is taken from our global baseTimenavHeight
    // 75 for initial title layout, or 26/50 after collapse/expand.
    let basePercent =
      typeof baseTimenavHeight === "number"
        ? baseTimenavHeight
        : DEFAULT_TIMENAV_HEIGHT;

    const events = window.timeline.config.events;

    // Normalize ID (strip leading '#' if it comes from URL hash)
    let normalizedId = uniqueId;
    if (!normalizedId && window.timeline.current_id) {
      normalizedId = window.timeline.current_id;
    }
    if (
      typeof normalizedId === "string" &&
      normalizedId.charAt(0) === "#"
    ) {
      normalizedId = normalizedId.substring(1);
    }

    const index = events.findIndex((ev) => ev.unique_id === normalizedId);

    let percentBase;

    if (index < 0) {
      // Title slide or unknown ID: always use the base timenav height
      percentBase = basePercent;
    } else if (index in TIMENAV_HEIGHT_BY_INDEX) {
      // Event slides with explicit override
      percentBase = TIMENAV_HEIGHT_BY_INDEX[index];
    } else {
      // Other event slides: fall back to basePercent
      percentBase = basePercent;
    }

    // Dynamically compute timenav height for this slide
    const dynamicPercent = computeDynamicTimenavPercent(index);

    let percent = percentBase;

    if (typeof dynamicPercent === "number") {
      // Choose the larger of the default value and the dynamic one
      percent = Math.max(percentBase, dynamicPercent);
    }

    // Ensure a minimum timenav height of 27%
    if (percent < 27) {
      percent = 27;
    }

    if (isCollapsed) {
      percent = COLLAPSED_TIMENAV_HEIGHT;
    }

    const viewportWidth =
      (window.visualViewport && window.visualViewport.width) ||
      window.innerWidth;
    const isMobileMode = viewportWidth <= MOBILE_WIDTH_BREAKPOINT;
    const zoomForTitle = isMobileMode ? 3 : 2;
    const zoomForEvents = isMobileMode ? 4 : 3;
    let zoomLevel = index === -1 ? zoomForTitle : zoomForEvents;
    if (typeof window.timeline.setZoom === "function") {
      window.timeline.setZoom(zoomLevel);
    }

    // Store the chosen percentage back into timeline options
    if (window.timeline.options) {
      window.timeline.options.timenav_height_percentage = percent;
    }

    // Ask TimelineJS to recalculate layout based on the new percentage
    if (typeof window.timeline.updateDisplay === "function") {
      window.timeline.updateDisplay();

      // Reposition Collapse button after timenav height change
      setTimeout(positionCollapseControls, 0);
    }
  }

  function resizeToViewport() {
    const viewport = window.visualViewport;

    // Height of the top bar from the Vue app
    const topbar = document.querySelector(".topbar");
    const topbarHeight = topbar ? topbar.offsetHeight : 0;

    const windowHeight = viewport ? viewport.height : window.innerHeight;
    const windowWidth = viewport ? viewport.width : window.innerWidth;

    // Use the width of the container's parent (content area),
    // not the full window width
    const parent = embed.parentElement;
    const contentWidth = parent ? parent.clientWidth : windowWidth;

    // Height = viewport height minus top bar
    const contentHeight = windowHeight - topbarHeight;

    embed.style.width = contentWidth + "px";
    embed.style.height = contentHeight + "px";

    if (window.timeline && typeof window.timeline.updateDisplay === "function") {
      window.timeline.updateDisplay();
    }

    recalcBaseTimenavHeight();
  }

  function applyHeightForCurrentSlide() {
    const idForHeight =
      (window.timeline && window.timeline.current_id) ||
      window.location.hash ||
      "";
    // Defer to next tick so slide DOM settles
    setTimeout(() => applyTimenavHeight(idForHeight), 0);
  }

  function attachReadMoreToggles() {
    const container = document.getElementById(containerId);
    if (!container) return;

    const isMobileWidth = () => {
      const viewportWidth =
        (window.visualViewport && window.visualViewport.width) ||
        window.innerWidth;
      return viewportWidth <= MOBILE_WIDTH_BREAKPOINT;
    };

    const updateFactsVisibility = () => {
      const mobile = isMobileWidth();
      const parents = container.querySelectorAll("#comp-content");
      parents.forEach((parent) => {
        const toggle = parent.querySelector(".facts-toggle");
        const extras = parent.querySelectorAll(".fact--extra");
        if (!toggle || !extras.length) return;

        if (!mobile) {
          extras.forEach((el) => {
            el.style.display = "list-item";
          });
          toggle.style.display = "none";
          toggle.dataset.state = "expanded";
          toggle.textContent = "Read more facts";
          return;
        }

        const state = toggle.dataset.state || "collapsed";
        const showAll = state === "expanded";

        extras.forEach((el) => {
          el.style.display = showAll ? "list-item" : "none";
        });
        toggle.style.display = "inline-block";
        toggle.textContent = showAll ? "Show less" : "Read more facts";
      });

      applyHeightForCurrentSlide();
      setTimeout(applyHeightForCurrentSlide, 100);
    };

    container.addEventListener("click", (event) => {
      const link = event.target.closest(".facts-toggle");
      if (!link) return;

      // On desktop we always show everything; just refresh layout.
      if (!isMobileWidth()) {
        updateFactsVisibility();
        return;
      }

      event.preventDefault();
      const state = link.dataset.state || "collapsed";
      const parent = link.closest("#comp-content") || link.parentElement;
      if (!parent) return;

      const extraFacts = parent.querySelectorAll(".fact--extra");
      const isCollapsed = state === "collapsed";

      extraFacts.forEach((el) => {
        el.style.display = isCollapsed ? "list-item" : "none";
      });

      link.dataset.state = isCollapsed ? "expanded" : "collapsed";
      link.textContent = isCollapsed ? "Show less" : "Read more facts";

      updateFactsVisibility();
    });

    const resizeHandler = () => updateFactsVisibility();
    window.addEventListener("resize", resizeHandler);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", resizeHandler);
    }

    updateFactsVisibility();
  }

  // Observe slide text height changes (e.g., when SoundCloud list finishes rendering)
  let slideResizeObserver = null;
  let resizeRaf = null;

  function attachSlideResizeObserver() {
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    if (slideResizeObserver) {
      slideResizeObserver.disconnect();
    }

    const slideEl =
      document.querySelector(".tl-slide.tl-slide-visible") ||
      document.querySelector(".tl-slide.tl-slide-current");
    const textEl =
      (slideEl && slideEl.querySelector(".tl-text-content")) || null;
    const textInner =
      (textEl && (textEl.firstElementChild || textEl)) ||
      (slideEl &&
        slideEl.querySelector(".tl-text-content-container") &&
        slideEl
          .querySelector(".tl-text-content-container")
          .firstElementChild) ||
      null;
    const textContentContainer =
      (slideEl &&
        slideEl.querySelector(".tl-text-content-container")) ||
      null;
    const scPlayerEl =
      (slideEl && slideEl.querySelector(".sc-player")) || null;
    const compContentEl = document.getElementById("comp-content");
    const slideTextEl =
      (slideEl && slideEl.querySelector(".tl-text")) || null;

    const targets = [
      textInner,
      textEl,
      textContentContainer,
      scPlayerEl,
      compContentEl,
      slideTextEl,
    ].filter(Boolean);

    if (!targets.length) {
      return;
    }

    slideResizeObserver = new ResizeObserver(() => {
      if (resizeRaf) {
        cancelAnimationFrame(resizeRaf);
      }
      resizeRaf = requestAnimationFrame(() => {
        applyHeightForCurrentSlide();
      });
    });

    targets.forEach((el) => slideResizeObserver.observe(el));
  }

  function scheduleHeightRecalcAfterContent() {
    applyHeightForCurrentSlide();
    setTimeout(applyHeightForCurrentSlide, 100);
    setTimeout(applyHeightForCurrentSlide, 1000);
  }

  function positionCollapseControls() {
    const timenav = document.querySelector(".tl-timenav");
    const collapseBtn = document.getElementById("collapse_timeline");
    const barrier = document.getElementById("collapse_timeline_barrier");
    if (!timenav || !collapseBtn || !timenav.parentElement) {
      return;
    }

    const container = timenav.parentElement;

    // Кнопка должна позиционироваться относительно контейнера
    const containerStyle = window.getComputedStyle(container);
    if (containerStyle.position === "static") {
      container.style.position = "relative";
    }

    const timenavRect = timenav.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const btnRect = collapseBtn.getBoundingClientRect();

    const rightPos = containerRect.right - timenavRect.right + 10;
    const bottomPos = containerRect.bottom - timenavRect.top - 1;

    // Явно убираем left, чтобы не тянуло влево
    collapseBtn.style.left = "auto";
    collapseBtn.style.right = rightPos + "px";
    collapseBtn.style.bottom = bottomPos + "px";

    if (barrier) {
      barrier.style.left = "auto";
      barrier.style.right = rightPos - 5 + "px";
      barrier.style.bottom = bottomPos - 5 + "px";
      barrier.style.width = btnRect.width + 10 + "px";
      barrier.style.height = btnRect.height + 10 + "px";
    }
  }

  // Shift timenav center a bit to the left
  const LEFT_BIAS = 0.1; // 10% from left instead of 50% center

  function biasTimeNav(tnav) {
    if (!tnav || !tnav.animateMovement) return;
    const originalDispatch = tnav._dispatchVisibleTicksChange.bind(tnav);
    tnav.animateMovement = function (n, fast) {
      if (this.animator && typeof this.animator.stop === "function") {
        this.animator.stop();
      }
      const center = this.options.width * LEFT_BIAS;
      const clampedIndex = Math.max(
        0,
        Math.min(n, this._markers.length - 0)
      );
      const leftValue = -this._markers[clampedIndex].getLeft() + center;
      this._el.slider.className = fast
        ? "tl-timenav-slider"
        : "tl-timenav-slider tl-timenav-slider-animate";
      this.animate_css = !fast;
      this._el.slider.style.left = leftValue + "px";
      this.current_id = this._markers[clampedIndex]?.data.unique_id || "";
      originalDispatch();
    };
    tnav.goToId(tnav.current_id, true);
  }

  // Create global timeline instance
  const timelineLib = window.TL;
  if (!timelineLib || !timelineLib.Timeline) {
    console.error("TimelineJS library not available on window.TL");
    return null;
  }

  window.timeline = new timelineLib.Timeline(containerId, timelineJson, {
    timenav_height_percentage: baseTimenavHeight,
    timenav_position: "bottom",
    hash_bookmark: true,
    marker_padding: 0,
    marker_height_min: 0,
    scale_factor: 1, // spread events along time
    initial_zoom: 4, // starting zoom level
  });

  if (window.timeline && window.timeline.on) {
    window.timeline.on("ready", () => {
      biasTimeNav(window.timeline._timenav);
      const initialId =
        window.timeline.current_id || window.location.hash || "";
      applyTimenavHeight(initialId);
      recalcBaseTimenavHeight();
      attachReadMoreToggles();

      // Initialize SoundCloud players, then re-apply height once they are rendered
      initSoundCloudPlayers(() => {
        scheduleHeightRecalcAfterContent();
        attachSlideResizeObserver();
      });

      // Update timenav height on every slide change, but wait for SoundCloud block to load
      window.timeline.on("change", () => {
        stopActiveAudio();
        initSoundCloudPlayers(() => {
          scheduleHeightRecalcAfterContent();
          attachSlideResizeObserver();
        });
      });

      // Add Collapse button above timenav
      const timenav = document.querySelector(".tl-timenav");
      if (timenav && !document.getElementById("collapse_timeline")) {
        const collapseBtn = document.createElement("button");
        collapseBtn.id = "collapse_timeline";
        collapseBtn.innerHTML = "▼"; // icon for collapse in expanded state

        // Basic inline styles for the collapse button so it stays visible above the barrier
        collapseBtn.style.position = "absolute";
        collapseBtn.style.zIndex = "1000";

        // Invisible barrier to block iframe interactions on mobile
        const barrier = document.createElement("div");
        barrier.id = "collapse_timeline_barrier";

        // Make the barrier invisible but clickable (for blocking iframe interactions on mobile)
        barrier.style.position = "absolute";
        barrier.style.zIndex = "999";
        barrier.style.background = "transparent";
        barrier.style.pointerEvents = "auto";

        // Insert barrier and button before timenav
        timenav.parentElement.insertBefore(barrier, timenav);
        timenav.parentElement.insertBefore(collapseBtn, timenav);

        // Ensure layout is complete before positioning
        setTimeout(positionCollapseControls, 0);

        const resizeHandler = () => {
          if (document.getElementById("collapse_timeline")) {
            positionCollapseControls();
          }
        };

        window.addEventListener("resize", resizeHandler);
        if (window.visualViewport) {
          window.visualViewport.addEventListener("resize", resizeHandler);
        }
      }
    });
  }

  resizeToViewport();
  window.addEventListener("resize", resizeToViewport);
  window.addEventListener("orientationchange", resizeToViewport);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", resizeToViewport);
  }

  // Track Collapse/Expand state
  document.addEventListener("click", function (event) {
    if (event.target && event.target.id === "collapse_timeline") {
      isCollapsed = !isCollapsed;

      const currentSlide = window.timeline && window.timeline.current_id;

      // Update button icon depending on state
      event.target.innerHTML = isCollapsed ? "▲" : "▼";

      const idForHeight = currentSlide || window.location.hash || "";
      applyTimenavHeight(idForHeight);
    }
  });

  // For now we do not clean up listeners, but we can return
  // a cleanup function here later if needed.
  return null;
}
