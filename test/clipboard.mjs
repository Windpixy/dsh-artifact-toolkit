// Pin the file-copy feature: the client asks the Host once, shows the row only
// when the answer is yes, and never claims a copy that did not happen.
//
// The Host half's own logic is covered by host.mjs; this file covers the browser
// side plus the contract the two halves share.
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8');

const cases = [];
const check = (label, ok, detail) => cases.push({ label, ok, detail });

// 1) The two halves agree on the routes. A mismatch means every click 404s, and
//    nothing else in the suite would notice.
const routes = (source) => {
  const out = {};
  for (const m of source.matchAll(/const (ROUTE_PREFIX|CAPABILITY_PATH|COPY_FILES_PATH) = ([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
};
const clientRoutes = routes(client);
const hostRoutes = routes(host);
check('both halves declare three route constants', Object.keys(clientRoutes).length === 3 && Object.keys(hostRoutes).length === 3);
for (const name of ['ROUTE_PREFIX', 'CAPABILITY_PATH', 'COPY_FILES_PATH']) {
  check(`${name} is identical on both sides`, clientRoutes[name] === hostRoutes[name], `${clientRoutes[name]} vs ${hostRoutes[name]}`);
}

// 2) The probe runs once at activation, and its answer is cached in a store the
//    menu subscribes to — otherwise a menu opened early would silently lack the
//    row forever.
check('the probe is kicked off at activation', client.includes('void probeCopyFiles()'));
check('the probe hits the capability route', /fetch\(CAPABILITY_PATH/.test(client));
check('the probe result is published to a store', client.includes('capabilityStore.publish('));
check('an unreachable Host means no row, not an error', /\.catch\(\(\) => \{[\s\S]{0,200}capabilityStore\.publish\(false\)/.test(client));
check('the menu subscribes to that store', client.includes('React.useSyncExternalStore(') && client.includes('capabilityStore.snapshot'));
check('the row list depends on the capability', client.includes('}, [request, t, copyable]);'));

// 3) The capability answer is read from the Host's field, and only `true` counts.
check('only an explicit true enables the row', client.includes('body?.canCopyFiles === true'));
check('the Host reports its own platform, not the browser', host.includes("process.platform === 'win32'"));

// 4) Both file rows are gated. An ungated row would offer an action that cannot
//    work on macOS or on a remote page.
const itemsBlock = client.slice(client.indexOf('const items = React.useMemo'), client.indexOf('}, [request, t, copyable]);'));
for (const id of ['copyFile', 'copyAllFiles']) {
  const rowIndex = itemsBlock.indexOf(`id: '${id}'`);
  check(`${id} exists in the row list`, rowIndex !== -1);
  if (rowIndex === -1) continue;
  const before = itemsBlock.slice(0, rowIndex);
  const gate = before.lastIndexOf('if (copyable === true) {');
  const closing = before.lastIndexOf('}');
  check(`${id} sits inside the capability gate`, gate !== -1 && gate > closing - 200, `gate at ${gate}, last } at ${closing}`);
}

// 5) Name-only references cannot be copied as files: the directory is unknown,
//    and this plugin never guesses one.
check('the name-only branch returns before the file rows', /nameOnly\) \{[\s\S]{0,600}return rows;/.test(client));
const nameOnlyBlock = client.slice(client.indexOf("if (hasOne && nameOnly)"), client.indexOf("if (hasOne) {\n          // Only the rows"));
check('the name-only branch offers no file copy', !nameOnlyBlock.includes('copyFile'), nameOnlyBlock.slice(0, 120).replace(/\s+/g, ' '));

// 6) The request body is what the Host expects, and the response is read as JSON.
check('the request posts the paths array', /JSON\.stringify\(\{ paths \}\)/.test(client));
check('the request is a POST', /method: 'POST'/.test(client));
check('the request declares its content type', client.includes("'content-type': 'application/json'"));
check('a non-json response is a failure, not a success', client.includes('if (body === null) return { ok: false'));

// The Host answers 200 even when it refuses, so `ok` must be checked explicitly:
// trusting the HTTP status alone would report a refused copy as a success.
check('success requires an explicit ok', client.includes('if (body.ok !== true)'));
check('a missing file is surfaced separately', client.includes('body.rejected?.some('));

// 7) The Host validates before writing. Without this the clipboard receives a
//    path that no longer exists and the user pastes a ghost with no explanation.
check('the host checks the path exists', host.includes('statSync(path)'));
check('the host requires a regular file', host.includes('info.isFile()'));
check('the host requires an absolute path', host.includes('/^[a-zA-Z]:[\\\\/]/'));
check('the host refuses an empty list', host.includes("body.paths.length === 0"));
check('the host caps how many files one request may carry', /body\.paths\.length > MAX_FILES/.test(host));
check('the host reports per-path rejections', host.includes('rejected.push('));

// 8) The clipboard write itself. The exact bug this guards: `Set-Clipboard -Path`
//    treats `[` and `]` in a file name as wildcards, silently drops the file, and
//    still reports success. It was observed on this machine, so the guard is real.
//    Check the injected script, not the prose that explains the choice.
const script = (() => {
  const start = host.indexOf('const CLIPBOARD_SCRIPT = `');
  const end = host.indexOf('\n`;', start);
  return start === -1 ? '' : host.slice(start, end);
})();
check('the clipboard script is present', script.length > 0);
check('the host uses the literal .NET drop list', script.includes('[System.Windows.Forms.Clipboard]::SetFileDropList'));
check('the host never uses the wildcard-emitting cmdlet', !/Set-Clipboard\s+-Path/.test(script), script.slice(0, 160));
check('the file list is parsed, not flattened', script.includes('[string[]]@($parsed)'), 'the @() must wrap the parsed variable, not the pipeline');
check('the paths never enter a command line', !host.includes('$args') && !/spawn\(\s*'powershell/.test(host) === false);
check('the script is passed encoded, not interpolated', host.includes("'-EncodedCommand'"));
check('the list travels through the environment', host.includes('DAM_CLIP_LIST'));

// 9) Failure is never silent. Every Host refusal carries a reason the client can
//    show, and the client shows it.
check('host failures carry a reason', host.includes('reason: written.reason') && host.includes("reason: 'body must be JSON'"));
check('the client logs the reason before showing it', client.includes("console.warn('[artifact-menu] copy file failed', result.reason)"));
check('the client shows the reason in the notice', client.includes('${label}（${result.reason}）'));

// 10) The route is fenced. It can write the clipboard, so it must not answer an
//     arbitrary local caller.
check('the host gates on a loopback peer', host.includes('LOOPBACK_ADDRESSES.has(address)'));
check('the host refuses proxy headers', host.includes("req.headers['x-forwarded-for']"));
check('the host validates the origin when present', host.includes('isTrustedOrigin(origin, portOf(host))'));
check('a refused caller gets 403, not a silent no-op', host.includes("writeJson(res, 403, { ok: false, reason: 'forbidden' })"));
check('every route checks trust first', (host.match(/if \(!isTrustedRequest\(req\)\)/g) ?? []).length === 2);

// 11) An unsupported platform is refused by the Host too, not merely hidden in
//     the UI: hiding a row is presentation, not enforcement.
check('the host refuses on other platforms', host.includes("writeJson(res, 501,"));
check('the host refuses a wrong method', host.includes("writeJson(res, 405,"));

let failed = 0;
for (const c of cases) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : ` -> ${c.detail ?? ''}`}`);
}
console.log(failed === 0 ? `\nFile copy contract verified (${cases.length} checks).` : `\n${failed} failed.`);
process.exitCode = failed === 0 ? 0 : 1;
