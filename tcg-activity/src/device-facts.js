// The device facts of a player report (Nathan, 2026-10-11; docs/player-reports.md): six short words that tell which
// app, device, system, engine, layout and pixel ratio the member used. The raw user agent never leaves this module:
// the report and the GitHub Issue get only these words (reports.js cleanContext allows exactly these keys).
// Pure: every input is a parameter, so it is unit-tested (device-facts.test.js). UI-40 adds the call to the report.
//
// The layout uses the size class of the UI standard (docs/design.md 2.1, ui3/size-class.js). The class comes from the
// shell (body[data-size], data-short, data-low). Without it, this module asks size-class.js for the class of the window.
import { sizeClass, isShort, isLow } from './ui3/size-class.js';

const LAYOUT_WORDS = { tiny: 'tiny', 'compact-land': 'compact landscape', 'compact-port': 'compact portrait', medium: 'medium', expanded: 'expanded' };

const major = (v) => (v ? String(v).split(/[._]/)[0] : '');

/** The system name and its main version, or '' when the agent does not tell it.
 *  macOS: every browser and Electron freeze the agent at "10_15_7", so only the client hint gives the version.
 *  Windows: "Windows NT 10.0" is Windows 10 and 11; the client hint platformVersion 13 or more is Windows 11. */
function osOf(ua, touch, platformVersion) {
  let m;
  if ((m = ua.match(/\biPad\b.*?\bOS (\d+)[_.]/))) return `iPadOS ${m[1]}`;
  if ((m = ua.match(/\b(?:iPhone|iPod)\b.*?\bOS (\d+)[_.]/))) return `iOS ${m[1]}`;
  if (/Macintosh/.test(ua) && touch > 1) { m = ua.match(/\bVersion\/(\d+)/); return m ? `iPadOS ${m[1]}` : 'iPadOS'; }   // an iPad that asks for the desktop site
  if ((m = ua.match(/\bAndroid (\d+)/))) return `Android ${m[1]}`;
  if (/\bAndroid\b/.test(ua)) return 'Android';
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS';
  if (/Windows NT 10\.0/.test(ua)) {
    const v = Number(major(platformVersion));
    return Number.isFinite(v) && platformVersion ? (v >= 13 ? 'Windows 11' : 'Windows 10') : 'Windows 10 or 11';
  }
  if ((m = ua.match(/Windows NT (\d+\.\d+)/))) return { '6.3': 'Windows 8.1', '6.2': 'Windows 8', '6.1': 'Windows 7' }[m[1]] || 'Windows';
  if (/Mac OS X|Macintosh/.test(ua)) return platformVersion ? `macOS ${major(platformVersion)}` : 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return '';
}

/** Phone, Tablet or Desktop. An Android agent without "Mobile" is a tablet (Google's rule for Android browsers). */
function deviceOf(ua, touch, os, w, h) {
  if (/\b(iPhone|iPod)\b/.test(ua)) return 'Phone';
  if (/\biPad\b/.test(ua) || os.startsWith('iPadOS')) return 'Tablet';
  if (/\bAndroid\b/.test(ua)) return /\bMobile\b/.test(ua) ? 'Phone' : 'Tablet';
  if (/Windows|Macintosh|Mac OS X|CrOS|X11|Linux/.test(ua)) return 'Desktop';
  if (touch > 0 && w > 0 && h > 0) return Math.min(w, h) < 600 ? 'Phone' : 'Tablet';   // the compact-port width rule (design.md 2.1)
  return '';
}

/** WebKit, Chromium or Gecko. Every iOS and iPadOS browser and the iOS Discord app use WebKit. */
function engineOf(ua, os) {
  if (/^iOS|^iPadOS/.test(os)) return 'WebKit';
  if (/\b(Chrome|Chromium|CriOS|Edg|Electron)\//.test(ua)) return 'Chromium';
  if (/\bGecko\/\d/.test(ua) && /\bFirefox\//.test(ua)) return 'Gecko';
  if (/AppleWebKit\//.test(ua)) return 'WebKit';
  return '';
}

/** Desktop app, Mobile app or Browser. The Discord desktop app is Electron with "discord/<version>" in the agent.
 *  The SDK platform says "desktop" for the desktop app AND for discord.com in a browser, so the agent decides there.
 *  The SDK platform "mobile" is the phone or tablet app (Activities do not run in a mobile browser). */
function appOf(ua, sdkPlatform) {
  if (/\bdiscord\/[\d.]+|\bElectron\//i.test(ua)) return 'Desktop app';
  if (sdkPlatform === 'mobile') return 'Mobile app';
  if (!sdkPlatform && (/\bDiscord\b/.test(ua) || /; wv\)/.test(ua))) return 'Mobile app';   // no SDK answer: the app web views
  return 'Browser';
}

/** The layout words: the size class (and its modifier) of the UI standard. layout = a class name ('compact-land'),
 *  or body.dataset ({ size, short, low }); without it the class of the window size (size-class.js). */
function layoutOf(layout, w, h) {
  let cls = '', short = false, low = false;
  if (typeof layout === 'string') cls = layout;
  else if (layout && typeof layout === 'object') { cls = String(layout.size || ''); short = layout.short != null; low = layout.low != null; }
  if (!LAYOUT_WORDS[cls]) {
    if (!(w > 0 && h > 0)) return '';
    cls = sizeClass(w, h); short = isShort(cls, h); low = isLow(cls, h);
  }
  return LAYOUT_WORDS[cls] + (short ? ' short' : '') + (low ? ' low' : '');
}

/** The pixel ratio as a short word: 3 -> "3x", 2.625 -> "2.6x". */
function dprOf(dpr) {
  const n = Number(dpr);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n * 10) / 10}x` : '';
}

/**
 * The device facts: { app, device, os, engine, layout, dpr }. An unknown fact is left out (never the raw agent).
 * o = { userAgent, maxTouchPoints, innerWidth, innerHeight, devicePixelRatio, sdkPlatform ('desktop' | 'mobile', the
 *       Discord SDK), layout (the size class or body.dataset), platformVersion (optional: the client hint) }
 */
export function deviceFacts(o = {}) {
  const ua = String(o.userAgent || '');
  const touch = Number(o.maxTouchPoints) || 0;
  const w = Number(o.innerWidth) || 0, h = Number(o.innerHeight) || 0;
  const sdk = o.sdkPlatform === 'desktop' || o.sdkPlatform === 'mobile' ? o.sdkPlatform : '';
  const os = osOf(ua, touch, o.platformVersion);
  const out = { app: appOf(ua, sdk), device: deviceOf(ua, touch, os, w, h), os, engine: engineOf(ua, os), layout: layoutOf(o.layout, w, h), dpr: dprOf(o.devicePixelRatio) };
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

/** The facts of this window (the client): reads navigator, the window size and body.dataset. */
export function deviceFactsOf(win = globalThis.window, sdkPlatform = '') {
  const nav = win?.navigator || {};
  return deviceFacts({ userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints, innerWidth: win?.innerWidth, innerHeight: win?.innerHeight,
    devicePixelRatio: win?.devicePixelRatio, sdkPlatform, layout: win?.document?.body?.dataset });
}
