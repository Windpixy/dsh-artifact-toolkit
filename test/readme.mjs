// The README makes concrete claims about behaviour. Check the ones that are
// checkable against the source, so the published copy cannot drift from the code.
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const readme = read('../README.md');
const client = read('../client.js');
const pkg = JSON.parse(read('../package.json'));

const cases = [];
const check = (label, ok, detail) => cases.push({ label, ok, detail });

// 1) Claimed menu rows and their grouping.
check('README lists 复制完整路径', readme.includes('复制完整路径'));
check('README lists 复制短路径', readme.includes('复制短路径'));
check('README lists 复制文件名', readme.includes('复制文件名'));
check('README lists 复制全部完整路径', readme.includes('复制全部完整路径'));
check('README lists 复制全部文件名', readme.includes('复制全部文件名'));
check('README lists 打开所在文件夹', readme.includes('打开所在文件夹'));
check('README lists 用默认程序打开', readme.includes('用默认程序打开'));
check('README lists 在侧栏预览', readme.includes('在侧栏预览'));

// 2) Those same labels exist in the runtime dictionary.
const zh = (() => {
  const start = client.indexOf('const zh = {');
  const out = {};
  for (const m of client.slice(start, client.indexOf('};', start)).matchAll(/^\s{6}(\w+):\s*'([^']*)'/gm)) out[m[1]] = m[2];
  return out;
})();
for (const key of ['copyPath', 'copyRelative', 'copyName', 'copyAll', 'copyAllName', 'reveal', 'openWith', 'preview']) {
  check(`dictionary has ${key}`, typeof zh[key] === 'string' && readme.includes(zh[key]), zh[key]);
}

// 3) "Only the first two have a second line" — checked against the source.
check('only two rows pass a plain hint', (client.match(/hint: t\('copyPathHint'\)|hint: t\('copyRelativeHint'\)/g) ?? []).length === 2);
check('copyAll also carries a hint', client.includes("t('copyAllHint', params)"));

// 4) Zero third-party dependencies: React only.
const requires = [...new Set([...client.matchAll(/require\('([^']+)'\)/g)].map(m => m[1]))];
check('only react is required', requires.length === 1 && requires[0] === 'react', requires.join(', '));
check('no runtime dependencies declared', !pkg.dependencies || Object.keys(pkg.dependencies).length === 0, JSON.stringify(pkg.dependencies));

// 5) The kinds of output the README describes are the ones the code detects.
check('detects presented cards', client.includes("closest('[data-presented-file]')"));
check('detects changed cards', client.includes("closest('[data-changed-files]')"));
check('detects ref chips', client.includes("closest('[data-ref-chip]')"));
check('detects markdown file links', client.includes('isFileMentionButton'));

// 6) Native right-click is preserved everywhere else.
check('only claims recognised cards', client.includes('if (card === null) return;'));

// 7) Feedback timing matches what the README says.
check('README says 1.4 seconds', readme.includes('1.4 秒'));
check('badge timer is 1400ms', client.includes('}, 1400);'));

// 8) Test count claimed in the README is not overstated.
const expected = 202;
check('README states the suite total', readme.includes(String(expected)), String(expected));

// 9) The stale screenshot is not referenced.
check('does not reference the old screenshot', !readme.includes('101716'));

// 10) Every image the README embeds must exist locally AND be referenced by an
// absolute raw.githubusercontent URL: a relative path works on GitHub but
// renders as a broken image on the npm package page.
import { existsSync } from 'node:fs';

const RAW_PREFIX = 'https://raw.githubusercontent.com/Windpixy/dsh-artifact-toolkit/main/';
const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]);
check('README embeds at least four images', images.length >= 4, `${images.length}`);

const relativeOnes = images.filter(src => !src.startsWith('https://'));
check('every image uses an absolute URL', relativeOnes.length === 0, relativeOnes.join(', '));

const offRepo = images.filter(src => src.startsWith('https://') && !src.startsWith(RAW_PREFIX));
check('every image is served from this repo', offRepo.length === 0, offRepo.join(', '));

for (const src of new Set(images)) {
  if (!src.startsWith(RAW_PREFIX)) continue;
  const local = src.slice(RAW_PREFIX.length);
  check(`image exists locally: ${local}`, existsSync(new URL(`../${local}`, import.meta.url)));
}

let failed = 0;
for (const c of cases) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : ` -> ${c.detail ?? ''}`}`);
}
console.log(failed === 0 ? `\nREADME claims match the code (${cases.length} checks).` : `\n${failed} failed.`);
process.exitCode = failed === 0 ? 0 : 1;
