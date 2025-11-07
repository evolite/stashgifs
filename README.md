# StashGifs

A GIF-style vertical scroller interface for Stash. Forked from Stash Reels.

## What is it?

StashGifs turns your Stash scene markers into a vertical social media feed. Scroll through your markers like you're browsing GIFs - perfect for quick browsing and discovery.

## Features

- **Vertical Scrolling Feed** - Smooth, infinite scrolling through generated scene markers
- **Auto-playing Videos** - Videos automatically play as you scroll
- **Random Content** - Get a fresh mix of content every time you load
- **Filtering** - Filter by tags or saved marker filters
- **Favorites** - Heart your favorite markers for quick access later (Adds a "StashGifs Favorite" tag to the marker)
- **O-Count Tracking** - Track and increment o-counts directly from the feed
- **High-Quality Mode** - Switch to full scene video with audio when you want the full experience
- **Mobile Friendly** - Works great on mobile devices with touch controls
- **Fullscreen Support** - Watch in fullscreen on desktop and mobile

## Installation

Install via Stash's plugin system using the index.yml file. The plugin will be available in your Stash settings.

## Building

If you want to build from source:

1. Install dependencies: `npm install`
2. Compile TypeScript: `.\build.ps1` (or `npx tsc`)
3. Zip the `stashgifs/` folder for deployment

## Navigation

Each card in the feed has several buttons on the right side:

- **❤️ Heart Button** - Click to favorite/unfavorite a marker. Favorited markers get a "StashGifs Favorite" tag added to them in Stash, making them easy to filter and find later.
- **💦 O-Count Button** - Click to increment the o-count for the scene. The count is displayed next to the emoji and updates in real-time.
- **HD Badge** - Click to switch from the low-res marker preview to the full high-quality scene video with audio. The video will start at the marker's timestamp.
- **▶️ Play Button** - Opens the full scene in Stash at the exact marker timestamp in a new tab.

The video player itself also has controls:
- **Play/Pause** - Control video playback
- **Progress Bar** - Seek through the video
- **Mute/Unmute** - Toggle audio (marker videos don't have sound, but scene videos do)
- **Fullscreen** - Watch in fullscreen mode

## How it works

The plugin creates a vertical feed interface that fetches scene markers from your Stash instance via GraphQL. Each marker is displayed as a card with the video, tags, performers, and interactive controls. Videos autoplay as they come into view and pause when you scroll away.

## Credits

Forked from [Stash TV](https://discourse.stashapp.cc/t/stash-tv/3627). Built as a hobby project to make browsing Stash more fun.