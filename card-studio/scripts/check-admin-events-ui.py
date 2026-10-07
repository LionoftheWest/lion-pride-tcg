"""Headless check of the Admin view Events page (Python Playwright, Chromium). It WRITES events: LOCAL copy only.

  python scripts/check-admin-events-ui.py --base http://127.0.0.1:4391 --user U --pass P --out <folder outside the repo>

Run it against a studio on the LOCAL copy (LOCALDB=1 with scripts/localdb-preload.mjs, ADMIN_VIEW=1); it stops when
/api/admin/source is not LOCAL. At 1440x900 and 390x844 it logs in and walks the page like Nathan:
  list -> New event (a drop: audience filters, rewards) -> Test (the preview, nothing saved) -> Save -> the event ->
  Preview -> Schedule -> Back to draft -> Edit (the key stays) -> Cancel; a rank event in the editor (tiers, Add tier, Test);
  the launch event (read only: no Edit, no Cancel).
Each state fails on a console or page error, a failed /api/admin request, an error panel, cut or off-screen text, a
horizontal scroll on the phone. A full-page screenshot of each state goes to --out (they show member data: keep them out
of the repo).
"""
import argparse, json, os, sys, time, urllib.request, base64
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', required=True)
ap.add_argument('--user', required=True)
ap.add_argument('--pass', dest='pw', required=True)
ap.add_argument('--out', required=True)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

def api(path):
    req = urllib.request.Request(a.base + '/api/admin' + path, headers={'Authorization': 'Basic ' + base64.b64encode(f'{a.user}:{a.pw}'.encode()).decode()})
    return json.load(urllib.request.urlopen(req))

if api('/source').get('source') != 'LOCAL':
    sys.exit('check-admin-events-ui: the studio is not on the LOCAL copy (LOCALDB=1): refused, this check writes events')
launch = next((r for r in api('/events')['rows'] if r['kind'] == 'launch_cards'), None)

CUT_JS = r"""() => {
  const out = [];
  for (const el of document.querySelectorAll('main *, header *, nav *')) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || !el.offsetParent && st.position !== 'fixed') continue;
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    if (st.textOverflow === 'ellipsis') out.push('ellipsis: ' + el.textContent.trim().slice(0, 40));
    const hides = /(hidden|clip)/.test(st.overflowX) || /(hidden|clip)/.test(st.overflow);
    if (hides && el.scrollWidth > el.clientWidth + 1) out.push('cut: ' + el.tagName + ' ' + el.textContent.trim().slice(0, 40));
    if (el.closest('.chips, .tbl-wrap, .gsearch-results, .tlist')) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > document.documentElement.clientWidth + 1 && st.position !== 'fixed') out.push('off-screen: ' + el.tagName + ' ' + el.textContent.trim().slice(0, 40));
  }
  for (const el of document.querySelectorAll('main input, main select, main textarea, main .btn')) {
    const r = el.getBoundingClientRect();
    if (el.offsetParent && r.right > document.documentElement.clientWidth + 1) out.push('control off-screen: ' + (el.name || el.textContent.trim().slice(0, 30)));
  }
  return [...new Set(out)].slice(0, 20);
}"""

