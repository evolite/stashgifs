# Plan: Modern Feed UI for Stash TV

## Overview
Transform the current full-screen vertical scroller into a modern social media feed interface where videos appear as individual "posts" in a scrollable feed, similar to Instagram or TikTok's feed view (not the full-screen vertical scroller).

## Current Architecture Analysis

### Current Implementation
- **Framework**: React (bundled/minified)
- **Video Player**: VideoJS library
- **Layout**: Full-screen vertical scroller
  - Each `VideoItem` takes 100% viewport height
  - Scroll snapping enabled
  - One video visible at a time
- **Structure**:
  - `VideoScroller` - Main container component
  - `VideoItem` - Individual video component (full height)
  - Uses Stash GraphQL API for fetching scenes/videos

### Key Functions to Preserve
1. Video fetching from Stash API
2. Video playback functionality
3. Scene metadata display (title, performers, studio, date)
4. Video controls (play/pause, mute, fullscreen)
5. Settings/configuration access
6. Filtering and search capabilities

## Target Architecture

### Technology Stack (Native Only)
- **Language**: TypeScript (compiled to JavaScript)
- **No Frameworks**: Pure vanilla JavaScript/TypeScript
- **Video Playback**: Native HTML5 `<video>` element
- **Rendering**: Native DOM APIs
- **Styling**: CSS3 (CSS Grid/Flexbox, CSS Variables)
- **State Management**: Native JavaScript classes/objects
- **Build Tool**: TypeScript compiler (tsc) only

### New Component Structure

```
FeedContainer
├── FeedHeader (optional - search/filters)
├── FeedScrollContainer
    ├── VideoPost (card-based)
    │   ├── VideoPostHeader (metadata)
    │   ├── VideoPlayer (native <video>)
    │   ├── VideoPostControls (play/pause, mute, etc.)
    │   └── VideoPostFooter (scene info, actions)
    ├── VideoPost
    ├── VideoPost
    └── ...
└── FeedFooter (loading indicator, pagination)
```

## Detailed Component Design

### 1. FeedContainer
**Purpose**: Main application container

**Responsibilities**:
- Initialize feed
- Manage global state (settings, filters)
- Handle API communication with Stash
- Coordinate video loading/unloading
- Manage viewport visibility detection

**Key Methods**:
```typescript
class FeedContainer {
  private videos: VideoData[]
  private visiblePosts: Set<string>
  private settings: FeedSettings
  
  async init(): Promise<void>
  async loadVideos(filters?: FilterOptions): Promise<void>
  handleScroll(): void
  handleVideoVisibilityChange(postId: string, isVisible: boolean): void
  cleanup(): void
}
```

### 2. VideoPost Component
**Purpose**: Individual video post card

**Layout Structure**:
```
┌─────────────────────────────┐
│  Header (Title, Date)       │
├─────────────────────────────┤
│                             │
│   Video Player              │
│   (16:9 or 9:16 aspect)     │
│                             │
├─────────────────────────────┤
│  Controls (play, mute)      │
├─────────────────────────────┤
│  Scene Info                 │
│  - Performers               │
│  - Studio                   │
│  - Tags                     │
└─────────────────────────────┘
```

**Key Features**:
- Fixed aspect ratio container (responsive)
- Lazy loading (load video when in viewport)
- Auto-pause when scrolled out of view
- Thumbnail/poster image before load
- Native video controls overlay

**CSS Approach**:
```css
.video-post {
  width: 100%;
  max-width: 600px; /* or responsive */
  margin: 0 auto 2rem;
  background: #1a1a1a;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}

.video-post__player {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9; /* or 9/16 for portrait */
  background: #000;
}

.video-post__player video {
  width: 100%;
  height: 100%;
  object-fit: contain; /* or cover */
}
```

### 3. Native Video Player
**Purpose**: Replace VideoJS with native HTML5 video

**Implementation**:
- Use `<video>` element directly
- Custom controls overlay (HTML/CSS)
- Intersection Observer for visibility
- Play/pause on click/tap
- Volume control
- Progress bar (custom, using `<input type="range">`)
- Fullscreen API (native browser fullscreen)

**Key Methods**:
```typescript
class NativeVideoPlayer {
  private videoElement: HTMLVideoElement
  private container: HTMLElement
  private controls: VideoControls
  
  constructor(container: HTMLElement, videoUrl: string)
  play(): void
  pause(): void
  toggleMute(): void
  seekTo(time: number): void
  enterFullscreen(): void
  exitFullscreen(): void
  updateProgress(): void
  destroy(): void
}
```

### 4. Visibility Management
**Purpose**: Efficiently handle video playback based on viewport

**Strategy**:
- Use Intersection Observer API
- Only play videos when in viewport (with threshold)
- Pause videos when scrolled away
- Preload next few videos
- Unload videos far from viewport (memory management)

**Implementation**:
```typescript
class VisibilityManager {
  private observer: IntersectionObserver
  private activeVideos: Map<string, NativeVideoPlayer>
  
  observePost(postElement: HTMLElement, postId: string): void
  handleIntersection(entries: IntersectionObserverEntry[]): void
  cleanup(): void
}
```

## Data Flow

### 1. Initialization
```
FeedContainer.init()
  → Fetch settings from Stash API
  → Load initial video batch
  → Render VideoPost components
  → Setup Intersection Observer
  → Attach scroll listeners
```

### 2. Video Loading
```
User scrolls
  → Intersection Observer detects visible posts
  → Load video source for visible posts
  → Show thumbnail/poster
  → User interacts (click/play)
  → Start video playback
```

