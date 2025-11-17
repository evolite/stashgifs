/**
 * Main entry point for Stashgifs Feed UI
 */

import { FeedContainer } from './FeedContainer.js';
import { StashAPI } from './StashAPI.js';
import { FeedSettings } from './types.js';

// Initialize when DOM is ready
function init(): void {
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
  
  const appContainer = document.getElementById('app');
  if (!appContainer) {
    console.error('App container not found');
    return;
  }

  // Create feed container
  appContainer.className = 'feed-container';

  // Don't clear content - let browser handle cleanup naturally
  // This preserves the skeleton loaders that were added to the HTML for immediate display

  try {
    // Initialize API (will use window.stash if available)
    const api = new StashAPI();

    // Get settings from localStorage or use defaults
    const savedSettings = localStorage.getItem('stashgifs-settings');
    let settings: Partial<FeedSettings> = {};
    if (savedSettings) {
      try {
        settings = JSON.parse(savedSettings) as Partial<FeedSettings>;
      } catch (error) {
        console.warn('Failed to parse saved settings, using defaults', error);
        settings = {};
      }
    }

    // Create feed
    const feed = new FeedContainer(appContainer, api, settings);

    // Initialize feed
    feed.init().catch((error: unknown) => {
      console.error('Failed to initialize feed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      appContainer.innerHTML = `
        <div style="padding: 2rem; text-align: center; color: #fff;">
          <h2>Error Loading Feed</h2>
          <p>${errorMessage}</p>
          <p style="font-size: 0.875rem; color: #999;">Check browser console for details</p>
        </div>
      `;
    });

    // Expose feed to window for debugging/extension
    interface WindowWithStashgifs extends Window {
      stashgifsFeed?: FeedContainer;
    }
    (globalThis.window as WindowWithStashgifs).stashgifsFeed = feed;
  } catch (error: unknown) {
    console.error('Stashgifs Feed UI: Fatal error during initialization:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    appContainer.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: #fff;">
        <h2>Fatal Error</h2>
        <p>${errorMessage}</p>
        <p style="font-size: 0.875rem; color: #999;">Check browser console for details</p>
      </div>
    `;
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

