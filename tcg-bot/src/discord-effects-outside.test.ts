import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { composeNick, fxDeps, onEffectMessage, onEffectVoice, startDiscordEffects, tick, WAIT_S } from './discord-effects.js';
import { fakeStore, type FakeStore } from './fakes.test.js';

// The pranks/boons with outside influence (SPEC-outside-effects.md, 2026-10-03), run through the
// real loop with fakes: an in-memory store, a fake guild, fake messages and voice states.

const H = 3600_000;
const iso = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString();
let nextId = 1000;
const row = (target: string, primitive: string, o: Record<string, unknown> = {}) => ({
  id: ++nextId, play_id: null, target_id: target, primitive, amount: null, duration_s: 3600,
  options: { sender_id: 'S1', card_id: 7 }, status: 'pending', revert_at: new Date(Date.now() + H).toISOString(),
  original_value: null, created_at: iso(60_000), execute_after: iso(60_000), error: null, ...o,
});

type FakeMember = { id: string; nickname: string | null; manageable: boolean; moderatable: boolean; user: { username: string; globalName: string | null };
  voice: { channelId: string | null; setMute: (b: boolean) => Promise<void>; setDeaf: (b: boolean) => Promise<void> }; setNickname: (n: string | null) => Promise<void> };
function member(id: string, name: string, nick: string | null = null): FakeMember {
  const m: FakeMember = {
    id, nickname: nick, manageable: true, moderatable: true, user: { username: name, globalName: null },
    voice: { channelId: null, setMute: async () => {}, setDeaf: async () => {} },
    setNickname: async (n) => { m.nickname = n; },
  };
  return m;
}
function client(members: FakeMember[]) {
  const by = new Map(members.map((m) => [m.id, m]));
  const guild = {
    ownerId: 'OWNER',
    members: { me: { id: 'BOT' }, fetch: async (id: string) => { const m = by.get(id); if (!m) throw new Error('Unknown Member'); return m; } },
  };
  return { guilds: { fetch: async () => guild } } as never;
}
function message(author: string) {
  const replies: Record<string, unknown>[] = [];
  return { replies, m: { author: { id: author, bot: false }, inGuild: () => true, react: async () => {}, reply: async (o: Record<string, unknown>) => { replies.push(o); } } as never };
}
function voiceChannel(ok = true) {
  const posts: Record<string, unknown>[] = [];
  return { posts, ch: { id: 'VC1', isTextBased: () => ok, send: async (o: Record<string, unknown>) => { posts.push(o); } } };
}
const join = (id: string, ch: unknown) => [{ id, channelId: null, channel: null }, { id, channelId: 'VC1', channel: ch }] as const;

const real = { ...fxDeps };
let sb: FakeStore;
function use(tables: Record<string, Record<string, unknown>[]>): FakeStore {
  sb = fakeStore({ players: [{ id: 'S1', username: 'Ash' }], cards: [{ id: 7, name: 'Grim\'s Pokemon Trainer', image_url: null }], ...tables });
  fxDeps.store = () => sb as never;
  fxDeps.work = async () => ({ fx: true, plays: true, events: true, auctions: true });
  return sb;
}
afterEach(() => { Object.assign(fxDeps, real); });
const fx = (id: number) => sb.tables.discord_effects!.find((r) => r.id === id)!;

