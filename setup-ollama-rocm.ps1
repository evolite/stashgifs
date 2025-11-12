# Setup Ollama with ROCm for AMD GPU Support on Windows
# This script configures Ollama to use AMD ROCm libraries for GPU acceleration

param(
    [string]$RocmPath = "C:\Users\ow\Downloads\ROCm-rocm-7.1.0\ROCm-rocm-7.1.0",
    [string]$OllamaPath = "$env:LOCALAPPDATA\Programs\Ollama"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Ollama ROCm Setup for AMD GPU" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Function to find ROCm DLLs in a directory
function Find-RocmDlls {
    param([string]$SearchPath)
    
    $dlls = @()
    $requiredDlls = @(
        "rocblas.dll",
        "rocfft.dll",
        "rocsparse.dll",
        "hipblas.dll",
        "hipfft.dll",
        "hipsparse.dll",
        "hiprtc.dll",
        "amdhip64.dll",
        "hsa-runtime64.dll",
        "hsakmt.dll"
    )
    
    if (Test-Path $SearchPath) {
        foreach ($dll in $requiredDlls) {
            $found = Get-ChildItem -Path $SearchPath -Filter $dll -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($found) {
                $dlls += $found
            }
        }
    }
    
    return $dlls
}

# Step 1: Verify Ollama installation
Write-Host "[1/6] Checking Ollama installation..." -ForegroundColor Yellow
if (-not (Test-Path $OllamaPath)) {
    Write-Host "ERROR: Ollama not found at $OllamaPath" -ForegroundColor Red
    Write-Host "Please install Ollama first from https://ollama.com/download" -ForegroundColor Red
    exit 1
}

$ollamaRocmPath = Join-Path $OllamaPath "lib\ollama\rocm"
Write-Host "  ✓ Ollama found at: $OllamaPath" -ForegroundColor Green

# Step 2: Check for ROCm/HIP SDK installation
Write-Host ""
Write-Host "[2/6] Searching for ROCm/HIP SDK binaries..." -ForegroundColor Yellow

$rocmDlls = @()
$rocmInstallPaths = @(
    "C:\Program Files\AMD\ROCm",
    "C:\Program Files (x86)\AMD\ROCm",
    "C:\ROCm",
    "$env:ProgramFiles\AMD\ROCm",
    "$env:ProgramFiles(x86)\AMD\ROCm",
    "C:\Program Files\AMD\HIP",
    "C:\Program Files (x86)\AMD\HIP",
    "$env:ProgramFiles\AMD\HIP",
    "$env:ProgramFiles(x86)\AMD\HIP"
)

# Also check the provided ROCm path for any built binaries
$rocmInstallPaths += $RocmPath

foreach ($path in $rocmInstallPaths) {
    if (Test-Path $path) {
        Write-Host "  Checking: $path" -ForegroundColor Gray
        $found = Find-RocmDlls -SearchPath $path
        if ($found.Count -gt 0) {
            Write-Host "  ✓ Found ROCm DLLs in: $path" -ForegroundColor Green
            $rocmDlls = $found
            break
        }
    }
}

# Check common bin/lib directories
if ($rocmDlls.Count -eq 0) {
    $commonSubPaths = @("bin", "lib", "lib\bin", "build\bin", "build\lib", "install\bin", "install\lib")
    foreach ($subPath in $commonSubPaths) {
        $testPath = Join-Path $RocmPath $subPath
        if (Test-Path $testPath) {
            Write-Host "  Checking: $testPath" -ForegroundColor Gray
            $found = Find-RocmDlls -SearchPath $testPath
            if ($found.Count -gt 0) {
                Write-Host "  ✓ Found ROCm DLLs in: $testPath" -ForegroundColor Green
                $rocmDlls = $found
                break
            }
        }
    }
}

if ($rocmDlls.Count -eq 0) {
    Write-Host ""
    Write-Host "WARNING: ROCm DLLs not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "The ROCm source code directory was found, but no built binaries (DLLs) were detected." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "You need to either:" -ForegroundColor Yellow
    Write-Host "  1. Install AMD HIP SDK for Windows from:" -ForegroundColor Yellow
    Write-Host "     https://www.amd.com/en/developer/resources/rocm-hub/rocm-installation.html" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  2. Or build ROCm from source (advanced)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "After installing HIP SDK, run this script again." -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Do you want to continue anyway? (y/N)"
    if ($continue -ne "y" -and $continue -ne "Y") {
        exit 1
    }
}

# Step 3: Create Ollama ROCm directory
Write-Host ""
Write-Host "[3/6] Setting up Ollama ROCm directory..." -ForegroundColor Yellow
if (-not (Test-Path $ollamaRocmPath)) {
    New-Item -ItemType Directory -Path $ollamaRocmPath -Force | Out-Null
    Write-Host "  ✓ Created directory: $ollamaRocmPath" -ForegroundColor Green
} else {
    Write-Host "  ✓ Directory exists: $ollamaRocmPath" -ForegroundColor Green
}

# Step 4: Copy ROCm DLLs to Ollama
if ($rocmDlls.Count -gt 0) {
    Write-Host ""
    Write-Host "[4/6] Copying ROCm DLLs to Ollama..." -ForegroundColor Yellow
    
    $copiedCount = 0
    foreach ($dll in $rocmDlls) {
        $destPath = Join-Path $ollamaRocmPath $dll.Name
        try {
            Copy-Item -Path $dll.FullName -Destination $destPath -Force
            Write-Host "  ✓ Copied: $($dll.Name)" -ForegroundColor Green
            $copiedCount++
        } catch {
            Write-Host "  ✗ Failed to copy: $($dll.Name) - $_" -ForegroundColor Red
        }
    }
    
    Write-Host "  Copied $copiedCount DLL(s)" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[4/6] Skipping DLL copy (no DLLs found)" -ForegroundColor Yellow
}

# Step 5: Set environment variables
Write-Host ""
Write-Host "[5/6] Setting up environment variables..." -ForegroundColor Yellow

# Find ROCm base path (where DLLs came from)
$rocmBasePath = ""
if ($rocmDlls.Count -gt 0) {
    $rocmBasePath = Split-Path -Parent $rocmDlls[0].FullName
    # Go up to find the main ROCm directory
    while ($rocmBasePath -and -not (Test-Path (Join-Path $rocmBasePath "bin"))) {
        $parent = Split-Path -Parent $rocmBasePath
        if ($parent -eq $rocmBasePath) { break }
        $rocmBasePath = $parent
    }
}

if (-not $rocmBasePath) {
    # Try to find it from common installation paths
    foreach ($path in $rocmInstallPaths) {
        if (Test-Path $path) {
            $rocmBasePath = $path
            break
        }
    }
}

if ($rocmBasePath) {
    # Set user-level environment variables
    [Environment]::SetEnvironmentVariable("ROCM_PATH", $rocmBasePath, "User")
    [Environment]::SetEnvironmentVariable("HIP_PATH", $rocmBasePath, "User")
    
    # Add to PATH if not already there
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $rocmBinPath = Join-Path $rocmBasePath "bin"
    
    if ($currentPath -notlike "*$rocmBinPath*" -and (Test-Path $rocmBinPath)) {
        [Environment]::SetEnvironmentVariable("Path", "$currentPath;$rocmBinPath", "User")
        Write-Host "  ✓ Added ROCm bin to PATH" -ForegroundColor Green
    }
    
    # Set GPU architecture override for RX 9070 XT (RDNA 3 / gfx1100)
    [Environment]::SetEnvironmentVariable("HSA_OVERRIDE_GFX_VERSION", "11.0.0", "User")
    
    Write-Host "  ✓ Set ROCM_PATH: $rocmBasePath" -ForegroundColor Green
    Write-Host "  ✓ Set HIP_PATH: $rocmBasePath" -ForegroundColor Green
    Write-Host "  ✓ Set HSA_OVERRIDE_GFX_VERSION: 11.0.0 (for RX 9070 XT)" -ForegroundColor Green
} else {
    Write-Host "  ⚠ Could not determine ROCm base path, skipping environment variables" -ForegroundColor Yellow
    Write-Host "    You may need to set these manually:" -ForegroundColor Yellow
    Write-Host "    - ROCM_PATH" -ForegroundColor Yellow
    Write-Host "    - HIP_PATH" -ForegroundColor Yellow
    Write-Host "    - HSA_OVERRIDE_GFX_VERSION=11.0.0" -ForegroundColor Yellow
}

# Step 6: Summary
Write-Host ""
Write-Host "[6/6] Setup complete!" -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Ollama Path: $OllamaPath" -ForegroundColor White
Write-Host "ROCm DLLs Location: $ollamaRocmPath" -ForegroundColor White
if ($rocmDlls.Count -gt 0) {
    Write-Host "ROCm DLLs Found: $($rocmDlls.Count)" -ForegroundColor Green
} else {
    Write-Host "ROCm DLLs Found: 0 (you may need to install HIP SDK)" -ForegroundColor Yellow
}
if ($rocmBasePath) {
    Write-Host "ROCm Base Path: $rocmBasePath" -ForegroundColor White
}
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Restart your terminal/PowerShell to load new environment variables" -ForegroundColor White
Write-Host "2. Run: .\verify-ollama-gpu.ps1" -ForegroundColor White
Write-Host "3. Test with: ollama run llama3.2" -ForegroundColor White
Write-Host ""
Write-Host "Note: If DLLs were not found, install AMD HIP SDK and run this script again." -ForegroundColor Yellow
Write-Host ""

