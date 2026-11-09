// Exercise the Host half's pure logic without loading a Cordis profile:
// the trust gate, the path validator, and the encoded clipboard payload.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const code = readFileSync(new URL('../index.js', import.meta.url), 'utf8');

// Strip the `import` lines and the public exports so the module body can run in
// a bare vm context: everything under test is plain functions plus constants.
const body = code
  .split('\n')
  .filter((line) => !line.startsWith('import '))
  .join('\n')
  .replace(/export const inject = \[[^\]]*\];?/g, '')
  .replace(/export function apply/, 'function apply');

// The module body runs in a bare vm context, so the Node names it closes over
// (the imports were stripped) are supplied here explicitly.
const sandbox = {
  process,
  Buffer,
  URL,
  setTimeout,
  clearTimeout,
  statSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  tmpdir,
  join,
  spawn,
};
vm.createContext(sandbox);
vm.runInContext(
  body +
    '; this.isTrustedRequest = isTrustedRequest; this.validatePath = validatePath;' +
    ' this.ENCODED_SCRIPT = ENCODED_SCRIPT; this.CLIPBOARD_SCRIPT = CLIPBOARD_SCRIPT;' +
    ' this.COPY_FILES_PATH = COPY_FILES_PATH; this.CAPABILITY_PATH = CAPABILITY_PATH;' +
    ' this.MAX_FILES = MAX_FILES;',
  sandbox,
);

const cases = [];
const check = (label, ok, detail) => cases.push({ label, ok, detail });

/** A minimal request shape for the trust gate. */
const req = (over = {}) => ({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:9613' }, ...over });

// 1) The happy path: a loopback page on the same port.
check('accepts a loopback request', sandbox.isTrustedRequest(req()) === true);
check(
  'accepts an origin on the same port',
  sandbox.isTrustedRequest(req({ headers: { host: '127.0.0.1:9613', origin: 'http://127.0.0.1:9613' } })) === true,
);
check('accepts localhost', sandbox.isTrustedRequest(req({ headers: { host: 'localhost:9613' } })) === true);

// 2) Anything that is not this machine's own page is refused.
check('refuses a non-loopback peer', sandbox.isTrustedRequest(req({ socket: { remoteAddress: '192.168.1.9' } })) === false);
check(
  'refuses a proxied request',
  sandbox.isTrustedRequest(req({ headers: { host: '127.0.0.1:9613', 'x-forwarded-for': '1.2.3.4' } })) === false,
);
check(
  'refuses a forwarded request',
  sandbox.isTrustedRequest(req({ headers: { host: '127.0.0.1:9613', forwarded: 'for=1.2.3.4' } })) === false,
);
check('refuses a foreign host header', sandbox.isTrustedRequest(req({ headers: { host: 'evil.example:9613' } })) === false);
check('refuses a missing host header', sandbox.isTrustedRequest(req({ headers: {} })) === false);
check(
  'refuses a foreign origin',
  sandbox.isTrustedRequest(req({ headers: { host: '127.0.0.1:9613', origin: 'https://evil.example' } })) === false,
);
check(
  'refuses an origin on another port',
  sandbox.isTrustedRequest(req({ headers: { host: '127.0.0.1:9613', origin: 'http://127.0.0.1:9999' } })) === false,
);

// 3) The path validator rejects everything that would paste a ghost.
// `fileURLToPath` decodes the percent-escapes the workspace path needs ("Product
// Enhancement" has a space), so the fixture below is a real absolute path.
const realFile = fileURLToPath(new URL('../index.js', import.meta.url));
check('accepts a real file', sandbox.validatePath(realFile).ok === true, JSON.stringify(sandbox.validatePath(realFile)));
check('rejects a missing file', sandbox.validatePath(`${realFile}.nope`).reason === 'missing');
check('rejects a directory', sandbox.validatePath(realFile.replace(/[^\\/]+$/, '')).ok === false);
check('rejects a relative path', sandbox.validatePath('index.js').reason === 'not an absolute path');
check('rejects an empty path', sandbox.validatePath('   ').reason === 'empty path');
check('rejects a non-string', sandbox.validatePath(42).reason === 'not a string');

// 4) The clipboard payload is base64 of the source, as UTF-16LE.
const decoded = Buffer.from(sandbox.ENCODED_SCRIPT, 'base64').toString('utf16le');
check('payload decodes back to the script', decoded === sandbox.CLIPBOARD_SCRIPT.trim());
check('script uses the literal .NET drop list', decoded.includes('[System.Windows.Forms.Clipboard]::SetFileDropList'));
check('script never uses the wildcard-emitting cmdlet', !/Set-Clipboard\s+-Path/.test(decoded));
check('script reads the list from the environment', decoded.includes('$env:DAM_CLIP_LIST'));
check('script never builds a command line from the list', !decoded.includes('Invoke-Expression') && !decoded.includes('iex '));

// 5) The two route paths are distinct and namespaced.
check('capability route is namespaced', sandbox.CAPABILITY_PATH.startsWith('/dsh-artifact-toolkit/'));
check('copy route is namespaced', sandbox.COPY_FILES_PATH.startsWith('/dsh-artifact-toolkit/'));
check('the routes differ', sandbox.CAPABILITY_PATH !== sandbox.COPY_FILES_PATH);
check('a sane per-request cap', sandbox.MAX_FILES > 0 && sandbox.MAX_FILES <= 200, String(sandbox.MAX_FILES));

let failed = 0;
for (const c of cases) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : ` -> ${c.detail ?? ''}`}`);
}
console.log(failed === 0 ? `\nHost half verified (${cases.length} checks).` : `\n${failed} failed.`);
process.exitCode = failed === 0 ? 0 : 1;
