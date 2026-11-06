// Only the two path actions get a gloss; every other row stays one line.
// The two are the pair whose names look interchangeable, and picking the wrong
// one fails quietly, so they explain themselves. The rest say it in the name.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

/** Pull the string values of one dictionary block. */
function dict(name) {
  const start = src.indexOf(`const ${name} = {`);
  const end = src.indexOf('};', start);
  const out = {};
  for (const m of src.slice(start, end).matchAll(/^\s{6}(\w+):\s*'((?:[^'\\]|\\.)*)'/gm)) out[m[1]] = m[2];
  return out;
}

const zh = dict('zh');
const en = dict('en');
const cases = [];
const check = (label, ok, detail) => cases.push({ label, ok, detail });

// Rows that explain themselves.
const WITH_HINT = ['copyPath', 'copyRelative', 'copyAll'];
// Rows that must stay one line.
const WITHOUT_HINT = ['copyName', 'copyAllName', 'reveal', 'openWith', 'preview'];

// 1) The glossed rows have text in both languages.
for (const id of WITH_HINT) {
  const key = `${id}Hint`;
  check(`zh defines ${key}`, typeof zh[key] === 'string' && zh[key].length > 0, zh[key]);
  check(`en defines ${key}`, typeof en[key] === 'string' && en[key].length > 0, en[key]);
}

// 2) The one-line rows carry no hint at all.
for (const id of WITHOUT_HINT) {
  const key = `${id}Hint`;
  check(`${id} has no zh hint`, zh[key] === undefined, zh[key]);
  check(`${id} has no en hint`, en[key] === undefined, en[key]);
}

// 3) The menu passes hints only for the glossed rows.
for (const id of WITHOUT_HINT) {
  check(`${id} row passes no hint`, !new RegExp(`id: '${id}'[^}]*hint:`).test(src));
}

// 4) A row with no hint must still render correctly (no empty second line).
check('hint is optional at render time', src.includes('item.hint === undefined ? null :'));

// 5) The two paths say what they produce, not just their names.
check(
  'full path explains where it is usable',
  /资源管理器|address bar/.test(zh.copyPathHint + en.copyPathHint),
  `${zh.copyPathHint} | ${en.copyPathHint}`,
);
check(
  'short path explains the AI use case',
  /AI/i.test(zh.copyRelativeHint + en.copyRelativeHint),
  `${zh.copyRelativeHint} | ${en.copyRelativeHint}`,
);

// 6) No dictionary entry is left unused, and both languages stay aligned.
const used = new Set([...src.matchAll(/\bt\('([A-Za-z]+)'/g)].map(m => m[1]));
const zhKeys = Object.keys(zh);
const enKeys = Object.keys(en);
check('zh and en define the same keys', zhKeys.length === enKeys.length && zhKeys.every(k => enKeys.includes(k)));
check('every key is used', zhKeys.every(k => used.has(k)), zhKeys.filter(k => !used.has(k)).join(', '));
check('every used key is defined', [...used].every(k => zhKeys.includes(k)), [...used].filter(k => !zhKeys.includes(k)).join(', '));

let failed = 0;
for (const c of cases) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : ` -> ${c.detail ?? ''}`}`);
}
console.log(failed === 0 ? `\nTwo glossed rows, five one-line rows (${cases.length} checks).` : `\n${failed} failed.`);
process.exitCode = failed === 0 ? 0 : 1;
