"""Headless check of the Admin view pages (Python Playwright, Chromium).

  python scripts/check-admin-ui.py --base http://127.0.0.1:4391 --user U --pass P --out <folder outside the repo>

Run it against a studio on the LOCAL copy (LOCALDB=1 with scripts/localdb-preload.mjs, ADMIN_VIEW=1).
For each page at 1440x900 and 390x844 it logs in through /login, waits until no panel is loading, and fails on:
  - a console error or a page error, a failed /api/admin request;
  - a panel in the error state;
  - text that is cut (an element with text whose content is wider than its box and that hides the overflow, or an ellipsis);
  - a horizontal scroll of the page on the phone.
It saves a full-page screenshot of each page in --out. The screenshots show member data: keep them out of the repo.
"""
import argparse, json, os, sys, urllib.request, base64
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

member = api('/members?limit=1')['rows'][0]['id']
hunts = api('/hunts?limit=1')['rows']
PAGES = [
    ('01', 'Overview', '/overview'), ('02', 'Members', '/members'), ('03', 'Member', f'/member/{member}'), ('04', 'Economy', '/economy'),
    ('05', 'Growth', '/growth'), ('06', 'Cards', '/cards'), ('07', 'Hunt list', '/hunt'),
    ('08', 'Hunt', f'/hunt/{hunts[0]["id"]}' if hunts else '/hunt'), ('09', 'Dungeon', '/dungeon'), ('10', 'Reports', '/reports'),
    ('11', 'Report - top power', '/report/top_power'), ('12', 'Data', '/data'), ('13', 'Data - settings', '/data/settings'), ('14', 'Health', '/health'),
]
# Phase 2 (ADMIN_EDIT=1): the editors and the change dialog.
try:
    EDIT = api('/edit/status').get('edit') is True
except Exception:
    EDIT = False
if EDIT:
    PAGES += [('16', 'Balance', '/balance'), ('17', 'Pull rates', '/balance/pulls'), ('18', 'Settings', '/settings'), ('19', 'Rewards', '/rewards'), ('20', 'Admin log', '/log')]
