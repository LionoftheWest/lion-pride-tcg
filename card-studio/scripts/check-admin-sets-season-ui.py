"""Headless check of the Season field in the Admin Sets section (F-2 fix, set_season_one_set.sql; Python Playwright, Chromium).
It WRITES a test set (id TSR): LOCAL copy only. Remove it afterwards (the caller deletes card_sets TSR on the local copy).

  py -3.14 scripts/check-admin-sets-season-ui.py --base http://127.0.0.1:<port> --user U --pass P --out <folder outside the repo>

Run it against a studio on the LOCAL copy (LOCALDB=1 with scripts/localdb-preload.mjs). It stops when /api/admin/source is not
LOCAL, and the browser refuses every request to a Supabase host. At 1440x900 it walks:
  New set: the Season field shows the next free season -> a used season is refused in the page (no request) ->
  the server refusal (another set took the season while the dialog was open) shows as an error ->
  the set page: a rename with the mouse wheel over the focused Season field keeps the season ->
  a used season is refused in the page (no request) -> a free season asks for a confirmation, then saves.
Each state fails on a console or page error or a blocked Supabase request. A screenshot of each state goes to --out.
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
AUTH = 'Basic ' + base64.b64encode(f'{a.user}:{a.pw}'.encode()).decode()

def call(path, body=None):
    req = urllib.request.Request(a.base + path, headers={'Authorization': AUTH, 'Content-Type': 'application/json'},
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return json.load(e)

if call('/api/admin/source').get('source') != 'LOCAL':
    sys.exit('check-admin-sets-season-ui: the studio is not on the LOCAL copy (LOCALDB=1): refused, this check writes a set')
sets = lambda: {s['id']: s for s in call('/api/sets')['sets']}
if 'TSR' in sets(): sys.exit('check-admin-sets-season-ui: set TSR exists already: remove it first')
used = {s['season'] for s in sets().values()}
free = max(used) + 1

fails = 0
n = [0]
def check(name, ok, extra=''):
    global fails
    if not ok: fails += 1
    print(f"{'PASS' if ok else 'FAIL'} {name}{'' if ok else '  ' + str(extra)}")

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1, extra_http_headers={'Authorization': AUTH})
    errors, blocked, posts = [], [], []
    ctx.route('**/*', lambda r: (blocked.append(r.request.url), r.abort()) if '.supabase.' in r.request.url else r.continue_())
    pg = ctx.new_page()
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('request', lambda r: posts.append(r.url) if r.method == 'POST' and '/api/sets' in r.url else None)
    def shot(name):
        n[0] += 1
        pg.screenshot(path=os.path.join(a.out, f'{n[0]:02d}-{name}.png'))
    def status(sel):
        el = pg.locator(sel)
        return el.inner_text(), 'err' in (el.get_attribute('class') or '').split()

    pg.goto(a.base + '/admin/#/sets')
    pg.wait_for_selector('#st-table')
    pg.click('#st-new')
    pg.wait_for_selector('#st-newdlg:not([hidden])')
    check(f'New set: the Season field shows the next free season ({free})', pg.input_value('#st-n-season') == str(free), pg.input_value('#st-n-season'))
    shot('new-default')

    pg.fill('#st-n-id', 'TSR'); pg.fill('#st-n-code', 'TSR'); pg.fill('#st-n-name', 'Season check')
    pg.fill('#st-n-season', '1')
    posts.clear()
    pg.click('#st-n-save')
    t, bad = status('#st-n-status')
    check('New set with season 1: refused in the page, as an error, no request', bad and 'season 1 is already used by set S1' in t and not posts, (t, bad, posts))
    shot('new-used-season')

    # Another set takes the free season while the dialog is open: the server refuses, the page shows its words as an error.
    other = call('/api/sets', {'set': {'id': 'TSR', 'name': 'Season check other', 'code': 'TSRO', 'pack_color': '#123456', 'season': free, 'pullable': False}, 'before': None, 'reason': 'season check'})
    check('setup: a set TSR in the free season (through the API)', other.get('ok'), other)
    pg.fill('#st-n-id', 'TSQ'); pg.fill('#st-n-code', 'TSQ')
    pg.fill('#st-n-season', str(free))
    posts.clear()
    pg.evaluate("document.getElementById('st-n-status').textContent = ''")
    e0 = len(errors)
    pg.click('#st-n-save')
    pg.wait_for_function("document.getElementById('st-n-status').textContent.startsWith('Error')")
    # Chrome logs the refused request (400) as a console error: expected here, and only here.
    del errors[e0:e0 + len([x for x in errors[e0:] if 'status of 400' in x])]
    t, bad = status('#st-n-status')
    check('The server refusal shows as an error with its words', bad and f'season {free} is already used by set TSR' in t and len(posts) == 1, (t, bad, posts))
    check('the refused set was not made', 'TSQ' not in sets())
    shot('new-server-refusal')

    # The set page: a rename. The mouse wheel over the focused Season field must not change it.
    pg.goto(a.base + '/admin/#/sets/TSR')
    pg.wait_for_selector('#st-season')
    pg.fill('#st-name', 'Season check renamed')
    pg.click('#st-season')
    pg.mouse.wheel(0, 300); pg.mouse.wheel(0, 300)
    check('the mouse wheel does not change the Season field', pg.input_value('#st-season') == str(free), pg.input_value('#st-season'))
    dialogs = []
    pg.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
    pg.click('#st-save')
    pg.wait_for_function("document.getElementById('st-status') && document.getElementById('st-status').textContent === 'Saved.'")
    s = sets()['TSR']
    check('a rename keeps the season, with no confirmation', s['name'] == 'Season check renamed' and s['season'] == free and not dialogs, (s, dialogs))
    shot('rename-saved')

    pg.fill('#st-season', '1')
    posts.clear()
    pg.click('#st-save')
    t, bad = status('#st-status')
    check('edit to season 1: refused in the page, as an error, no request', bad and 'season 1 is already used by set S1' in t and not posts and sets()['TSR']['season'] == free, (t, bad, posts))
    shot('edit-used-season')

    pg.fill('#st-season', str(free + 5))
    pg.click('#st-save')
    pg.wait_for_function("document.getElementById('st-status') && document.getElementById('st-status').textContent === 'Saved.'")
    check('edit to a free season: asks first, then saves', len(dialogs) == 1 and f'from {free} to {free + 5}' in dialogs[0] and sets()['TSR']['season'] == free + 5, dialogs)
    t, bad = status('#st-status')
    check('the success line is not an error', not bad)
    shot('edit-free-season')

    check('no console or page error', not errors, errors)
    check('no request to a Supabase host', not blocked, blocked)
    br.close()

print(f'{fails} FAILED' if fails else 'PASS all')
sys.exit(1 if fails else 0)
