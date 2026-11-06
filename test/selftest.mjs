// Re-run both the path-helper and card-detection checks against the edited client.js.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const start = code.indexOf('function looksLikePath');
const end = code.indexOf('// ── the shared request store');
const helpers = code.slice(start, end);

const DOM = (() => {
  class Element {
    constructor(tag, attrs = {}, children = []) {
      this.tagName = tag.toUpperCase();
      this.nodeType = 1;
      this._attrs = new Map(Object.entries(attrs));
      this.children = children;
      this.parentElement = null;
      this._text = '';
      for (const child of children) child.parentElement = this;
    }
    getAttribute(name) { return this._attrs.has(name) ? this._attrs.get(name) : null; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this._text = v; }
    closest(selector) {
      let node = this;
      while (node !== null) { if (select(node, selector)) return node; node = node.parentElement; }
      return null;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) {
      const out = [];
      const walk = (n) => { for (const c of n.children) { if (select(c, selector)) out.push(c); walk(c); } };
      walk(this);
      return out;
    }
  }
  function select(node, selector) {
    return selector.split(',').some(part => {
      const m = /^([a-zA-Z]+)?\[([a-zA-Z-]+)\]$/.exec(part.trim());
      if (m === null) return false;
      if (m[1] !== undefined && node.tagName !== m[1].toUpperCase()) return false;
      return node.getAttribute(m[2]) !== null;
    });
  }
  return { Element, select };
})();

const byId = new Map();
const sandbox = { Element: DOM.Element, document: { getElementById: id => byId.get(id) ?? null } };
vm.createContext(sandbox);
vm.runInContext(
  helpers + '; this.cardAt=cardAt; this.looksLikePath=looksLikePath; this.isAbsolutePath=isAbsolutePath;' +
  ' this.baseName=baseName; this.joinPath=joinPath; this.relativeTo=relativeTo; this.sessionFileAddress=sessionFileAddress;',
  sandbox,
);

const E = (tag, attrs, ...children) => new DOM.Element(tag, attrs, children);
const text = v => { const n = new DOM.Element('span'); n.textContent = v; return n; };

const root = String.raw`C:\Users\zxy19\Documents\Product Enhancement`;
const deliveredPath = root + String.raw`\16-交互健康分-v2.40 进度与测试指南.md`;

// Delivery card with a sibling row: one file among several.
const single = E('div', { 'data-presented-file': '' },
  E('button', { type: 'button', title: deliveredPath }),
  E('div', {}, E('div', { 'data-presented-description': '' }, text('在侧边栏预览'))),
);
const singleRow = E('div', { 'data-presented-files-row': '' }, single);

// Multi-row delivery: right-clicking the outer container of one card.
const otherPath = root + String.raw`\15-交互健康分-方案对比.md`;
const other = E('div', { 'data-presented-file': '' },
  E('button', { type: 'button', title: otherPath }),
  E('div', {}, text('方案对比文档')),
);
const multiRow = E('div', { 'data-presented-files-row': '' }, single, other);

// Changed card: single file (only a header, no attribute on the header itself).
const oneFile = root + String.raw`\src\Panel.tsx`;
const singleChanged = E('div', { 'data-changed-files': '' },
  E('button', { type: 'button' }, text('已编辑 Panel.tsx')),
);
byId.set('sdesc', E('span', {}, text(oneFile)));
singleChanged.children[0].setAttribute?.('aria-describedby', 'sdesc');

const cases = [
  ['path: looksLikePath(win path)', sandbox.looksLikePath(deliveredPath), true],
  ['path: looksLikePath(prose)', sandbox.looksLikePath('纯中文说明'), false],
  ['path: baseName with spaces', sandbox.baseName(deliveredPath), '16-交互健康分-v2.40 进度与测试指南.md'],
  ['path: relativeTo inside root', sandbox.relativeTo(root, deliveredPath), '16-交互健康分-v2.40 进度与测试指南.md'],
  ['path: relativeTo outside root', sandbox.relativeTo(root, String.raw`C:\Users\zxy19\Desktop\x.md`), null],
  ['dom: delivery card interior', sandbox.cardAt(single.children[1])?.path === deliveredPath, true],
  ['dom: delivery action button', sandbox.cardAt(single.children[1].children[0])?.path === deliveredPath, true],
  ['dom: multi-row picks its own card', sandbox.cardAt(other.children[1])?.path === otherPath, true],
  ['dom: gap between cards does nothing', sandbox.cardAt(multiRow), null],
  ['dom: plain element', sandbox.cardAt(E('p', {}, text('文字'))), null],
  ['dom: null target', sandbox.cardAt(null), null],
];

let failed = 0;
for (const [label, actual, expected] of cases) {
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`}`);
}

// A card whose only file is unnamed must still answer for that one file.
const nameless = E('div', { 'data-presented-file': '' },
  E('button', { type: 'button', title: deliveredPath }),
  E('div', {}, text('说明')),
);
const namelessRow = E('div', { 'data-presented-files-row': '' }, nameless);
const fallbackOk = sandbox.cardAt(nameless.children[1])?.path === deliveredPath;
console.log(`${fallbackOk ? 'PASS' : 'FAIL'}  dom: unnamed single card falls back to its one file`);
if (!fallbackOk) failed += 1;

console.log(failed === 0 ? `\nAll ${cases.length + 1} checks pass.` : `\n${failed} check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
