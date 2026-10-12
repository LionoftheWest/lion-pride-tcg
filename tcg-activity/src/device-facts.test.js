// The device facts of a player report: the right words for each real client, and never the raw agent.
// node --test src/device-facts.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceFacts, deviceFactsOf } from './device-facts.js';

const UA = {
  iphoneDiscord: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ipadDesktopSite: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidPhone: 'Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP3A.241005.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710 Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Safari/537.36',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  macDiscord: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) discord/0.0.325 Chrome/128.0.6613.186 Electron/32.2.2 Safari/537.36',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
};

test('iPhone, Discord app: Mobile app, Phone, iOS 18, WebKit, compact portrait, 3x', () => {
  assert.deepEqual(deviceFacts({ userAgent: UA.iphoneDiscord, maxTouchPoints: 5, innerWidth: 430, innerHeight: 822, devicePixelRatio: 3, sdkPlatform: 'mobile', layout: 'compact-port' }),
    { app: 'Mobile app', device: 'Phone', os: 'iOS 18', engine: 'WebKit', layout: 'compact portrait', dpr: '3x' });
});

test('iPad, Discord app: Tablet, iPadOS 17, WebKit, the medium class', () => {
  assert.deepEqual(deviceFacts({ userAgent: UA.ipad, maxTouchPoints: 5, innerWidth: 820, innerHeight: 1180, devicePixelRatio: 2, sdkPlatform: 'mobile', layout: { size: 'medium' } }),
    { app: 'Mobile app', device: 'Tablet', os: 'iPadOS 17', engine: 'WebKit', layout: 'medium', dpr: '2x' });
});

test('an iPad that sends the Mac agent is still a Tablet with iPadOS (touch points)', () => {
  const f = deviceFacts({ userAgent: UA.ipadDesktopSite, maxTouchPoints: 5, sdkPlatform: 'mobile' });
  assert.equal(f.device, 'Tablet');
  assert.equal(f.os, 'iPadOS 17');
  assert.equal(deviceFacts({ userAgent: UA.ipadDesktopSite, maxTouchPoints: 0 }).device, 'Desktop', 'a real Mac has no touch points');
});

test('Android phone, Discord app: Phone, Android 15, Chromium, compact landscape low (body.dataset), 2.6x', () => {
  assert.deepEqual(deviceFacts({ userAgent: UA.androidPhone, maxTouchPoints: 5, innerWidth: 915, innerHeight: 380, devicePixelRatio: 2.625, sdkPlatform: 'mobile', layout: { size: 'compact-land', low: '' } }),
    { app: 'Mobile app', device: 'Phone', os: 'Android 15', engine: 'Chromium', layout: 'compact landscape low', dpr: '2.6x' });
});

test('Android tablet (no "Mobile" in the agent): Tablet, Android 14', () => {
  const f = deviceFacts({ userAgent: UA.androidTablet, maxTouchPoints: 10, innerWidth: 692, innerHeight: 917, devicePixelRatio: 2, sdkPlatform: 'mobile' });
  assert.equal(f.device, 'Tablet');
  assert.equal(f.os, 'Android 14');
  assert.equal(f.engine, 'Chromium');
  assert.equal(f.layout, 'compact portrait', 'no class given: the class of the window size (size-class.js; D-181: a portrait tablet uses the phone portrait layout)');
});

test('Windows Chrome (discord.com in a browser): Browser, Desktop, Windows, Chromium, expanded short', () => {
  assert.deepEqual(deviceFacts({ userAgent: UA.windowsChrome, maxTouchPoints: 0, innerWidth: 1280, innerHeight: 600, devicePixelRatio: 1.25, sdkPlatform: 'desktop' }),
    { app: 'Browser', device: 'Desktop', os: 'Windows 10 or 11', engine: 'Chromium', layout: 'expanded short', dpr: '1.3x' });
  assert.equal(deviceFacts({ userAgent: UA.windowsChrome, platformVersion: '15.0.0' }).os, 'Windows 11', 'the client hint 13+ is Windows 11');
  assert.equal(deviceFacts({ userAgent: UA.windowsChrome, platformVersion: '10.0.0' }).os, 'Windows 10');
});

test('macOS Discord desktop app: Desktop app, Desktop, macOS, Chromium (Electron)', () => {
  assert.deepEqual(deviceFacts({ userAgent: UA.macDiscord, maxTouchPoints: 0, innerWidth: 1990, innerHeight: 830, devicePixelRatio: 2, sdkPlatform: 'desktop', layout: 'expanded' }),
    { app: 'Desktop app', device: 'Desktop', os: 'macOS', engine: 'Chromium', layout: 'expanded', dpr: '2x' });
  assert.equal(deviceFacts({ userAgent: UA.macDiscord, platformVersion: '15.1.0' }).os, 'macOS 15');
});

