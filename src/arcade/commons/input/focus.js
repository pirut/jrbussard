/*
 * Moving through a menu with a d-pad or arrow keys: from the focused
 * control, the nearest one that lies the way you pushed.
 *
 * `nextInDirection` works on plain rectangles so it can be tested and reused
 * anywhere; `moveFocus` applies it to the controls inside a DOM element.
 */

const center = (r) => [r.left + r.width / 2, r.top + r.height / 2];

/*
 * Index of the rect to go to from `from` when pushing `dir`, or -1 when
 * nothing lies that way. Something straight along the push beats something
 * nearer but off to the side.
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
      /* Rows overlapping sideways count as straight along. */
      const overlap = Math.min(a.left + a.width, r.left + r.width) - Math.max(a.left, r.left);
      across = overlap > 0 ? 0 : Math.abs(dx);
    } else {
      along = dir === "left" ? -dx : dx;
      const overlap = Math.min(a.top + a.height, r.top + r.height) - Math.max(a.top, r.top);
      across = overlap > 0 ? 0 : Math.abs(dy);
    }
    if (along <= 1) return;
    const score = along + across * 3;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"], [role="slider"]';

/* The controls inside `root` a player can land on, in page order. */
export function focusables(root) {
  if (!root) return [];
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.getClientRects().length && !el.closest('[aria-hidden="true"], [inert]'),
  );
}

/* Move focus one step `dir` inside `root`. Returns whether it moved. */
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

/* Focus the first control in `root` unless something in it has focus. */
export function ensureFocus(root) {
  if (!root || root.contains(document.activeElement)) return;
  const preferred = root.querySelector("[autofocus], [data-autofocus]");
  (preferred || focusables(root)[0])?.focus();
}

/* Step the tabs inside `root` one way, by clicking the next one along. */
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

/* A tab list's keydown: left and right step through the tabs. */
export function tabListKeys(event) {
  const way = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
  if (!way) return;
  event.preventDefault();
  stepTabs(event.currentTarget.parentElement, way);
}