VIEWS = [('desktop', 1440, 900), ('phone', 390, 844)]

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
    if (el.closest('.chips, .tbl-wrap, .gsearch-results, .tlist')) continue;  // these scroll on purpose
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > document.documentElement.clientWidth + 1 && st.position !== 'fixed') out.push('off-screen: ' + el.tagName + ' ' + el.textContent.trim().slice(0, 40));
  }
  return [...new Set(out)].slice(0, 20);
}"""

fails = 0
with sync_playwright() as p:
    br = p.chromium.launch()
    for vname, w, hgt in VIEWS:
        ctx = br.new_context(viewport={'width': w, 'height': hgt}, device_scale_factor=1, is_mobile=(vname == 'phone'), has_touch=(vname == 'phone'))
        pg = ctx.new_page()
        errors = []
        pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        pg.on('response', lambda r: errors.append(f'http {r.status}: {r.url}') if '/api/admin' in r.url and r.status >= 400 else None)
        pg.goto(a.base + '/admin/')
        pg.wait_for_url('**/login**')
        pg.fill('#u', a.user); pg.fill('#p', a.pw); pg.click('button[type=submit]')
        pg.wait_for_url('**/admin/**')
        for num, name, route in PAGES:
            errors.clear()
            pg.goto(a.base + '/admin/#' + route)
            pg.wait_for_load_state('networkidle')
            try:
                pg.wait_for_function("() => !document.querySelector('main .state .spin')", timeout=30000)
            except Exception:
                errors.append('still loading after 30 s')
            pg.wait_for_timeout(400)
            problems = list(errors)
            problems += ['error state: ' + t for t in pg.locator('main .state.error').all_inner_texts()]
            problems += pg.evaluate(CUT_JS)
            txt = pg.locator('main').inner_text()
            for bad in ('[object ', 'undefined', 'NaN', 'Invalid Date'):
                if bad in txt: problems.append(f'bad text in the page: {bad}')
            if vname == 'phone':
                sw = pg.evaluate('document.scrollingElement.scrollWidth'); iw = pg.evaluate('window.innerWidth')
                if sw > iw: problems.append(f'horizontal scroll: {sw} > {iw}')
                wide = pg.evaluate("() => [...document.querySelectorAll('main .tbl-wrap')].filter(w => w.offsetParent && w.scrollWidth > w.clientWidth + 1).map(w => w.querySelector('th')?.textContent || '?')")
                problems += [f'table wider than the phone (first column {x})' for x in wide]
            # For the full-page picture only: the fixed bars go to the page edges (else they float over the middle).
            tag = pg.add_style_tag(content='body{position:relative} .tabbar{position:absolute!important} .side{position:absolute!important;top:var(--top-h)!important;bottom:auto!important;height:calc(100% - var(--top-h))}')
            pg.screenshot(path=os.path.join(a.out, f'{num} {name} - {vname}.png'), full_page=True)
            tag.evaluate('t => t.remove()')
            status = 'PASS' if not problems else 'FAIL'
            if problems: fails += 1
            print(f'{status} {vname} {name}' + ('' if not problems else '\n    ' + '\n    '.join(problems[:12])))
        if EDIT:
            # The change dialog: Rewards > Hunt prizes, change the first rank, Review, Test on the local copy (rolled back).
            errors.clear()
            pg.goto(a.base + '/admin/#/rewards'); pg.wait_for_load_state('networkidle')
            pg.wait_for_function("() => !document.querySelector('main .state .spin')", timeout=30000)
            first = pg.locator('main details.keypanel[open] input.field.num').first
            first.fill(str(int(first.input_value()) + 1))
            pg.locator('main details.keypanel[open] button.btn.primary').first.click()
            pg.wait_for_selector('.modal .diff-row', timeout=15000)
            pg.fill('.modal textarea.reason', 'ui check (rolled back)')
            pg.click('.modal button:has-text("Test on local copy")')
            pg.wait_for_selector('.modal .test-head', timeout=60000)
            problems = list(errors) + ['error state: ' + t for t in pg.locator('.modal .state.error').all_inner_texts()]
            if not pg.locator('.modal .status.pass:has-text("Test passed")').count(): problems.append('the test did not pass')
            if pg.locator('.modal button:has-text("Apply live")').is_disabled(): problems.append('Apply stays disabled after a passed test')
            if vname == 'phone':
                sw = pg.evaluate('document.scrollingElement.scrollWidth'); iw = pg.evaluate('window.innerWidth')
                if sw > iw: problems.append(f'horizontal scroll: {sw} > {iw}')
            pg.screenshot(path=os.path.join(a.out, f'21 Change dialog - {vname}.png'))
            if problems: fails += 1
            print(('PASS' if not problems else 'FAIL') + f' {vname} Change dialog' + ('' if not problems else '\n    ' + '\n    '.join(problems[:12])))
            pg.keyboard.press('Escape')
            # The member actions: open Grant packs on the member page.
            pg.goto(a.base + '/admin/#/member/' + member); pg.wait_for_load_state('networkidle')
            pg.wait_for_function("() => !document.querySelector('main .state .spin')", timeout=30000)
            pg.click('main button.action-btn.on:has-text("Grant packs")')
            pg.wait_for_selector('main .act-row', timeout=5000)
            pg.locator('main .act-row').scroll_into_view_if_needed()
            pg.screenshot(path=os.path.join(a.out, f'22 Member actions - {vname}.png'))
        if vname == 'phone':
            pg.goto(a.base + '/admin/#/overview'); pg.wait_for_load_state('networkidle')
            pg.click('.tabbar button.tab')
            pg.screenshot(path=os.path.join(a.out, '15 More sheet - phone.png'))
        ctx.close()
    br.close()
print('PASS all pages' if not fails else f'FAIL {fails} page views')
sys.exit(1 if fails else 0)
