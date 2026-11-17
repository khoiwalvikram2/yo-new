// Execute the real TS/TSX sources with isolated dependency stubs, without adding a runner.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

// Vite resolves these at build time; a CommonJS module run in node:vm cannot use `import.meta`.
// import.meta.glob(...) -> {} (no files matched: e.g. sport icons are simply absent), and
// import.meta.env -> a production-like env without VITE_* values (a test can override it through
// the loader's globals as `__VITE_ENV__`).
const VITE_ENV = Object.freeze({ MODE: 'test', DEV: false, PROD: true, SSR: false, BASE_URL: '/' });
function replaceViteImportMeta(source) {
  return source
    .replace(/import\.meta\.glob\s*(?:<[^>()]*>)?\s*\(/g, '(() => ({}))(')
    .replace(/import\.meta\.env\b/g, '__VITE_ENV__');
}
// Static asset imports resolve to a URL string in Vite; return the root-relative path instead.
const ASSET_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|mp3|mp4|webm|woff2?|ttf)$/i;
const assetModule = filename => ({ __esModule: true, default: `/${path.relative(root, filename).split(path.sep).join('/')}` });

function loader(stubs = {}, globals = {}) {
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (Object.hasOwn(stubs, filename)) return stubs[filename];
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const output = ts.transpileModule(replaceViteImportMeta(fs.readFileSync(filename, 'utf8')), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    const nativeRequire = createRequire(filename);
    const sourceRequire = specifier => {
      if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
      // Component stylesheets are Vite's job and export nothing at runtime.
      if (specifier.endsWith('.css')) return {};
      if (specifier.startsWith('.') || specifier.startsWith('@/')) {
        const base = specifier.startsWith('@/') ? path.join(root, 'src', specifier.slice(2)) : path.resolve(path.dirname(filename), specifier);
        // Like Vite: an extensionless import may name a .jsx or .js source (the Matka kit's './components').
        for (const extension of ['', '.ts', '.tsx', '.jsx', '.js']) {
          const candidate = base + extension;
          if (Object.hasOwn(stubs, candidate)) return stubs[candidate];
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return ASSET_EXTENSION.test(candidate) ? assetModule(candidate) : load(candidate);
        }
      }
      return nativeRequire(specifier);
    };
    vm.runInNewContext(output, { exports: module.exports, module, require: sourceRequire, console, __VITE_ENV__: VITE_ENV, ...globals }, { filename });
    return module.exports;
  }
  return load;
}

function themeEnvironment(saved = {}, blocked = false) {
  const values = new Map(Object.entries(saved));
  const styles = new Map();
  const listeners = new Map();
  const classList = () => {
    const classes = new Set();
    return { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name),
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } };
  };
  const storage = {
    getItem(key) { if (blocked) throw new Error('Storage unavailable'); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error('Storage unavailable'); values.set(key, String(value)); },
  };
  const rootElement = { classList: classList(), style: { setProperty: (key, value) => styles.set(key, value) } };
  const window = {
    localStorage: storage,
    addEventListener(name, handler) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(handler); },
    removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
    dispatchEvent(event) { listeners.get(event.type)?.forEach(handler => handler(event)); },
  };
  const globals = { window, localStorage: storage, document: { documentElement: rootElement, body: { classList: classList() } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
  return { globals, rootElement, values, styles, theme: loader({}, globals)('src/lib/theme.ts') };
}

function settingsTheme(environment) {
  const filename = path.join(root, 'src/lib/app-settings.tsx');
  const text = fs.readFileSync(filename, 'utf8');
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let apply;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'applyTheme') apply = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!apply) throw new Error('Settings palette function was not found');
  const helpers = source.statements.filter(node => ts.isFunctionDeclaration(node) && ['hexToRgb', 'lightenHex', 'darkenHex', 'hexToRgba'].includes(node.name?.text)).map(node => node.getText(source)).join('\n');
  const output = ts.transpileModule(`${helpers}\nmodule.exports = ${apply};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  // applyPlayerTheme is a recording spy: the calls are on the returned function as playerThemeCalls.
  const playerThemeCalls = [];
  vm.runInNewContext(output, { module, applyPlayerTheme: theme => { playerThemeCalls.push(theme); }, ...environment.globals }, { filename });
  module.exports.playerThemeCalls = playerThemeCalls;
  return module.exports;
}

module.exports = { loader, themeEnvironment, settingsTheme, root };
