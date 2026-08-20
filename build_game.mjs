import fs from 'fs';

const headSource = fs.existsSync('backup/horse-jump-game.html') ? 'backup/horse-jump-game.html' : 'index.html';
const head = fs.readFileSync(headSource, 'utf8').split('\n');
let styleEnd = -1;
for (let i = 0; i < head.length; i++) {
  if (head[i].trim() === '</style>') {
    styleEnd = i;
    break; // MUST STOP AT FIRST </style> tag in <head>!
  }
}
if (styleEnd < 0) throw new Error('Could not find </style>');

const htmlHead = head.slice(0, styleEnd + 1).join('\n');
const body = fs.readFileSync('_body_template.html', 'utf8');
const code = fs.readFileSync('new_game_code.js', 'utf8');

const out = htmlHead + '\n' + body.replace('__GAME_CODE__', () => code);
fs.writeFileSync('index.html', out, 'utf8');
if (fs.existsSync('horse-jump-game.html')) fs.unlinkSync('horse-jump-game.html');
console.log(`Done! Updated index.html (${out.length} bytes)`);
