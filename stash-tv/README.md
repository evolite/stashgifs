# Stash TV Feed UI

Modern feed interface for Stash TV - transforming from full-screen scroller to card-based feed.

## Building

### Prerequisites
- Node.js and npm
- TypeScript (will be installed via npx if not available)

### Build Steps

1. Install dependencies (optional, TypeScript will be downloaded via npx):
   ```bash
   npm install
   ```

2. Compile TypeScript:
   ```bash
   npx tsc
   ```
   
   Or use the build script:
   ```bash
   ./build.ps1  # Windows PowerShell
   ```

3. The compiled JavaScript will be in `app/assets/` directory.

## Development

### File Structure
```
stash-tv/
├── src/              # TypeScript source files
│   ├── index.ts     # Main entry point
│   ├── FeedContainer.ts
│   ├── VideoPost.ts
│   ├── NativeVideoPlayer.ts
│   ├── VisibilityManager.ts
│   ├── StashAPI.ts
│   ├── types.ts
│   └── utils.ts
├── app/
│   ├── index.html   # Main HTML file
│   └── assets/
│       ├── feed.css # Feed UI styles
│       └── *.js     # Compiled JavaScript
├── tsconfig.json    # TypeScript configuration
└── package.json     # Project metadata
```

### Using the Feed UI

To use the new feed UI instead of the old scroller:

1. Compile TypeScript: `npx tsc`
2. Update `app/index.html` to include:
   ```html
   <link rel="stylesheet" href="./assets/feed.css">
   <script type="module" src="./assets/index.js"></script>
   ```

## Features

- ✅ Native TypeScript/JavaScript (no frameworks)
- ✅ HTML5 video player with custom controls
- ✅ Intersection Observer for lazy loading
- ✅ Card-based feed layout
- ✅ Responsive design
- ✅ Type-safe codebase

## Status

Phase 1: Core Structure - ✅ Complete
- TypeScript project setup
- Core classes implemented
- Basic styling

Phase 2: Functionality - 🚧 In Progress
- Stash API integration
- Video playback
- Settings/configuration

Phase 3: Polish - ⏳ Pending
- Animations
- Error handling
- Accessibility

Phase 4: Advanced Features - ⏳ Pending
- Infinite scroll
- Search/filter UI
- Keyboard shortcuts

