// Pin the service wiring. A missing inject entry is invisible until the user
// clicks the action that needs it, so it is checked here instead.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

const cases = [];
const check = (label, ok, detail) => cases.push({ label, ok, detail });

const injectMatch = /const inject = \[([^\]]+)\]/.exec(src);
const inject = injectMatch === null ? [] : injectMatch[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

// 1) The two the plugin cannot run without.
check('declares slots', inject.includes('slots'));
check('declares locale', inject.includes('locale'));

// 2) The host remote, and its dotted child. Reaching into `remote` for
//    `.session` without the dotted entry throws at click time.
check('declares remote', inject.includes('remote'));
check('declares remote.session by its dotted name', inject.includes('remote.session'));

// 3) The remaining services the actions read.
check('declares sessions', inject.includes('sessions'));
check('declares sidebarRight', inject.includes('sidebarRight'));

// 4) Services must be read from the injected properties, not from ctx.get.
//    ctx.get('remote') does not carry the dotted injection.
check('no ctx.get for remote', !/ctx\.get\(\s*['"]remote/.test(src));
check('no ctx.get for sessions', !/ctx\.get\(\s*['"]sessions/.test(src));
check('no ctx.get for sidebarRight', !/ctx\.get\(\s*['"]sidebarRight/.test(src));
check('reads ctx.remote', src.includes('ctx.remote'));
check('reads ctx.sessions', src.includes('ctx.sessions'));
check('reads ctx.sidebarRight', src.includes('ctx.sidebarRight'));

// 5) The action that broke must actually use the session remote.
check('reveal/open call session.openWorkspacePath', src.includes('session.openWorkspacePath'));

// 6) The Host half must register the route carrier, and the Client half must not
//    pretend to depend on it: the browser reaches it over HTTP, not Cordis.
const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
check('host reads webServer through ctx.inject', /ctx\.inject\(\s*\[\s*'webServer'/.test(host));
check('host returns the route disposers', host.includes('disposeCapability()') && host.includes('disposeCopy()'));
check('the client half does not inject webServer', !inject.includes('webServer'), inject.join(', '));

// 7) The two halves must agree on the route paths, or every click 404s.
const clientPaths = [...src.matchAll(/const (ROUTE_PREFIX|CAPABILITY_PATH|COPY_FILES_PATH) = ([^;]+);/g)]
  .map(([, name, value]) => [name, value.trim()]);
const hostPaths = [...host.matchAll(/const (ROUTE_PREFIX|CAPABILITY_PATH|COPY_FILES_PATH) = ([^;]+);/g)]
  .map(([, name, value]) => [name, value.trim()]);
check('both halves declare the same route constants', clientPaths.length === 3 && hostPaths.length === 3, `${clientPaths.length}/${hostPaths.length}`);
for (const [name, value] of hostPaths) {
  const client = clientPaths.find(([n]) => n === name);
  check(`${name} matches across the halves`, client !== undefined && client[1] === value, `${client?.[1]} vs ${value}`);
}

let failed = 0;
for (const c of cases) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}`);
}
console.log(`\ninject: [${inject.join(', ')}]`);
console.log(failed === 0 ? `\nService wiring verified (${cases.length} checks).` : `\n${failed} failed.`);
process.exitCode = failed === 0 ? 0 : 1;
