// A reply can reference a file that DSH never recorded as a session file. The
// renderer then publishes only the name in `title` (e.g. "PerfCard-便携版.zip").
// That case used to be ignored entirely; it must now offer the one action whose
// result is exact, plus a line explaining why the rest is missing.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const helpers =
  code.slice(code.indexOf('function looksLikePath'), code.indexOf('// ── the shared request store')) +
  code.slice(code.indexOf('function isElement'), code.indexOf('// ── styles ──'));

const ATTR_ONLY = /^([a-zA-Z]+)?\[([a-zA-Z-]+)\]$/;

class El {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this._a = new Map(Object.entries(attrs));
    this.children = [];
    this.parentElement = null;
  }
  get className() { return this._a.get('class') ?? ''; }
  getAttribute(k) { return this._a.has(k) ? this._a.get(k) : null; }
  closest(sel) {
    let n = this;
    while (n) { if (match(n, sel)) return n; n = n.parentElement; }
    return null;
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
function match(node, sel) {
  return sel.split(',').some(part => {
    const m = ATTR_ONLY.exec(part.trim());
    if (!m) return false;
    if (m[1] && node.tagName !== m[1].toUpperCase()) return false;
    return node.getAttribute(m[2]) !== null;
  });
}

const sandbox = { Element: El, document: { getElementById: () => null } };
vm.createContext(sandbox);
vm.runInContext(
  helpers + '; this.cardAt=cardAt; this.looksLikeFileName=looksLikeFileName; this.looksLikePath=looksLikePath;',
  sandbox,
);

const cases = [];
const check = (label, ok, detail) => cases.push({ label, ok, detail });

// 1) The name recogniser must accept the real case and reject prose/paths.
const nameAccepts = [
  ['PerfCard-便携版.zip', true],
  ['16-交互健康分-v2.40 进度与测试指南.md', true],
  ['archive.tar.gz', true],
  ['a.7z', true],
  ['普通文字', false],
  ['这句话以句号结尾。', false],
  ['C:\\Users\\x\\a.md', false],
  ['docs/a.md', false],
  ['', false],
];
for (const [value, want] of nameAccepts) {
  check(`looksLikeFileName(${JSON.stringify(value)}) === ${want}`, sandbox.looksLikeFileName(value) === want);
}

// 2) A path must NOT be treated as name-only (it takes the full branch).
check('a real path is not name-only', sandbox.looksLikeFileName(String.raw`C:\w\a.md`) === false);

// 3) The mention button carrying only a name is claimed, marked nameOnly.
const btn = new El('button', {
  class: '_fileMention_1ypvv_85 _fileLink_1ypvv_59',
  title: 'PerfCard-便携版.zip',
});
const hit = sandbox.cardAt(btn);
check('name-only mention is claimed', hit !== null);
check('it is marked nameOnly', hit?.nameOnly === true, JSON.stringify(hit));
check('the path is the bare name', hit?.path === 'PerfCard-便携版.zip', hit?.path);

// 4) A mention with a full path must NOT be marked nameOnly.
const fullBtn = new El('button', {
  class: '_fileMention_1ypvv_85',
  title: String.raw`C:\Users\zxy19\Documents\项目\报告.md`,
});
const fullHit = sandbox.cardAt(fullBtn);
check('full-path mention claimed', fullHit !== null);
check('full-path mention is not nameOnly', fullHit?.nameOnly === undefined, JSON.stringify(fullHit));

// 5) A button with no title stays inert.
const noTitle = new El('button', { class: '_fileMention_1ypvv_85' });
check('mention without a title stays inert', sandbox.cardAt(noTitle) === null);

// 6) The menu, for a name-only request, offers copyName plus one note row.
const menuSrc = code.slice(code.indexOf('const items = React.useMemo'), code.indexOf('}, [request, t]);'));
check('menu branches on nameOnly', menuSrc.includes('const nameOnly = request.nameOnly === true'));
check('name-only branch offers copyName', /nameOnly\) \{[\s\S]{0,220}id: 'copyName'/.test(menuSrc));
check('name-only branch adds an explanation row', menuSrc.includes("type: 'note'"));
check('name-only branch returns early', /nameOnly\) \{[\s\S]{0,400}return rows;/.test(menuSrc));

// 7) The note row is rendered as quiet text, not as a clickable item.
check('note row is not a button', code.includes("className: 'dam-note'"));
check('note row is excluded from keyboard navigation', code.includes("items.filter((item) => item.type === undefined)"));

// 8) Both dictionaries explain the limitation.
const zh = code.slice(code.indexOf('const zh = {'), code.indexOf('};', code.indexOf('const zh = {')));
const en = code.slice(code.indexOf('const en = {'), code.indexOf('};', code.indexOf('const en = {')));
check('zh explains the missing folder', /nameOnlyNote:/.test(zh));
check('en explains the missing folder', /nameOnlyNote:/.test(en));

let failed = 0;
for (const c of cases) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : ` -> ${c.detail}`}`);
}
console.log(failed === 0 ? `\nName-only references handled (${cases.length} checks).` : `\n${failed} failed.`);
process.exitCode = failed === 0 ? 0 : 1;
