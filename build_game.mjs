#!/usr/bin/env node
/* build_game.mjs — cross-platform twin of build_game.ps1.
   Produces byte-identical index.html on Windows / macOS / Linux / CI.
     node build_game.mjs
*/
import fs from 'fs';

const head = fs.readFileSync('backup/horse-jump-game.html', 'utf8').split('\n');
let styleEnd = -1;
head.forEach((l, i) => { if (l.trim() === '</style>') styleEnd = i; });
if (styleEnd < 0) throw new Error('Could not find </style> in backup/horse-jump-game.html');

const htmlHead = head.slice(0, styleEnd + 1).join('\n');
const body = fs.readFileSync('_body_template.html', 'utf8');
const code = fs.readFileSync('new_game_code.js', 'utf8');

const out = htmlHead + '\n' + body.replace('__GAME_CODE__', () => code);
fs.writeFileSync('index.html', out, 'utf8');
if (fs.existsSync('horse-jump-game.html')) fs.unlinkSync('horse-jump-game.html');
console.log(`Done! Updated index.html (${out.length} bytes)`);
