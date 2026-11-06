// Verify the renamed package still resolves and the profile lists it correctly.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const profileDir = 'C:/Users/zxy19/.dsh/profiles/desktop';
const anchor = 'C:/Users/zxy19/AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh/package.json';

const cases = [];
const check = (label, ok, detail) => cases.push({ label, ok, detail });

// 1) The profile lists the new name and not the old one.
const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
const bundles = manifest.dsh.profile.bundles;
const deps = manifest.dependencies;
check('profile bundles include dsh-artifact-toolkit', bundles.includes('dsh-artifact-toolkit'));
check('profile has no old bundle entry', !bundles.some(b => b.includes('dsh-artifact-menu')));
check('profile dependency uses the new key', typeof deps['dsh-artifact-toolkit'] === 'string', String(deps['dsh-artifact-toolkit']));
check('profile has no old dependency', deps['@local/dsh-artifact-menu'] === undefined);

// 2) DSH's own resolution rule finds it (installation anchor, then profile).
function packageDirFromAnchor(a, name) {
  for (const p of createRequire(a).resolve.paths(name) ?? []) {
    const candidate = join(p, name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  return undefined;
}
let dir;
for (const a of [anchor, join(profileDir, 'package.json')]) {
  dir = packageDirFromAnchor(a, 'dsh-artifact-toolkit');
  if (dir !== undefined) break;
}
check('resolves like DSH resolves bundles', dir !== undefined, String(dir));

// 3) The manifest is publishable and self-consistent.
const pkg = JSON.parse(readFileSync(join(profileDir, 'node_modules/dsh-artifact-toolkit/package.json'), 'utf8'));
check('package name is dsh-artifact-toolkit', pkg.name === 'dsh-artifact-toolkit', pkg.name);
check('not marked private', pkg.private !== true, String(pkg.private));
check('declares a license', pkg.license === 'MIT', String(pkg.license));
check('declares keywords', Array.isArray(pkg.keywords) && pkg.keywords.length > 0);
check('declares dsh.bundle', pkg.dsh?.bundle?.patch === './cordis.patch.yml');
check('declares dsh.client for web', pkg.dsh?.client?.platform === 'web');
check('exports the client entry', pkg.exports?.['./client'] === './client.js');

// 4) The bundle patch uses the new name.
const patch = readFileSync(join(dir ?? '', 'cordis.patch.yml'), 'utf8');
check('patch inserts dsh-artifact-toolkit', patch.includes('dsh-artifact-toolkit'), patch.trim());
check('patch has no old name', !patch.includes('@local/dsh-artifact-menu'));

// 5) The loader id matches the package name (they must agree).
const client = readFileSync(join(dir ?? '', 'client.js'), 'utf8');
const idMatch = /id:\s*'([^']+)'/.exec(client);
check('module loader id equals the package name', idMatch?.[1] === 'dsh-artifact-toolkit', idMatch?.[1]);

// 6) Publishable file list covers what the README needs.
check('files include client.js', pkg.files.includes('client.js'));
check('files include README', pkg.files.includes('README.md'));
check('files include LICENSE', pkg.files.includes('LICENSE'));
check('files include the screenshots', pkg.files.some(f => f.startsWith('docs/')));

// 7) No stale name anywhere in the package.
const stale = ['package.json', 'client.js', 'cordis.patch.yml', 'index.js', 'README.md'].filter(f =>
  readFileSync(join(dir ?? '', f), 'utf8').includes('@local/dsh-artifact-menu'),
);
check('no file still mentions the old name', stale.length === 0, stale.join(', '));

let failed = 0;
for (const c of cases) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : ` -> ${c.detail}`}`);
}
console.log(`\nresolved dir: ${dir}`);
console.log(failed === 0 ? `\nRename verified (${cases.length} checks).` : `\n${failed} failed.`);
process.exitCode = failed === 0 ? 0 : 1;
