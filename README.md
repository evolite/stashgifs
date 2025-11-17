# StashGifs

A hobby project that turns your Stash scene markers into an endless scroll of looping GIFs. Think TikTok, but for your favorite moments.

## What's This?

I wanted a way to scroll through my scene markers like a social feed, so I built this. It transforms your markers into a vertical feed of auto-playing videos that loop endlessly. Just keep scrolling and let randomness serve you the good stuff.

## Screenshots

### Main Feed View
![Main Feed](screenshots/main-feed.png)
*The endless scroll feed with auto-playing videos and images*

### Performer and Tag Filtering
![Filtering](screenshots/filtering.png)
*Click performer or tag chips to filter the feed instantly*

### Card Interactions
![Card Actions](screenshots/card-actions.png)
*Heart favorites, rate with stars, increment o-count, and more*

### Search and Discovery
![Search](screenshots/search.png)
*Search bar with trending tags, performers, and saved filters*

### Settings
![Settings](screenshots/settings.png)
*Configure feed behavior, file types, and image inclusion*

## Getting Started

Install it via Stash's plugin system using the `index.yml` file. That's it.

## Features

- Scroll through markers like a social feed
- Videos auto-play as you browse (HD videos wait for hover)
- Image support - browse images alongside videos in the feed
- Click performer or tag chips to filter on the fly
- Every load gives you a fresh random mix
- Heart favorites, track o-counts, rate with stars
- Jump into full HD mode with audio
- Random scene player to discover new content and add markers on the spot
- Works on mobile too

## How to Use It

**The Feed:**
- Click any performer or tag chip to filter instantly
- Search bar opens a full-screen dropdown with trending tags and saved filters

**On Each Card:**
- Heart it to favorite (adds a tag in Stash)
- Increment the o-count
- Rate it (0-10 stars)
- **HD** Switch to full scene with audio
- Add a marker at the current timestamp (in random mode)
- **+** Add more tags
- Open in Stash at the marker timestamp

**Video Controls:**
- Play/pause, seek, fullscreen—standard stuff

**Images:**
- Images from your Stash library appear in the feed alongside videos
- Same interaction features as videos: heart, rate, add tags, increment o-count
- Click to view full size

## Settings

Access settings via the settings button in the header. You can configure:

- **Include images in feed** - Toggle whether images appear in the feed (enabled by default)
- **Only load images** - When enabled, only images are shown and videos are skipped
- **File extensions** - Control which file types are included (default: `.gif`). Enter comma-separated extensions like `.gif, .webm, .mp4`

Settings are saved to your browser's localStorage and persist across sessions. The page will reload after saving to apply changes.

## For Developers

```bash
npm install
npm run build
```

## AMD GPU Setup (Optional)

There are some scripts here to help Ollama use AMD GPUs for acceleration. Check them out if you need that.

## Credits

Inspired by [Stash TV](https://discourse.stashapp.cc/t/stash-tv/3627). Thanks for the idea!
