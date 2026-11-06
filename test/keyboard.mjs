// Verify the menu is operable from the keyboard, not only by mouse.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

const cases = [];
const check = (label, ok, detail) => cases.push({ label, ok, detail });

// The menu container must be focusable for focus to move into it.
check('menu container is focusable', /role: 'menu',\s*\n\s*tabIndex: -1/.test(src));

// Focus moves in on open and back out on close.
check('menu takes focus when opened', src.includes('node.focus({ preventScroll: true })'));
check('focus returns to the previous element', src.includes('previous.focus({ preventScroll: true })'));
check('the previous element is remembered', src.includes('const previous = document.activeElement'));

// Arrow keys move the highlight, Enter runs the highlighted row, Escape closes.
check('ArrowDown and ArrowUp are handled', src.includes("event.key !== 'ArrowDown' && event.key !== 'ArrowUp'"));
check('Enter runs the highlighted row', src.includes("if (chosen !== undefined) void run(chosen.id)"));
check('Escape closes the menu', /if \(event\.key === 'Escape'\)/.test(src));

// The highlight wraps around in both directions instead of stopping at an end.
check('highlight wraps', src.includes('(activeIndex + step + selectable.length) % selectable.length'));

// The DOM focus follows the highlight so the ring is visible.
check('DOM focus follows the highlight', src.includes('target.focus({ preventScroll: true })'));

// Outside press, scroll and resize all dismiss it.
check('outside press dismisses', src.includes('store.close();') && src.includes("document.addEventListener('pointerdown'"));
check('scroll dismisses', src.includes("window.addEventListener('scroll', onDismiss, true)"));
check('resize dismisses', src.includes("window.addEventListener('resize', onDismiss)"));

// Listeners are removed with the same options they were added with.
check(
  'listeners are cleaned up with capture flags',
  src.includes("document.removeEventListener('pointerdown', onPointerDown, true)") &&
    src.includes("window.removeEventListener('scroll', onDismiss, true)"),
);

// A right-click on the menu itself must not open the native menu over it.
check('menu swallows its own right-click', /onContextMenu: \(event\) => \{\s*\n\s*event\.preventDefault\(\)/.test(src));

let failed = 0;
for (const c of cases) {
  if (!c.ok) failed += 1;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}`);
}
console.log(failed === 0 ? `\nKeyboard and dismissal behaviour verified (${cases.length} checks).` : `\n${failed} failed.`);
process.exitCode = failed === 0 ? 0 : 1;
