/**
 * Host half of dsh-artifact-toolkit.
 *
 * The only thing the browser cannot do for this plugin is put a real file on the
 * system clipboard: `navigator.clipboard` can write text and images, but the
 * format a file manager and WeChat paste from is Windows' `CF_HDROP`, which only
 * a native process can write. So this half owns exactly one capability — copy
 * the given files to the clipboard — and the Client half asks for it.
 *
 * Why a Web route instead of `@Remote`/`host.call`:
 * `host.call` belongs to the dynamic Client half, which this package does not use
 * (it ships a `dsh.client` module-loader bundle), and a third-party package
 * cannot reach the shipped `fileActions`/`contextMenus` Client services. A plain
 * Web route is the path the other profile plugins (`dsh-prompt-enhance`,
 * `dsh-better-sidebar`) already take, and `webServer` is a stable Host service.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Route prefix owned by this plugin. The Client half uses the same constant. */
const ROUTE_PREFIX = '/dsh-artifact-toolkit';

/** The two endpoints, appended to {@link ROUTE_PREFIX}. */
const CAPABILITY_PATH = `${ROUTE_PREFIX}/capability`;
const COPY_FILES_PATH = `${ROUTE_PREFIX}/copy-files`;

/** How many files one request may copy. A card never lists more than a handful. */
const MAX_FILES = 50;

/** How long one clipboard write may take before it is treated as hung. */
const WRITE_TIMEOUT_MS = 15000;

/** The largest request body accepted, in bytes. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * The PowerShell program that performs the clipboard write.
 *
 * It is embedded as source and delivered through `-EncodedCommand`, so no path,
 * and no part of the request, is ever interpolated into a command line. The file
 * list arrives through the environment variable `DAM_CLIP_LIST`, pointing at a
 * JSON file this process wrote.
 *
 * `Clipboard::SetFileDropList` is used deliberately instead of
 * `Set-Clipboard -Path`: the cmdlet treats `[` and `]` in a file name as
 * wildcard characters, silently drops such a file, and still reports success.
 * The .NET call takes literal strings. The OLE entry is flushed when the process
 * exits, and the data survives that exit (verified on this machine).
 */
const CLIPBOARD_SCRIPT = `
$ErrorActionPreference = 'Stop';
$listPath = $env:DAM_CLIP_LIST;
if ([string]::IsNullOrEmpty($listPath)) { Write-Error 'DAM_CLIP_LIST is empty'; exit 3 }
$raw = Get-Content -LiteralPath $listPath -Raw -Encoding UTF8;
# Assign first, then wrap: '@(ConvertFrom-Json $raw)' yields an array holding the
# array, and the '[string[]]' cast would then flatten it into one space-joined
# path — which SetFileDropList rejects as invalid.
$parsed = ConvertFrom-Json $raw;
$paths = [string[]]@($parsed);
if ($paths.Count -eq 0) { Write-Error 'no paths'; exit 4 }
if (-not ('System.Windows.Forms.Clipboard' -as [type])) { Add-Type -AssemblyName System.Windows.Forms }
$collection = New-Object System.Collections.Specialized.StringCollection;
foreach ($p in $paths) { [void]$collection.Add($p) }
[System.Windows.Forms.Clipboard]::SetFileDropList($collection);
exit 0;
`;

/** The same source as a single `-EncodedCommand` argument (UTF-16LE base64). */
const ENCODED_SCRIPT = Buffer.from(CLIPBOARD_SCRIPT.trim(), 'utf16le').toString('base64');

// ── request trust ──────────────────────────────────────────────────────────
//
// The route is reachable by anything that can reach the listener, so it is
// fenced the same way the other Host routes in this profile fence theirs: only a
// loopback caller, no proxy headers, and an Origin (when present) that names a
// loopback host on this listener's own port. The worst a bypass could do is
// write the clipboard, but a silent write is still worth preventing.

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const TRUSTED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

/** The bare host name of a `Host` header, without its port or IPv6 brackets. */
function hostnameOf(hostHeader) {
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  const colon = trimmed.lastIndexOf(':');
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

/** The port declared by a `Host` header, or null when it declares none. */
function portOf(hostHeader) {
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end === -1) return null;
    const rest = trimmed.slice(end + 1);
    return rest.startsWith(':') ? rest.slice(1) || null : null;
  }
  const colon = trimmed.lastIndexOf(':');
  return colon === -1 ? null : trimmed.slice(colon + 1) || null;
}

