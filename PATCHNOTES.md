# Patch Notes - Version 1.3.5

## Search & Filter Improvements

### Enhanced Search Overlay
- **Full-screen overlay**: Search suggestions dropdown now covers the entire screen for better mobile experience
- **Improved positioning**: Overlay is properly locked to the search bar and extends to the top of the screen
- **Scroll locking**: Page scrolling is disabled when the search overlay is open, preventing the header from disappearing
- **Better UX**: Overlay automatically closes when selecting a suggestion (tag, performer, or saved filter)

### Performer Search
- Added performer search functionality alongside tag search
- Suggested performers displayed in search dropdown with avatars
- Clicking a performer chip filters results by that performer

### Search Suggestions
- Reorganized suggestions: Saved filters moved to the top
- Added "Suggested Tags" and "Suggested Performers" sections (renamed from "Trending")
- Optimized performance: Reduced initial load to 40 items for faster response
- Removed post counts from suggestions for improved speed

### UI/UX Enhancements
- Search bar remains visible and accessible when overlay is open
- Improved event handling to prevent overlay from reopening unexpectedly
- Better visual feedback and interaction patterns

## Technical Improvements
- Fixed body scroll locking mechanism
- Improved event propagation handling
- Enhanced overlay positioning logic
- Performance optimizations for suggestion loading

