<template>
  <!-- TimelineJS will render into this div -->
  <div id="timeline-embed"></div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from "vue";
import { initKnightlabTimeline } from "../knightlabTimeline";

let cleanup = null;

onMounted(() => {
  // initialize timeline when the component is mounted
  cleanup = initKnightlabTimeline("timeline-embed");
});

onBeforeUnmount(() => {
  // optional clean-up if we add it later
  if (typeof cleanup === "function") {
    cleanup();
  }
});
</script>

<style scoped>
/* базовые стили для контейнера, можно потом донастроить */
#timeline-embed {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
}
</style>