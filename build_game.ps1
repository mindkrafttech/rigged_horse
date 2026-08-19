# build_game.ps1
# Builds index.html from:
#   - CSS/HTML head:  backup\horse-jump-game.html  (everything up to and including </style>)
#   - Body markup:    _body_template.html
#   - Game logic:     new_game_code.js
#   - Sprites:        sprites\ folder (loaded at runtime, NOT embedded)
#
# IMPORTANT: the sprites\ folder must sit next to index.html when served.
# To update any sprite, just replace its PNG in the sprites\ folder.
#
# NOTES:
#  * The head is located by searching for </style>, not a hard-coded line
#    number, so editing the CSS can never silently break the build.
#  * String .Replace() is used instead of -replace because the game code
#    contains  ${...}  template literals that PowerShell regex would mangle.

$origLines = (Get-Content 'backup\horse-jump-game.html' -Raw -Encoding UTF8) -split "`n"

$styleEnd = -1
for ($i = 0; $i -lt $origLines.Length; $i++) {
  if ($origLines[$i].Trim() -eq '</style>') { $styleEnd = $i }
}
if ($styleEnd -lt 0) { throw 'Could not find </style> in backup\horse-jump-game.html' }

$htmlHead = ($origLines[0..$styleEnd]) -join "`n"
$newCode  = Get-Content 'new_game_code.js'    -Raw -Encoding UTF8
$body     = Get-Content '_body_template.html' -Raw -Encoding UTF8

$newHtml = $htmlHead + "`n" + $body.Replace('__GAME_CODE__', $newCode)

Set-Content 'index.html' -Value $newHtml -Encoding UTF8 -NoNewline
if (Test-Path 'horse-jump-game.html') { Remove-Item 'horse-jump-game.html' -Force }
Write-Host "Done! Updated index.html (size: $((Get-Item 'index.html').Length) bytes)"
