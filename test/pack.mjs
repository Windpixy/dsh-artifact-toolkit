// Guard the publish: the packed tarball must contain no local paths, no test
// scaffolding and no runtime junk. Run after `npm pack --dry-run`.
//
// npm is a .cmd shim on Windows, so it runs through cmd.exe. The private cache
// keeps this check from reading or writing the developer's global npm cache, and
// it lives under the OS temp directory: `cmd /c` with `/s` mangles a quoted path
// that contains spaces, which the workspace path does.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const packageDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const cache = join(tmpdir(), `dam-pack-${process.pid}`);
rmSync(cache, { recursive: true, force: true });
mkdirSync(cache, { recursive: true });

const run = spawnSync('cmd.exe', ['/d', '/s', '/c', `npm pack --dry-run --json --cache ${cache}`], {
  encoding: 'utf8',
  cwd: packageDir,
  windowsHide: true,
  timeout: 180000,
});
rmSync(cache, { recursive: true, force: true });

let info;
try {
  info = JSON.parse(run.stdout.replace(/^\uFEFF/, ''))[0];
} catch {
  console.error('FAIL  npm pack did not return usable JSON');
  console.error(`      status=${run.status} error=${run.error?.message ?? 'none'}`);
  console.error(String(run.stderr ?? '').slice(0, 800));
  process.exit(1);
}
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
