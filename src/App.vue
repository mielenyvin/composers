<template>
  <div class="app">
    <!-- Top bar -->
    <header class="topbar">
      <button class="menu-button" @click="toggleMenu" aria-label="Toggle navigation menu">
        <span class="menu-icon"></span>
      </button>
      <img class="logo" src="/favicon.png" alt="Logo" />
      <div class="app-title">Composers</div>
    </header>

    <!-- Side menu -->
    <aside class="side-menu" :class="{ 'side-menu--open': isMenuOpen }">
      <nav class="menu-nav">
        <button class="menu-item" :class="{ 'menu-item--active': currentView === 'composers' }"
          @click="selectView('composers')">
          Composers
        </button>
        <button class="menu-item" :class="{ 'menu-item--active': currentView === 'about' }"
          @click="selectView('about')">
          About
        </button>
      </nav>
    </aside>

    <!-- Backdrop for mobile when menu is open -->
    <div v-if="isMenuOpen" class="backdrop" @click="closeMenu"></div>

    <!-- Main content -->
    <main class="content">
      <section v-if="currentView === 'composers'">
        <ComposersTimeline />
      </section>

      <section v-else-if="currentView === 'about'">
        <h1>About</h1>
        <p>Authors will be added soon.</p>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";
import ComposersTimeline from "./components/ComposersTimeline.vue";

// Controls whether the side menu is visible
const isMenuOpen = ref(false);

// Current view is derived from window.location.pathname ("/" or "/about")
const currentView = ref("composers");

function updateViewFromLocation(pathname = window.location.pathname) {
  if (pathname === "/about") {
    currentView.value = "about";
  } else {
    // Default route is Composers
    currentView.value = "composers";
  }
}

const handlePopState = () => {
  updateViewFromLocation();
};

onMounted(() => {
  // Set initial view based on current URL
  updateViewFromLocation();
  // Listen for back/forward navigation
  window.addEventListener("popstate", handlePopState);
});

onBeforeUnmount(() => {
  window.removeEventListener("popstate", handlePopState);
});

function navigateTo(path) {
  if (window.location.pathname !== path) {
    history.pushState({}, "", path);
    updateViewFromLocation(path);
  }
  isMenuOpen.value = false;
}

function selectView(view) {
  const path = view === "about" ? "/about" : "/";
  navigateTo(path);
}

function toggleMenu() {
  isMenuOpen.value = !isMenuOpen.value;
}

function closeMenu() {
  isMenuOpen.value = false;
}
</script>

<style scoped>
.logo {
  height: 80%;
  object-fit: contain;
}

.app-title {
  font-weight: 600;
  font-size: 25px;
  font-family: cursive !important;
}

@media (max-width: 640px) {
  .app-title {
    font-size: 20px;
  }
}
</style>