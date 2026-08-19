# Royal Championship Derby

Promotional horse-jump game. 2D horse sprite + full 3D Three.js championship arena.

## Run it

The page uses an ES module `importmap`, so it **must be served over HTTP** —
opening `index.html` from the file system will fail.

```bash
cd horse_game
python3 -m http.server 8080     # or: npx serve .
# open http://localhost:8080
```

The `sprites/` folder must sit next to `index.html`. To swap any horse frame,
just replace the PNG — nothing is embedded in the HTML.

## Build

`index.html` is generated. Never edit it by hand; edit the sources and rebuild:

| Source | Contains |
|---|---|
| `backup/horse-jump-game.html` | the `<head>` + all CSS (everything up to `</style>`) |
| `_body_template.html` | the body markup / HUD / overlay screens |
| `new_game_code.js` | all game + environment logic |

```powershell
.\build_game.ps1        # Windows
```
```bash
node build_game.mjs     # macOS / Linux / CI — identical output
```

The head is now located by searching for `</style>` rather than a hard-coded
line number, so editing the CSS can no longer silently break the build.

## Business rules (enforced in code)

- Maximum discount is **15%**. `calculateReward()` ends with a hard clamp;
  no code path can print more than 15%.
- Missing the **first hurdle** = **0%**, always.
- 100% course progress ≠ 100% discount. 100% progress means the course was
  completed; 15% additionally requires full accuracy.
- 15 cleared hurdles = 100% progress = the 15% cap.

Tuning lives at the top of `new_game_code.js`: `TIMER_CONFIG`, `REWARD_CONFIG`,
`DERBY_CONFIG` (all banner/event text) and `GC` (physics, collision, difficulty).

## Environment structure

Parallax is applied per **layer**, one matrix update per layer per frame:

```
skyline 0.10  ->  grandstands + crowd 0.22  ->  towers/flags 0.30
   ->  rails/banners 0.90  ->  track + hurdles + horse 1.00
   ->  foreground decor 1.12  ->  running lights 1.20
```

Crowd LOD: 232 individually animated 3D spectators (near tier has independently
pivoting arms for clapping/waving) + 96 instanced billboard panels carrying
roughly 1,700 painted figures behind them. Cheer waves fire on hurdle clears,
hard mode and victory.

The finish gate position is **derived** from the remaining course
(`game.finishDistance`), never a hard-coded X, so it stays synchronised with
100% progress if speed, gaps or difficulty change.

## Debug handle

`window.DERBY_GAME` exposes the live game object in the browser console
(`DERBY_GAME.progress`, `.hurdlesCleared`, `.env` …).

## Known: needs a GPU pass

The transformation was verified by simulation and by software-rasterising the
exported scene graph. Textures could not be rendered offline, so **lighting,
texture detail and final colour balance still want one review pass on real
hardware** — particularly the finish arch on the closing approach.
