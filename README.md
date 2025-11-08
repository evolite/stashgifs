# StashGifs

A Social Media-style vertical feed for browsing Stash scene markers. Scroll through your markers like GIFs.

## Quick Start

Install via Stash's plugin system using the `index.yml` file.

## Features

- **Vertical scrolling feed** - Browse markers like a social media feed, looping videos
- **Auto-play videos** - Videos play automatically as you scroll
- **Smart search** - Full-screen dropdown on mobile, large dropdown on desktop
- **Trending searches** - See top 3 trending tags when you open search
- **Fuzzy tag matching** - Selecting "finger" matches "fingers", "finger - pov", "finger play", etc.
- **Saved filters** - Quick access to your saved marker filters
- **Auto-hiding header** - Search bar hides when scrolling down, reappears when scrolling up
- **Random content** - Fresh mix every time you load
- **Favorites** - Heart markers to save them (adds "StashGifs Favorite" tag)
- **O-count tracking** - Track and increment o-counts
- **HD mode** - Switch to full scene video with audio
- **Mobile friendly** - Works great on touch devices
- **Fullscreen support** - Watch in fullscreen

## Controls

**Search bar:**
- Click to open full-screen search dropdown
- Select trending tags or saved filters
- Search automatically matches related tags (e.g., "finger" finds "fingers", "finger - pov")
- Click search bar again to clear and start fresh

**Card buttons:**
- ❤️ **Heart** - Favorite/unfavorite (adds tag in Stash)
- 💦 **O-count** - Increment scene o-count
- ⭐ **Star** - Set rating (0-10 stars)
- **HD** - Switch to full scene video with audio
- ▶️ **Play** - Open scene in Stash at marker timestamp

**Video controls:**
- Play/pause, seek, mute/unmute, fullscreen

## Development

```bash
npm install    # Install dependencies
npm run build  # Compile TypeScript
```

## Credits

Idea from [Stash TV](https://discourse.stashapp.cc/t/stash-tv/3627).
