/**
 * Main entry point for Stashgifs Feed UI
 */

import { FeedContainer } from './FeedContainer.js';
import { StashAPI } from './StashAPI.js';
import { PluginSettingsManager } from './PluginSettingsManager.js';
import { FeedSettings } from './types.js';
import { toRgba, darkenHex, normalizeHexColor } from './utils.js';

/**
 * Load theme colors early to prevent color flash before UI renders
 * Applies user-selected color palette to CSS custom properties immediately
 */
function loadFonts(): void {
  const existing = document.querySelector('link[data-stashgifs-fonts="true"]');
  if (existing) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap';
  link.dataset.stashgifsFonts = 'true';
  document.head.appendChild(link);
}

function getSavedSettings(): Partial<FeedSettings> {
  const savedSettings = localStorage.getItem('stashgifs-settings');
  if (!savedSettings) return {};

  try {
    return JSON.parse(savedSettings) as Partial<FeedSettings>;
  } catch (error) {
    console.warn('Failed to parse saved settings for early theme loading', error);
    return {};
  }
}

function loadThemeEarly(settings: Partial<FeedSettings>): void {
  try {
    const background = normalizeHexColor(settings.themeBackground, '#1F2A33');
    const primary = normalizeHexColor(settings.themePrimary, '#2C3B46');
    const secondary = normalizeHexColor(settings.themeSecondary, '#24323C');
    const accent = normalizeHexColor(settings.themeAccent, '#4FA3D1');

    const root = document.documentElement;
    root.style.setProperty('--color-bg', background);
    root.style.setProperty('--color-surface', primary);
    root.style.setProperty('--color-surface-secondary', secondary);
    root.style.setProperty('--color-bg-overlay', toRgba(background, 0.96));
    root.style.setProperty('--color-accent', accent);
    root.style.setProperty('--color-accent-strong', darkenHex(accent, 0.15));
    root.style.setProperty('--color-accent-weak', toRgba(accent, 0.18));
    root.style.setProperty('--color-accent-weaker', toRgba(accent, 0.1));
    root.style.setProperty('--color-text-primary', '#E6EEF4');
    root.style.setProperty('--color-text-secondary', '#B4C0C9');
    root.style.setProperty('--color-text-muted', '#8A99A6');

    document.documentElement.dataset.stashgifsThemeReady = 'true';
  } catch (error) {
    console.warn('Failed to load theme early', error);
  }
}

function applyReelModeEarly(settings: Partial<FeedSettings>, container?: HTMLElement | null): void {
  if (!settings.reelMode) return;
  document.documentElement.style.scrollSnapType = 'y mandatory';
  document.documentElement.dataset.stashgifsReelReady = 'true';

  if (container) {
    container.style.width = '100vw';
    container.style.maxWidth = '100vw';
    container.style.margin = '0';
    container.style.marginLeft = 'calc(50% - 50vw)';
    container.style.marginRight = 'calc(50% - 50vw)';
    container.style.padding = '0';
  }
}

// Initialize when DOM is ready
function init(): void {
  const handleMediaError = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target instanceof HTMLImageElement) {
      const src = target.currentSrc || target.src || '';
      console.warn('Media error: image failed to load', { src });
      return;
    }
    if (target instanceof HTMLVideoElement) {
      const src = target.currentSrc || target.src || '';
      console.warn('Media error: video failed to load', { src });
      return;
    }
    if (target instanceof HTMLSourceElement) {
      const src = target.src || '';
      console.warn('Media error: source failed to load', { src });
    }
  };

  globalThis.addEventListener('error', handleMediaError, true);

  loadFonts();
  const savedSettings = getSavedSettings();
  
  // Check if we should scroll to top after reload
  if (sessionStorage.getItem('stashgifs-scroll-to-top') === 'true') {
    sessionStorage.removeItem('stashgifs-scroll-to-top');
    // Scroll to top immediately
    window.scrollTo(0, 0);
    // Also ensure document is at top
    if (document.documentElement) {
      document.documentElement.scrollTop = 0;
    }
    if (document.body) {
      document.body.scrollTop = 0;
    }
  }
  
  interface WindowWithStashgifs extends Window {
    stashgifsFeed?: FeedContainer;
  }

  const appContainer = document.getElementById('app');
  if (!appContainer) {
    console.error('App container not found');
    return;
  }

  // Create feed container
  appContainer.className = 'feed-container';
  applyReelModeEarly(savedSettings, appContainer);

  // Don't clear content - let browser handle cleanup naturally

  try {
    // Initialize API (will use window.stash if available)
    const api = new StashAPI();

    // Create settings manager (reads from localStorage synchronously)
    const settingsManager = new PluginSettingsManager(api);

    // Get settings from localStorage or use defaults
    const settings = savedSettings;

    const existingFeed = (globalThis.window as WindowWithStashgifs).stashgifsFeed;
    if (existingFeed) {
      existingFeed.destroy();
      (globalThis.window as WindowWithStashgifs).stashgifsFeed = undefined;
    }

    // Create feed
    const feed = new FeedContainer(appContainer, api, settings, settingsManager);

    // When server settings arrive and differ from local cache, update feed
    settingsManager.setOnSettingsUpdated((data) => {
      if (data.settings && Object.keys(data.settings).length > 0) {
        loadThemeEarly(data.settings);
        feed.updateSettings(data.settings);
      }
    });

    // Initialize feed
    feed.init().catch((error: unknown) => {
      console.error('Failed to initialize feed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
       appContainer.innerHTML = `
         <div style="padding: 2rem; text-align: center; color: var(--color-text-primary, #E6EEF4);">
           <h2>Error Loading Feed</h2>
           <p>${errorMessage}</p>
           <p style="font-size: 0.875rem; color: var(--color-text-muted, #8A99A6);">Check browser console for details</p>
         </div>
       `;
    });

    // Background: sync settings from server (handles migration + cross-device sync)
    settingsManager.loadFromServer().catch((error: unknown) => {
      console.warn('Failed to sync settings from server:', error);
    });

    (globalThis.window as WindowWithStashgifs).stashgifsFeed = feed;
  } catch (error: unknown) {
    console.error('Stashgifs Feed UI: Fatal error during initialization:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
     appContainer.innerHTML = `
       <div style="padding: 2rem; text-align: center; color: var(--color-text-primary, #E6EEF4);">
         <h2>Fatal Error</h2>
         <p>${errorMessage}</p>
         <p style="font-size: 0.875rem; color: var(--color-text-muted, #8A99A6);">Check browser console for details</p>
       </div>
     `;
  }
}

// Apply theme immediately at script load — before any event listener fires.
// document.documentElement is always available; localStorage is synchronous.
loadThemeEarly(getSavedSettings());

// Wait for DOM to be ready for the rest
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