/** Whether an `Origin` header names this machine on the listener's own port. */
function isTrustedOrigin(origin, expectedPort) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const bare = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!TRUSTED_HOSTNAMES.has(bare)) return false;
  const port = url.port !== '' ? url.port : url.protocol === 'https:' ? '443' : '80';
  return expectedPort === null || port === expectedPort;
}

/**
 * Whether a request may use this plugin's routes.
 * @param req - the incoming request.
 * @returns whether it comes from this machine's own page.
 */
function isTrustedRequest(req) {
  const address = req.socket?.remoteAddress ?? '';
  if (!LOOPBACK_ADDRESSES.has(address)) return false;
  // A proxied request is not necessarily local, and the DSH page never is one.
  if (req.headers['x-forwarded-for'] !== undefined || req.headers.forwarded !== undefined) return false;
  const host = req.headers.host;
  if (typeof host !== 'string' || host.trim() === '') return false;
  if (!TRUSTED_HOSTNAMES.has(hostnameOf(host))) return false;
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.trim() !== '' && !isTrustedOrigin(origin, portOf(host))) return false;
  return true;
}

// ── response helpers ───────────────────────────────────────────────────────

/** Write one JSON response with no caching. */
function writeJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

/** Read a request body up to a byte cap, or null when it is too large. */
async function readBoundedJson(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) return null;
    chunks.push(chunk);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

// ── path validation ────────────────────────────────────────────────────────

/**
 * Decide whether one requested path may be copied.
 *
 * The browser cannot see the filesystem, so it cannot tell a live file from a
 * stale card. Without this check the clipboard would happily receive a path that
 * no longer exists, and the user would paste a ghost: nothing appears, with no
 * explanation. Only regular files that are still present are accepted.
 * @param value - one entry of the request's `paths` array.
 * @returns the resolved absolute path, or a rejection reason.
 */
function validatePath(value) {
  if (typeof value !== 'string') return { ok: false, reason: 'not a string' };
  const path = value.trim();
  if (path === '') return { ok: false, reason: 'empty path' };
  if (path.length > 4096) return { ok: false, reason: 'path too long' };
  // Absolute only: a relative path would be resolved against the Host's own
  // working directory, which is not the Session's workspace.
  if (!/^[a-zA-Z]:[\\/]/.test(path) && !path.startsWith('\\\\') && !path.startsWith('/')) {
    return { ok: false, reason: 'not an absolute path' };
  }
  let info;
  try {
    info = statSync(path);
  } catch {
    return { ok: false, reason: 'missing', path };
  }
  if (!info.isFile()) return { ok: false, reason: 'not a regular file', path };
  return { ok: true, path };
}

// ── the clipboard write ────────────────────────────────────────────────────

/**
 * Put `paths` on this machine's clipboard as real files.
 *
 * A helper PowerShell process does the write; it exits as soon as the OLE entry
 * is placed, and the entry outlives it. Anything that goes wrong — no
 * PowerShell, a refused spawn, a non-zero exit, a timeout — is reported as a
 * failure with its reason, never as success.
 * @param paths - absolute paths that already passed {@link validatePath}.
 * @returns whether the write completed, and why when it did not.
 */
