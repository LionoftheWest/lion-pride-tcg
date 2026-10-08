"""Headless check of the Admin view Test lab (Python Playwright, Chromium). LOCAL copy only.

  python scripts/check-admin-lab-ui.py --base http://127.0.0.1:4395 --user U --pass P --out <folder outside the repo>

Run it against a studio on the LOCAL copy (LOCALDB=1 with scripts/localdb-preload.mjs, ADMIN_VIEW=1, ADMIN_EDIT=1,
ADMIN_LAB=1); it stops when /api/admin/source is not LOCAL. At 1440x900 and 390x844 it logs in and walks the page:
  the nav (See / Manage, the Test lab open, no "Phase") -> a scenario: boss_hp Normal = 35000, the Hunt simulation (small)
  -> Apply live disabled before a run -> Run (progress) -> the result: the boss HP baseline vs scenario, a chart, the table
  -> Apply live enabled; a changed value disables it, the same value enables it again -> Apply live opens the plan (the live
  value now, the after value; nothing is applied) -> Save, the saved scenario, Delete. Desktop also: a long run + Cancel.
Each state fails on a console or page error, a failed /api/admin request, an error panel, cut or off-screen text, a
horizontal scroll on the phone. A full-page screenshot of each state goes to --out (they can show member data: card
names hold member names; keep them out of the repo).
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
    sys.exit('check-admin-lab-ui: the studio is not on the LOCAL copy (LOCALDB=1): refused')
hp = next(r for r in api('/lab/balance')['rows'] if r['key'] == 'boss_hp')['value']['Normal']
NEW_HP = 35000 if hp != 35000 else 36000

CUT_JS = r"""() => {
  const out = [];
  for (const el of document.querySelectorAll('main *, header *, nav *, .modal *')) {
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
    if (el.offsetParent && r.right > document.documentElement.clientWidth + 1) out.push('control off-screen: ' + (el.name || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30)));
  }
  for (const t of document.querySelectorAll('main svg text')) {
    const r = t.getBoundingClientRect(), s = t.ownerSVGElement.getBoundingClientRect();
    if (r.width && (r.right > s.right + 1 || r.left < s.left - 1)) out.push('chart text outside: ' + t.textContent.slice(0, 30));
  }
  return [...new Set(out)].slice(0, 20);
}"""

fails = 0
def fail(msg):
    global fails
    fails += 1
    print('FAIL ' + msg)

with sync_playwright() as p:
    br = p.chromium.launch()
    for vname, w, hgt in [('desktop', 1440, 900), ('phone', 390, 844)]:
        ctx = br.new_context(viewport={'width': w, 'height': hgt}, device_scale_factor=1, is_mobile=(vname == 'phone'), has_touch=(vname == 'phone'))
        pg = ctx.new_page()
        errors = []
        pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' and 'status of 409' not in m.text else None)
        pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        pg.on('response', lambda r: errors.append(f'http {r.status}: {r.url}') if '/api/admin' in r.url and r.status >= 400 and r.status != 409 else None)
        pg.goto(a.base + '/admin/')
        pg.wait_for_url('**/login**')
        pg.fill('#u', a.user); pg.fill('#p', a.pw); pg.click('button[type=submit]')
        pg.wait_for_url('**/admin/**')
        n = [0]

        def settle(spin=True):
            pg.wait_for_load_state('networkidle')
            if spin:
                try:
                    pg.wait_for_function("() => !document.querySelector('main .state .spin')", timeout=30000)
                except Exception:
                    errors.append('still loading after 30 s')
            pg.wait_for_timeout(300)

        def check(name, expect=None):
            global fails
            settle(spin=False)
            problems = list(errors)
            problems += ['error state: ' + t for t in pg.locator('main .state.error, .modal .state.error').all_inner_texts()]
            problems += pg.evaluate(CUT_JS)
            txt = pg.locator('main').inner_text() + ' ' + ' '.join(pg.locator('.modal').all_inner_texts())
            for bad in ('[object ', 'undefined', 'NaN', 'Invalid Date', 'null'):
                if bad in txt: problems.append(f'bad text in the page: {bad}')
            for e in ([expect] if isinstance(expect, str) else (expect or [])):
                if e not in txt: problems.append(f'expected text missing: {e}')
            if vname == 'phone':
                sw = pg.evaluate('document.scrollingElement.scrollWidth'); iw = pg.evaluate('window.innerWidth')
                if sw > iw: problems.append(f'horizontal scroll: {sw} > {iw}')
            n[0] += 1
            tag = pg.add_style_tag(content='body{position:relative} .tabbar{position:absolute!important} .side{position:absolute!important;top:var(--top-h)!important;bottom:auto!important;height:calc(100% - var(--top-h))}')
            pg.screenshot(path=os.path.join(a.out, f'{n[0]:02d} Test lab - {name} - {vname}.png'), full_page=True)
            tag.evaluate('t => t.remove()')
            if problems: fails += 1
            print(f"{'PASS' if not problems else 'FAIL'} {vname} {name}" + ('' if not problems else '\n    ' + '\n    '.join(problems[:12])))
            errors.clear()

        # The nav: plain section names, the Test lab open.
        pg.goto(a.base + '/admin/#/lab'); settle()
        heads = pg.evaluate("() => [...document.querySelectorAll('#side .nav-head')].map(x => x.textContent)")
        if 'See' not in heads or 'Manage' not in heads or any('Phase' in x for x in heads): fail(f'{vname} nav headings {heads}')
        side = pg.evaluate("() => document.querySelector('#side').textContent")
        if 'Phase' in side: fail(f'{vname} the nav still says Phase')
        if pg.locator('#side a.nav-item:has-text("Test lab")').count() != 1: fail(f'{vname} the Test lab nav item is not open')
        check('page')

        # A scenario: boss_hp Normal -> NEW_HP, the Hunt simulation (small and fast).
        ch = pg.locator('.lab-change').first
        ch.locator('select').nth(0).select_option('boss_hp')
        ch = pg.locator('.lab-change').first
        opts = ch.locator('select').nth(1).locator('option').all_inner_texts()
        ch.locator('select').nth(1).select_option(index=opts.index('Normal'))
        ch = pg.locator('.lab-change').first
        ch.locator('input').fill(str(NEW_HP))
        for extra in range(pg.locator('.lab-change').count() - 1):
            pg.locator('.lab-change').nth(1).locator('button[aria-label^="Remove"]').click()
        pg.select_option('select[aria-label="Simulation"]', 'hunt')
        pg.fill('input[aria-label="Bosses"]', '1'); pg.fill('input[aria-label="Members per group"]', '1')
        if pg.locator('button:has-text("Apply live")').is_enabled() and pg.locator('main').inner_text().find('No run yet') >= 0:
            fail(f'{vname} Apply live is enabled before a run')
        check('scenario')

        pg.click('button:has-text("Run")')
        pg.wait_for_timeout(150)
        if vname == 'desktop':
            check('running')
        try:
            pg.wait_for_function("() => /finished|Cancelled|failed/i.test(document.querySelector('.lab-job')?.textContent || '')", timeout=180000)
        except Exception:
            fail(f'{vname} the run did not finish in 180 s')
        settle()
        txt = pg.locator('.lab-job').inner_text()
        if 'Baseline and scenario finished' not in txt: fail(f'{vname} no finished run: {txt[:200]}')
        if f'{NEW_HP:,}' not in txt or f'{hp:,}' not in txt: fail(f'{vname} the boss HP baseline {hp} / scenario {NEW_HP} is not shown')
        if pg.locator('.lab-chart svg').count() < 1: fail(f'{vname} no chart')
        if not pg.locator('button:has-text("Apply live")').is_enabled(): fail(f'{vname} Apply live is not enabled after the finished run')
        check('result', ['Normal boss HP', 'Damage per member-day'])

        # A changed value disables Apply; the same value enables it again.
        inp = pg.locator('.lab-change').first.locator('input')
        inp.fill(str(NEW_HP + 1))
        if pg.locator('button:has-text("Apply live")').is_enabled(): fail(f'{vname} Apply live stays enabled after a change')
        check('changed after the run', 'The changes differ from the run')
        inp.fill(str(NEW_HP))
        if not pg.locator('button:has-text("Apply live")').is_enabled(): fail(f'{vname} Apply live is not enabled again')

        # Apply live: the plan (nothing applied here).
        pg.click('button:has-text("Apply live")')
        pg.wait_for_selector('.modal')
        try:
            pg.wait_for_function("() => !document.querySelector('.modal .state .spin')", timeout=30000)
        except Exception:
            errors.append('the plan did not load')
        check('apply plan', ['Balance boss_hp', 'Normal'])
        pg.click('.modal button[aria-label="Close"]')

        # Save, the saved list, Delete.
        name = f'PW check {vname} {time.strftime("%H%M%S")}'
        pg.fill('input[aria-label="Scenario name"]', name)
        pg.click('button:has-text("Save")'); settle()
        if name not in pg.locator('select[aria-label="Saved scenarios"]').inner_text(): fail(f'{vname} the saved scenario is not in the list')
        check('saved', 'Saved')
        pg.click('button:has-text("Delete")'); settle()
        if name in pg.locator('select[aria-label="Saved scenarios"]').inner_text(): fail(f'{vname} the deleted scenario is still in the list')

        # A long run and Cancel (desktop).
        if vname == 'desktop':
            pg.select_option('select[aria-label="Simulation"]', 'boss_moves')
            pg.fill('input[aria-label="Days"]', '20')
            pg.click('button:has-text("Run")')
            pg.wait_for_selector('.lab-progress button:has-text("Cancel")', timeout=10000)
            check('long run', 'Running')
            pg.click('.lab-progress button:has-text("Cancel")')
            try:
                pg.wait_for_function("() => /Cancelled/.test(document.querySelector('.lab-job')?.textContent || '')", timeout=60000)
            except Exception:
                fail('desktop Cancel did not stop the run in 60 s')
            if pg.locator('button:has-text("Apply live")').is_enabled(): fail('desktop Apply live is enabled after a cancelled run')
            errors[:] = [e for e in errors if 'error state' not in e]
            settle(spin=False)
            # the cancelled state shows an error panel by design: check it without the error-panel rule
            if 'Cancelled' not in pg.locator('.lab-job').inner_text(): fail('desktop no Cancelled text')
            pg.screenshot(path=os.path.join(a.out, f'{n[0] + 1:02d} Test lab - cancelled - {vname}.png'), full_page=True); n[0] += 1
            # back to the small scenario for the phone pass
            pg.select_option('select[aria-label="Simulation"]', 'hunt')
        ctx.close()
    br.close()
print('PASS all Test lab states' if not fails else f'FAIL {fails}')
sys.exit(1 if fails else 0)
