# Verify Ollama GPU Support with ROCm
# This script checks if Ollama is properly configured to use AMD GPU acceleration

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Ollama GPU Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check 1: Ollama installation
Write-Host "[1/5] Checking Ollama installation..." -ForegroundColor Yellow
$ollamaPath = "$env:LOCALAPPDATA\Programs\Ollama"
$ollamaExe = Join-Path $ollamaPath "ollama.exe"

if (Test-Path $ollamaExe) {
    Write-Host "  ✓ Ollama found at: $ollamaExe" -ForegroundColor Green
    
    # Check Ollama version
    try {
        $version = & $ollamaExe --version 2>&1
        if ($version) {
            Write-Host "  Version: $version" -ForegroundColor Gray
        }
    } catch {
        Write-Host "  ⚠ Could not get version" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ✗ Ollama not found!" -ForegroundColor Red
    Write-Host "    Please install Ollama from https://ollama.com/download" -ForegroundColor Red
    exit 1
}

# Check 2: ROCm DLLs in Ollama
Write-Host ""
Write-Host "[2/5] Checking ROCm DLLs in Ollama..." -ForegroundColor Yellow
$ollamaRocmPath = Join-Path $ollamaPath "lib\ollama\rocm"

if (Test-Path $ollamaRocmPath) {
    $rocmDlls = Get-ChildItem -Path $ollamaRocmPath -Filter "*.dll" -ErrorAction SilentlyContinue
    if ($rocmDlls.Count -gt 0) {
        Write-Host "  ✓ Found $($rocmDlls.Count) ROCm DLL(s):" -ForegroundColor Green
        foreach ($dll in $rocmDlls) {
            Write-Host "    - $($dll.Name)" -ForegroundColor Gray
        }
    } else {
        Write-Host "  ✗ No ROCm DLLs found in $ollamaRocmPath" -ForegroundColor Red
        Write-Host "    Run setup-ollama-rocm.ps1 first" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ✗ ROCm directory not found: $ollamaRocmPath" -ForegroundColor Red
    Write-Host "    Run setup-ollama-rocm.ps1 first" -ForegroundColor Yellow
}

# Check 3: Environment variables
Write-Host ""
Write-Host "[3/5] Checking environment variables..." -ForegroundColor Yellow

$rocmPath = [Environment]::GetEnvironmentVariable("ROCM_PATH", "User")
$hipPath = [Environment]::GetEnvironmentVariable("HIP_PATH", "User")
$gfxVersion = [Environment]::GetEnvironmentVariable("HSA_OVERRIDE_GFX_VERSION", "User")

if ($rocmPath) {
    Write-Host "  ✓ ROCM_PATH: $rocmPath" -ForegroundColor Green
} else {
    Write-Host "  ⚠ ROCM_PATH not set" -ForegroundColor Yellow
}

if ($hipPath) {
    Write-Host "  ✓ HIP_PATH: $hipPath" -ForegroundColor Green
} else {
    Write-Host "  ⚠ HIP_PATH not set" -ForegroundColor Yellow
}

if ($gfxVersion) {
    Write-Host "  ✓ HSA_OVERRIDE_GFX_VERSION: $gfxVersion" -ForegroundColor Green
} else {
    Write-Host "  ⚠ HSA_OVERRIDE_GFX_VERSION not set (may be needed for RX 9070 XT)" -ForegroundColor Yellow
}

# Check 4: Ollama service status
Write-Host ""
Write-Host "[4/5] Checking Ollama service..." -ForegroundColor Yellow

try {
    $ollamaRunning = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
    if ($ollamaRunning) {
        Write-Host "  ✓ Ollama is running (PID: $($ollamaRunning.Id))" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ Ollama is not running" -ForegroundColor Yellow
        Write-Host "    Start it with: ollama serve" -ForegroundColor Gray
    }
} catch {
    Write-Host "  ⚠ Could not check Ollama process" -ForegroundColor Yellow
}

# Check 5: Test GPU detection
Write-Host ""
Write-Host "[5/5] Testing GPU detection..." -ForegroundColor Yellow

# Check if ollama command is available
$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollamaCmd) {
    Write-Host "  ⚠ 'ollama' command not in PATH" -ForegroundColor Yellow
    Write-Host "    Add $ollamaPath to your PATH or use full path" -ForegroundColor Gray
} else {
    Write-Host "  ✓ 'ollama' command available" -ForegroundColor Green
    
    # Try to get GPU info (if supported)
    Write-Host ""
    Write-Host "  Attempting to check GPU support..." -ForegroundColor Gray
    Write-Host "  (This may take a moment)" -ForegroundColor Gray
    
    try {
        # Try to pull llama3.2 if not already available
        Write-Host ""
        Write-Host "  Checking if llama3.2 model is available..." -ForegroundColor Gray
        $models = & ollama list 2>&1
        if ($models -match "llama3.2") {
            Write-Host "  ✓ llama3.2 model found" -ForegroundColor Green
        } else {
            Write-Host "  ⚠ llama3.2 model not found" -ForegroundColor Yellow
            Write-Host "    Download it with: ollama pull llama3.2" -ForegroundColor Gray
        }
    } catch {
        Write-Host "  ⚠ Could not check models: $_" -ForegroundColor Yellow
    }
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Verification Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$allGood = $true

if (-not (Test-Path $ollamaExe)) {
    Write-Host "✗ Ollama not installed" -ForegroundColor Red
    $allGood = $false
}

if (-not (Test-Path $ollamaRocmPath) -or (Get-ChildItem -Path $ollamaRocmPath -Filter "*.dll" -ErrorAction SilentlyContinue).Count -eq 0) {
    Write-Host "✗ ROCm DLLs not configured" -ForegroundColor Red
    Write-Host "  Run: .\setup-ollama-rocm.ps1" -ForegroundColor Yellow
    $allGood = $false
}

if (-not $rocmPath -or -not $hipPath) {
    Write-Host "⚠ Environment variables not set" -ForegroundColor Yellow
    Write-Host "  Run: .\setup-ollama-rocm.ps1" -ForegroundColor Yellow
}

if ($allGood) {
    Write-Host ""
    Write-Host "✓ Basic configuration looks good!" -ForegroundColor Green
    Write-Host ""
    Write-Host "To test GPU acceleration:" -ForegroundColor Cyan
    Write-Host "1. Make sure Ollama is running: ollama serve" -ForegroundColor White
    Write-Host "2. Run a model: ollama run llama3.2" -ForegroundColor White
    Write-Host "3. Monitor GPU usage in Task Manager > Performance > GPU" -ForegroundColor White
    Write-Host ""
    Write-Host "If GPU is not being used, check:" -ForegroundColor Yellow
    Write-Host "- GPU drivers are up to date" -ForegroundColor White
    Write-Host "- AMD HIP SDK is properly installed" -ForegroundColor White
    Write-Host "- HSA_OVERRIDE_GFX_VERSION is set correctly (11.0.0 for RX 9070 XT)" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "Please fix the issues above and run this script again." -ForegroundColor Yellow
}

Write-Host ""

