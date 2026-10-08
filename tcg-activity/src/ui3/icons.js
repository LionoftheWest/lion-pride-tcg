// The one icon set (docs/design.md 5.2 Icon, G-053, D-47): Lucide line icons (ISC license), stroke 2, sizes 16, 20
// and 24 (or the component's own icon token). One icon has one meaning in the whole app (3.1). The element icons are
// in element-icons.js (13; the 14th, physical, is 'hand-fist' here). Only the icons named here are bundled.
import {
  X, ChevronLeft, ChevronRight, ChevronDown, Search, Star, RotateCcw, ArrowLeftRight, LoaderCircle, Check, Lock, Plus,
  Minus, Info, CircleCheck, CircleAlert, TriangleAlert, Timer, SlidersHorizontal, Landmark, PartyPopper, Layers, Award,
  Trophy, Skull, Swords, Castle, Crown, House, Store, Bell, Menu, Gift, Users, Settings, Package, Undo2, Pencil, Trash2,
  Hexagon, Zap, HandFist, CalendarCheck, CircleHelp, Wrench, ScrollText, ListFilter, Circle, Ban, ArrowRight,
  Flame, MessageCircle, Headphones, ShieldCheck, TrendingUp, Heart,
} from 'lucide';

// name -> Lucide node. The names are the Lucide names (kebab-case), as design.md writes them.
export const ICONS = {
  'x': X, 'chevron-left': ChevronLeft, 'chevron-right': ChevronRight, 'chevron-down': ChevronDown, 'search': Search,
  'star': Star, 'rotate-ccw': RotateCcw, 'arrow-left-right': ArrowLeftRight, 'loader-circle': LoaderCircle,
  'check': Check, 'lock': Lock, 'plus': Plus, 'minus': Minus, 'info': Info, 'circle-check': CircleCheck,
  'circle-alert': CircleAlert, 'triangle-alert': TriangleAlert, 'timer': Timer, 'sliders-horizontal': SlidersHorizontal,
  // the tab icons (3.1, D-47): Trade Hall, Boons, Cards, Achievements, Leaderboard, Bosses, Hunt, Dungeon, Gauntlet
  'landmark': Landmark, 'party-popper': PartyPopper, 'layers': Layers, 'award': Award, 'trophy': Trophy, 'skull': Skull,
  'swords': Swords, 'castle': Castle, 'crown': Crown,
  // the shell
  'house': House, 'store': Store, 'bell': Bell, 'menu': Menu, 'gift': Gift, 'users': Users, 'settings': Settings,
  'package': Package, 'undo-2': Undo2, 'pencil': Pencil, 'trash-2': Trash2, 'hexagon': Hexagon, 'zap': Zap,
  // the 14th element: element-icons.js has no physical icon (13 icons)
  'hand-fist': HandFist,
  // the menu grid (UI-60)
  'calendar-check': CalendarCheck, 'circle-help': CircleHelp, 'wrench': Wrench, 'scroll-text': ScrollText,
  // the Card picker and the squad views (UI-64, UI-46): Filters, an open check, a card not allowed today, a link onward
  'list-filter': ListFilter, 'circle': Circle, 'ban': Ban, 'arrow-right': ArrowRight,
  // the Dailies window (UI-36): the streak mark (replaces the emoji, G-053), the Chat and Voice task icons
  'flame': Flame, 'message-circle': MessageCircle, 'headphones': Headphones,
  // the Dungeon reward choice (UI-48): a Ward, the damage bonus, a heal
  'shield-check': ShieldCheck, 'trending-up': TrendingUp, 'heart': Heart,
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * One icon as an inline SVG string. size = an icon size token name ('md' = --icon-md) or a number of CSS px is not
 * allowed (sizes come from tokens). label = the accessible name; without it the icon is decorative (aria-hidden).
 */
export function icon(name, { size = 'md', label = null, cls = '' } = {}) {
  const node = ICONS[name];
  if (!node) throw new Error(`unknown icon "${name}" (add it to src/ui3/icons.js)`);
  const kids = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`).join('');
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true" focusable="false"';
  return `<svg class="u3-ico u3-ico--${size}${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${kids}</svg>`;
}
