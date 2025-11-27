// src/knightlabTimeline.js

const SOUND_CLOUD_CLIENT_ID = "7NiC4CDyy3mG61NFtn7hY0EzLyrRiSQk";
const SOUND_CLOUD_RESOLVE_ENDPOINT = "https://api.soundcloud.com/resolve";

// WARNING: Do NOT ship client secret to production/frontend code.
// This is only acceptable for local testing and must be removed
// once a proper backend proxy is implemented.
const SOUND_CLOUD_CLIENT_SECRET = "MUCwjRJ2qXNCJQz4Pd8gWvBu4sV9xDAc";
const SOUND_CLOUD_TOKEN_ENDPOINT = "https://api.soundcloud.com/oauth2/token";

// Cache the token promise so we do not request it on every playlist load
let soundCloudTokenPromise = null;

async function getSoundCloudAccessToken() {
  if (soundCloudTokenPromise) {
    return soundCloudTokenPromise;
  }

  soundCloudTokenPromise = (async () => {
    const body = new URLSearchParams();
    body.set("grant_type", "client_credentials");
    body.set("client_id", SOUND_CLOUD_CLIENT_ID);
    body.set("client_secret", SOUND_CLOUD_CLIENT_SECRET);

    const response = await fetch(SOUND_CLOUD_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      soundCloudTokenPromise = null;
      throw new Error(`SoundCloud token error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.access_token) {
      soundCloudTokenPromise = null;
      throw new Error("SoundCloud token response missing access_token");
    }

    return data.access_token;
  })();

  return soundCloudTokenPromise;
}

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


// Legacy synchronous SoundCloud stream URL resolver (removed)
// function getStreamUrl(track) {
//   const baseStreamUrl =
//     track.stream_url || `https://api.soundcloud.com/tracks/${track.id}/stream`;
//   const url = new URL(baseStreamUrl);
//   url.searchParams.set("client_id", SOUND_CLOUD_CLIENT_ID);
//   return url.toString();
// }

// New async SoundCloud stream URL resolver using media.transcodings
async function resolveSoundCloudStreamUrl(track) {
  if (!track) {
    throw new Error("No track provided");
  }

  // Prefer new-style media.transcodings if available
  const transcodings =
    track.media && Array.isArray(track.media.transcodings)
      ? track.media.transcodings
      : [];

  let chosenTranscoding = null;

  if (transcodings.length > 0) {
    // Try to find a progressive MP3 stream (easier for plain <audio>)
    chosenTranscoding = transcodings.find(
      (t) =>
        t &&
        t.format &&
        t.format.protocol === "progressive"
    );

    // Fallback: if no progressive found, just take the first transcoding
    if (!chosenTranscoding) {
      chosenTranscoding = transcodings[0];
    }
  }

  // If we have a transcoding, we must call its URL with client_id to get the final streamable URL
  if (chosenTranscoding && chosenTranscoding.url) {
    const resolveUrl = `${chosenTranscoding.url}?client_id=${SOUND_CLOUD_CLIENT_ID}`;
    console.debug("[SC] Resolving transcoding URL", {
      trackId: track.id,
      resolveUrl,
      protocol:
        chosenTranscoding.format && chosenTranscoding.format.protocol,
    });

    const resp = await fetch(resolveUrl);
    if (!resp.ok) {
      throw new Error(
        `SoundCloud transcoding resolve error: ${resp.status}`
      );
    }

    const data = await resp.json();
    if (data && data.url) {
      console.debug("[SC] Final stream URL", {
        trackId: track.id,
        url: data.url,
      });
      return data.url;
    }

    throw new Error("SoundCloud transcoding response missing url");
  }

  // Try official streams endpoint as a modern fallback
  if (track.id) {
    try {
      const streams = await fetchSoundCloudTrackStreams(track.id);

      const candidateUrl =
        streams.http_mp3_128_url ||
        streams.preview_mp3_128_url ||
        streams.hls_mp3_128_url ||
        streams.hls_opus_64_url ||
        Object.values(streams).find(
          (v) => typeof v === "string" && v.startsWith("http")
        );

      if (candidateUrl) {
        let finalUrl = candidateUrl;

        // Newer API responses may return an intermediate API URL that still
        // requires OAuth (e.g. https://api.soundcloud.com/tracks/.../streams/.../http).
        // In that case we need to resolve it once with Authorization to get
        // the actual CDN URL which <audio> can load directly.
        if (candidateUrl.includes("api.soundcloud.com/tracks/")) {
          try {
            const accessToken = await getSoundCloudAccessToken();
            const resp = await fetch(candidateUrl, {
              headers: {
                Authorization: `OAuth ${accessToken}`,
              },
              // Follow redirects so resp.url points to the final CDN URL
              redirect: "follow",
            });

            if (!resp.ok) {
              throw new Error(
                `SoundCloud stream redirect error: ${resp.status}`
              );
            }

            if (resp.url && resp.url.startsWith("http")) {
              finalUrl = resp.url;
            } else {
              console.warn(
                "[SC] Streams redirect did not expose a final URL, using candidate as-is",
                { trackId: track.id, candidateUrl }
              );
            }
          } catch (innerErr) {
            console.error(
              "[SC] Failed to resolve streams endpoint URL, will try to fall back",
              innerErr
            );

            // As a last resort, use preview_mp3_128_url if available, since
            // it typically points directly to a public CDN asset.
            if (streams && streams.preview_mp3_128_url) {
              finalUrl = streams.preview_mp3_128_url;
              console.debug("[SC] Falling back to preview_mp3_128_url", {
                trackId: track.id,
                url: finalUrl,
              });
            } else {
              // Re-throw so outer catch can fall back to stream_url
              throw innerErr;
            }
          }
        }

        console.debug("[SC] Using streams endpoint URL", {
          trackId: track.id,
          url: finalUrl,
        });
        return finalUrl;
      }
    } catch (e) {
      console.error(
        "[SC] Streams endpoint failed, falling back to stream_url if available",
        e
      );
    }
  }

  // Legacy fallback: use stream_url if present
  if (track.stream_url) {
    const baseStreamUrl = track.stream_url;
    const url = new URL(baseStreamUrl);
    url.searchParams.set("client_id", SOUND_CLOUD_CLIENT_ID);
    const finalUrl = url.toString();
    console.debug("[SC] Using legacy stream_url", {
      trackId: track.id,
      url: finalUrl,
    });
    return finalUrl;
  }

  throw new Error(
    `No playable SoundCloud stream found for track ${track.id || "unknown"}`
  );
}

async function fetchSoundCloudPlaylist(playlistUrl) {
  const accessToken = await getSoundCloudAccessToken();

  const url = `${SOUND_CLOUD_RESOLVE_ENDPOINT}?url=${encodeURIComponent(
    playlistUrl
  )}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `OAuth ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`SoundCloud resolve error: ${response.status}`);
  }

  return response.json();
}

async function fetchSoundCloudTrackStreams(trackId) {
  if (!trackId) {
    throw new Error("No trackId provided for SoundCloud streams");
  }

  const accessToken = await getSoundCloudAccessToken();
  const url = `https://api.soundcloud.com/tracks/${trackId}/streams`;

  console.debug("[SC] Fetching streams endpoint", { trackId, url });

  const resp = await fetch(url, {
    headers: {
      Authorization: `OAuth ${accessToken}`,
    },
  });

  if (!resp.ok) {
    throw new Error(`SoundCloud streams error: ${resp.status}`);
  }

  const data = await resp.json();
  console.debug("[SC] Streams endpoint response", { trackId, data });
  return data;
}

function renderSoundCloudPlayer(container, tracks = []) {
  container.innerHTML = "";

  if (!tracks.length) {
    container.innerHTML =
      '<div class="sc-player__status sc-player__status--error">No tracks found</div>';
    container.dataset.soundcloudReady = "error";
    return;
  }

  const list = document.createElement("div");
  list.className = "sc-track-list";
  // Simple neutral list
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

    let streamResolved = false;
    let resolving = false;

    button.addEventListener("click", async () => {
      // Switching to a different track stops the current one
      if (activeAudio && activeAudio !== audio) {
        stopActiveAudio();
      }

      // If we already have a URL and the audio is paused, just play/pause normally
      if (streamResolved && !audio.paused) {
        // Currently playing this track → stop it
        stopActiveAudio();
        return;
      }

      if (streamResolved && audio.paused) {
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
        }
        return;
      }

      // If we reach here, stream is not resolved yet
      if (resolving) {
        // Already resolving in background, ignore extra clicks
        return;
      }

      resolving = true;
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = "Loading...";

      try {
        const url = await resolveSoundCloudStreamUrl(track);
        audio.src = url;
        audio.load();
        streamResolved = true;

        await audio.play();
        activeAudio = audio;
        activeAudioButton = button;
        button.dataset.state = "playing";
        button.textContent = "⏸";
      } catch (err) {
        console.error("Unable to play SoundCloud track", err);
        button.dataset.state = "paused";
        button.textContent = "▶";
      } finally {
        resolving = false;
        button.disabled = false;
      }
    });

    row.appendChild(button);
    row.appendChild(title);
    list.appendChild(row);
  });

  container.appendChild(list);
  container.dataset.soundcloudReady = "true";
}

