# Deploy script - Copy stashgifs plugin to Stash plugins directory

$sourceDir = Join-Path $PSScriptRoot "stashgifs"
$targetDir = "C:\Users\ow\.stash\plugins\stashgifs"

Write-Host "Deploying stashgifs plugin..." -ForegroundColor Cyan
Write-Host "Source: $sourceDir" -ForegroundColor Gray
Write-Host "Target: $targetDir" -ForegroundColor Gray

# Check if source exists
if (-not (Test-Path $sourceDir)) {
    Write-Host "Error: Source directory not found: $sourceDir" -ForegroundColor Red
    exit 1
}

# Create target directory if it doesn't exist
if (-not (Test-Path $targetDir)) {
    Write-Host "Creating target directory: $targetDir" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

# Files/folders to exclude
$excludeItems = @(
    "node_modules",
    ".git",
    ".gitignore",
    "src",
    "tsconfig.json",
    "package.json",
    "package-lock.json",
    "build.ps1"
)

Write-Host "`nCopying files..." -ForegroundColor Cyan

# Get all items in source directory
$items = Get-ChildItem -Path $sourceDir -Force

$copiedCount = 0
$skippedCount = 0

foreach ($item in $items) {
    $itemName = $item.Name
    
    # Skip excluded items
    if ($excludeItems -contains $itemName) {
        Write-Host "  Skipping: $itemName" -ForegroundColor DarkGray
        $skippedCount++
        continue
    }
    
    $sourcePath = $item.FullName
    $targetPath = Join-Path $targetDir $itemName
    
    try {
        if ($item.PSIsContainer) {
            # Copy directory
            Write-Host "  Copying directory: $itemName" -ForegroundColor Gray
            Copy-Item -Path $sourcePath -Destination $targetPath -Recurse -Force
        } else {
            # Copy file
            Write-Host "  Copying file: $itemName" -ForegroundColor Gray
            Copy-Item -Path $sourcePath -Destination $targetPath -Force
        }
        $copiedCount++
    } catch {
        Write-Host "  Error copying $itemName : $_" -ForegroundColor Red
    }
}

Write-Host "`nDeployment complete!" -ForegroundColor Green
Write-Host "  Copied: $copiedCount items" -ForegroundColor Green
Write-Host "  Skipped: $skippedCount items" -ForegroundColor Yellow
Write-Host "`nPlugin deployed to: $targetDir" -ForegroundColor Cyan

