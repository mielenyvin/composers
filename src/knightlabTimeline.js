// src/knightlabTimeline.js

// Attach global SoundCloud stop handler only once
let stopSoundHandlerAttached = false;

export function initKnightlabTimeline(containerId) {
  // Global click handler for the "stop-sound" button inside slides
  if (!stopSoundHandlerAttached) {
    document.addEventListener("click", function (event) {
      if (!event.target || event.target.id !== "stop-sound") {
        return;
      }

      const iframe = document.querySelector(
        'iframe[src*="w.soundcloud.com/player"]'
      );
      if (!iframe) {
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
  let isCollapsed = false;
  const COLLAPSED_TIMENAV_HEIGHT = 20;

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

    // Adjust zoom level: default 4, but for specific index we could change it
    let zoomLevel = 3;
    if (index !== -1) {
      // example: out-of-bounds check
      zoomLevel = 4;
    }
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

      // Update timenav height on every slide change
      window.timeline.on("change", (e) => {
        applyTimenavHeight(e.unique_id, "change");
      });

      // Add Collapse button above timenav
      const timenav = document.querySelector(".tl-timenav");
      if (timenav && !document.getElementById("collapse_timeline")) {
        const collapseBtn = document.createElement("button");
        collapseBtn.id = "collapse_timeline";
        collapseBtn.innerHTML = "-"; // icon for collapse in expanded state

        // Invisible barrier to block iframe interactions on mobile
        const barrier = document.createElement("div");
        barrier.id = "collapse_timeline_barrier";

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
      event.target.innerHTML = isCollapsed ? "+" : "-";

      const idForHeight = currentSlide || window.location.hash || "";
      applyTimenavHeight(idForHeight, "toggle-collapse");
    }
  });

  // For now we do not clean up listeners, but we can return
  // a cleanup function here later if needed.
  return null;
}