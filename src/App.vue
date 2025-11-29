<template>
  <div class="app">
    <!-- Top bar -->
    <header class="topbar">
      <button class="menu-button" @click="toggleMenu" aria-label="Toggle navigation menu">
        <span class="menu-icon"></span>
      </button>
      <img class="logo" src="/timeline/images/favicon.png" alt="Logo" @click="returnToTitle" />
      <div class="app-title" role="button" @click="returnToTitle">
        Composers
      </div>
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

      <section v-else-if="currentView === 'about'" class="about">
        <div class="about__card">
          <p class="about__eyebrow">About</p>
          <h1 class="about__title">Understand classical music by ear</h1>
          <p class="about__text">
            Sometimes you hear a familiar melody and know it is classical music. But whose? Bach, Beethoven, or Mozart -
            it can be hard to tell immediately.
          </p>
          <p class="about__text">
            This site is designed to help you hear the character of each era and each composer, compare their stories
            and musical voices, and never get lost in the names again.
          </p>

          <div class="about__author">
            <img class="about__photo" src="/timeline/images/dk3.jpg" alt="Dmitrii Kotikov" loading="lazy" />
            <div class="about__author-body">
              <div class="about__author-label">Project creator and author</div>
              <div class="about__author-name">Dmitrii Kotikov</div>
              <a class="about__link" href="https://www.linkedin.com/in/dmitrykotikov/" target="_blank" rel="noreferrer">
                Check out Dmitrii Kotikov’s profile on LinkedIn
              </a>
            </div>
          </div>
        </div>
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
  if (window.location.pathname === '/about') {
    currentView.value = 'about';
  }
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

function returnToTitle() {
  navigateTo('/');
  if (window.timeline && typeof window.timeline.goToStart === "function") {
    window.timeline.goToStart();
  }
}
</script>

<style scoped>
.content {
  position: relative;
  height: calc(100vh - 48px);
  overflow-y: auto;
}

.logo {
  height: 80%;
  object-fit: contain;
  cursor: pointer;
}

.app-title {
  font-weight: 400;
  font-size: 25px;
  /* font-family: cursive; */
  cursor: pointer;
}

.about__card {
  background: none;
  border-radius: 0;
  padding: 36px;
  box-shadow: none;
  backdrop-filter: none;
}

.about__eyebrow {
  margin: 0 0 8px;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 12px;
}

.about__title {
  margin: 0 0 18px;
  font-size: 32px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.about__text {
  margin: 0 0 14px;
  font-size: 16px;
  line-height: 1.6;
  color: #1f2937;
}

.about__author {
  margin-top: 28px;
  padding: 18px;
  border-radius: 14px;
  border: 1px dashed rgba(148, 163, 184, 0.6);
  display: flex;
  align-items: center;
  gap: 16px;
  background: rgba(255, 255, 255, 0.7);
}

.about__photo {
  width: 50%;
  max-width: 500px;
  border-radius: 14px;
  object-fit: cover;
}

.about__author-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.about__author-label {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6b7280;
}

.about__author-name {
  font-size: 18px;
  font-weight: 600;
}

.about__link {
  color: #2563eb;
  text-decoration: none;
  border-bottom: 1px solid transparent;
  width: fit-content;
}

.about__link:hover {
  border-bottom-color: currentColor;
}

@media (max-width: 640px) {
  .about__card {
    padding: 26px 22px;
  }

  .about__title {
    font-size: 26px;
    line-height: 1.2;
  }

  .about__author {
    flex-direction: column;
    align-items: flex-start;
  }

  .about__photo {
    width: 100%;
    max-width: 500px;
    margin: 0 auto;
  }

  .app-title {
    font-size: 20px;
  }
}
</style>