describe('title + sticker: Discord nickname layers', () => {
  it('composes a title, a sticker, a crown and a nickname together', () => {
    assert.equal(composeNick(null, 'Lion', { title: 'Bug Catcher' }), 'Lion · Bug Catcher');
    assert.equal(composeNick(null, 'Lion', { sticker: '🦆' }), '🦆 Lion');
    assert.equal(composeNick('Leo', 'Lion', { crown: true, sticker: '🦆', title: 'Ace' }), '👑 🦆 Leo · Ace');
    assert.equal(composeNick('Leo', 'Lion', { nickname: 'Leo the Clown', crown: true, title: 'Ace' }), '👑 Leo the Clown · Ace');
  });
  it('keeps 32 characters: it cuts the name, never the title or the emoji', () => {
    const n = composeNick(null, 'AVeryVeryLongUsername12345', { crown: true, sticker: '🦆', title: 'Pokemon Master' })!;
    assert.ok(n.length <= 32, `${n} is ${n.length}`);
    assert.ok(n.startsWith('👑 🦆 A') && n.endsWith(' · Pokemon Master'), n);
    assert.ok(!/[\uD800-\uDBFF]$/.test(n.split(' · ')[0]!), 'no half emoji');
    const e = composeNick(null, '🦁🦁🦁🦁🦁🦁🦁🦁🦁🦁🦁🦁🦁🦁', { title: 'Gym Leader' })!;   // an emoji name is cut whole
    assert.ok(e.length <= 32 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(e), e);
  });
  it('layers through the loop: each layer goes at its own time, then the own nickname comes back', async () => {
    const lion = member('T1', 'Lion', 'Leo');
    const crown = row('T1', 'crown');
    const title = row('T1', 'title', { options: { sender_id: 'S1', title: 'Bug Catcher' } });
    const sticker = row('T1', 'sticker', { options: { sender_id: 'S1', stickers: ['🦆', '🐸'] } });
    use({ discord_effects: [crown, title, sticker] });
    const c = client([lion]);
    await tick(c, true);
    assert.equal(lion.nickname, '👑 🦆 Leo · Bug Catcher');
    assert.deepEqual([fx(crown.id).status, fx(title.id).status, fx(sticker.id).status], ['active', 'active', 'active']);
    fx(title.id).revert_at = iso(1000); await tick(c, true);
    assert.equal(lion.nickname, '👑 🦆 Leo');
    fx(crown.id).revert_at = iso(1000); await tick(c, true);
    assert.equal(lion.nickname, '🦆 Leo');
    fx(sticker.id).revert_at = iso(1000); await tick(c, true);
    assert.equal(lion.nickname, 'Leo');
    assert.deepEqual([fx(crown.id).status, fx(title.id).status, fx(sticker.id).status], ['reverted', 'reverted', 'reverted']);
  });
  it('a sticker with no emoji option gets the label emoji', async () => {
    const m = member('T2', 'Keeb');
    const s = row('T2', 'sticker', { options: { sender_id: 'S1' } });
    use({ discord_effects: [s] });
    await tick(client([m]), true);
    assert.equal(m.nickname, '🏷️ Keeb');
  });
});

describe('heckle: one reply to the next message', () => {
  it('arms on the first tick (48 h), replies once with a card line, then is done', async () => {
    const h = row('T3', 'heckle', { duration_s: 172800, revert_at: null, options: { sender_id: 'S1', lines: ['Go back to Pallet Town!'] } });
    use({ discord_effects: [h] });
    await tick(client([member('T3', 'Misty')]), true);
    assert.equal(fx(h.id).status, 'active');
    assert.equal(fx(h.id).revert_at, new Date(new Date(h.created_at).getTime() + 48 * H).toISOString());
    const other = message('SOMEONE'); await onEffectMessage(other.m);
    assert.equal(other.replies.length, 0);
    const a = message('T3'); await onEffectMessage(a.m);
    assert.equal(a.replies.length, 1);
    assert.equal(a.replies[0]!.content, 'Go back to Pallet Town!');
    assert.deepEqual(a.replies[0]!.allowedMentions, { parse: [], repliedUser: false });
    assert.equal(fx(h.id).status, 'done');
    const b = message('T3'); await onEffectMessage(b.m);
    assert.equal(b.replies.length, 0);
  });
  it('uses the fallback line when the card has no lines', async () => {
    const h = row('T4', 'heckle', { duration_s: 172800 });
    use({ discord_effects: [h] });
    await tick(client([member('T4', 'Brock')]), true);
    const a = message('T4'); await onEffectMessage(a.m);
    assert.equal(a.replies[0]?.content, '🎤 Ash says hi');
  });
  it('an unused heckle expires at revert_at (skipped, expired) and never replies', async () => {
    const h = row('T5', 'heckle', { duration_s: 172800 });
    use({ discord_effects: [h] });
    const c = client([member('T5', 'Gary')]);
    await tick(c, true);
    fx(h.id).revert_at = iso(1000);
    await tick(c, true);
    assert.equal(fx(h.id).status, 'skipped');
    assert.equal(fx(h.id).error, 'expired');
    const a = message('T5'); await onEffectMessage(a.m);
    assert.equal(a.replies.length, 0);
  });
});