fails = 0
stamp = time.strftime('%H%M%S')
with sync_playwright() as p:
    br = p.chromium.launch()
    for vname, w, hgt in [('desktop', 1440, 900), ('phone', 390, 844)]:
        ctx = br.new_context(viewport={'width': w, 'height': hgt}, device_scale_factor=1, is_mobile=(vname == 'phone'), has_touch=(vname == 'phone'))
        pg = ctx.new_page()
        errors, dialogs = [], []
        pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        pg.on('response', lambda r: errors.append(f'http {r.status}: {r.url}') if '/api/admin' in r.url and r.status >= 400 else None)
        pg.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
        pg.goto(a.base + '/admin/')
        pg.wait_for_url('**/login**')
        pg.fill('#u', a.user); pg.fill('#p', a.pw); pg.click('button[type=submit]')
        pg.wait_for_url('**/admin/**')
        n = [0]

        def settle():
            pg.wait_for_load_state('networkidle')
            try:
                pg.wait_for_function("() => !document.querySelector('main .state .spin')", timeout=30000)
            except Exception:
                errors.append('still loading after 30 s')
            pg.wait_for_timeout(300)

        def check(name, expect=None):
            global fails
            settle()
            problems = list(errors)
            problems += ['error state: ' + t for t in pg.locator('main .state.error').all_inner_texts()]
            problems += ['form error: ' + t for t in pg.locator('main .ev-err').all_inner_texts()]
            problems += pg.evaluate(CUT_JS)
            txt = pg.locator('main').inner_text()
            for bad in ('[object ', 'undefined', 'NaN', 'Invalid Date'):
                if bad in txt: problems.append(f'bad text in the page: {bad}')
            if expect and expect not in txt: problems.append(f'expected text missing: {expect}')
            if vname == 'phone':
                sw = pg.evaluate('document.scrollingElement.scrollWidth'); iw = pg.evaluate('window.innerWidth')
                if sw > iw: problems.append(f'horizontal scroll: {sw} > {iw}')
            n[0] += 1
            tag = pg.add_style_tag(content='body{position:relative} .tabbar{position:absolute!important} .side{position:absolute!important;top:var(--top-h)!important;bottom:auto!important;height:calc(100% - var(--top-h))}')
            pg.screenshot(path=os.path.join(a.out, f'{n[0]:02d} Events - {name} - {vname}.png'), full_page=True)
            tag.evaluate('t => t.remove()')
            if problems: fails += 1
            print(f"{'PASS' if not problems else 'FAIL'} {vname} {name}" + ('' if not problems else '\n    ' + '\n    '.join(problems[:12])))
            errors.clear()

        pg.goto(a.base + '/admin/#/events'); check('list', 'Launch Day event cards')
        if 'locked' in (pg.locator('nav.side').inner_text() if vname == 'desktop' else ''):
            pass
        side = pg.evaluate("() => [...document.querySelectorAll('#side .nav-item.locked')].map(x => x.textContent)")
        if any('Events' in s for s in side): print(f'FAIL {vname} the Events nav item is still locked'); fails += 1

        # A new drop: filters, rewards, Test, Save.
        pg.goto(a.base + '/admin/#/events/new'); settle()
        key = f'pw_drop_{vname}_{stamp}'
        pg.fill('input[name=title]', f'PW Drop {vname}')
        pg.fill('input[name=key]', key)
        pg.select_option('select[name=kind]', 'drop')
        pg.fill('input[name=starts_at]', '2027-01-10T09:00'); pg.fill('input[name=ends_at]', '2027-01-12T09:00')
        pg.select_option('select[name=audience_mode]', 'filter')
        pg.check('input[name=tutorial_done]')
        pg.fill('input[name=active_since]', '2026-10-01T00:00')
        pg.fill('input[name=bell_title]', 'Winter gift')
        pg.fill('input[name=packs]', '2'); pg.fill('input[name=shards]', '25')
        check('new drop (filled)')
        pg.click('button:has-text("Test")'); check('new drop - Test', 'Audience')
        pg.click('button:has-text("Save")'); pg.wait_for_url('**/#/events/*')
        check('saved draft', 'Winter gift')
        pg.click('button:has-text("Preview")'); check('draft - Preview', 'Audience')
        pg.click('button:has-text("Schedule")'); check('scheduled', 'Scheduled')
        pg.click('button:has-text("Back to draft")'); check('back to draft', 'Draft')
        pg.click('a:has-text("Edit")'); settle()
        if not pg.locator('input[name=key]').is_enabled(): print(f'FAIL {vname} the key of a draft is not editable'); fails += 1
        pg.fill('input[name=title]', f'PW Drop {vname} 2')
        pg.click('button:has-text("Save")'); pg.wait_for_url('**/#/events/*')
        check('edited', f'PW Drop {vname} 2')
        pg.click('button:has-text("Cancel event")'); check('cancelled', 'Cancelled')
        if pg.locator('main a:has-text("Edit")').count(): print(f'FAIL {vname} a cancelled event still shows Edit'); fails += 1

        # A rank event in the editor: tiers, Add tier, Test (nothing saved).
        pg.goto(a.base + '/admin/#/events/new'); settle()
        pg.fill('input[name=title]', 'PW Rank'); pg.fill('input[name=key]', f'pw_rank_{vname}_{stamp}')
        pg.select_option('select[name=kind]', 'rank'); pg.select_option('select[name=metric]', 'hunt_damage')
        pg.fill('input[name=starts_at]', '2026-10-01T00:00'); pg.fill('input[name=ends_at]', '2026-10-07T00:00')
        pg.click('button:has-text("Add tier")')
        tiers = pg.locator('.ev-tier')
        tiers.nth(0).locator('input[name=packs]').fill('5')
        tiers.nth(1).locator('input[name=to]').fill('10'); tiers.nth(1).locator('input[name=shards]').fill('100')
        pg.click('button:has-text("Test")'); check('rank - Test', 'Rank')

        # The launch event: read only.
        if launch:
            pg.goto(a.base + f"/admin/#/events/{launch['id']}"); check('launch event', 'Launch cards')
            if pg.locator('main a:has-text("Edit"), main button:has-text("Cancel event"), main button:has-text("End now")').count():
                print(f'FAIL {vname} the launch event shows a write button'); fails += 1
        print(f'  dialogs: {dialogs}')
        ctx.close()
    br.close()
print('PASS all Events states' if not fails else f'FAIL {fails}')
sys.exit(1 if fails else 0)
