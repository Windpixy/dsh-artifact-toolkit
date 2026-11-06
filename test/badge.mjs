// Verify the copy confirmation: the green pill goes inside the card's own
// description line, fits its 16px height, and the line is restored exactly.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const snippet =
  code.slice(code.indexOf('function looksLikePath'), code.indexOf('// ── the shared request store')) +
  code.slice(code.indexOf('function isElement'), code.indexOf('// ── styles ──'));

const ATTR_ONLY = /^([a-zA-Z]+)?\[([a-zA-Z-]+)\]$/;

class El {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this._a = new Map(Object.entries(attrs));
    this.children = children;
    this.parentElement = null;
    this._text = '';
    this.removed = false;
    for (const c of children) c.parentElement = this;
  }
  get className() { return this._a.get('class') ?? ''; }
  set className(v) { this._a.set('class', v); }
  getAttribute(k) { return this._a.has(k) ? this._a.get(k) : null; }
  setAttribute(k, v) { this._a.set(k, v); }
  removeAttribute(k) { this._a.delete(k); }
  remove() { this.removed = true; if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(c => c !== this); } }
  appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
  get textContent() { return this._text + this.children.filter(c => !c.removed).map(c => c.textContent).join(''); }
  set textContent(v) { this._text = v; this.children = []; }
  closest(sel) {
    let n = this;
    while (n) { if (match(n, sel)) return n; n = n.parentElement; }
    return null;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = n => { for (const c of n.children) { if (match(c, sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}
function match(node, sel) {
  return sel.split(',').some(part => {
    const m = ATTR_ONLY.exec(part.trim());
    if (!m) return false;
    if (m[1] && node.tagName !== m[1].toUpperCase()) return false;
    return node.getAttribute(m[2]) !== null;
  });
}

const timers = [];
const sandbox = {
  Element: El,
  document: { getElementById: () => null, createElement: t => new El(t) },
  setTimeout: fn => { timers.push(fn); return timers.length; },
  clearTimeout: () => {},
};
vm.createContext(sandbox);
vm.runInContext(snippet + '; this.MenuStore = MenuStore; this.descriptionSlot = descriptionSlot;', sandbox);

const store = new sandbox.MenuStore();
const E = (t, a, ...k) => new El(t, a, k);

// The real card: a description line with its own class, inside a 60px card.
const descLine = E('span', { 'data-presented-description': '', class: 'K5rwea_description' });
descLine.textContent = '在侧边栏预览';
const card = E('div', { 'data-presented-file': '' },
  E('button', { type: 'button', title: 'C:/w/a.md' }),
  E('div', { class: 'K5rwea_details' }, descLine),
);

const cases = [];
const check = (label, ok, detail) => cases.push({ label, ok, detail });

// 1) A green pill appears inside the card's description line.
store.flash(card, '已复制');
const pill = descLine.children.find(c => c.className === 'dam-badge');
check('pill is inside the description line', pill !== undefined);
check('pill carries the confirmation text', pill?.textContent === '已复制', pill?.textContent);
check('the line no longer shows its old hint', descLine.textContent === '已复制', descLine.textContent);
check('the line keeps its own class', descLine.getAttribute('class') === 'K5rwea_description', descLine.getAttribute('class'));

// 2) The pill is styled green and sized to fit a 16px line.
const css = code.slice(code.indexOf('.dam-badge{'), code.indexOf('@media (prefers-reduced-motion'));
check('green background', /background:\s*var\(--dsw-alias-state-success-primary/.test(css));
check('white text', /color:\s*#fff/.test(css));
check('rounded', /border-radius:\s*999px/.test(css));
check('inline so it does not break the line', /display:\s*inline-block/.test(css));
const lineHeight = Number((/line-height:\s*(\d+)px/.exec(css) ?? [])[1]);
check('pill height fits the 16px line', lineHeight <= 16, `line-height=${lineHeight}`);

// 3) After it expires the line is back to exactly what it was.
timers.at(-1)();
check('old hint restored', descLine.textContent === '在侧边栏预览', descLine.textContent);
check('pill removed', descLine.children.every(c => c.className !== 'dam-badge'));
check('original class untouched', descLine.getAttribute('class') === 'K5rwea_description');

// 4) A second confirmation replaces the first cleanly.
store.flash(card, '已复制 2');
check('second pill shown', descLine.textContent === '已复制 2', descLine.textContent);
check('still only one pill', descLine.children.filter(c => c.className === 'dam-badge').length === 1);
timers.at(-1)();
check('restored again', descLine.textContent === '在侧边栏预览', descLine.textContent);

// 5) Anything without that line uses the quiet notice instead of a pill, and
//    that notice is green so a success looks the same wherever it lands.
const changedCard = E('div', { 'data-changed-files': '' }, E('button', { type: 'button', 'aria-describedby': 'd1' }, E('span')));
store.toast = null;
store.flash(changedCard, '已复制');
check('changed row falls back to the notice', store.toast?.text === '已复制', JSON.stringify(store.toast));
check('that notice is a success', store.toast?.tone === 'success', JSON.stringify(store.toast));

const mention = new El('button', { type: 'button', title: 'C:/w/a.md' });
mention.className = '_fileMention_x_1';
store.toast = null;
store.flash(mention, '已复制');
check('inline mention falls back to the notice', store.toast?.text === '已复制', JSON.stringify(store.toast));
check('that notice is a success too', store.toast?.tone === 'success', JSON.stringify(store.toast));

// 6) A failure must not be green — it carries the error tone instead.
store.toast = null;
store.showToastAs('error', '复制失败');
check('failures use the error tone', store.toast?.tone === 'error', JSON.stringify(store.toast));

let failed = 0;
for (const c of cases) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : ` -> ${c.detail}`}`);
}
console.log(failed === 0 ? `\nGreen pill fits the card's line and restores it (${cases.length} checks).` : `\n${failed} failed.`);
process.exitCode = failed === 0 ? 0 : 1;
