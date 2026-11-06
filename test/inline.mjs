// Verify inline file references (the chip rendered in a reply) are recognised.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const helpers =
  code.slice(code.indexOf('function looksLikePath'), code.indexOf('// ── the shared request store')) +
  code.slice(code.indexOf('function isElement'), code.indexOf('// ── the shared request store'));

// Minimal DOM with the selectors this plugin actually queries.
const ATTR_ONLY = /^([a-zA-Z]+)?\[([a-zA-Z-]+)\]$/;
class El {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this._a = new Map(Object.entries(attrs));
    this.children = children;
    this.parentElement = null;
    this._text = '';
    for (const c of children) c.parentElement = this;
  }
  getAttribute(k) { return this._a.has(k) ? this._a.get(k) : null; }
  setAttribute(k, v) { this._a.set(k, v); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = v; }
  closest(sel) {
    let n = this;
    while (n) { if (matches(n, sel)) return n; n = n.parentElement; }
    return null;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = n => { for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}
function matches(node, sel) {
  return sel.split(',').some(part => {
    const m = ATTR_ONLY.exec(part.trim());
    if (!m) return false;
    if (m[1] && node.tagName !== m[1].toUpperCase()) return false;
    return node.getAttribute(m[2]) !== null;
  });
}

const byId = new Map();
const sandbox = { Element: El, document: { getElementById: id => byId.get(id) ?? null } };
vm.createContext(sandbox);
vm.runInContext(helpers + '; this.cardAt = cardAt;', sandbox);

const E = (tag, attrs, ...kids) => new El(tag, attrs, kids);
const txt = v => { const n = new El('span'); n.textContent = v; return n; };

const absPath = String.raw`C:\Users\zxy19\Documents\Product Enhancement\16号文档-第六节.md`;

// The inline mention chip: <button data-ref-chip className=fileMention title=path>
const chip = E('button', { type: 'button', 'data-ref-chip': 'file', title: absPath },
  E('span', {}, txt('16号文档第六节')),
);
// The icon inside the chip is what the pointer usually lands on.
const innerIcon = chip.children[0];

// A chip with no title (unresolved reference) must stay inert.
const inert = E('button', { type: 'button', 'data-ref-chip': 'skill' },
  E('span', {}, txt('某个技能')),
);

// A chip whose title is prose rather than a path.
const proseTitle = E('button', { type: 'button', 'data-ref-chip': 'file', title: '点击查看' },
  E('span', {}, txt('文字')),
);

// A plain <span data-ref-chip> (not clickable) must not be claimed.
const spanChip = E('span', { 'data-ref-chip': 'file', title: absPath }, txt('x'));

// The other shape: an explicit Markdown link to a file. No data-ref-chip, but
// the renderer's fileMention class and the full path in `title`.
const markdownLink = E('button', { type: 'button', class: '_fileMention_1ypvv_85 _fileLink_1ypvv_59', title: absPath },
  E('span', {}, txt('16号文档第六节')),
);
markdownLink.className = '_fileMention_1ypvv_85 _fileLink_1ypvv_59';

// An ordinary button carrying a class of its own must stay inert.
const plainButton = E('button', { type: 'button', class: '_toolbar_abc_1', title: absPath }, txt('按钮'));
plainButton.className = '_toolbar_abc_1';

// A fileMention button whose title is not a path (image preview name) is inert.
const nameOnly = E('button', { type: 'button', class: '_fileMention_1ypvv_85', title: '图片说明' }, txt('x'));
nameOnly.className = '_fileMention_1ypvv_85';

const cases = [
  ['chip itself', sandbox.cardAt(chip), r => r?.kind === 'inline' && r.path === absPath],
  ['icon inside the chip', sandbox.cardAt(innerIcon), r => r?.kind === 'inline' && r.path === absPath],
  ['chip without a title is inert', sandbox.cardAt(inert), r => r === null],
  ['chip titled with prose is inert', sandbox.cardAt(proseTitle), r => r === null],
  ['non-button chip is inert', sandbox.cardAt(spanChip), r => r === null],
  ['markdown file link', sandbox.cardAt(markdownLink), r => r?.kind === 'inline' && r.path === absPath],
  ['markdown file link (icon child)', sandbox.cardAt(markdownLink.children[0]), r => r?.kind === 'inline' && r.path === absPath],
  ['ordinary button is inert', sandbox.cardAt(plainButton), r => r === null],
  ['file mention titled with a name is inert', sandbox.cardAt(nameOnly), r => r === null],
  ['unrelated element is inert', sandbox.cardAt(E('p', {}, txt('普通文字'))), r => r === null],
];

let failed = 0;
for (const [label, result, check] of cases) {
  const ok = check(result);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` -> ${JSON.stringify(result)}`}`);
}
console.log(failed === 0 ? `\nInline references handled correctly (${cases.length} checks).` : `\n${failed} failed.`);
process.exitCode = failed === 0 ? 0 : 1;
