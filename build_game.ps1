# build_game.ps1
# Builds horse-jump-game.html from:
#   - CSS/HTML structure: taken from backup\horse-jump-game.html (lines 0..286)
#   - Game logic:         new_game_code.js
#   - Sprites:            sprites\ folder (loaded at runtime, NOT embedded)
#
# IMPORTANT: sprites\ folder must sit next to horse-jump-game.html when served.
# To update any sprite, just replace its PNG in the sprites\ folder.

$srcOriginal = Get-Content 'backup\horse-jump-game.html' -Raw -Encoding UTF8
$origLines   = $srcOriginal -split "`n"

# Keep the HTML <head> with all the CSS (lines 0..286, ends with </style>)
$htmlHead = ($origLines[0..286]) -join "`n"

# Read the new Three.js game code
$newCode = Get-Content 'new_game_code.js' -Raw -Encoding UTF8

# -------------------------------------------------------------------------
# Assemble the HTML file — no more inline ASSET_B64 script block!
# Sprites are loaded from the sprites/ folder at runtime.
# -------------------------------------------------------------------------
$newHtml = @"
$htmlHead
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"
  }
}
</script>
</head>
<body>
<div id="app">
  <div id="stage">
    <canvas id="game"></canvas>

    <div id="hud">
      <div class="hud-row">
        <div class="hud-pill" id="modePill">MODE: <b>NORMAL</b></div>
        <div id="progressWrap"><div id="hardMarker"></div><div id="progressFill"></div></div>
        <div class="hud-pill" id="progressPill">PROGRESS: <b>0%</b></div>
      </div>
      <div class="hud-row">
        <div class="hud-pill" id="rewardPill">REWARD: <b>5% OFF</b></div>
      </div>
    </div>

    <div id="feedbackLayer"></div>
    <div id="hardModeBanner">HARD MODE UNLOCKED!</div>
    <div id="startHint">SPACE / &#8593; / TAP JUMP TO CLEAR HURDLES</div>

    <button id="jumpBtn"><span class="lbl">JUMP<small>&#9650;</small></span></button>
    <button id="muteBtn">&#128266;</button>

    <!-- START SCREEN -->
    <div class="overlay active" id="screenStart">
      <div class="card">
        <div class="eyebrow">EQUESTRIAN CHALLENGE</div>
        <h1>Clear the Course</h1>
        <img class="hero-img" id="startHero" alt="Horse and rider">
        <p>Jump over every hurdle and complete the course to unlock your reward. Time it right &#8212; one miss ends the ride.</p>
        <button class="btn gold" id="btnStart">START RIDE</button>
        <div class="small-note">
          Desktop: <span class="kbd">SPACE</span> or <span class="kbd">&#8593;</span> &nbsp;&bull;&nbsp; Mobile: tap JUMP
        </div>
      </div>
    </div>

    <!-- GAME OVER SCREEN -->
    <div class="overlay" id="screenOver">
      <div class="card">
        <div class="eyebrow">RUN OVER</div>
        <h1>Hurdle Missed</h1>
        <p>The horse caught the rail. Here's how far you made it.</p>
        <div class="stat-row">
          <div class="stat-box"><div class="label">PROGRESS</div><div class="value" id="overProgress">0%</div></div>
          <div class="stat-box"><div class="label">REWARD</div><div class="value" id="overReward">5%</div></div>
        </div>
        <button class="btn" id="btnRetry">TRY AGAIN</button>
      </div>
    </div>

    <!-- VICTORY SCREEN -->
    <div class="overlay" id="screenVictory">
      <div class="card">
        <div class="eyebrow">COURSE COMPLETE</div>
        <h1>Perfect Round!</h1>
        <p>You cleared every hurdle on the course. Your reward is locked in.</p>
        <div class="stat-row">
          <div class="stat-box"><div class="label">PROGRESS</div><div class="value">100%</div></div>
          <div class="stat-box"><div class="label">REWARD</div><div class="value" id="victoryReward">100%</div></div>
        </div>
        <button class="btn gold" id="btnVictoryRestart">RIDE AGAIN</button>
      </div>
    </div>
  </div>
</div>

<script type="module">
$newCode
</script>
</body>
</html>
"@

Set-Content 'horse-jump-game.html' -Value $newHtml -Encoding UTF8
Write-Host "Done! Output file size: $((Get-Item 'horse-jump-game.html').Length) bytes"
Write-Host "(No ASSET_B64 embedded -- sprites loaded from sprites\ folder at runtime)"
