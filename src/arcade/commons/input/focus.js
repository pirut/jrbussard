/*
 * Moving through a menu with a d-pad or arrow keys: from the focused
 * control, the nearest one that lies the way you pushed.
 *
 * `nextInDirection` works on plain rectangles so it can be tested and reused
 * anywhere; `moveFocus` applies it to the controls inside a DOM element.
 *
 * Browser only: everything below `nextInDirection` reads the DOM
 * (document.activeElement, querySelectorAll, getBoundingClientRect). The
 * native app does not import this file. Used by
 * useGamepad.js (pad-driven menus) and the tab lists in HelpOverlay and
 * SettingsPanel (tabListKeys). Only the tested `nextInDirection` is DOM-free.
 */

const center = (r) => [r.left + r.width / 2, r.top + r.height / 2];

/*
 * Index of the rect to go to from `from` when pushing `dir`, or -1 when
 * nothing lies that way. Something straight along the push beats something
 * nearer but off to the side.
 *
 * `rects` are {left, top, width, height} (DOMRect-shaped), `dir` is "up",
 * "down", "left" or "right". When `from` is not a valid index (nothing is
 * focused yet) it returns 0, the first item, rather than -1.
 *
 * Scoring: distance travelled along the push plus three times the sideways
 * offset between centres, lowest wins, so a control one row down and a
 * little left beats one far below. Candidates whose centres lie less than
 * 1px along the push are ignored (the same row, or the control itself).
 */
export function nextInDirection(rects, from, dir) {
  if (!rects.length) return -1;
  if (from < 0 || from >= rects.length) return 0;
  const [cx, cy] = center(rects[from]);
  const a = rects[from];
  let best = -1;
  let bestScore = Infinity;
  rects.forEach((r, i) => {
    if (i === from) return;
    const [x, y] = center(r);
    const dx = x - cx;
    const dy = y - cy;
    let along;
    let across;
    if (dir === "up" || dir === "down") {
      along = dir === "up" ? -dy : dy;
      /* Controls that overlap sideways with the current one count as
         straight along (zero sideways cost), even if their centres differ,
         so a wide button still reaches a narrow one beneath it. */
      const overlap = Math.min(a.left + a.width, r.left + r.width) - Math.max(a.left, r.left);
      across = overlap > 0 ? 0 : Math.abs(dx);
    } else {
      along = dir === "left" ? -dx : dx;
      const overlap = Math.min(a.top + a.height, r.top + r.height) - Math.max(a.top, r.top);
      across = overlap > 0 ? 0 : Math.abs(dy);
    }
    if (along <= 1) return;
    /* 3 makes sideways drift cost three times as much as forward distance. */
    const score = along + across * 3;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/* What counts as a place the pad cursor can land. [role="slider"] is here
   because custom sliders are divs, not inputs. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"], [role="slider"]';

/* The controls inside `root` a player can land on, in page order. Skips
   anything with no layout box (display: none) and anything inside an
   aria-hidden or inert subtree. */
export function focusables(root) {
  if (!root) return [];
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.getClientRects().length && !el.closest('[aria-hidden="true"], [inert]'),
  );
}

/* Move focus one step `dir` inside `root`. Returns whether it moved. Also
   scrolls the new control into view, as a long list would otherwise leave
   it off screen. If nothing in `root` is focused, the first control wins. */
export function moveFocus(root, dir) {
  const items = focusables(root);
  if (!items.length) return false;
  const from = items.indexOf(document.activeElement);
  const next = nextInDirection(
    items.map((el) => el.getBoundingClientRect()),
    from,
    dir,
  );
  if (next < 0) return false;
  items[next].focus();
  items[next].scrollIntoView?.({ block: "nearest", inline: "nearest" });
  return true;
}

/* Focus the first control in `root` unless something in it has focus. A
   control marked autofocus or data-autofocus is preferred, so a window can
   choose its own starting point. */
export function ensureFocus(root) {
  if (!root || root.contains(document.activeElement)) return;
  const preferred = root.querySelector("[autofocus], [data-autofocus]");
  (preferred || focusables(root)[0])?.focus();
}

/* Step the tabs inside `root` one way (`way` is -1 or 1, wrapping round),
   by clicking the next one along so the owner's own onClick does the work
   of switching panels. Returns whether there was a tab list to step. */
export function stepTabs(root, way) {
  const list = root?.querySelector('[role="tablist"]');
  if (!list) return false;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  if (!tabs.length) return false;
  const at = Math.max(0, tabs.findIndex((t) => t.getAttribute("aria-selected") === "true"));
  const next = tabs[(at + way + tabs.length) % tabs.length];
  next.click();
  next.focus();
  return true;
}

/* A tab list's keydown: left and right step through the tabs. Attach to
   the element with role="tablist"; the tabs are looked up from its parent
   element (stepTabs finds the tablist inside it). */
export function tabListKeys(event) {
  const way = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
  if (!way) return;
  event.preventDefault();
  stepTabs(event.currentTarget.parentElement, way);
}