describe('an armed row the table already ended is not used (a cleanse between two ticks)', () => {
  it('a cleansed heckle (revert_at = now) gets no reply, even while it is still in memory', async () => {
    const h = row('T13', 'heckle', { duration_s: 172800 });
    use({ discord_effects: [h] });
    await tick(client([member('T13', 'Lance')]), true);
    fx(h.id).revert_at = iso(1000);      // cleanse: play_card_effect sets revert_at = now()
    const a = message('T13'); await onEffectMessage(a.m);
    assert.equal(a.replies.length, 0);
    assert.equal(fx(h.id).status, 'active'); // the next tick skips it (expired)
  });
});

describe('fanfare / squeaky: one post on the next voice join', () => {
  it('fanfare posts once in the voice text chat with the button, then is done', async () => {
    const f = row('T6', 'fanfare', { duration_s: 172800 });
    use({ discord_effects: [f] });
    const c = client([member('T6', 'Dawn')]);
    await tick(c, true);
    assert.equal(fx(f.id).status, 'active');
    const vc = voiceChannel();
    await onEffectVoice(c, ...join('T6', vc.ch));
    assert.equal(vc.posts.length, 1);
    assert.equal(vc.posts[0]!.content, '📯 <@T6> has arrived! (Fanfare from Ash)');
    assert.deepEqual(vc.posts[0]!.allowedMentions, { parse: [] });
    assert.equal((vc.posts[0]!.components as unknown[]).length, 1);
    assert.equal(fx(f.id).status, 'done');
    await onEffectVoice(c, ...join('T6', vc.ch));
    assert.equal(vc.posts.length, 1);
  });
  it('squeaky does nothing on a channel move or a leave, then posts on a join', async () => {
    const s = row('T7', 'squeaky', { duration_s: 172800 });
    use({ discord_effects: [s] });
    const c = client([member('T7', 'Iris')]);
    await tick(c, true);
    const vc = voiceChannel();
    await onEffectVoice(c, { id: 'T7', channelId: 'VC0', channel: null }, { id: 'T7', channelId: 'VC1', channel: vc.ch }); // a move
    await onEffectVoice(c, { id: 'T7', channelId: 'VC1', channel: vc.ch }, { id: 'T7', channelId: null, channel: null }); // a leave
    assert.equal(vc.posts.length, 0);
    assert.equal(fx(s.id).status, 'active');
    await onEffectVoice(c, ...join('T7', vc.ch));
    assert.equal(vc.posts[0]?.content, '🐔 <@T7> squeaked in… (thanks to Ash)');
    assert.equal(fx(s.id).status, 'done');
  });
  it('falls back to the notifications channel when the voice chat cannot take a post', async () => {
    const f = row('T8', 'fanfare', { duration_s: 172800 });
    use({ discord_effects: [f] });
    const sent: unknown[] = [];
    fxDeps.announce = (async (_c: unknown, m: unknown) => { sent.push(m); return true; }) as never;
    const c = client([member('T8', 'Cynthia')]);
    await tick(c, true);
    await onEffectVoice(c, ...join('T8', voiceChannel(false).ch));
    assert.equal(sent.length, 1);
    assert.match(String((sent[0] as { content: string }).content), /^📯 <@T8> has arrived!/);
    assert.equal(fx(f.id).status, 'done');
  });
  it('an unused fanfare expires at revert_at', async () => {
    const f = row('T9', 'fanfare', { duration_s: 172800 });
    use({ discord_effects: [f] });
    const c = client([member('T9', 'Red')]);
    await tick(c, true);
    fx(f.id).revert_at = iso(1000);
    await tick(c, true);
    assert.deepEqual([fx(f.id).status, fx(f.id).error], ['skipped', 'expired']);
    const vc = voiceChannel();
    await onEffectVoice(c, ...join('T9', vc.ch));
    assert.equal(vc.posts.length, 0);
  });
});

