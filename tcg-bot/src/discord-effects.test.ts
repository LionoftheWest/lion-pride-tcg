import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeNick, nickFromTemplate, pick, pingTimes, discordEffectsEnabled, colorFor, NAME_COLORS, serialRunner } from './discord-effects.js';
import { effectPost } from './effect-notify.js';

describe('discord effects: the pure rules', () => {
  it('fills a nickname template and keeps it to 32 characters', () => {
    assert.equal(nickFromTemplate('{name} the Clown', 'Keeb'), 'Keeb the Clown');
    assert.equal(nickFromTemplate('King K. {name}', 'Lion'), 'King K. Lion');
    assert.equal(nickFromTemplate('the Krool', 'Lion'), 'Lion the Krool');       // no {name}: the name goes first
    const long = nickFromTemplate('{name} the Unbelievably Long Title', 'AVeryVeryLongUsername');
    assert.ok(long.length <= 32 && long.endsWith('the Unbelievably Long Title'), long);
  });
  it('composes the nick layers: a nickname, a crown, both, none', () => {
    assert.equal(composeNick(null, 'Lion', {}), null);                            // no effect: no nickname
    assert.equal(composeNick('Leo', 'Lion', {}), 'Leo');                          // back to the own nickname
    assert.equal(composeNick(null, 'Lion', { crown: true }), '👑 Lion');
    assert.equal(composeNick('Leo', 'Lion', { crown: true }), '👑 Leo');
    assert.equal(composeNick('Leo', 'Lion', { nickname: 'Leo the Clown' }), 'Leo the Clown');
    assert.equal(composeNick('Leo', 'Lion', { nickname: 'Leo the Clown', crown: true }), '👑 Leo the Clown');
  });
  it('spreads the ping parade: at most 3 pings over at most 5 minutes', () => {
    assert.deepEqual(pingTimes(3, 300), [0, 150, 300]);
    assert.deepEqual(pingTimes(9, 9999), [0, 150, 300]);
    assert.deepEqual(pingTimes(1, 300), [0]);
  });
  it('picks from a card list, with a fallback', () => {
    assert.equal(pick(['a', 'b'], 'x', () => 0.99), 'b');
    assert.equal(pick([], 'x'), 'x');
    assert.equal(pick(undefined, 'x'), 'x');
  });
  it('is OFF unless FEATURE_DISCORD_EFFECTS=1', () => {
    const before = process.env.FEATURE_DISCORD_EFFECTS;
    delete process.env.FEATURE_DISCORD_EFFECTS; assert.equal(discordEffectsEnabled(), false);
    process.env.FEATURE_DISCORD_EFFECTS = '1'; assert.equal(discordEffectsEnabled(), true);
    if (before === undefined) delete process.env.FEATURE_DISCORD_EFFECTS; else process.env.FEATURE_DISCORD_EFFECTS = before;
  });
  it('a hype play gets the hype line', () => {
    const p = effectPost({ id: 1, player_id: 'a', target_id: '42', aimed_at: '42', kind: 'boon', outcome: 'applied', primitive: 'hype', sender: 'Nathan', card: 'The Dad Gaming', effect_name: 'TDG Crew' });
    assert.match(String(p.content), /HYPING <@42> with \*\*The Dad Gaming\*\*: \*\*TDG Crew\*\*/);
  });
});

describe('the play post for the batch 3 counters', () => {
  const base = { id: 1, player_id: 'a', target_id: '42', aimed_at: '42', kind: 'prank', sender: 'Nathan', card: 'Lazy SD', effect_name: 'Self Destruct' };
  it('decoyed: a direct hit on a cutout', () => assert.match(String(effectPost({ ...base, outcome: 'decoyed' }).content), /Direct hit! 🪧/));
  it('redirected: names the member it went to', () => assert.match(String(effectPost({ ...base, target_id: '77', outcome: 'redirected' }).content), /on <@42>\.\.\. but it went to <@77>/));
  it('delayed: lands in 1 hour', () => assert.match(String(effectPost({ ...base, outcome: 'delayed' }).content), /lands in 1 hour/));
});

describe('the name color boon', () => {
  it('uses the picked color when it is one of the 8', () => {
    assert.equal(colorFor({ color: '#5b8cff' }, 10), '#5B8CFF');
    assert.equal(Object.keys(NAME_COLORS).length, 8);
  });
  it('waits for the pick, then gives gold after 24 hours', () => {
    assert.equal(colorFor({}, 60), null);
    assert.equal(colorFor({ color: '#123456' }, 60), null);   // not in the list: still waiting
    assert.equal(colorFor({}, 86400), '#F4B73C');
  });
});

describe('discord effects: the tick queue', () => {
  // A run that waits until the test releases it, so a second request lands mid-run.
  const gated = () => {
    const calls: boolean[] = [];
    let release: () => void = () => {};
    const run = (_: string, force: boolean) => { calls.push(force); return new Promise<void>((r) => { release = r; }); };
    return { calls, run, release: () => release() };
  };
  it('runs a forced request that arrives during a run once the run ends (a voice join is not dropped)', async () => {
    const g = gated();
    const tick = serialRunner(g.run);
    const first = tick('c');            // the 10 s poll
    void tick('c', true);               // a member joins voice mid-tick
    void tick('c', true);               // a second join: still one extra run
    g.release(); await new Promise((r) => setImmediate(r));
    assert.deepEqual(g.calls, [false, true]);
    g.release(); await first;
    assert.deepEqual(g.calls, [false, true]);
  });
  it('drops a plain poll that arrives during a run (the next poll comes in 10 s)', async () => {
    const g = gated();
    const tick = serialRunner(g.run);
    const first = tick('c');
    void tick('c');
    g.release(); await first;
    assert.deepEqual(g.calls, [false]);
  });
});