test('Firefox is Gecko', () => {
  assert.equal(deviceFacts({ userAgent: UA.windowsFirefox }).engine, 'Gecko');
});

test('the raw agent never comes out: every fact is one of the short words', () => {
  for (const ua of Object.values(UA)) {
    const f = deviceFacts({ userAgent: ua, maxTouchPoints: 5, innerWidth: 800, innerHeight: 600, devicePixelRatio: 2, sdkPlatform: 'mobile' });
    const all = Object.values(f).join(' ');
    assert.doesNotMatch(all, /Mozilla|AppleWebKit|Build\/|KHTML|Version\//);
    for (const v of Object.values(f)) assert.ok(v.length <= 24, v);
  }
});

test('nothing known: an empty object (no guess), and an unknown class falls back to the window size', () => {
  assert.deepEqual(deviceFacts({}), { app: 'Browser' });
  assert.equal(deviceFacts({ layout: 'bogus', innerWidth: 375, innerHeight: 667 }).layout, 'compact portrait');
});

test('deviceFactsOf reads navigator, the window and body.dataset', () => {
  const win = { navigator: { userAgent: UA.iphoneDiscord, maxTouchPoints: 5 }, innerWidth: 430, innerHeight: 822, devicePixelRatio: 3, document: { body: { dataset: { size: 'compact-port' } } } };
  assert.deepEqual(deviceFactsOf(win, 'mobile'), { app: 'Mobile app', device: 'Phone', os: 'iOS 18', engine: 'WebKit', layout: 'compact portrait', dpr: '3x' });
});

// The app value (PR #385 found it): the SDK platform decides first; the agent is the fallback, and a mobile signal
// wins over "Discord/" (the iOS and Android Discord apps put "Discord/<version>" in their agent too).
const DUA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Discord/250.0 (iPhone; iOS 18.0; Scale/3.00)',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP3A.241005.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Discord/250.0',
  ipadMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Discord/250.0',
};

test('iPhone Discord app agent with "Discord/": Mobile app with the SDK value, and also without it', () => {
  const withSdk = deviceFacts({ userAgent: DUA.iphone, maxTouchPoints: 5, sdkPlatform: 'mobile' });
  const noSdk = deviceFacts({ userAgent: DUA.iphone, maxTouchPoints: 5 });
  for (const f of [withSdk, noSdk]) {
    assert.equal(f.app, 'Mobile app');
    assert.equal(f.device, 'Phone');
    assert.equal(f.os, 'iOS 18');
    assert.equal(f.engine, 'WebKit');
  }
});

test('Android Discord app agent with "Discord/": Mobile app with and without the SDK value', () => {
  assert.equal(deviceFacts({ userAgent: DUA.android, maxTouchPoints: 5, sdkPlatform: 'mobile' }).app, 'Mobile app');
  assert.equal(deviceFacts({ userAgent: DUA.android, maxTouchPoints: 5 }).app, 'Mobile app');
  assert.equal(deviceFacts({ userAgent: DUA.android }).device, 'Phone');
  const tablet = UA.androidTablet + ' Discord/250.0';   // an Android tablet agent has no "Mobile": Android alone is the signal
  assert.equal(deviceFacts({ userAgent: tablet, maxTouchPoints: 10 }).app, 'Mobile app');
  assert.equal(deviceFacts({ userAgent: tablet, maxTouchPoints: 10 }).device, 'Tablet');
});

test('an iPad with the Mac agent and "Discord/" (touch points): Mobile app without the SDK value; a real Mac stays Desktop app', () => {
  assert.equal(deviceFacts({ userAgent: DUA.ipadMac, maxTouchPoints: 5 }).app, 'Mobile app');
  assert.equal(deviceFacts({ userAgent: UA.macDiscord, maxTouchPoints: 0 }).app, 'Desktop app');
});

test('macOS Discord desktop agent: Desktop app with the SDK value desktop and without it; the SDK value mobile wins', () => {
  assert.equal(deviceFacts({ userAgent: UA.macDiscord, sdkPlatform: 'desktop' }).app, 'Desktop app');
  assert.equal(deviceFacts({ userAgent: UA.macDiscord }).app, 'Desktop app');
  assert.equal(deviceFacts({ userAgent: UA.windowsChrome, sdkPlatform: 'desktop' }).app, 'Browser', 'desktop + a plain browser agent = discord.com in a browser');
  assert.equal(deviceFacts({ userAgent: UA.macDiscord, sdkPlatform: 'mobile' }).app, 'Mobile app', 'the SDK value decides first');
  assert.equal(deviceFacts({ userAgent: DUA.iphone, maxTouchPoints: 5, sdkPlatform: 'desktop' }).app, 'Browser', 'the SDK value desktop is never the Mobile app');
});
