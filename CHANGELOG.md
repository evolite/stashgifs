# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.21.3] - 2026-01-15

### Changed
- Fix rating dialog overlay sizing and anchoring
- Revise image feed feature description in README
- Revise README with updated features and AI usage

## [5.21.2] - 2026-01-04

### Changed
- Added new files ot manifest

## [5.21.1] - 2026-01-04

### Changed
- Fixed sonarqube issues
- Fixed sonarqube issues
- Videos as Images are now handles like markers, and can be normal / HD, added rating support for images

## [5.21.0] - 2026-01-04

### Changed
- Improved API logic and small layout changes
- Improved caching and filtering
- Added performer country as flags on performer image liek Stash does it, and some small graphical fixes
- Improved StashAPI funcitons
- Improved pagination
- Scroll bar shoudl now always return to the top when applying a new filter
- Improved filtering logic

## [5.20.0] - 2026-01-04

### Changed
- Ensure consistent sort order across pagination pages, preventing duplicates or missing items.

## [5.19.0] - 2026-01-03

### Changed
- Improved Image is Video Playback feature

## [5.18.0] - 2026-01-03

## [5.17.0] - 2026-01-03

### Changed
- Simplified videos is images playback, now just plays the preview
- Excluded image codecs from video detection — even if visualFiles has a video_codec or duration, image formats are treated as images
- Excluded image codecs from video detection — even if visualFiles has a video_codec or duration, image formats are treated as images
- Clicking the stashgifs logo now clears all filters
- Added support for video exttensions as images (H.264/MP4 or WebM primarily)
- Updated description

## [5.16.0] - 2026-01-03

## [5.15.15] - 2026-01-03

### Changed
- Fixed couple of sonarqube issues
- Made things better
- Remove deploy.sh and release.sh from git tracking
- Refactor deployment script and update .gitignore

## [5.15.13] - 2026-01-03

### Changed
- Fixed couple of sonarqube issues
- Made things better
- Remove deploy.sh and release.sh from git tracking
- Refactor deployment script and update .gitignore


## [5.15.12] - 2026-01-03

### Changed
- Made things better
- Remove deploy.sh and release.sh from git tracking
- Refactor deployment script and update .gitignore

### Added
- Version display in settings page footer
- Automatic version generation from package.json during build
- Release notes support in release script (auto-generate from git commits or use custom notes)
- CHANGELOG.md generation support in release script

### Fixed
- Removed unused CLEAR_SVG import
- Removed unnecessary type assertion in snapThrottleTimeout
- Removed commented code in CSS
- Fixed duplicate CSS properties (touch-action, min-width)
- Merged duplicate :root selector in CSS
- Improved text contrast for better accessibility
- Fixed empty CSS ruleset

## [5.15.11] - 2026-01-03

### Changed
- Version bump to 5.15.11