### 3. Playback Management
```
Video enters viewport (50% visible)
  → Auto-play (if setting enabled)
  → Or show play button overlay

Video exits viewport
  → Pause playback
  → Keep in memory (or unload if far away)

User scrolls far
  → Unload video from memory
  → Keep thumbnail
```

## Styling Strategy

### CSS Architecture
- **CSS Variables**: For theming, spacing, colors
- **Mobile-First**: Responsive design
- **Flexbox/Grid**: For layout
- **CSS Transitions**: For smooth interactions
- **No CSS Frameworks**: Pure CSS3

### Key CSS Classes
```css
/* Container */
.feed-container { }
.feed-scroll-container { }

/* Post Card */
.video-post { }
.video-post__header { }
.video-post__player { }
.video-post__controls { }
.video-post__footer { }

/* Video Player */
.video-player { }
.video-player__element { }
.video-player__controls { }
.video-player__overlay { }
.video-player__progress { }

/* States */
.video-post--loading { }
.video-post--playing { }
.video-post--paused { }
```

## API Integration

### Stash GraphQL API
- Reuse existing API calls from current implementation
- Fetch scenes with filters
- Get video URLs
- Get metadata (performers, studio, tags, etc.)

### Key API Functions
```typescript
interface StashAPI {
  fetchScenes(filters: FilterOptions): Promise<Scene[]>
  getVideoUrl(sceneId: string): Promise<string>
  getThumbnailUrl(sceneId: string): Promise<string>
}
```

## Performance Considerations

### Optimization Strategies
1. **Lazy Loading**: Only load videos in/near viewport
2. **Thumbnail First**: Show poster image before video loads
3. **Progressive Loading**: Load low quality first, then high quality
4. **Memory Management**: Unload videos far from viewport
5. **Debounced Scroll**: Throttle scroll event handlers
6. **Request Animation Frame**: For smooth scroll-based animations

### Resource Management
- Limit concurrent video loads (e.g., max 3-5)
- Unload videos after X seconds out of viewport
- Use `preload="metadata"` or `preload="none"` on video elements
- Clean up event listeners on component destruction

## Migration Path

### Phase 1: Core Structure
1. Create TypeScript project structure
2. Implement FeedContainer class
3. Create basic VideoPost component
4. Implement native video player
5. Basic styling

### Phase 2: Functionality
1. Integrate Stash API
2. Implement visibility management
3. Add video controls
4. Add scene metadata display
5. Implement settings/configuration

### Phase 3: Polish
1. Add animations/transitions
2. Improve responsive design
3. Add loading states
4. Error handling
5. Accessibility improvements

### Phase 4: Advanced Features
1. Infinite scroll/pagination
2. Search/filter UI
3. Keyboard shortcuts
4. Settings panel
5. Performance optimizations

## File Structure

```
stash-tv/
├── app/
│   ├── index.html
│   ├── assets/
│   │   ├── feed.css
│   │   ├── feed.ts (compiled to feed.js)
│   │   └── ...
│   └── ...
├── src/ (TypeScript source)
│   ├── FeedContainer.ts
│   ├── VideoPost.ts
│   ├── NativeVideoPlayer.ts
│   ├── VisibilityManager.ts
│   ├── StashAPI.ts
│   ├── types.ts
│   └── utils.ts
├── tsconfig.json
└── package.json (optional, for TypeScript compiler)
```

## Browser Compatibility

### Required APIs
- Intersection Observer API
- HTML5 Video API
- Fullscreen API
- CSS Grid/Flexbox
- CSS Variables
- Fetch API

### Polyfills (if needed)
- Intersection Observer (for older browsers)
- Minimal polyfills only if absolutely necessary

## Accessibility

### Requirements
- Keyboard navigation (arrow keys, space, enter)
- Screen reader support (ARIA labels)
- Focus management
- High contrast mode support
- Reduced motion support

## Testing Strategy

### Manual Testing
- Different screen sizes (mobile, tablet, desktop)
- Different video aspect ratios
- Slow network conditions
- Many videos in feed
- Browser compatibility

### Key Scenarios
1. Scroll through feed smoothly
2. Videos play/pause correctly
3. Memory doesn't grow unbounded
4. Controls are responsive
5. Settings persist

## Open Questions / Decisions Needed

1. **Aspect Ratio**: Fixed 16:9, or preserve original aspect ratio?
2. **Auto-play**: Should videos auto-play when in viewport?
3. **Card Size**: Fixed width or responsive? Max width?
4. **Spacing**: How much space between posts?
5. **Controls**: Always visible, or fade on hover/tap?
6. **Fullscreen**: Keep fullscreen mode, or remove?
7. **Thumbnails**: Use Stash thumbnails, or generate from video?
8. **Pagination**: Infinite scroll, or "Load More" button?

## Success Criteria

- ✅ Videos display in card-based feed layout
- ✅ Native JavaScript/TypeScript only (no frameworks)
- ✅ No external dependencies (except TypeScript compiler)
- ✅ Smooth scrolling performance
- ✅ Efficient memory usage
- ✅ All existing functionality preserved
- ✅ Responsive design
- ✅ Accessible

## Estimated Complexity

- **Core Structure**: Medium
- **Video Player**: Medium-High (custom controls)
- **Visibility Management**: Medium
- **API Integration**: Low (reuse existing)
- **Styling**: Medium
- **Performance Optimization**: High
- **Total**: Medium-High complexity project