function writeFilesToClipboard(paths) {
  return new Promise((resolve) => {
    let dir;
    try {
      // One fresh directory per call, so concurrent requests cannot collide.
      dir = mkdtempSync(join(tmpdir(), 'dsh-artifact-clip-'));
      writeFileSync(join(dir, 'paths.json'), JSON.stringify(paths), 'utf8');
    } catch (error) {
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
      resolve({ ok: false, reason: `cannot stage file list: ${error.message}` });
      return;
    }

    const listFile = join(dir, 'paths.json');
    let child;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // The helper has exited (or been killed) before this runs, so the list
      // file is no longer read by anyone.
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // A leftover temporary directory is harmless.
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      // A hung helper must not hold the request open; its clipboard entry, if it
      // got that far, stays valid.
      try {
        child?.kill();
      } catch {
        // Already gone.
      }
      finish({ ok: false, reason: 'clipboard write timed out' });
    }, WRITE_TIMEOUT_MS);

    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', ENCODED_SCRIPT],
        {
          windowsHide: true,
          stdio: 'ignore',
          env: { ...process.env, DAM_CLIP_LIST: listFile },
        },
      );
    } catch (error) {
      finish({ ok: false, reason: `cannot start powershell: ${error.code ?? error.message}` });
      return;
    }

    child.on('error', (error) => {
      finish({ ok: false, reason: `cannot start powershell: ${error.code ?? error.message}` });
    });
    child.on('exit', (code, signal) => {
      if (code === 0) {
        finish({ ok: true });
        return;
      }
      const how = signal === null ? `exit ${code}` : `signal ${signal}`;
      finish({ ok: false, reason: `helpers failed (${how})` });
    });
  });
}

// ── the plugin body ────────────────────────────────────────────────────────

/**
 * Host plugin body: register the two routes the Client half calls.
 *
 * `webServer` is reached through `ctx.inject`, not a hard `inject` dependency: a
 * profile without a Web server must still load this bundle (the Client half and
 * its other actions keep working), it simply has no clipboard route.
 * @param ctx - the Host root context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (routeCtx) => {
    const server = routeCtx.get('webServer');
    if (server === undefined) return;

    routeCtx.effect(() => {
      const disposeCapability = server.register({
        kind: 'exact',
        path: CAPABILITY_PATH,
        handler: (req, res) => {
          if (!isTrustedRequest(req)) {
            writeJson(res, 403, { ok: false, reason: 'forbidden' });
            return;
          }
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            writeJson(res, 405, { ok: false, reason: 'method not allowed' });
            return;
          }
          // Only a clipboard that can carry files is useful to the caller. The
          // Client half hides the row entirely when this is false, rather than
          // offering an action that cannot work.
          writeJson(res, 200, { ok: true, canCopyFiles: process.platform === 'win32', platform: process.platform });
        },
      });

      const disposeCopy = server.register({
        kind: 'exact',
        path: COPY_FILES_PATH,
        handler: async (req, res) => {
          if (!isTrustedRequest(req)) {
            writeJson(res, 403, { ok: false, reason: 'forbidden' });
            return;
          }
          if (req.method !== 'POST') {
            writeJson(res, 405, { ok: false, reason: 'method not allowed' });
            return;
          }
          if (process.platform !== 'win32') {
            writeJson(res, 501, { ok: false, reason: 'unsupported platform' });
            return;
          }
          const body = await readBoundedJson(req, MAX_BODY_BYTES);
          if (body === undefined) {
            writeJson(res, 400, { ok: false, reason: 'body must be JSON' });
            return;
          }
          if (body === null) {
            writeJson(res, 413, { ok: false, reason: 'body too large' });
            return;
          }
          if (!Array.isArray(body?.paths)) {
            writeJson(res, 400, { ok: false, reason: 'paths must be an array' });
            return;
          }
          if (body.paths.length === 0) {
            writeJson(res, 400, { ok: false, reason: 'no paths given' });
            return;
          }
          if (body.paths.length > MAX_FILES) {
            writeJson(res, 400, { ok: false, reason: `at most ${MAX_FILES} files` });
            return;
          }

          const accepted = [];
          const rejected = [];
          for (const value of body.paths) {
            const result = validatePath(value);
            if (result.ok) accepted.push(result.path);
            else rejected.push({ path: value, reason: result.reason });
          }
          if (accepted.length === 0) {
            // Every candidate is gone or not a file; say which, so the card can
            // explain itself instead of claiming a copy that did not happen.
            writeJson(res, 200, { ok: false, reason: 'no copyable files', rejected });
            return;
          }

          const written = await writeFilesToClipboard(accepted);
          if (!written.ok) {
            ctx.logger?.warn?.('copy-files failed: %s', written.reason);
            writeJson(res, 200, { ok: false, reason: written.reason, rejected });
            return;
          }
          writeJson(res, 200, { ok: true, count: accepted.length, rejected });
        },
      });

      return () => {
        disposeCapability();
        disposeCopy();
      };
    }, 'artifact-menu: clipboard routes');
  });
}