async function hydrateSoundCloudPlayer(container) {
  if (
    !container ||
    container.dataset.soundcloudReady === "true" ||
    container.dataset.soundcloudReady === "loading" ||
    container.dataset.soundcloudReady === "error"
  ) {
    return;
  }

  const playlistUrl = container.getAttribute("data-soundcloud-playlist");
  if (!playlistUrl) {
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
    renderSoundCloudPlayer(container, tracks);
  } catch (error) {
    console.error("Failed to build SoundCloud player", error);
    container.innerHTML =
      '<div class="sc-player__status sc-player__status--error">Не удалось загрузить плейлист</div>';
    container.dataset.soundcloudReady = "error";
  }
}

function initSoundCloudPlayers() {
  const containers = document.querySelectorAll("[data-soundcloud-playlist]");
  containers.forEach((container) => {
    hydrateSoundCloudPlayer(container);
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

      if (typeof SC === "undefined" || !SC.Widget) {
        return;
      }

      try {
        // SC is loaded globally from index.html
        const widget = SC.Widget(iframe);
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
    7: 50, // 7 lines Paganini
    8: 50,
    9: 50,
    10: 50,
    11: 50,
    12: 50,
    13: 50,
    14: 50,
    15: 50,
    16: 50,
    17: 50,
    18: 50,
    19: 50,
    20: 50,
    21: 50,
    22: 50,
    23: 50,
    24: 50,
    25: 50,
    26: 50,
    27: 50,
    28: 50,
    29: 50,
    30: 50,
    31: 50,
    32: 50, // Rachmaninoff
    33: 37,
    34: 27,
    35: 27,
    // add more indexes here if needed
  };

  const DEFAULT_TIMENAV_HEIGHT = 50;
  // Base timenav height for title and non-overridden slides
  // 75 = initial, later can be 26/50 when collapsed/expanded



  let baseTimenavHeight = 75;
  let baseHeightRecalcTimeout = null;

  function recalcBaseTimenavHeight(reason = "auto") {
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
      applyTimenavHeight(idForHeight, reason);
    }, 120);
  }

  let isCollapsed = false;
  const COLLAPSED_TIMENAV_HEIGHT = 20;
  const MOBILE_WIDTH_BREAKPOINT = 640;

  // Apply timenav/story heights based on current slide
  function applyTimenavHeight(uniqueId, source) {
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

    let percent;

    if (index < 0) {
      // Title slide or unknown ID: always use the base timenav height
      percent = basePercent;
    } else if (index in TIMENAV_HEIGHT_BY_INDEX) {
      // Event slides with explicit override
      percent = TIMENAV_HEIGHT_BY_INDEX[index];
    } else {
      // Other event slides: fall back to basePercent
      percent = basePercent;
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

    recalcBaseTimenavHeight("viewport-resize");
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
    tnav.animateMovement = function (n, fast, css_animation) {
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
  window.timeline = new TL.Timeline(containerId, timelineJson, {
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
      applyTimenavHeight(initialId, "ready-initial");
      recalcBaseTimenavHeight("ready-auto");
      initSoundCloudPlayers();

      // Update timenav height on every slide change
      window.timeline.on("change", (e) => {
        stopActiveAudio();
        initSoundCloudPlayers();
        applyTimenavHeight(e.unique_id, "change");
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
      applyTimenavHeight(idForHeight, "toggle-collapse");
    }
  });

  // For now we do not clean up listeners, but we can return
  // a cleanup function here later if needed.
  return null;
}
