/**
 * Main entry point for Stash TV Feed UI
 */

import { FeedContainer } from './FeedContainer';
import { StashAPI } from './StashAPI';
import { FeedSettings } from './types';

// Initialize when DOM is ready
function init(): void {
  const appContainer = document.getElementById('app');
  if (!appContainer) {
    console.error('App container not found');
    return;
  }

  // Create feed container
  appContainer.className = 'feed-container';

  // Initialize API (will use window.stash if available)
  const api = new StashAPI();

  // Get settings from localStorage or use defaults
  const savedSettings = localStorage.getItem('stash-tv-settings');
  const settings: Partial<FeedSettings> = savedSettings
    ? JSON.parse(savedSettings)
    : {};

  // Create feed
  const feed = new FeedContainer(appContainer, api, settings);

  // Initialize feed
  feed.init().catch((error) => {
    console.error('Failed to initialize feed:', error);
  });

  // Expose feed to window for debugging/extension
  (window as any).stashTVFeed = feed;
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