describe('voice pranks wait up to 48 h', () => {
  it('WAIT_S is 48 h for vc_mute and vc_deafen', () => {
    assert.equal(WAIT_S.vc_mute, 172800);
    assert.equal(WAIT_S.vc_deafen, 172800);
  });
  it('a 2 h old voice prank still waits; a 49 h old one is skipped', async () => {
    const young = row('T10', 'vc_mute', { duration_s: 30, created_at: iso(2 * H), execute_after: iso(2 * H) });
    const old = row('T10', 'vc_deafen', { duration_s: 30, created_at: iso(49 * H), execute_after: iso(49 * H) });
    use({ discord_effects: [young, old] });
    await tick(client([member('T10', 'Blue')]), true);
    assert.equal(fx(young.id).status, 'pending');
    assert.deepEqual([fx(old.id).status, fx(old.id).error], ['skipped', 'never_in_voice']);
  });
});

describe('the startup tick is forced', () => {
  it('runs with no bot_work() and rebuilds the armed list after a restart', async () => {
    const prev = process.env.FEATURE_DISCORD_EFFECTS;
    process.env.FEATURE_DISCORD_EFFECTS = '1';
    // Armed before the restart (active, in the table only) + a new play.
    const armed = row('T11', 'heckle', { status: 'active', duration_s: 172800, options: { sender_id: 'S1', lines: ['Wild heckle appeared!'] } });
    const fresh = row('T12', 'crown');
    use({ discord_effects: [armed, fresh] });
    let asked = 0;
    fxDeps.work = async () => { asked += 1; return { fx: false, plays: false, events: false, auctions: false }; };
    const timer = startDiscordEffects(client([member('T11', 'Leaf'), member('T12', 'Ethan')]));
    try {
      for (let i = 0; i < 100 && fx(fresh.id).status === 'pending'; i++) await new Promise((r) => setTimeout(r, 10));
      assert.equal(fx(fresh.id).status, 'active');
      assert.equal(asked, 0);
      const a = message('T11'); await onEffectMessage(a.m);
      assert.equal(a.replies[0]?.content, 'Wild heckle appeared!');
    } finally {
      if (timer) clearInterval(timer);
      if (prev === undefined) delete process.env.FEATURE_DISCORD_EFFECTS; else process.env.FEATURE_DISCORD_EFFECTS = prev;
    }
  });
});

describe('the fake store (the other tests trust it)', () => {
  it('filters, orders, limits and updates like PostgREST', async () => {
    const sb = fakeStore({ t: [{ id: 1, s: 'a', at: '2026-01-02' }, { id: 2, s: 'b', at: '2026-01-01' }, { id: 3, s: 'a', at: '2026-01-03' }] });
    const t = () => sb.from('t') as any;
    assert.deepEqual((await t().select('*').eq('s', 'a').order('at', { ascending: false })).data.map((r: Record<string, unknown>) => r.id), [3, 1]);
    assert.deepEqual((await t().select('*').lte('at', '2026-01-02').order('at')).data.map((r: Record<string, unknown>) => r.id), [2, 1]);
    assert.equal((await t().select('*').eq('id', 9).maybeSingle()).data, null);
    const u = await t().update({ s: 'c' }).eq('id', 2).eq('s', 'b').select('id');
    assert.deepEqual(u.data.map((r: Record<string, unknown>) => r.id), [2]);
    assert.equal(((await t().update({ s: 'd' }).eq('id', 2).eq('s', 'b').select('id')).data as unknown[]).length, 0); // already changed
  });
});
