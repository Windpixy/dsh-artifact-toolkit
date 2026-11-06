// Guard the publish: the packed tarball must contain no local paths, no test
// scaffolding and no runtime junk. Run after `npm pack --dry-run`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// `npm` is a .cmd shim on Windows, so it needs a shell; no user input reaches it.
const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  encoding: 'utf8',
  shell: true,
  timeout: 120000,
});

const info = JSON.parse(out)[0];
const files = info.files.map(f => f.path);
const cases = [];
const check = (label, ok, detail) => cases.push({ label, ok, detail });

// 1) The runtime files are present.
for (const required of [
  'package.json',
  'index.js',
  'client.js',
  'cordis.patch.yml',
  'locale/zh.json',
  'locale/en.json',
  'icon.svg',
  'README.md',
  'LICENSE',
  'screenshots.json',
]) {
  check(`packs ${required}`, files.includes(required));
}

// 2) Nothing from the test suite or local scaffolding leaks in.
const junk = files.filter(p =>
  p.startsWith('test/') ||
  p.endsWith('.tgz') ||
  p.endsWith('.log') ||
  p.endsWith('.bak') ||
  p.includes('_selftest') ||
  p.startsWith('_'),
);
check('no test or scaffolding files packed', junk.length === 0, junk.join(', '));

// 3) The market needs a raster icon, and it must be packed.
check('ships a raster icon', files.includes('docs/images/icon-180.png'));
check('screenshot files are packed', files.filter(p => p.startsWith('docs/images/')).length >= 6);

// 4) No absolute paths or user names inside any text file of the tarball.
const suspicious = [];
for (const path of files) {
  if (!/\.(js|json|yml|yaml|md|svg)$/.test(path)) continue;
  const body = readFileSync(path, 'utf8');
  if (/C:\\\\Users\\\\/i.test(body) || body.includes('zxy19')) suspicious.push(path);
}
check('no local absolute paths in packed text', suspicious.length === 0, suspicious.join(', '));

// 5) A sane size: screenshots dominate, but nothing should be huge.
check('package stays under 1 MiB', info.size < 1024 * 1024, `${info.size} bytes`);

let failed = 0;
for (const c of cases) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : ` -> ${c.detail}`}`);
}
console.log(`\npacked files: ${files.length}, package size: ${info.size} bytes, unpacked: ${info.unpackedSize} bytes`);
console.log(failed === 0 ? `\nPublish contents verified (${cases.length} checks).` : `\n${failed} failed.`);
process.exitCode = failed === 0 ? 0 : 1;
