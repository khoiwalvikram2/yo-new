// The player theme (shared/src/theme/playerTheme.ts) recolours the panel through --mb-* tokens, so the brand red and the
// chrome charcoal must not be written as literals outside matchbook-tokens.css. A colour that must stay fixed carries the
// comment `theme: fixed` on the same line.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.resolve(__dirname, '../src');
const ALLOWED = new Set([path.join('styles', 'matchbook-tokens.css')]);
// Brand reds and chrome charcoals, with the shades the buttons, header, footer and hero used (matchbook-tokens.css names each).
const SHADES = [
  'C51A1B', 'A81516', 'A01516', 'D8282A', 'FF6A6B', '2B2F35', '43444A', '30333A', '24272C', '3A3D43',
  'D42324', 'D22322', 'D02223', 'E0282B', 'BE1D1E', 'AE1516', 'B21718', 'E5252A', 'E0262A', 'E2282C', 'F0353A', 'D21F20',
  'A91317', '9E1112', '8E1011', '7A0D0E', '9E1516', 'B31620', 'FF5A5B',
  '383B41', '43464C', '1F2226', '202328', '1A1C20', '33373D', '23262B', '3E4248', '3A3E44', '1B1E22', '1B1D21',
  '262A30', '15171B', '121417', '1F2227', '4A4D53', '62656B', '6A6D73',
  'D42A2B', 'B6191B', 'FF6B6B', 'F6E7E7', '202329', '34383F', '820E0F', '8C0E0F', '960F10',
];
// #RRGGBB, or #RRGGBBAA for the brand red and the shades that carry tints (these must be color-mix() on the token).
const LITERAL = new RegExp(
  `#(?:${SHADES.join('|')})(?![0-9a-f])|#(?:C51A1B|A31919|B31620)[0-9a-f]{2}(?![0-9a-f])` +
  '|rgba?\\(\\s*(?:197[ ,]+26[ ,]+27|43[ ,]+47[ ,]+53|229[ ,]+37[ ,]+42|224[ ,]+38[ ,]+42|158[ ,]+21[ ,]+22|255[ ,]+106[ ,]+107|130[ ,]+14[ ,]+15|140[ ,]+14[ ,]+15|150[ ,]+15[ ,]+16)[ ,/]', 'i');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(css|tsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('brand red and chrome charcoal come from tokens, not literals', () => {
  const hits = [];
  for (const file of walk(SRC)) {
    const relative = path.relative(SRC, file);
    if (ALLOWED.has(relative)) continue;
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (LITERAL.test(line) && !line.includes('theme: fixed')) hits.push(`${relative}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

// The theme only overrides tokens whose inputs differ from MATCHBOOK_COLORS, so those must stay today's CSS values.
test('MATCHBOOK_COLORS in shared/src/theme/playerTheme.ts matches matchbook-tokens.css', () => {
  const { loader } = require('./load-source.cjs');
  const { MATCHBOOK_COLORS } = loader()('../shared/src/theme/playerTheme.ts');
  const css = fs.readFileSync(path.join(SRC, 'styles', 'matchbook-tokens.css'), 'utf8');
  const block = selector => { const start = css.indexOf(`${selector} {`); return css.slice(start, css.indexOf('}', start)); };
  const value = (text, token) => (new RegExp(`${token}:\\s*(#[0-9A-Fa-f]{6})`).exec(text) || [])[1]?.toUpperCase();
  const light = block(':root');
  const dark = block('html.dark');
  assert.equal(value(light, '--mb-red'), MATCHBOOK_COLORS.action);
  assert.equal(value(light, '--mb-link'), MATCHBOOK_COLORS.link);
  assert.equal(value(light, '--mb-chrome'), MATCHBOOK_COLORS.chrome);
  for (const [mode, text] of [['light', light], ['dark', dark]]) {
    for (const [key, token] of [['page', '--mb-page'], ['panel', '--mb-panel'], ['text', '--mb-text'], ['line', '--mb-line']]) {
      assert.equal(value(text, token), MATCHBOOK_COLORS[mode][key], `${mode} ${key}`);
    }
  }
});

// Text and icons on the brand colour use --mb-on-red: white by default, dark ink when a theme's action colour is too
// bright for white. A rule that paints a brand background must not write white text itself. Brand means the tokens
// below, any --mb-brand-* shade, and every local alias of them (--ex-red, --hc-red, --acct-red, --m99-brand, ...).
// The Matka game accents (--m99-game-accent and --g) are each game's own colour, the brand being only a fallback.
const BRAND_TOKENS = ['mb-red', 'mb-red-hover', 'mb-nav-active', 'nova-accent', 'brand-primary', 'brand-primary-dark', 'mobile-nav-active'];
const NOT_BRAND = new Set(['m99-game-accent', 'g']);
const WHITE = /(?:^|[\s,(])(?:#fff(?:fff)?(?:[0-9a-f]{2})?(?![0-9a-f])|white(?![\w-])|rgba?\(\s*255[\s,]+255[\s,]+255(?![\d.]))/i;

// Every { } block of a stylesheet with its own declarations (nested blocks keep theirs); comments are blanked first.
function cssBlocks(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
  const blocks = [];
  const stack = [{ prelude: '', decls: [] }];
  let start = 0;
  let parens = 0;
  let quote = null;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (quote) { if (ch === '\\') i += 1; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') { parens += 1; continue; }
    if (ch === ')') { parens = Math.max(0, parens - 1); continue; }
    if (parens) continue;
    if (ch === '{') {
      const block = { prelude: css.slice(start, i).trim().replace(/\s+/g, ' '), decls: [] };
      blocks.push(block);
      stack.push(block);
      start = i + 1;
    } else if (ch === ';' || ch === '}') {
      const text = css.slice(start, i);
      const colon = text.indexOf(':');
      if (colon !== -1 && !text.trim().startsWith('@')) {
        const from = start + (text.length - text.trimStart().length);
        stack[stack.length - 1].decls.push({
          prop: text.slice(0, colon).trim().toLowerCase(),
          value: text.slice(colon + 1).trim(),
          from,
          to: i,
        });
      }
      if (ch === '}' && stack.length > 1) stack.pop();
      start = i + 1;
    }
  }
  return blocks;
}

test('text on a brand background uses --mb-on-red, not white', () => {
  const tokens = fs.readFileSync(path.join(SRC, 'styles', 'matchbook-tokens.css'), 'utf8');
  assert.match(tokens.slice(tokens.indexOf(':root {')), /^[^}]*--mb-on-red: #FFFFFF;/, 'the default --mb-on-red is white');

  const sheets = walk(SRC).filter(file => file.endsWith('.css')).map(file => {
    const source = fs.readFileSync(file, 'utf8');
    return { relative: path.relative(SRC, file), source, blocks: cssBlocks(source) };
  });
  const brand = new Set(BRAND_TOKENS);
  const isBrand = name => !NOT_BRAND.has(name) && (brand.has(name) || name.startsWith('mb-brand-'));
  const refsBrand = value => [...value.matchAll(/var\(\s*--([\w-]+)/g)].some(match => isBrand(match[1]));
  const aliases = sheets.flatMap(sheet => sheet.blocks.flatMap(block => block.decls.filter(decl => decl.prop.startsWith('--'))));
  for (let grew = true; grew;) {
    grew = false;
    for (const decl of aliases) {
      const name = decl.prop.slice(2);
      if (!NOT_BRAND.has(name) && !brand.has(name) && refsBrand(decl.value)) { brand.add(name); grew = true; }
    }
  }
  assert.ok(['ex-red', 'hc-red', 'acct-red', 'm99-brand', 'lobby-accent'].every(name => brand.has(name)), 'local brand aliases are found');

  const hits = [];
  for (const { relative, source, blocks } of sheets) {
    const lineAt = offset => source.slice(0, offset).split('\n').length;
    const lines = source.split(/\r?\n/);
    for (const block of blocks) {
      if (!block.decls.some(decl => /^background(?:-color|-image)?$/.test(decl.prop) && refsBrand(decl.value))) continue;
      for (const decl of block.decls) {
        if (!/^(?:color|fill|stroke|-webkit-text-fill-color)$/.test(decl.prop) || !WHITE.test(decl.value)) continue;
        const first = lineAt(decl.from);
        const spanned = lines.slice(first - 1, lineAt(decl.to));
        if (spanned.some(line => line.includes('theme: fixed'))) continue;
        hits.push(`${relative}:${first}: ${block.prelude} { ${decl.prop}: ${decl.value} }`);
      }
    }
  }
  assert.deepEqual(hits, []);
});

// The same for Tailwind classes: a brand background (at 50% or more) with text-white on one line. Pale tints such as
// bg-[var(--brand-primary)]/10 are not brand surfaces.
test('Tailwind brand backgrounds pair with --mb-on-red, not text-white', () => {
  const BG = /\bbg-\[(?:color:)?var\(--(?:mb-red|mb-red-hover|mb-brand-[\w-]+|mb-nav-active|nova-accent|brand-primary|brand-primary-dark)\)\](?!\/[0-4]?\d\b)/;
  const hits = [];
  for (const file of walk(SRC).filter(name => name.endsWith('.tsx'))) {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (BG.test(line) && /\btext-white\b/.test(line) && !line.includes('theme: fixed')) hits.push(`${path.relative(SRC, file)}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});
