// The locale/*.json files are what the plugin manager shows before the plugin
// runs; the dictionaries inside client.js are what the menu actually uses. They
// drifted apart once already, so they are compared here.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const zhJson = JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8'));
const enJson = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'));

/** Pull the string values of one dictionary block in client.js. */
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

const sameKeys = (a, b) => {
  // `meta` is display metadata for the plugin list, not a menu string.
  const ka = Object.keys(a).filter(k => k !== 'meta').sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
};

// 1) Keys line up between the runtime dictionaries and the JSON files.
check('zh.json keys match client.js zh', sameKeys(zhJson, zh), Object.keys(zhJson).filter(k => !(k in zh)).join(', '));
check('en.json keys match client.js en', sameKeys(enJson, en), Object.keys(enJson).filter(k => !(k in en)).join(', '));

// 2) Values line up too, so the plugin list never shows stale copy.
const zhDiffs = Object.keys(zh).filter(k => zhJson[k] !== zh[k]);
const enDiffs = Object.keys(en).filter(k => enJson[k] !== en[k]);
check('zh.json wording matches the menu', zhDiffs.length === 0, zhDiffs.map(k => `${k}: ${zhJson[k]} vs ${zh[k]}`).join(' | '));
check('en.json wording matches the menu', enDiffs.length === 0, enDiffs.map(k => `${k}: ${enJson[k]} vs ${en[k]}`).join(' | '));

// 3) Display metadata is present and describes this plugin.
check('zh meta.title present', typeof zhJson.meta?.title === 'string' && zhJson.meta.title.length > 0);
check('zh meta.description present', typeof zhJson.meta?.description === 'string' && zhJson.meta.description.length > 0);
check('en meta.title present', typeof enJson.meta?.title === 'string' && enJson.meta.title.length > 0);
check('en meta.description present', typeof enJson.meta?.description === 'string' && enJson.meta.description.length > 0);

// 4) One wording for the reveal action everywhere.
check('menu label says 文件夹', zhJson.reveal === '打开所在文件夹', zhJson.reveal);
check('failure text says 文件夹', zhJson.revealFailed === '无法打开所在文件夹', zhJson.revealFailed);
check('no stale 所在位置 anywhere in the json', !JSON.stringify(zhJson).includes('所在位置'));

// 5) Placeholders survive the copy.
check('copyAllHint keeps its {count}', zhJson.copyAllHint.includes('{count}'), zhJson.copyAllHint);
check('copiedAll keeps its {count}', zhJson.copiedAll.includes('{count}'), zhJson.copiedAll);
check('copiedName keeps its {name}', zhJson.copiedName.includes('{name}'), zhJson.copiedName);

let failed = 0;
for (const c of cases) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : ` -> ${c.detail ?? ''}`}`);
}
console.log(failed === 0 ? `\nLocale files match the runtime dictionaries (${cases.length} checks).` : `\n${failed} failed.`);
process.exitCode = failed === 0 ? 0 : 1;
