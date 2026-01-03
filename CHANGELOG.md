# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
