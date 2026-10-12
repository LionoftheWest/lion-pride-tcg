"""Headless check of the Admin event calendar (F-1 PR 5; Python Playwright, Chromium). It WRITES events: LOCAL copy only.

  py -3.14 scripts/check-admin-calendar-ui.py --base http://127.0.0.1:<port> --user U --pass P --out <folder outside the repo>

Run it against a studio on the LOCAL copy (LOCALDB=1 with scripts/localdb-preload.mjs, ADMIN_VIEW=1) with the test events of
the calendar seed (keys cal_test_*: a one-time drop, a multi-day trigger, an overlapping rank, a scheduled Dungeon modifier,
a fourth event on the 16th, a LIVE modifier with pull_rare_mult, a modifier with two variables). It stops when
/api/admin/source is not LOCAL, and the browser refuses every request to a Supabase host (the page never talks to the
database itself; the server is on the local copy). At 1440x900 it walks:
  the month (bars across days and weeks, lanes, "+N more", the 4 group colors) -> next / previous / Today ->
  click a bar (the panel) and edit the title -> the variable limits in the form (no request leaves for a bad value) and
  add a variable -> drag a bar (move) -> drag an edge (length) -> a live event (no move, no start edge; a later end; its
  variables change, its start and kind are locked) -> save as template -> click an empty day, create from the template ->
  a blank modifier -> the library and "create from template" -> the Repeat control (off until F-1 PR 2).
At 390x844 (the phone): thin bars, the list of the selected day, the panel.
Each state fails on a console or page error, a failed /api/admin request, a blocked Supabase request, or a horizontal
scroll on the phone. A screenshot of each state goes to --out.
"""
import argparse, json, os, re, sys, urllib.request, base64
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', required=True)
ap.add_argument('--user', required=True)
ap.add_argument('--pass', dest='pw', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--month', default='2026-10')
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
AUTH = 'Basic ' + base64.b64encode(f'{a.user}:{a.pw}'.encode()).decode()

def api(path):
    req = urllib.request.Request(a.base + '/api/admin' + path, headers={'Authorization': AUTH})
    return json.load(urllib.request.urlopen(req))

if api('/source').get('source') != 'LOCAL':
    sys.exit('check-admin-calendar-ui: the studio is not on the LOCAL copy (LOCALDB=1): refused, this check writes events')
M = a.month
def rows():
    d = api(f'/events/calendar?from={M}-01T00:00:00Z&to=2026-12-15T00:00:00Z')
    return {r['key']: r for r in d['rows']}
seed = rows()
need = ['cal_test_once', 'cal_test_week', 'cal_test_rank', 'cal_test_dungeon', 'cal_test_extra', 'cal_test_live', 'cal_test_daily']
missing = [k for k in need if k not in seed]
if missing: sys.exit(f'check-admin-calendar-ui: the seed events are missing: {missing}')
if seed['cal_test_live']['status'] != 'live': sys.exit('check-admin-calendar-ui: cal_test_live is not live')
ID = {k: seed[k]['id'] for k in need}
def ev(key_or_id):
    i = ID.get(key_or_id, key_or_id)
    return api(f'/events/{i}')['event']

TZ_JS = "(iso) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; }"

fails = 0
n = [0]
blocked, posts = [], []
with sync_playwright() as p:
    br = p.chromium.launch()
    for vname, w, hgt in [('desktop', 1440, 900), ('phone', 390, 844)]:
        ctx = br.new_context(viewport={'width': w, 'height': hgt}, device_scale_factor=1, is_mobile=(vname == 'phone'), has_touch=(vname == 'phone'))
        # NEVER live: the browser refuses every Supabase host (the studio server is on the local copy, checked above).
        ctx.route(re.compile(r'https?://([^/]*\.)?supabase\.(co|com|in)(/|$)'), lambda route: (blocked.append(route.request.url), route.abort()))
        pg = ctx.new_page()
        errors, dialogs = [], []
        pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' and 'status of 404' not in m.text else None)  # the edit/status probe; real 404s are caught by the response handler
        pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        pg.on('response', lambda r: errors.append(f'http {r.status}: {r.url}') if '/api/admin' in r.url and '/api/admin/edit/status' not in r.url and r.status >= 400 else None)  # edit/status: 404 with ADMIN_EDIT off (the shell probes it)
        pg.on('request', lambda r: posts.append(r.url) if r.method == 'POST' and '/api/admin/events' in r.url else None)
        pg.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
        pg.goto(a.base + '/admin/')
        pg.wait_for_url('**/login**')
        pg.fill('#u', a.user); pg.fill('#p', a.pw); pg.click('button[type=submit]')
        pg.wait_for_url('**/admin/**')

        def settle():
            pg.wait_for_load_state('networkidle')
            try:
                pg.wait_for_function("() => !document.querySelector('main .state .spin, .cal-ov .state .spin')", timeout=30000)
            except Exception:
                errors.append('still loading after 30 s')
            pg.wait_for_timeout(250)

        def check(name, cond=True, why=''):
            global fails
            settle()
            problems = list(errors)
            problems += ['error state: ' + t for t in pg.locator('main .state.error, .cal-ov .state.error').all_inner_texts()]
            if blocked: problems.append(f'a Supabase request from the browser: {blocked[:2]}')
            txt = pg.locator('body').inner_text()
            for bad in ('[object ', 'undefined', 'NaN', 'Invalid Date'):
                if bad in txt: problems.append(f'bad text in the page: {bad}')
            if vname == 'phone':
                sw = pg.evaluate('document.scrollingElement.scrollWidth'); iw = pg.evaluate('window.innerWidth')
                if sw > iw: problems.append(f'horizontal scroll: {sw} > {iw}')
            if not cond: problems.append('expected: ' + why)
            n[0] += 1
            pg.screenshot(path=os.path.join(a.out, f'{n[0]:02d} Calendar - {name} - {vname}.png'), full_page=False)
            if problems: fails += 1
            print(f"{'PASS' if not problems else 'FAIL'} {vname} {name}" + ('' if not problems else '\n    ' + '\n    '.join(problems[:12])))
            errors.clear()

        def cell(day): return pg.locator(f'.cal-day[data-day="{day}"]')
        def center(loc):
            b = loc.bounding_box(); return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
        def bar(key, nth=0): return pg.locator(f'.cal-bar[data-id="{ID[key]}"]').nth(nth)
        def drag(x1, y1, x2, y2):
            pg.mouse.move(x1, y1); pg.mouse.down(); pg.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, steps=4); pg.mouse.move(x2, y2, steps=6); pg.mouse.up()
        def close_panel():
            if pg.locator('.cal-ov').count(): pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
        def mt(iso): return pg.evaluate(TZ_JS, iso)

        pg.goto(a.base + f'/admin/#/events?m={M}'); settle()
        if vname == 'desktop':
            segs = pg.locator(f'.cal-bar[data-id="{ID["cal_test_week"]}"]').count()
            lanes = pg.evaluate("(ids) => ids.map(id => { const b = document.querySelector(`.cal-bar[data-id='${id}']`); return b && getComputedStyle(b).gridRowStart; })",
                                [ID['cal_test_week'], ID['cal_test_rank'], ID['cal_test_dungeon']])
            colors = pg.evaluate("(ids) => ids.map(id => { const b = document.querySelector(`.cal-bar[data-id='${id}']`); return b && getComputedStyle(b).borderTopColor; })",
                                 [ID['cal_test_live'], ID['cal_test_week'], ID['cal_test_dungeon']])
            more = pg.locator('.cal-more').all_inner_texts()
            check('month (bars, lanes, +N more, colors)', segs == 2 and len(set(lanes)) == 3 and any(re.fullmatch(r'\+\d+ more', t) for t in more) and len(set(colors)) == 3
                  and pg.locator('.cal-month').inner_text() == 'October 2026',
                  f'the week bar in 2 weeks ({segs}), 3 lanes on the 16th ({lanes}), +1 more ({more}), 3 group colors ({colors})')

            # Month navigation
            pg.click('button[aria-label="Next month"]'); settle()
            check('next month', pg.locator('.cal-month').inner_text() == 'November 2026' and 'm=2026-11' in pg.url, 'November 2026')
            pg.click('button[aria-label="Previous month"]'); settle(); pg.click('button[aria-label="Previous month"]'); settle()
            check('previous month', pg.locator('.cal-month').inner_text() == 'September 2026', 'September 2026')
            pg.click('.cal-nav button:has-text("Today")'); settle()
            check('Today', pg.locator('.cal-month').inner_text() == 'October 2026' and pg.locator('.cal-day.today').count() == 1, 'October 2026 with today marked')

            # Click a bar: the panel; edit the title
            bar('cal_test_rank').click(); settle()
            ok = pg.locator('.cal-drawer').count() == 1 and 'CAL Overlap rank' in pg.locator('.cal-drawer').inner_text()
            check('panel of an event', ok and pg.locator('.cal-drawer input[name=title]').is_enabled() and 'Change log' in pg.locator('.cal-drawer').inner_text(), 'the panel with the form and the log')
            pg.fill('.cal-drawer input[name=title]', 'CAL Overlap rank 2')
            pg.click('.cal-drawer button[type=submit]'); settle()
            check('panel - edited title', ev('cal_test_rank')['title'] == 'CAL Overlap rank 2' and 'CAL Overlap rank 2' in pg.locator('.cal-ov-title').inner_text()
                  and pg.locator('.cal-bar', has_text='CAL Overlap rank 2').count() >= 1, 'the title saved, the panel and the bar show it')
            close_panel()

            # The variable limits in the form
            bar('cal_test_daily').click(); settle()
            row = pg.locator('.cal-drawer [data-var=daily_cap]')
            facts = row.inner_text()
            row.locator('input').fill('25')
            err = row.locator('.ev-var-err').inner_text()
            before = len(posts)
            pg.click('.cal-drawer button[type=submit]'); pg.wait_for_timeout(400)
            check('vars - outside the limits refused in the form', 'Base' in facts and '1 to 20' in facts and 'from 1 to 20' in err and len(posts) == before
                  and 'daily_cap must be from 1 to 20' in pg.locator('.cal-drawer form .ev-msg').inner_text(), f'base and limits shown ({facts!r}), error ({err!r}), no POST ({len(posts) - before})')
            row.locator('input').fill('10.5')
            err2 = row.locator('.ev-var-err').inner_text()
            row.locator('input').fill('12')
            pg.select_option('.cal-drawer select[name=var_add]', 'pull_rare_mult')
            prow = pg.locator('.cal-drawer [data-var=pull_rare_mult]')
            pfacts = prow.inner_text()
            prow.locator('input').fill('3')
            pg.click('.cal-drawer button[type=submit]'); settle()
            v = ev('cal_test_daily')['vars']
            check('vars - add a variable, save inside the limits', 'whole number' in err2 and 'Base 1' in pfacts and '0.5 to 5' in pfacts and v == {'daily_cap': 12, 'daily_shards': 2, 'pull_rare_mult': 3},
                  f'whole-number error ({err2!r}), pull_rare_mult base 1 and limits ({pfacts!r}), saved vars ({v})')

            # Save as template (from this panel)
            pg.fill('.cal-drawer input[name=template_name]', 'CAL Daily cap template')
            pg.click('.cal-drawer button:has-text("Save as template")'); settle()
            tpls = api('/events/templates')['rows']
            tpl = next((t for t in tpls if t['name'] == 'CAL Daily cap template'), None)
            check('save as template', tpl is not None and tpl['vars'] == v and tpl['source_event_id'] == ID['cal_test_daily'] and 'Saved to the library' in pg.locator('.cal-drawer').inner_text(),
                  f'the template with the same vars ({tpl})')
            close_panel()

            # Drag: move the one-time drop from Oct 21 to Oct 23 (the MT wall time stays 10:00)
            x1, _ = center(cell(f'{M}-21')); _, y1 = center(bar('cal_test_once'))
            x2, _ = center(cell(f'{M}-23'))
            drag(x1, y1, x2, y1); settle()
            e1 = ev('cal_test_once')
            check('drag - move', mt(e1['starts_at']) == f'{M}-23T10:00' and mt(e1['ends_at']) == f'{M}-23T14:00' and pg.locator('.cal-drawer').count() == 0,
                  f'moved to Oct 23 10:00-14:00 MT ({mt(e1["starts_at"])} - {mt(e1["ends_at"])})')

            # Drag the end edge: the community week ends Oct 22 00:00 instead of Oct 20 00:00 (its 2nd segment ends on Oct 19)
            seg2 = bar('cal_test_week', 1)
            b2 = seg2.bounding_box()
            x2, _ = center(cell(f'{M}-21'))
            drag(b2['x'] + b2['width'] - 3, b2['y'] + b2['height'] / 2, x2, b2['y'] + b2['height'] / 2); settle()
            e2 = ev('cal_test_week')
            check('drag - edge (length)', mt(e2['starts_at']) == f'{M}-13T00:00' and mt(e2['ends_at']) == f'{M}-22T00:00', f'the end moved to Oct 22 00:00 MT ({mt(e2["ends_at"])})')

            # A live event: no start edge; a move is refused before the server; a later end is saved
            live_segs = pg.locator(f'.cal-bar[data-id="{ID["cal_test_live"]}"]')
            lsec = live_segs.nth(live_segs.count() - 1)
            has_l = lsec.locator('.cal-h-l').count() + live_segs.nth(0).locator('.cal-h-l').count()
            has_r = lsec.locator('.cal-h-r').count()
            lb = lsec.bounding_box()
            before = len(posts)
            x1, _ = center(cell(f'{M}-12')); x2, _ = center(cell(f'{M}-13'))
            drag(x1, lb['y'] + lb['height'] / 2, x2, lb['y'] + lb['height'] / 2); settle()
            msg = pg.locator('.cal-msg').inner_text()
            check('live - a move is refused', has_l == 0 and has_r == 1 and len(posts) == before and 'cannot change its start' in msg and mt(ev('cal_test_live')['starts_at']) == f'{M}-10T00:00',
                  f'no start edge ({has_l}), an end edge ({has_r}), no POST ({len(posts) - before}), the message ({msg!r})')
            lb = lsec.bounding_box()
            x2, _ = center(cell(f'{M}-15'))
            drag(lb['x'] + lb['width'] - 3, lb['y'] + lb['height'] / 2, x2, lb['y'] + lb['height'] / 2); settle()
            e3 = ev('cal_test_live')
            check('live - a later end by the edge', mt(e3['ends_at']) == f'{M}-16T00:00' and mt(e3['starts_at']) == f'{M}-10T00:00' and e3['status'] == 'live', f'the end Oct 16 00:00 MT ({mt(e3["ends_at"])})')
            pg.locator(f'.cal-bar[data-id="{ID["cal_test_live"]}"]').first.click(); settle()
            dr = pg.locator('.cal-drawer')
            locked = (not dr.locator('input[name=starts_at]').is_enabled()) and (not dr.locator('select[name=kind]').is_enabled()) and (not dr.locator('input[name=key]').is_enabled())
            prow = dr.locator('[data-var=pull_rare_mult]')
            prow.locator('input').fill('6')
            before = len(posts)
            dr.locator('button[type=submit]').click(); pg.wait_for_timeout(300)
            refused = len(posts) == before and 'from 0.5 to 5' in prow.locator('.ev-var-err').inner_text()
            prow.locator('input').fill('3')
            dr.locator('input[name=theme_banner]').fill('Triple rare odds')
            dr.locator('button[type=submit]').click(); settle()
            e4 = ev('cal_test_live')
            logtxt = pg.locator('.cal-drawer').inner_text()
            check('live - vars and theme change, start and kind locked', locked and refused and e4['vars'] == {'pull_rare_mult': 3} and e4['theme'].get('banner') == 'Triple rare odds'
                  and 'pull_rare_mult' in logtxt, f'locked ({locked}), 6 refused in the form ({refused}), saved ({e4["vars"]}, {e4["theme"]}), the log shows the vars change')
            close_panel()

            # Click an empty day: create from the template (one time); the Repeat control is off until F-1 PR 2
            cell(f'{M}-28').click(position={'x': 30, 'y': cell(f'{M}-01').bounding_box()['height'] - 5}); settle()
            modal = pg.locator('.cal-modal.cal-ov')
            rep_off = modal.locator('input[value=repeat]').is_disabled() and 'F-1 PR 2' in modal.inner_text()
            check('empty day - create dialog', modal.count() == 1 and 'Wed 28 Oct 2026' in modal.inner_text() and rep_off and modal.locator('.cal-item', has_text='CAL Daily cap template').count() == 1,
                  'the dialog for Oct 28 with the template and the Repeat control off')
            modal.locator('input[name=start_time]').fill('15:00')
            modal.locator('.cal-item', has_text='CAL Daily cap template').click(); settle()
            made = [r for r in rows().values() if r.get('template_id') == (tpl or {}).get('id')]
            ok = len(made) == 1 and mt(made[0]['starts_at']) == f'{M}-28T15:00' and made[0]['status'] == 'draft' and made[0]['vars'] == v
            check('empty day - created from the template', ok and pg.locator('.cal-drawer').count() == 1 and pg.locator(f'.cal-bar[data-id="{made[0]["id"] if made else 0}"]').count() >= 1,
                  f'a draft on Oct 28 15:00 MT with the template vars ({made})')
            if made: ID['cal_from_tpl'] = made[0]['id']
            close_panel()

            # Click an empty day: a blank modifier
            cell(f'{M}-29').click(position={'x': 30, 'y': cell(f'{M}-01').bounding_box()['height'] - 5}); settle()
            pg.locator('.cal-modal.cal-ov button:has-text("Blank event")').click(); settle()
            dr = pg.locator('.cal-drawer')
            dr.locator('input[name=title]').fill('CAL Blank modifier')
            autokey = dr.locator('input[name=key]').input_value()
            dr.locator('select[name=kind]').select_option('modifier')
            aud_hidden = not dr.locator('select[name=audience_mode]').is_visible()
            before = len(posts)
            dr.locator('button[type=submit]').click(); pg.wait_for_timeout(300)
            empty_refused = len(posts) == before and 'at least one variable' in dr.locator('form .ev-msg').inner_text()
            dr.locator('select[name=var_add]').select_option('pack_earn_mult')
            dr.locator('[data-var=pack_earn_mult] input').fill('2')
            dr.locator('button[type=submit]').click(); settle()
            blank = [r for r in rows().values() if r['title'] == 'CAL Blank modifier']
            check('empty day - blank modifier', autokey == 'cal_blank_modifier_20261029' and aud_hidden and empty_refused and len(blank) == 1 and blank[0]['vars'] == {'pack_earn_mult': 2}
                  and mt(blank[0]['starts_at']) == f'{M}-29T00:00' and mt(blank[0]['ends_at']) == f'{M}-30T00:00',
                  f'key from the title ({autokey}), no audience for a modifier ({aud_hidden}), a modifier with no vars refused ({empty_refused}), saved ({blank})')
            close_panel()

            # The library and "create from template"
            pg.goto(a.base + '/admin/#/events/library'); settle()
            card = pg.locator('.cal-tpl-card', has_text='CAL Daily cap template')
            check('library', card.count() == 1 and 'Daily earned-pack cap' in card.inner_text(), 'the template card with its variables')
            card.locator('input[name=tpl_start]').fill('2026-11-05T15:00')
            card.locator('button:has-text("Create from template")').click()
            pg.wait_for_url('**/#/events?m=2026-11&open=*'); settle()
            made2 = [r for r in rows().values() if r.get('template_id') == (tpl or {}).get('id') and r['id'] != ID.get('cal_from_tpl')]
            check('library - create from template', len(made2) == 1 and mt(made2[0]['starts_at']) == '2026-11-05T15:00' and pg.locator('.cal-drawer').count() == 1
                  and pg.locator('.cal-month').inner_text() == 'November 2026', f'a draft on Nov 5 15:00 MT and its panel in November ({made2})')
            close_panel()
            pg.goto(a.base + '/admin/#/events/list'); settle()
            check('list view', pg.locator('main', has_text='CAL Live rare rush').count() == 1, 'the list still works')
        else:
            check('phone month (thin bars)', pg.locator('.cal-bar').count() > 0 and pg.locator('.cal-daylist').is_visible(), 'bars and the day list')
            cell(f'{M}-16').click(); settle()
            items = pg.locator('.cal-daylist .cal-item').count()
            titles = pg.locator('.cal-daylist').inner_text()
            check('phone - selected day', items >= 4 and all(t in titles for t in ('CAL Community week', 'CAL Overlap rank', 'CAL Dungeon boost', 'CAL Extra')) and 'Fri 16 Oct 2026' in pg.locator('.cal-daylist').inner_text(), f'the 4 test events on Oct 16 ({items} events)')
            pg.locator('.cal-daylist .cal-item').first.click(); settle()
            check('phone - panel', pg.locator('.cal-drawer').count() == 1, 'the panel')
            close_panel()
            pg.locator('.cal-daylist button:has-text("New event")').click(); settle()
            check('phone - create dialog', pg.locator('.cal-modal.cal-ov').count() == 1, 'the dialog')
            close_panel()
        print(f'  dialogs: {dialogs}')
        ctx.close()
    br.close()
print(f'blocked Supabase requests in the browser: {len(blocked)}')
print('PASS all calendar states' if not fails else f'FAIL {fails}')
sys.exit(1 if fails else 0)
