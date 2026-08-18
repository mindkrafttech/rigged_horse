# extract_sprites.ps1
# Extracts all embedded base64 horse sprites from the backup HTML
# and saves them as PNG files in the sprites\ folder

$src = Get-Content 'backup\horse-jump-game.html' -Raw -Encoding UTF8

# Find and parse the ASSET_B64 JSON object
$startIdx = $src.IndexOf('"runA"')
$endIdx   = $src.IndexOf('};', $startIdx) + 1

$jsonBlock = '{' + $src.Substring($startIdx, $endIdx - $startIdx)

# Create sprites folder
$spritesDir = ".\sprites"
if (-not (Test-Path $spritesDir)) { New-Item -ItemType Directory -Path $spritesDir | Out-Null }

# Parse each key-value pair using regex
$pattern = '"(\w+)":\s*"([A-Za-z0-9+/=]+)"'
$matches  = [regex]::Matches($jsonBlock, $pattern)

Write-Host "Found $($matches.Count) sprite entries:`n"

foreach ($m in $matches) {
    $key    = $m.Groups[1].Value
    $b64    = $m.Groups[2].Value
    $outPath = "$spritesDir\$key.png"

    try {
        $bytes = [System.Convert]::FromBase64String($b64)
        [System.IO.File]::WriteAllBytes($outPath, $bytes)
        $kb = [math]::Round($bytes.Length / 1024, 1)
        Write-Host "  [$key]  ->  sprites\$key.png  ($kb KB)"
    } catch {
        Write-Host "  [$key]  ERROR: $_"
    }
}

Write-Host "`nDone! All sprites saved to: $spritesDir"
