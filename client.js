window.__ModuleLoader__.load({
  id: 'dsh-artifact-toolkit',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /**
     * Write `text` to the system clipboard. The async Clipboard API needs a
     * secure context, so it is tried first and a hidden-textarea fallback
     * covers a plain-HTTP page.
     * @param text - the text to place on the clipboard.
     * @returns whether the write went through.
     */
    async function copyText(text) {
      if (navigator.clipboard?.writeText !== undefined) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          // fall through to the execCommand path
        }
      }
      if (typeof document.execCommand !== 'function') return false;
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      try {
        return document.execCommand('copy');
      } catch {
        return false;
      } finally {
        area.remove();
      }
    }

    /** Dictionary namespace owned by this plugin. */
    const NS = 'artifact-menu';

    /**
     * Routes owned by this plugin's Host half. The Host registers the same two
     * paths; they must stay in step, which `test/host.mjs` checks.
     */
    const ROUTE_PREFIX = '/dsh-artifact-toolkit';
    const CAPABILITY_PATH = `${ROUTE_PREFIX}/capability`;
    const COPY_FILES_PATH = `${ROUTE_PREFIX}/copy-files`;

    /** How long a capability probe may take before the row is treated as absent. */
    const PROBE_TIMEOUT_MS = 4000;

    const zh = {
      copyPath: '复制完整路径',
      copyPathHint: '整条路径，可粘贴到资源管理器地址栏',
      copyRelative: '复制短路径',
      copyRelativeHint: '相对当前项目目录，适合发给 AI',
      copyName: '复制文件名',
      copyFile: '复制文件',
      copyFileHint: '粘贴到微信、邮件或资源管理器，得到文件本身',
      copyAll: '复制全部完整路径',
      copyAllHint: '每行一条，共 {count} 个文件',
      copyAllName: '复制全部文件名',
      copyAllFile: '复制全部文件',
      copyAllFileHint: '共 {count} 个文件，一次粘贴带走全部',
      reveal: '打开所在文件夹',
      openWith: '用默认程序打开',
      preview: '在侧栏预览',
      copied: '已复制',
      copiedAll: '已复制 {count} 个路径',
      copiedName: '已复制 {name}',
      copiedFile: '已复制文件',
      copiedFiles: '已复制 {count} 个文件',
      copying: '正在复制…',
      copyFailed: '复制失败',
      fileCopyFailed: '无法复制文件',
      fileMissing: '文件已不在这个位置',
      revealFailed: '无法打开所在文件夹',
      openFailed: '无法打开文件',
      previewFailed: '无法在侧栏打开',
      nameOnlyNote: '这条链接只记录了文件名，拿不到所在目录',
      unavailable: '当前环境不支持在系统里打开文件',
    };

    const en = {
      copyPath: 'Copy full path',
      copyPathHint: 'The whole path — paste it into the address bar',
      copyRelative: 'Copy short path',
      copyRelativeHint: 'Relative to the project — handy when talking to an AI',
      copyName: 'Copy file name',
      copyFile: 'Copy file',
      copyFileHint: 'Paste into WeChat, mail or Explorer to get the file itself',
      copyAll: 'Copy all full paths',
      copyAllHint: 'One per line, {count} files',
      copyAllName: 'Copy all file names',
      copyAllFile: 'Copy all files',
      copyAllFileHint: '{count} files, all in one paste',
      reveal: 'Show in folder',
      openWith: 'Open in default app',
      preview: 'Preview in sidebar',
      copied: 'Copied',
      copiedAll: 'Copied {count} paths',
      copiedName: 'Copied {name}',
      copiedFile: 'File copied',
      copiedFiles: 'Copied {count} files',
      copying: 'Copying…',
      copyFailed: 'Copy failed',
      fileCopyFailed: 'Could not copy the file',
      fileMissing: 'The file is no longer at this location',
      revealFailed: 'Could not show in folder',
      openFailed: 'Could not open file',
      previewFailed: 'Could not open in the sidebar',
      nameOnlyNote: 'This link records only the file name, so its folder is unknown',
      unavailable: 'This environment cannot open files on the system',
    };

    // ── path helpers ──────────────────────────────────────────────────────

    /** Whether a string looks like a filesystem path rather than prose. */
    function looksLikePath(value) {
      if (typeof value !== 'string') return false;
      const text = value.trim();
      if (text === '' || text.length > 4096) return false;
      return /^[a-zA-Z]:[\\/]/.test(text) || text.startsWith('\\\\') || text.startsWith('/') || /[\\/]/.test(text);
    }

    /**
     * Whether a value is a bare file name that still identifies a file, such as
     * `PerfCard-便携版.zip`. The renderer publishes only the name when the link
     * does not resolve to a recorded session file, so the directory is unknown —
     * but the name itself is exact and worth offering.
     * @param value - the candidate string.
     * @returns whether it looks like a bare file name with an extension.
     */
    function looksLikeFileName(value) {
      if (typeof value !== 'string') return false;
      const text = value.trim();
      if (text === '' || text.length > 255) return false;
      // A separator or drive letter means it is a path, which takes the other branch.
      if (/[\\/]/.test(text) || /^[a-zA-Z]:/.test(text)) return false;
      // Require an extension so ordinary prose never qualifies.
      return /\.[A-Za-z0-9]{1,12}$/.test(text);
    }

    /** Whether a path is rooted (drive letter, UNC, or POSIX). */
    function isAbsolutePath(path) {
      return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/');
    }

    /** The trailing name of a path in either separator spelling. */
    function baseName(path) {
      const parts = path.split(/[\\/]+/).filter(Boolean);
      return parts.length === 0 ? path : parts[parts.length - 1];
    }

    /** Join a workspace root and a relative path with the root's own separator. */
    function joinPath(root, relative) {
      const separator = /[\\/]/.test(root) && root.includes('\\') ? '\\' : '/';
      return `${root.replace(/[\\/]+$/, '')}${separator}${relative.replace(/^[\\/]+/, '')}`;
    }

    /** The part of an absolute path below a workspace root, or null when it is outside. */
    function relativeTo(root, path) {
      if (root === undefined || root === '') return null;
      const base = root.replace(/[\\/]+$/, '').replace(/\//g, '\\');
      const full = path.replace(/\//g, '\\');
      if (full === base) return '';
      if (!full.startsWith(`${base}\\`)) return null;
      return full.slice(base.length + 1);
    }

    /** Encode one `dsh-resource://file/…` path segment, keeping drive-letter colons literal. */
    function encodeSegment(segment) {
      return encodeURIComponent(segment).replace(/%3A/gi, ':');
    }

    /** The `dsh-resource://file/session/<id>/<path>` address of one file. */
    function sessionFileAddress(sessionId, path) {
      const normalized = path.replace(/\\/g, '/');
      return `dsh-resource://file/session/${encodeSegment(sessionId)}/${normalized.split('/').map(encodeSegment).join('/')}`;
    }

    // ── copying the files themselves ──────────────────────────────────────
    //
    // A browser can put text and images on the clipboard, but the format a file
    // manager, WeChat or a mail client pastes a *file* from is the operating
    // system's own file list, which only a native process can write. So the
    // plugin asks its Host half to do it over a local Web route. Everything here
    // degrades to "no row" rather than to an action that cannot work.

    /**
     * Ask the Host half whether it can put files on this machine's clipboard.
     *
     * Probed once per page and cached: the answer depends on the Host's platform,
     * which cannot change while the page is open. The browser's own platform is
     * not consulted — a remote page may be looking at a clipboard on a different
     * machine, and the write happens where the Host runs.
     *
     * The answer arrives asynchronously, so it lives in a tiny subscribable store:
     * a menu opened before the probe settles re-renders when it does, instead of
     * silently omitting the row for the first right-click of the page.
     */
    // Arrow functions, not methods: React stores `subscribe` and `getSnapshot`
    // as bare functions and calls them with no receiver, so a method reading
    // `this.listeners` would throw during render. A throw here takes the whole
    // menu layer down and the right-click appears to do nothing at all.
    const capabilityStore = {
      value: null,
      listeners: new Set(),
      subscribe: (listener) => {
        capabilityStore.listeners.add(listener);
        return () => {
          capabilityStore.listeners.delete(listener);
        };
      },
      snapshot: () => capabilityStore.value,
      publish: (next) => {
        capabilityStore.value = next;
        for (const listener of capabilityStore.listeners) listener();
      },
    };

    /**
     * Probe the Host's clipboard capability once, publishing the result.
     * @returns the probe's promise, for tests and for activation ordering.
     */
    function probeCopyFiles() {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller === null ? null : setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      return fetch(CAPABILITY_PATH, { method: 'GET', signal: controller?.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          capabilityStore.publish(body?.canCopyFiles === true);
        })
        .catch(() => {
          // An unreachable Host means no clipboard route; the row stays hidden.
          capabilityStore.publish(false);
        })
        .finally(() => {
          if (timer !== null) clearTimeout(timer);
        });
    }

    /**
     * Put `paths` on the Host machine's clipboard as real files.
     *
     * `fetch` rejects on a network failure and resolves on any HTTP status, and
     * the Host answers 200 even for a refusal, so both layers are inspected: a
     * non-ok status, a non-JSON body, or `ok !== true` are all failures, and each
     * carries the Host's own reason for the message.
     * @param paths - absolute paths to copy.
     * @returns whether the files reached the clipboard, and why not.
     */
    async function copyFiles(paths) {
      const payload = JSON.stringify({ paths });
      let response;
      try {
        response = await fetch(COPY_FILES_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload,
        });
      } catch (error) {
        return { ok: false, reason: error?.message ?? 'network' };
      }
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (body === null) return { ok: false, reason: `HTTP ${response.status}` };
      if (body.ok !== true) {
        const reason = body.reason ?? `HTTP ${response.status}`;
        const missing = body.rejected?.some((entry) => entry.reason === 'missing') === true;
        return { ok: false, reason, missing };
      }
      return { ok: true, count: typeof body.count === 'number' ? body.count : paths.length };
    }

    // ── reading paths out of the shipped card DOM ─────────────────────────
    //
    // Neither card exposes a path through a data attribute meant for plugins,
    // so this reads the facts the cards already render for accessibility and
    // hover text. Every lookup stays defensive: an unrecognised shape yields
    // no menu, and the browser's own context menu opens as usual.

    /** The absolute path a changed-file row already publishes to assistive tech. */
    function describedPath(el) {
      const ids = el.getAttribute('aria-describedby');
      if (ids === null) return null;
      for (const id of ids.split(/\s+/)) {
        if (id === '') continue;
        const described = document.getElementById(id);
        const text = described?.textContent?.trim();
        if (text !== undefined && looksLikePath(text)) return text;
      }
      return null;
    }

    /** Every changed-file path inside one changed-files card, in row order. */
    function changedFilePaths(card) {
      const paths = [];
      for (const el of card.querySelectorAll('[aria-describedby]')) {
        const path = describedPath(el);
        if (path !== null && !paths.includes(path)) paths.push(path);
      }
      return paths;
    }

    /** Every presented-file path inside one delivery row, in card order. */
    function presentedPaths(card) {
      const row = card.closest('[data-presented-files-row]') ?? card.parentElement ?? card;
      const paths = [];
      for (const el of row.querySelectorAll('[data-presented-file]')) {
        const title = el.querySelector('button[title]')?.getAttribute('title')?.trim();
        if (title !== undefined && looksLikePath(title) && !paths.includes(title)) paths.push(title);
      }
      return paths;
    }

    /**
     * Whether a value is a DOM element, without assuming which window it came from. */
    function isElement(value) {
      return value !== null && typeof value === 'object' && value.nodeType === 1;
    }

    /**
     * The element a delivery card uses to describe its own file — the line under
     * the file name that normally reads "在侧边栏预览" or a progress message.
     * Writing the confirmation there reuses the card's own reporting slot, so no
     * extra element is placed over the page.
     * A changed-files row has no such line (its rows only carry the path and the
     * line counts), so those report through the quiet notice instead.
     * @param anchor - a delivery card or a changed-file row.
     * @returns that element, or null when this anchor has no such line.
     */
    function descriptionSlot(anchor) {
      const presented = anchor.closest('[data-presented-file]');
      if (presented === null) return null;
      return presented.querySelector('[data-presented-description]');
    }

    /**
     * Whether a button is the shipped renderer's inline file mention. That
     * component's class names are build-hashed (`_fileMention_1ypvv_85`), so the
     * hash is stripped before matching; the shape and the surrounding `<code>`
     * are checked too, which keeps ordinary buttons out.
     * @param button - a candidate element.
     * @returns whether this is an inline file mention.
     */
    function isFileMentionButton(button) {
      const className = typeof button.className === 'string' ? button.className : '';
      if (!/(?:^|\s)_?file(?:Mention|Link)(?:_|$|\s)/.test(className)) return false;
      // The mention sits inside the code element the renderer wraps it in.
      return button.tagName === 'BUTTON';
    }

    /**
     * What a right-click landed on, or null when it is not a file reference.
     * A card that holds exactly one file answers for that file even when the
     * pointer missed the text that names it.
     * @param target - the event target, resolved to an Element.
     * @returns the kind, the clicked path, the sibling paths, and the element the feedback badge sits on.
     */
    function cardAt(target) {
      if (!isElement(target)) return null;
      const changed = target.closest('[data-changed-files]');
      if (changed !== null) {
        const focused = target.closest('[aria-describedby]');
        const found = focused === null ? null : describedPath(focused);
        const paths = changedFilePaths(changed);
        const path = found ?? (paths.length === 1 ? paths[0] : null);
        // A single-file card answers on the card; a row answers on that row.
        const anchor = focused !== null && found !== null ? focused : changed;
        return paths.length === 0 && path === null ? null : { kind: 'changed', path, paths, anchor };
      }
      const presented = target.closest('[data-presented-file]');
      if (presented !== null) {
        const found = presented.querySelector('button[title]')?.getAttribute('title')?.trim() ?? null;
        const paths = presentedPaths(presented);
        const path = found ?? (paths.length === 1 ? paths[0] : null);
        return path === null && paths.length === 0 ? null : { kind: 'presented', path, paths, anchor: presented };
      }
      // An inline file reference in the reply body, in either of the two shapes
      // the shipped renderer produces: a `data-ref-chip` button (a delivered or
      // produced path mentioned in backticks) and a plain button with the
      // `fileMention` class (an explicit Markdown link to a file). Both publish
      // the target as `title`. When the link resolved to a recorded session file
      // that title is a full path; when it did not, it is only the file name —
      // still exact, so the name-only actions are offered and the ones needing a
      // directory are hidden rather than guessing one.
      const chip = target.closest('[data-ref-chip]');
      if (chip !== null && chip.tagName === 'BUTTON') {
        const title = chip.getAttribute('title')?.trim();
        if (title !== undefined && looksLikePath(title)) {
          return { kind: 'inline', path: title, paths: [title], anchor: chip };
        }
        if (title !== undefined && looksLikeFileName(title)) {
          return { kind: 'inline', path: title, paths: [title], anchor: chip, nameOnly: true };
        }
      }
      const button = target.closest('button[title]');
      if (button !== null && isFileMentionButton(button)) {
        const title = button.getAttribute('title')?.trim();
        if (title !== undefined && looksLikePath(title)) {
          return { kind: 'inline', path: title, paths: [title], anchor: button };
        }
        if (title !== undefined && looksLikeFileName(title)) {
          return { kind: 'inline', path: title, paths: [title], anchor: button, nameOnly: true };
        }
      }
      return null;
    }

    // ── the shared request store ──────────────────────────────────────────

    /** One right-click request: where the menu opens and what it acts on. */
    class MenuStore {
      state = { open: false, x: 0, y: 0, path: null, paths: [], kind: 'presented' };
      toast = null;
      listeners = new Set();
      toastTimer = null;
      /** The element the last copy landed on, and its own copy of the badge. */
      badge = null;
      badgeTimer = null;

      subscribe = (listener) => {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      };

      snapshot = () => this.state;
      toastSnapshot = () => this.toast;

      publish() {
        for (const listener of this.listeners) listener();
      }

      open(request) {
        this.state = { open: true, ...request };
        this.publish();
      }

      close() {
        if (!this.state.open) return;
        this.state = { ...this.state, open: false };
        this.publish();
      }

      /**
       * Show the bottom notice in one of three tones. The same strip reports
       * both successes and failures, so its colour has to come from the caller
       * rather than from the strip itself.
       * @param tone - 'success', 'error' or 'info'.
       * @param text - the localized message.
       */
      showToastAs(tone, text) {
        this.toast = { tone, text };
        this.publish();
        if (this.toastTimer !== null) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
          this.toastTimer = null;
          this.toast = null;
          this.publish();
        }, 1600);
      }

      /**
       * Report a successful copy where the card itself reports its own progress:
       * by swapping the line under the file name. That is the card's own slot, so
       * nothing floats over the page and nothing shifts the layout.
       * A reference in the middle of a paragraph has no such slot — a floating
       * badge there would cover the prose above or beside it — so that case uses
       * the quiet notice at the bottom of the window instead.
       * @param anchor - the card or row the confirmation belongs to.
       * @param text - the localized confirmation.
       */
      flash(anchor, text) {
        this.clearBadge();
        if (!isElement(anchor)) {
          this.showToastAs('success', text);
          return;
        }
        const slot = descriptionSlot(anchor);
        if (slot === null) {
          // No card line to borrow, so the strip carries the confirmation — and
          // it turns green there too, so a success always looks like a success.
          this.showToastAs('success', text);
          return;
        }
        this.paintBadge(slot, text, 'success');
        this.badgeTimer = setTimeout(() => {
          this.badgeTimer = null;
          this.clearBadge();
        }, 1400);
      }

      /**
       * Report an action that is still running, in the same slot a success
       * uses.
       *
       * A file copy takes about a second, two orders of magnitude longer than
       * every other row here. Without this the menu closes and nothing happens
       * for a moment, which reads as a missed click. The pill is neutral rather
       * than green: this is "working", not "done", and green would claim a
       * result that has not arrived yet.
       * @param anchor - the card or row the notice belongs to.
       * @param text - the localized progress text.
       */
      flashInfo(anchor, text) {
        this.clearBadge();
        if (!isElement(anchor)) {
          this.showToastAs('info', text);
          return;
        }
        const slot = descriptionSlot(anchor);
        if (slot === null) {
          this.showToastAs('info', text);
          return;
        }
        // No expiry timer: the action that started this always ends by calling
        // flash() or showToastAs(), and both clear the pill first.
        this.paintBadge(slot, text, 'info');
      }

      /**
       * Put one pill inside the card's description line, remembering what to
       * restore later.
       * @param slot - the 16px description line to borrow.
       * @param text - what the pill says.
       * @param tone - 'success' or 'info'.
       */
      paintBadge(slot, text, tone) {
        // Put a pill inside the card's own description line rather than
        // restyling that line: the line clips its content, so painting it green
        // would be cut off at the top and bottom. The pill sits where the text
        // was, so nothing around it moves.
        const pill = document.createElement('span');
        pill.className = 'dam-badge';
        pill.setAttribute('data-tone', tone);
        pill.textContent = text;
        this.badge = { node: slot, original: slot.textContent, pill };
        slot.textContent = '';
        slot.appendChild(pill);
      }

      clearBadge() {
        if (this.badgeTimer !== null) clearTimeout(this.badgeTimer);
        this.badgeTimer = null;
        if (this.badge === null) return;
        const { node, original, pill } = this.badge;
        // Drop the pill and put the card's own text back. A re-render may have
        // replaced the node meanwhile; writing to a detached one is harmless.
        if (pill !== null) pill.remove();
        node.textContent = original;
        this.badge = null;
      }

      dispose() {
        if (this.toastTimer !== null) clearTimeout(this.toastTimer);
        this.toastTimer = null;
        this.clearBadge();
        this.listeners.clear();
      }
    }

    // ── styles ────────────────────────────────────────────────────────────

    const CSS = `
.dam-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483000}
.dam-menu{position:fixed;box-sizing:border-box;min-width:230px;max-width:330px;padding:4px;pointer-events:auto;
  border:0.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));border-radius:var(--dsw-radius-md, 8px);
  background:var(--dsw-alias-bg-layer-1, #fff);color:var(--dsw-alias-label-primary, #1f2328);
  box-shadow:0 8px 24px rgba(0,0,0,.16);font-size:13px;line-height:20px;user-select:none}
.dam-item{display:flex;align-items:flex-start;gap:8px;width:100%;box-sizing:border-box;border:0;background:transparent;
  color:inherit;font:inherit;text-align:left;padding:5px 8px;border-radius:var(--dsw-radius-sm, 6px);cursor:pointer}
.dam-item:hover,.dam-item[data-active=true]{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}
.dam-item:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--dsw-alias-state-business-primary, #1f6feb)}
.dam-item[disabled]{cursor:default;opacity:.45;background:transparent}
.dam-icon{flex:none;width:15px;height:20px;display:grid;place-items:center;color:var(--dsw-alias-label-secondary, #6b7280)}
.dam-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.dam-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dam-hint{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary, #6b7280);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* An explanation row: not clickable, so it must not look like a menu item. */
.dam-note{padding:4px 8px 2px;font-size:11px;line-height:15px;white-space:normal;
  color:var(--dsw-alias-label-tertiary, #6b7280)}
.dam-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l2, rgba(0,0,0,.1))}
.dam-toast{position:fixed;left:50%;bottom:48px;transform:translateX(-50%);pointer-events:none;
  padding:6px 14px;border-radius:999px;color:#fff;font-size:12px;font-weight:500;line-height:18px;
  box-shadow:0 4px 16px rgba(0,0,0,.24);max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* A success reads green here too, so the confirmation looks the same wherever
   it lands; failures stay red, and anything else keeps the neutral dark pill. */
.dam-toast[data-tone=success]{background:var(--dsw-alias-state-success-primary, #1a7f37)}
.dam-toast[data-tone=error]{background:var(--dsw-alias-state-error-primary, #ba2723)}
.dam-toast[data-tone=info]{background:rgba(28,28,30,.92)}
/* Inside the card's 16px description line: a compact pill that fits that line
   without growing it, so the 60px card never changes height. The green comes
   from the theme's own success token, so dark and light both read correctly. */
.dam-badge{display:inline-block;box-sizing:border-box;max-width:100%;
  padding:0 8px;border-radius:999px;background:var(--dsw-alias-state-success-primary, #1a7f37);color:#fff;
  font-size:11px;font-weight:600;line-height:15px;letter-spacing:.2px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:middle;
  box-shadow:0 1px 3px rgba(0,0,0,.18);animation:dam-badge-in .16s ease-out}
/* Work in progress borrows the neutral tone instead of the success green: the
   result has not arrived yet, so it must not read as "done". */
.dam-badge[data-tone=info]{background:var(--dsw-alias-label-secondary, #6b7280)}
@keyframes dam-badge-in{from{opacity:0;transform:translateY(1px) scale(.9)}to{opacity:1;transform:translateY(0) scale(1)}}
@media (prefers-reduced-motion:reduce){.dam-badge{animation:none}}
`;

    /** The small glyphs the menu rows use; drawn inline so no icon table is guessed at. */
    const ICONS = {
      copy: 'M6.5 2.5h5l3 3v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z M11.2 2.7v3h3',
      copyAll: 'M5.5 4.5h5l3 3v6a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z M2.5 9.5v-5a1 1 0 0 1 1-1h5',
      // A sheet with a folded corner: the file itself, as distinct from the
      // clipboard-with-a-line glyph the two path rows use.
      file: 'M4 2.5h5l3 3v8a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z M9.2 2.7v3h3',
      fileAll: 'M5.2 4.2h3.4l2.2 2.2v6.1a1 1 0 0 1-1 1h-4.6a1 1 0 0 1-1-1v-7.3a1 1 0 0 1 1-1z M2.2 10.6v-6.4a1 1 0 0 1 1-1h2',
      folder: 'M2.5 4.2h4l1.3 1.6h5.7a1 1 0 0 1 1 1v5.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
      open: 'M8 2.8h5.2v5.2 M13.2 2.8 7.6 8.4 M11.4 9.2v3.2a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h3.2',
      preview: 'M2.4 8s2.1-3.6 5.6-3.6S13.6 8 13.6 8s-2.1 3.6-5.6 3.6S2.4 8 2.4 8z M8 9.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z',
    };

    /** One 16px line icon for a menu row. */
    function MenuIcon({ name }) {
      return h(
        'span',
        { className: 'dam-icon', 'aria-hidden': 'true' },
        h(
          'svg',
          { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.35, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
          h('path', { d: ICONS[name] }),
        ),
      );
    }

    // ── the overlay component ─────────────────────────────────────────────

    /**
     * Keep a render failure inside this plugin. The slot framework reports a
     * failing entry, but a boundary here means a malformed card can never take
     * the surrounding page down with it — the layer simply renders nothing and
     * the native context menu returns.
     */
    class LayerBoundary extends React.Component {
      state = { failed: false };

      static getDerivedStateFromError() {
        return { failed: true };
      }

      componentDidCatch(error) {
        console.warn('[artifact-menu] menu layer failed; the native context menu is unaffected.', error);
      }

      render() {
        return this.state.failed ? null : this.props.children;
      }
    }

    /**
     * The menu and the copy toast, mounted into the frame-wide overlay layer.
     * @param props - the request store, the Session service, and translated copy.
     * @returns the floating layer, empty while nothing is open.
     */
    function ArtifactMenuLayer(props) {
      const { store, services, t } = props;
      const request = React.useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
      const toast = React.useSyncExternalStore(store.subscribe, store.toastSnapshot, store.toastSnapshot);

      // Read on demand: this layer lives for the whole page, so it should not
      // re-render on every Session update just to learn one workspace root.
      const sessionRows = React.useCallback(() => {
        try {
          return Object.values(services?.sessions?.()?.list?.getSnapshot?.()?.byId ?? {});
        } catch {
          return [];
        }
      }, [services]);

      const menuRef = React.useRef(null);
      const [placement, setPlacement] = React.useState(null);
      const [activeIndex, setActiveIndex] = React.useState(-1);
      // Subscribe to the Host's clipboard capability so a menu opened before the
      // probe settles gains the row as soon as the answer arrives.
      const copyable = React.useSyncExternalStore(
        capabilityStore.subscribe,
        capabilityStore.snapshot,
        capabilityStore.snapshot,
      );

      /** The Session whose workspace root contains `path`, else the visible one. */
      const rootFor = React.useCallback(
        (path) => {
          const rows = sessionRows();
          let best = null;
          for (const row of rows) {
            const cwd = row?.cwd;
            if (typeof cwd !== 'string' || cwd === '' || path === null) continue;
            const root = cwd.replace(/[\\/]+$/, '');
            const normalized = path.replace(/\//g, '\\');
            const base = root.replace(/\//g, '\\');
            if (normalized === base || normalized.startsWith(`${base}\\`)) {
              if (best === null || root.length > best.length) best = { cwd, sessionId: row.id };
            }
          }
          if (best !== null) return best;
          const visible = rows.find((row) => (row?.retainedBy?.mainView ?? 0) > 0) ?? rows[0];
          return { cwd: visible?.cwd, sessionId: visible?.id };
        },
        [sessionRows],
      );

      /** The absolute path of one card path, resolving a relative one against the Session root. */
      const absolute = React.useCallback(
        (path) => {
          if (path === null) return null;
          if (isAbsolutePath(path)) return path;
          const root = rootFor(null).cwd;
          return typeof root === 'string' && root !== '' ? joinPath(root, path) : null;
        },
        [rootFor],
      );

      const items = React.useMemo(() => {
        if (!request.open) return [];
        const hasOne = request.path !== null;
        const count = request.paths.length;
        const many = count > 1;
        const params = { count: String(count) };
        // A reference that carried only a file name has no known directory, so
        // everything needing a path would have to be guessed. Offer just the
        // action whose result is exact.
        const nameOnly = request.nameOnly === true;
        const rows = [];
        if (hasOne && nameOnly) {
          // The reference carried only a name, so say why the rest is missing
          // rather than offering a shorter menu with no explanation.
          rows.push({ id: 'copyName', icon: 'copy', label: t('copyName') });
          rows.push({ id: 'nameOnlyNote', type: 'note', label: t('nameOnlyNote') });
          return rows;
        }
        if (hasOne) {
          // Only the rows whose names look interchangeable carry a gloss:
          // "full path" and "short path" differ in output but not in wording, and
          // "copy file" sits right beside "copy file name" — picking the wrong
          // one of any of those fails quietly. Everything else says what it does
          // in its own name, so it stays one line.
          rows.push({ id: 'copyPath', icon: 'copy', label: t('copyPath'), hint: t('copyPathHint') });
          rows.push({ id: 'copyRelative', icon: 'copy', label: t('copyRelative'), hint: t('copyRelativeHint') });
          rows.push({ id: 'copyName', icon: 'copy', label: t('copyName') });
          // Offered only when the Host says it can really put a file on the
          // clipboard; an action that cannot work is worse than an absent row.
          if (copyable === true) {
            rows.push({ id: 'copyFile', icon: 'file', label: t('copyFile'), hint: t('copyFileHint') });
          }
        }
        if (many) {
          if (hasOne) rows.push({ type: 'separator' });
          rows.push({ id: 'copyAll', icon: 'copyAll', label: t('copyAll'), hint: t('copyAllHint', params) });
          rows.push({ id: 'copyAllName', icon: 'copyAll', label: t('copyAllName') });
          if (copyable === true) {
            rows.push({ id: 'copyAllFiles', icon: 'fileAll', label: t('copyAllFile'), hint: t('copyAllFileHint', params) });
          }
        }
        if (hasOne) {
          rows.push({ type: 'separator' });
          rows.push({ id: 'reveal', icon: 'folder', label: t('reveal') });
          rows.push({ id: 'openWith', icon: 'open', label: t('openWith') });
          rows.push({ id: 'preview', icon: 'preview', label: t('preview') });
        }
        return rows;
      }, [request, t, copyable]);

      const selectable = items.filter((item) => item.type === undefined);

      // Place the menu at the pointer, then pull it back inside the viewport.
      React.useLayoutEffect(() => {
        if (!request.open) {
          setPlacement(null);
          return;
        }
        const node = menuRef.current;
        const margin = 8;
        const width = node?.offsetWidth ?? 200;
        const height = node?.offsetHeight ?? 200;
        const left = Math.min(Math.max(request.x, margin), Math.max(window.innerWidth - width - margin, margin));
        const top = Math.min(Math.max(request.y, margin), Math.max(window.innerHeight - height - margin, margin));
        setPlacement({ left, top });
      }, [request.open, request.x, request.y, items.length]);

      React.useEffect(() => {
        setActiveIndex(-1);
      }, [request.open, request.x, request.y]);

      // A context menu opened by mouse still has to be usable from the keyboard:
      // move focus into it on open and hand it back to where it came from on close.
      React.useEffect(() => {
        if (!request.open) return;
        const previous = document.activeElement;
        const node = menuRef.current;
        if (node !== null) node.focus({ preventScroll: true });
        return () => {
          if (previous instanceof HTMLElement && previous.isConnected) {
            previous.focus({ preventScroll: true });
          }
        };
      }, [request.open]);

      const run = React.useCallback(
        async (id) => {
          const path = request.path;
          const anchor = request.anchor;
          const abs = absolute(path);
          const root = rootFor(abs ?? path);
          // A successful action reports where the card itself reports; a failure
          // has no trustworthy place to sit on, so it uses the quiet notice.
          const confirm = (ok, text) => {
            if (ok) {
              store.flash(anchor, text);
              return;
            }
            store.showToastAs('error', t('copyFailed'));
          };
          store.close();
          try {
            if (id === 'copyPath' && abs !== null) {
              confirm(await copyText(abs), t('copied'));
              return;
            }
            if (id === 'copyRelative' && path !== null) {
              const relative = abs === null ? path : (relativeTo(root.cwd, abs) ?? path);
              confirm(await copyText(relative), t('copied'));
              return;
            }
            if (id === 'copyName' && path !== null) {
              const name = baseName(path);
              confirm(await copyText(name), t('copiedName', { name }));
              return;
            }
            if (id === 'copyAll' || id === 'copyAllName') {
              const rows = request.paths
                .map((item) => (id === 'copyAll' ? (absolute(item) ?? item) : baseName(item)))
                .filter((value) => typeof value === 'string' && value !== '');
              if (rows.length === 0) {
                store.showToastAs('error', t('copyFailed'));
                return;
              }
              confirm(await copyText(rows.join('\n')), t('copiedAll', { count: String(rows.length) }));
              return;
            }
            if (id === 'copyFile' || id === 'copyAllFiles') {
              // Unlike a text copy this takes about a second: a native helper
              // writes the system file list. Say so on the card immediately, so
              // the wait reads as progress rather than as a missed click.
              const targets =
                id === 'copyFile'
                  ? abs === null
                    ? []
                    : [abs]
                  : request.paths.map((item) => absolute(item)).filter((value) => value !== null);
              if (targets.length === 0) {
                store.showToastAs('error', t('fileCopyFailed'));
                return;
              }
              store.flashInfo(anchor, t('copying'));
              const result = await copyFiles(targets);
              if (!result.ok) {
                // "The file is gone" is actionable and means something different
                // from "the clipboard write failed", so they are not merged.
                const label = result.missing === true ? t('fileMissing') : t('fileCopyFailed');
                console.warn('[artifact-menu] copy file failed', result.reason);
                store.showToastAs('error', `${label}（${result.reason}）`);
                return;
              }
              const count = result.count;
              store.flash(anchor, count > 1 ? t('copiedFiles', { count: String(count) }) : t('copiedFile'));
              return;
            }
            if ((id === 'reveal' || id === 'openWith') && abs !== null) {
              const session = services?.remote?.()?.session;
              if (session === undefined || typeof session.openWorkspacePath !== 'function') {
                store.showToastAs('error', t('unavailable'));
                return;
              }
              const request = id === 'reveal' ? { path: abs, action: 'reveal' } : { path: abs };
              let failure = '';
              try {
                const result = await session.openWorkspacePath(request);
                if (result?.ok) return;
                failure = 'host refused';
              } catch (error) {
                // The Host reports why it refused (unverified path, missing
                // desktop, unknown application); keep that text, it is the only
                // clue when a path the sidebar can preview fails to open.
                failure = error?.remote?.code ?? error?.code ?? error?.message ?? 'failed';
              }
              console.warn('[artifact-menu] open/reveal rejected', request, failure);
              store.showToastAs(
                'error',
                `${id === 'reveal' ? t('revealFailed') : t('openFailed')}（${failure}）`,
              );
              return;
            }
            if (id === 'preview' && abs !== null) {
              const sidebar = services?.sidebarRight?.();
              if (sidebar === undefined) return;
              const inside = relativeTo(root.cwd, abs);
              sidebar.openResource(sessionFileAddress(root.sessionId ?? '', inside ?? abs.replace(/\\/g, '/')));
            }
          } catch (error) {
            // Name what actually failed: "reveal" and "open" are different
            // actions and used to share one message, which made a folder-reveal
            // failure read as a file-open failure with no clue attached.
            const reason = error?.remote?.code ?? error?.code ?? error?.message ?? 'failed';
            console.warn('[artifact-menu] action failed', id, reason, error);
            if (id === 'reveal') {
              store.showToastAs('error', `${t('revealFailed')}（${reason}）`);
            } else if (id === 'openWith') {
              store.showToastAs('error', `${t('openFailed')}（${reason}）`);
            } else if (id === 'preview') {
              store.showToastAs('error', `${t('previewFailed')}（${reason}）`);
            } else {
              store.showToastAs('error', `${t('copyFailed')}（${reason}）`);
            }
          }
        },
        [request, absolute, rootFor, store, t, services],
      );

      // Dismissal: Escape, any outside pointer press, scroll and resize.
      React.useEffect(() => {
        if (!request.open) return;
        const onPointerDown = (event) => {
          if (menuRef.current?.contains(event.target) === true) return;
          store.close();
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            store.close();
            return;
          }
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
          event.preventDefault();
          if (selectable.length === 0) return;
          if (event.key === 'Enter') {
            const chosen = selectable[activeIndex];
            if (chosen !== undefined) void run(chosen.id);
            return;
          }
          const step = event.key === 'ArrowDown' ? 1 : -1;
          const next = (activeIndex + step + selectable.length) % selectable.length;
          setActiveIndex(next);
          // Keep the real focus ring on the highlighted row so the choice is
          // visible and screen readers announce the right item. The menu
          // renders one button per selectable row, in the same order.
          const buttons = menuRef.current?.querySelectorAll('button[role="menuitem"]');
          const target = buttons === undefined ? undefined : buttons[next];
          if (target instanceof HTMLElement) target.focus({ preventScroll: true });
        };
        const onDismiss = () => {
          store.close();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('scroll', onDismiss, true);
        window.addEventListener('resize', onDismiss);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('scroll', onDismiss, true);
          window.removeEventListener('resize', onDismiss);
        };
      }, [request.open, activeIndex, selectable, run, store]);

      if (!request.open && toast === null) return null;

      const menu = request.open
        ? h(
            'div',
            {
              ref: menuRef,
              className: 'dam-menu',
              role: 'menu',
              tabIndex: -1,
              'aria-label': t('copyPath'),
              'data-artifact-menu': '',
              style: {
                left: `${placement?.left ?? request.x}px`,
                top: `${placement?.top ?? request.y}px`,
                visibility: placement === null ? 'hidden' : 'visible',
              },
              onContextMenu: (event) => {
                event.preventDefault();
                event.stopPropagation();
              },
            },
            items.map((item, index) =>
              item.type === 'separator'
                ? h('div', { key: `sep:${index}`, className: 'dam-sep', role: 'separator' })
                : item.type === 'note'
                  ? h('div', { key: `note:${index}`, className: 'dam-note' }, item.label)
                  : h(
                    'button',
                    {
                      key: item.id,
                      type: 'button',
                      role: 'menuitem',
                      className: 'dam-item',
                      'data-active': selectable.indexOf(item) === activeIndex ? true : undefined,
                      onClick: () => void run(item.id),
                    },
                    h(MenuIcon, { name: item.icon }),
                    h(
                      'span',
                      { className: 'dam-text' },
                      h('span', { className: 'dam-label' }, item.label),
                      // A one-line gloss under each name: "file path" and
                      // "relative path" mean nothing to someone who does not
                      // live in a terminal, and picking the wrong one is silent.
                      item.hint === undefined ? null : h('span', { className: 'dam-hint' }, item.hint),
                    ),
                  ),
            ),
          )
        : null;

      return h(
        'div',
        { className: 'dam-layer', 'data-artifact-menu-layer': '' },
        menu,
        toast === null
          ? null
          : h(
              'div',
              {
                className: 'dam-toast',
                'data-tone': toast.tone,
                role: 'status',
                'aria-live': 'polite',
              },
              toast.text,
            ),
      );
    }

    /** The registered entry: the bounds check wraps the layer so a render fault stays local. */
    function ArtifactMenuLayerWithBoundary(props) {
      return h(LayerBoundary, null, h(ArtifactMenuLayer, props));
    }

    // ── the plugin body ───────────────────────────────────────────────────

    /**
     * Services this plugin reads. 'remote.session' must be listed by its own
     * dotted name: reaching into `remote` for `.session` without that entry
     * throws `cannot get property "remote.session" without inject`, which is
     * exactly what the reveal/open actions need. The rest are optional at call
     * time (the layer checks before using them), so a composition without them
     * only loses the actions that need them.
     */
    const inject = ['slots', 'locale', 'remote', 'remote.session', 'sessions', 'sidebarRight'];

    /**
     * Client plugin body: install the styles, register the overlay layer, and
     * listen for right-clicks on the two file cards.
     * @param ctx - the client root context.
     */
    function apply(ctx) {
      const store = new MenuStore();

      ctx.effect(() => {
        const tag = document.createElement('style');
        tag.dataset.plugin = 'dsh-artifact-toolkit';
        tag.dataset.pluginCss = 'dsh-artifact-toolkit/menu.css';
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => {
          tag.remove();
        };
      }, 'artifact-menu: styles');

      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'artifact-menu: dictionaries');

      ctx.effect(
        () => () => store.dispose(),
        'artifact-menu: store',
      );

      // Ask the Host once, at activation, whether it can put a file on the
      // clipboard. Deciding up front keeps the row out of the first right-click
      // of the page and stops the question being asked again on every menu.
      ctx.effect(() => {
        void probeCopyFiles();
      }, 'artifact-menu: clipboard capability');

      // The one gesture this plugin adds. It claims only right-clicks that land
      // on a recognised file card; everything else keeps the native menu.
      ctx.effect(() => {
        const onContextMenu = (event) => {
          const target = isElement(event.target) ? event.target : event.target?.parentElement;
          const card = cardAt(target);
          if (card === null) return;
          event.preventDefault();
          event.stopPropagation();
          store.open({ x: event.clientX, y: event.clientY, path: card.path, paths: card.paths, kind: card.kind, anchor: card.anchor });
        };
        document.addEventListener('contextmenu', onContextMenu, true);
        return () => {
          document.removeEventListener('contextmenu', onContextMenu, true);
        };
      }, 'artifact-menu: context menu listener');

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'artifact-menu',
            order: 900,
            locale: NS,
            // Read through the injected properties, never through ctx.get: the
            // dotted 'remote.session' entry only resolves as a real injection.
            inject: () => ({
              store,
              services: {
                sessions: () => ctx.sessions,
                remote: () => ctx.remote,
                sidebarRight: () => ctx.sidebarRight,
              },
            }),
          },
          ArtifactMenuLayerWithBoundary,
        ),
      );
    }

    return { inject, apply };
  },
});
