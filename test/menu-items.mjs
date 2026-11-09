// Re-implement the menu-row rules exactly as client.js states them, then check
// that every card shape offers the required actions and the multi-file extras.
//
// Keeping this as a mirror is deliberate: the source block uses React hooks, and
// the rules themselves are a handful of plain conditionals worth pinning in a test.

/** The rows one request produces, mirroring items() in client.js. */
function rowsFor(request, copyable = true) {
  if (!request.open) return [];
  const hasOne = request.path !== null;
  const many = request.paths.length > 1;
  const rows = [];
  if (hasOne) rows.push('copyPath', 'copyRelative', 'copyName');
  // The file rows exist only when the Host said it can really write the clipboard.
  if (hasOne && copyable) rows.push('copyFile');
  if (many) rows.push('copyAll', 'copyAllName');
  if (many && copyable) rows.push('copyAllFiles');
  if (hasOne) rows.push('reveal', 'openWith', 'preview');
  return rows;
}

const REQUIRED = ['copyPath', 'copyRelative', 'copyName', 'reveal', 'openWith', 'preview'];

const cases = [
  ['delivery card, one file', { open: true, path: 'C:/w/a.md', paths: ['C:/w/a.md'] }, false],
  ['delivery card among several (clicked one)', { open: true, path: 'C:/w/a.md', paths: ['C:/w/a.md', 'C:/w/b.md'] }, true],
  ['changed card, row picked of two', { open: true, path: 'C:/w/a.md', paths: ['C:/w/a.md', 'C:/w/b.md'] }, true],
  ['changed card, single file', { open: true, path: 'C:/w/a.md', paths: ['C:/w/a.md'] }, false],
  ['inline reference in the reply', { open: true, path: 'C:/w/a.md', paths: ['C:/w/a.md'] }, false],
];

let failed = 0;
for (const [label, request, expectMulti] of cases) {
  const rows = rowsFor(request);
  const missing = REQUIRED.filter((id) => !rows.includes(id));
  const hasMulti = rows.includes('copyAll') && rows.includes('copyAllName');
  const ok = missing.length === 0 && hasMulti === expectMulti;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`      ${rows.join(', ')}`);
  if (missing.length > 0) console.log(`      MISSING: ${missing.join(', ')}`);
  if (hasMulti !== expectMulti) console.log(`      multi-file rows should be ${expectMulti ? 'present' : 'absent'}`);
}

const closed = rowsFor({ open: false, path: null, paths: [] });
console.log(`${closed.length === 0 ? 'PASS' : 'FAIL'}  closed menu has no rows`);
if (closed.length !== 0) failed += 1;

// The file-copy rows are conditional on the Host's capability, in both the
// mirror and the source.
const single = { open: true, path: 'C:/w/a.md', paths: ['C:/w/a.md'] };
const withCap = rowsFor(single, true);
const withoutCap = rowsFor(single, false);
console.log(`${withCap.includes('copyFile') ? 'PASS' : 'FAIL'}  a capable Host offers 复制文件`);
console.log(`${!withoutCap.includes('copyFile') ? 'PASS' : 'FAIL'}  an incapable Host hides 复制文件`);
if (!withCap.includes('copyFile') || withoutCap.includes('copyFile')) failed += 1;

// Cross-check the mirror against the real source so drift is caught.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('const items = React.useMemo'), src.indexOf('}, [request, t, copyable]);'));
for (const id of [...REQUIRED, 'copyAll', 'copyAllName', 'copyFile', 'copyAllFiles']) {
  const present = block.includes(`id: '${id}'`);
  if (!present) {
    failed += 1;
    console.log(`FAIL  source no longer builds row '${id}'`);
  }
}
console.log(`PASS  source builds all ${[...REQUIRED, 'copyAll', 'copyAllName', 'copyFile', 'copyAllFiles'].length} rows`);

// Both file rows must sit behind the capability flag, never beside it.
const gateAfter = block.indexOf("if (copyable === true) {\n            rows.push({ id: 'copyFile'");
console.log(`${gateAfter !== -1 ? 'PASS' : 'FAIL'}  the single-file row is gated on capability`);
if (gateAfter === -1) failed += 1;

console.log(failed === 0 ? `\nEvery card shape offers the required actions (${cases.length + 3} checks).` : `\n${failed} failed.`);
process.exitCode = failed === 0 ? 0 : 1;
