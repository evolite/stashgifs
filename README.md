# StashGifs

A Social Media-style vertical feed for browsing Stash scene markers. Scroll through your markers like GIFs.

## Quick Start

Install via Stash's plugin system using the `index.yml` file.

## Features

- **Vertical scrolling feed** - Browse markers like a social media feed, looping videos
- **Auto-play videos** - Videos play automatically as you scroll (HD videos play on hover)
- **Saved filters** - Quick access to your saved marker filters
- **Random content** - Fresh mix every time you load
- **Favorites** - Heart markers to save them (adds "StashGifs Favorite" tag)
- **O-count tracking** - Track and increment o-counts
- **HD mode** - Switch to full scene video with audio
- **Random scene player** - Watch random scenes and add markers if you like them
- **Add markers** - Create new markers directly from scenes
- **Mobile friendly** - Works great on touch devices
- **Fullscreen support** - Watch in fullscreen

## Controls

**Navigation:**
- **Performer chips** - Click any performer chip to filter the feed to show only markers with that performer
- **Tag chips** - Click any tag chip to filter the feed to show only markers with that tag

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
- 📌 **Marker** - Add a new marker at current timestamp (In random mode)
- **+** **Add Tag** - Add a additonal  tag to a marker
- ▶️ **Play** - Open scene in Stash at marker timestamp

**Video controls:**
- Play/pause, seek,, fullscreen

## Development

```bash
npm install    # Install dependencies
npm run build  # Compile TypeScript
```

## Ollama ROCm Setup (AMD GPU Support)

This repository includes scripts to configure Ollama to use AMD ROCm for GPU acceleration on Windows, specifically for AMD Radeon GPUs like the RX 9070 XT.

### Prerequisites

- Ollama installed (download from https://ollama.com/download)
- AMD GPU with ROCm support (RX 9070 XT, RX 7900 XT, etc.)
- AMD HIP SDK or ROCm binaries (see below)

### Setup Instructions

1. **Install AMD HIP SDK** (if not already installed):
   - Download from: https://www.amd.com/en/developer/resources/rocm-hub/rocm-installation.html
   - Or use pre-built ROCm binaries for Windows

2. **Run the setup script**:
   ```powershell
   .\setup-ollama-rocm.ps1
   ```
   
   The script will:
   - Detect your Ollama installation
   - Search for ROCm/HIP SDK binaries
   - Copy ROCm DLLs to Ollama's directory
   - Configure environment variables (ROCM_PATH, HIP_PATH, HSA_OVERRIDE_GFX_VERSION)

3. **Verify the setup**:
   ```powershell
   .\verify-ollama-gpu.ps1
   ```

4. **Test GPU acceleration**:
   ```powershell
   # Restart your terminal to load new environment variables
   ollama pull llama3.2
   ollama run llama3.2
   ```
   
   Monitor GPU usage in Task Manager > Performance > GPU to confirm the GPU is being used.

### Troubleshooting

- **No ROCm DLLs found**: Install AMD HIP SDK and run the setup script again
- **GPU not being used**: 
  - Check GPU drivers are up to date
  - Verify HSA_OVERRIDE_GFX_VERSION is set (11.0.0 for RX 9070 XT)
  - Ensure ROCm DLLs are in `%LOCALAPPDATA%\Programs\Ollama\lib\ollama\rocm\`
- **Environment variables not working**: Restart your terminal/PowerShell after running the setup script

### Script Parameters

The setup script accepts optional parameters:

```powershell
.\setup-ollama-rocm.ps1 -RocmPath "C:\Path\To\ROCm" -OllamaPath "C:\Path\To\Ollama"
```

## Credits

Idea from [Stash TV](https://discourse.stashapp.cc/t/stash-tv/3627).
