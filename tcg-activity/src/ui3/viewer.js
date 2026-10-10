// UI-09 / UI-10 (v3 only): the card viewer layer. The v2 #viewer keeps its markup and handlers; in v3 its three buttons become the
// library IconButton (5.2: an icon, the 44 px touch size) and the "Spend points" button of the celebration becomes the primary Button.
// The CSS is public/ui3/90-ui-09.css and 90-ui-10.css. Nothing here runs when body.ui-v3 is off.
import { icon } from './icons.js';

const BUTTONS = [['viewer-close', 'x'], ['viewer-prev', 'chevron-left'], ['viewer-next', 'chevron-right']];

/** The icon a viewer button shows (pure). */
export const iconOf = (id) => BUTTONS.find(([k]) => k === id)?.[1] || null;

/** Give the viewer buttons their library look once (idempotent). */
export function styleViewerButtons(root = document.getElementById('viewer')) {
  if (!root) return;
  for (const [id, name] of BUTTONS) {
    const b = root.querySelector(`#${id}`);
    if (!b || b.dataset.u3) continue;
    b.dataset.u3 = '1';
    b.classList.add('u3-ibtn', 'u3-ibtn--md', 'u3-ibtn--panel');
    b.innerHTML = icon(name, { size: 'lg' });
  }
}

/** The "Spend points" button of the celebration: the primary Button, medium. */
export const spendClasses = 'u3-btn u3-btn--primary u3-btn--md asc-spend';

/** The text of a refused ascend (D-80 item 14): "Could not ascend" and the reason when the server named one (10.6). */
export const ascendFailText = (reason) => (reason ? `Could not ascend. ${reason}` : 'Could not ascend');
/** The text of a failed stat point save (D-80 item 13, 10.6 unknown error). */
export const SAVE_FAIL_TEXT = 'Something went wrong. Try again.';
