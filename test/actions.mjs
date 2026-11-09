// Pin the action table: which menu id does what, and what each failure says.
// This is a reading of run() in client.js; the ids and guards are asserted
// against the source below so the two cannot drift apart silently.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const runStart = src.indexOf('const run = React.useCallback');
const runEnd = src.indexOf('[request, absolute, rootFor, store, t, services]');
const run = src.slice(runStart, runEnd);

const cases = [];
const check = (label, ok, detail) => cases.push({ label, ok, detail });

// 1) Every required action is dispatched.
for (const id of ['copyPath', 'copyRelative', 'copyName', 'copyAll', 'copyAllName', 'copyFile', 'copyAllFiles', 'reveal', 'openWith', 'preview']) {
  check(`dispatches ${id}`, run.includes(`'${id}'`));
}

// 2) Copy actions go through the clipboard and report via confirm().
for (const id of ['copyPath', 'copyRelative', 'copyName']) {
  const branch = run.slice(run.indexOf(`'${id}'`), run.indexOf(`'${id}'`) + 320);
  check(`${id} uses the clipboard`, branch.includes('copyText('));
  check(`${id} reports through confirm`, branch.includes('confirm('));
}

// 3) The two native actions go through the Host remote, not the clipboard.
const nativeBranch = run.slice(run.indexOf("'reveal' || id === 'openWith'"));
check('open/reveal call openWorkspacePath', nativeBranch.includes('openWorkspacePath'));
check('reveal asks for the file-manager action', nativeBranch.includes("action: 'reveal'"));
// The request is built once, then handed over; the reveal branch adds `action`,
// the plain-open branch must not.
check(
  'open with default omits the action',
  /const request = id === 'reveal' \? \{ path: abs, action: 'reveal' \} : \{ path: abs \}/.test(nativeBranch),
  nativeBranch.slice(0, 200).replace(/\s+/g, ' '),
);
check('a missing desktop is reported, not silently ignored', nativeBranch.includes("t('unavailable')"));
// A refusal must say why: the Host's reason is the only clue when a path that
// previews fine cannot be opened.
check('a refusal carries the Host reason', nativeBranch.includes('failure =') && nativeBranch.includes('remote?.code'));
check('a refusal is logged with the request', nativeBranch.includes('console.warn'));

// 4) Failures name the action that actually failed. Reveal and open are
//    different gestures; sharing one message made a folder-reveal failure read
//    as a file-open failure and hid the cause.
const catchBlock = run.slice(run.indexOf('} catch (error)'));
check(
  'a reveal failure says reveal',
  /if \(id === 'reveal'\)[\s\S]{0,120}t\('revealFailed'\)/.test(catchBlock),
  catchBlock.slice(0, 200).replace(/\s+/g, ' '),
);
check(
  'an open failure says open',
  /id === 'openWith'[\s\S]{0,120}t\('openFailed'\)/.test(catchBlock),
);
check(
  'a preview failure says preview',
  /id === 'preview'[\s\S]{0,120}t\('previewFailed'\)/.test(catchBlock),
);
check('an unexpected failure still carries its reason', catchBlock.includes('（${reason}）'));
check('failures are logged for diagnosis', catchBlock.includes('console.warn'));

// 5) "Copied all" counts what is actually written, and an empty set is a failure.
const allBranch = run.slice(run.indexOf("'copyAll' || id === 'copyAllName'"));
check('empty path list is a failure', allBranch.includes('rows.length === 0'));
check('count comes from the resolved rows', allBranch.includes("count: String(rows.length)"));

// 6) Preview goes through the sidebar, addressed per Session.
check('preview opens a sidebar resource', run.includes('openResource('));
check('preview address is Session-scoped', run.includes('sessionFileAddress('));

// 7) Every branch that needs a path is guarded against a null path.
const copyGuards = (run.match(/&& (abs|path) !== null/g) ?? []).length;
check('null paths are guarded before use', copyGuards >= 4, `guards=${copyGuards}`);

// 8) Copying a file is not a clipboard text write: it goes to the Host, says it
//    is working while it waits, and never reports a partial result as success.
const fileBranch = run.slice(run.indexOf("id === 'copyFile'"), run.indexOf("id === 'reveal' || id === 'openWith'"));
check('the file branch goes to the Host, not copyText', !fileBranch.includes('copyText('), fileBranch.slice(0, 160).replace(/\s+/g, ' '));
check('the file branch calls copyFiles', fileBranch.includes('copyFiles('));
check('the wait is announced before it is waited for', fileBranch.includes("flashInfo(anchor, t('copying'))"));
// The progress pill must be painted BEFORE the await, otherwise a slow Host shows
// nothing and the click reads as a miss.
check(
  'the progress notice precedes the await',
  fileBranch.indexOf('flashInfo(') !== -1 &&
    fileBranch.indexOf('flashInfo(') < fileBranch.indexOf('await copyFiles('),
);
// The failure arm must end in an error notice and never fall through to the
// success flash. Assert over the arm's own text rather than a character budget.
const failStart = fileBranch.indexOf('if (!result.ok)');
const failArm = failStart === -1 ? '' : fileBranch.slice(failStart, fileBranch.indexOf('return;', failStart) + 'return;'.length);
check('a failed copy reports an error', failArm.includes("showToastAs('error'"), failArm.replace(/\s+/g, ' ').slice(0, 160));
check('a failed copy never reaches the success flash', !failArm.includes('store.flash('), failArm.replace(/\s+/g, ' ').slice(0, 160));
check('a copy failure carries the Host reason', fileBranch.includes('result.reason'));
// "The file is gone" and "the write failed" are different problems.
check('a missing file is named as such', fileBranch.includes("t('fileMissing')"));
check('a missing file is distinguished from a failed write', fileBranch.includes('result.missing'));
// The confirmation counts what actually landed.
check('the confirmation counts what was written', fileBranch.includes('copiedFiles') && fileBranch.includes('copiedFile'));

let failed = 0;
for (const c of cases) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : ` -> ${c.detail ?? ''}`}`);
}
console.log(failed === 0 ? `\nAction dispatch verified (${cases.length} checks).` : `\n${failed} failed.`);
process.exitCode = failed === 0 ? 0 : 1;
