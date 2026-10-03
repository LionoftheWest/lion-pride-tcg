import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { echoLine, fxDeps, onEffectMessage, onEffectVoice, pollFor, spongeCase, tick } from './discord-effects.js';
import { fakeStore, type FakeStore } from './fakes.test.js';

// effects_spread.sql (2026-10-03): ping text, slowmode, hot take poll, name swap, parrot, spongebob,
// a fanfare line from the card, and the 1-minute timeout. The real loop with fakes (no Discord, no Supabase).

const H = 3600_000;
const iso = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString();
let nextId = 5000;
const row = (target: string, primitive: string, o: Record<string, unknown> = {}) => ({
  id: ++nextId, play_id: 1, target_id: target, primitive, amount: null, duration_s: 3600,
  options: { sender_id: 'S1', card_id: 7 }, status: 'pending', revert_at: new Date(Date.now() + H).toISOString(),
  original_value: null, created_at: iso(60_000), execute_after: iso(60_000), error: null, ...o,
});

type FakeMember = { id: string; nickname: string | null; manageable: boolean; moderatable: boolean; user: { username: string; globalName: string | null };
  voice: { channelId: string | null }; setNickname: (n: string | null) => Promise<void>; timeout: (ms: number) => Promise<void>; timeouts: number[] };
function member(id: string, name: string, nick: string | null = null): FakeMember {
  const m: FakeMember = {
    id, nickname: nick, manageable: true, moderatable: true, user: { username: name, globalName: null }, voice: { channelId: null },
    setNickname: async (n) => { m.nickname = n; }, timeouts: [], timeout: async (ms) => { m.timeouts.push(ms); },
  };
  return m;
}
function client(members: FakeMember[], manageMessages = true) {
  const by = new Map(members.map((m) => [m.id, m]));
  const guild = {
    ownerId: 'OWNER',
    members: {
      me: { id: 'BOT', permissions: { has: (p: bigint) => manageMessages && p === 8192n } }, // 8192 = Manage Messages
      fetch: async (id: string) => { const m = by.get(id); if (!m) throw new Error('Unknown Member'); return m; },
    },
  };
  return { guilds: { fetch: async () => guild } } as never;
}
/** A chat message: replies, deletes and channel posts are recorded. */
function message(author: string, content = 'hello', o: { channelId?: string; at?: number; bot?: boolean } = {}) {
  const replies: Record<string, unknown>[] = [];
  const posts: Record<string, unknown>[] = [];
  const state = { deleted: false };
  const m = {
    author: { id: author, bot: o.bot ?? false }, content, channelId: o.channelId ?? 'C1', createdTimestamp: o.at ?? Date.now(),
    inGuild: () => true, react: async () => {}, reply: async (x: Record<string, unknown>) => { replies.push(x); },
    delete: async () => { state.deleted = true; }, channel: { send: async (x: Record<string, unknown>) => { posts.push(x); } },
  };
  return { replies, posts, state, m: m as never };
}

const real = { ...fxDeps };
let sb: FakeStore;
let sent: Record<string, unknown>[] = [];
function use(tables: Record<string, Record<string, unknown>[]>): FakeStore {
  sb = fakeStore({ players: [{ id: 'S1', username: 'Ash' }], cards: [{ id: 7, name: 'Test Card', image_url: null }], ...tables });
  fxDeps.store = () => sb as never;
  fxDeps.work = async () => ({ fx: true, plays: true, events: true, auctions: true });
  sent = [];
  fxDeps.announce = (async (_c: unknown, m: unknown) => { sent.push(typeof m === 'string' ? { content: m } : (m as Record<string, unknown>)); return true; }) as never;
  return sb;
}
afterEach(() => { Object.assign(fxDeps, real); });
const fx = (id: number) => sb.tables.discord_effects!.find((r) => r.id === id)!;

describe('ping parade: the post is only the mention', () => {
  it('each ping is "<@target>" and nothing else (no card name, no 1/3)', async () => {
    const p = row('P1', 'ping_parade', { amount: 3, duration_s: 300, created_at: iso(10 * 60_000) }); // 10 min ago: all 3 are due
    use({ discord_effects: [p] });
    await tick(client([member('P1', 'Dan')]), true); // arms (times)
    await tick(client([member('P1', 'Dan')]), true); // sends
    assert.deepEqual(sent.map((m) => m.content), ['<@P1>', '<@P1>', '<@P1>']);
    assert.equal(fx(p.id).status, 'done');
  });
});

describe('slowmode: delete a message that comes too soon', () => {
  it('keeps the first message, deletes one 10 s later in the same channel, posts one notice', async () => {
    const s = row('L1', 'slowmode', { amount: 30, duration_s: 300, revert_at: new Date(Date.now() + 300_000).toISOString() });
    use({ discord_effects: [s] });
    await tick(client([member('L1', 'Aussie')]), true);
    assert.equal(fx(s.id).status, 'active');
    const t0 = Date.now();
    const a = message('L1', 'g\'day', { at: t0 }); await onEffectMessage(a.m);
    assert.equal(a.state.deleted, false);
    const b = message('L1', 'mate', { at: t0 + 10_000 }); await onEffectMessage(b.m);
    assert.equal(b.state.deleted, true);
    assert.equal(b.posts.length, 1);
    assert.match(String(b.posts[0]!.content), /^🐌 <@L1> is in slowmode \(\*\*Test Card\*\*\): one message every 30 seconds/);
    assert.deepEqual(b.posts[0]!.allowedMentions, { parse: [] });
    const c = message('L1', 'again', { at: t0 + 20_000 }); await onEffectMessage(c.m);
    assert.equal(c.state.deleted, true);
    assert.equal(c.posts.length, 0, 'the notice posts only once');
    assert.equal((fx(s.id).options as Record<string, unknown>).noticed, true);
  });
  it('keeps a message 30 s after the last kept one, and a message in another channel', async () => {
    const s = row('L2', 'slowmode', { amount: 30, duration_s: 300, revert_at: new Date(Date.now() + 300_000).toISOString() });
    use({ discord_effects: [s] });
    await tick(client([member('L2', 'Aussie')]), true);
    const t0 = Date.now();
    await onEffectMessage(message('L2', 'one', { at: t0 }).m);
    const other = message('L2', 'two', { at: t0 + 5_000, channelId: 'C2' }); await onEffectMessage(other.m);
    assert.equal(other.state.deleted, false);
    const late = message('L2', 'three', { at: t0 + 30_000 }); await onEffectMessage(late.m);
    assert.equal(late.state.deleted, false);
  });
  it('a deleted message gets no other effect (no heckle reply)', async () => {
    const s = row('L3', 'slowmode', { amount: 30, duration_s: 300, revert_at: new Date(Date.now() + 300_000).toISOString() });
    const h = row('L3', 'heckle', { duration_s: 172800, options: { sender_id: 'S1', lines: ['Boo'] } });
    use({ discord_effects: [s, h] });
    await tick(client([member('L3', 'Aussie')]), true);
    const t0 = Date.now();
    const a = message('L3', 'one', { at: t0 }); await onEffectMessage(a.m);
    assert.equal(a.replies.length, 1); // the heckle used the kept message
    const b = message('L3', 'two', { at: t0 + 1_000 }); await onEffectMessage(b.m);
    assert.deepEqual([b.state.deleted, b.replies.length], [true, 0]);
  });
  it('stops at revert_at: the row is reverted and nothing is deleted after it', async () => {
    const s = row('L4', 'slowmode', { amount: 30, duration_s: 300, revert_at: new Date(Date.now() + 300_000).toISOString() });
    use({ discord_effects: [s] });
    const c = client([member('L4', 'Aussie')]);
    await tick(c, true);
    const t0 = Date.now();
    await onEffectMessage(message('L4', 'one', { at: t0 }).m);
    fx(s.id).revert_at = iso(1000);
    await tick(c, true);
    assert.equal(fx(s.id).status, 'reverted');
    const b = message('L4', 'two', { at: t0 + 1_000 }); await onEffectMessage(b.m);
    assert.equal(b.state.deleted, false);
  });
  it('fails closed without Manage Messages (nothing is deleted)', async () => {
    const s = row('L5', 'slowmode', { amount: 30, duration_s: 300 });
    use({ discord_effects: [s] });
    await tick(client([member('L5', 'Aussie')], false), true);
    assert.deepEqual([fx(s.id).status, fx(s.id).error], ['failed', 'no_manage_messages']);
    const t0 = Date.now();
    await onEffectMessage(message('L5', 'one', { at: t0 }).m);
    const b = message('L5', 'two', { at: t0 + 1_000 }); await onEffectMessage(b.m);
    assert.equal(b.state.deleted, false);
  });
});

describe('parrot / spongebob: one reply to the next message with text', () => {
  it('spongeCase alternates the letters and keeps mentions and custom emoji', () => {
    assert.equal(spongeCase('meta abuser'), 'mEtA aBuSeR');
    assert.equal(spongeCase('hi <@123> <:Kek:456> ok'), 'hI <@123> <:Kek:456> oK');
    assert.equal(echoLine('parrot', 'hello'), '🦜 hello');
    assert.equal(echoLine('spongebob', 'go back to pokemon'), '🧽 gO bAcK tO pOkEmOn');
    assert.equal([...echoLine('parrot', '🦁'.repeat(400))].length <= 300, true);
    assert.ok(echoLine('parrot', 'x'.repeat(400)).length === 300);
  });
  for (const [prim, want] of [['parrot', '🦜 Go back to Pokemon @everyone'], ['spongebob', '🧽 gO bAcK tO pOkEmOn @EvErYoNe']] as const) {
    it(`${prim}: replies once with the text, no mention can ping, then done`, async () => {
      const p = row('E1', prim, { duration_s: 172800 });
      use({ discord_effects: [p] });
      await tick(client([member('E1', 'Lorc')]), true);
      assert.equal(fx(p.id).status, 'active');
      const bot = message('E1', 'from a bot', { bot: true }); await onEffectMessage(bot.m);
      const empty = message('E1', '   '); await onEffectMessage(empty.m);        // an image only: no text
      assert.deepEqual([bot.replies.length, empty.replies.length, fx(p.id).status], [0, 0, 'active']);
      const a = message('E1', 'Go back to Pokemon @everyone'); await onEffectMessage(a.m);
      assert.equal(a.replies.length, 1);
      assert.equal(a.replies[0]!.content, want);
      assert.deepEqual(a.replies[0]!.allowedMentions, { parse: [], repliedUser: false });
      assert.equal(fx(p.id).status, 'done');
      const b = message('E1', 'second'); await onEffectMessage(b.m);
      assert.equal(b.replies.length, 0, 'one use only');
    });
  }
  it('an unused parrot expires at revert_at (48 h) and never replies', async () => {
    const p = row('E2', 'parrot', { duration_s: 172800 });
    use({ discord_effects: [p] });
    const c = client([member('E2', 'Lorc')]);
    await tick(c, true);
    assert.equal(fx(p.id).revert_at, new Date(new Date(p.created_at).getTime() + 48 * H).toISOString());
    fx(p.id).revert_at = iso(1000);
    await tick(c, true);
    assert.deepEqual([fx(p.id).status, fx(p.id).error], ['skipped', 'expired']);
    const a = message('E2', 'hello'); await onEffectMessage(a.m);
    assert.equal(a.replies.length, 0);
  });
  it('a heckle and a parrot on one member: one reply per message (the heckle first)', async () => {
    const h = row('E3', 'heckle', { duration_s: 172800, options: { sender_id: 'S1', lines: ['Boo'] } });
    const p = row('E3', 'parrot', { duration_s: 172800 });
    use({ discord_effects: [h, p] });
    await tick(client([member('E3', 'Lorc')]), true);
    const a = message('E3', 'one'); await onEffectMessage(a.m);
    const b = message('E3', 'two'); await onEffectMessage(b.m);
    assert.deepEqual([a.replies.map((r) => r.content), b.replies.map((r) => r.content)], [['Boo'], ['🦜 two']]);
  });
});

describe('hot take poll', () => {
  it('pollFor fills the name, keeps the fixed answers, cuts to the Discord limits', () => {
    const p = pollFor({ question: 'Is {name} the Sauce Boss?', answers: ['Yes', 'No', 'a'.repeat(80)] }, 'Lion');
    assert.equal(p.question.text, 'Is Lion the Sauce Boss?');
    assert.deepEqual(p.answers.slice(0, 2), [{ text: 'Yes' }, { text: 'No' }]);
    assert.equal(p.answers[2]!.text.length, 55);
    assert.equal(p.duration, 1);
    assert.deepEqual(pollFor({}, 'Lion').answers, [{ text: 'Yes' }, { text: 'No' }]);
  });
  it('posts one poll in the plays channel, the row stays active until the poll ends', async () => {
    const p = row('Q1', 'hot_take_poll', { options: { sender_id: 'S1', card_id: 7, question: 'Is {name} the Sauce Boss?', answers: ['Yes', 'No'] } });
    use({ discord_effects: [p] });
    await tick(client([member('Q1', 'Lion', 'Leo')]), true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.content, '📊 Ash played **Test Card** on <@Q1>');
    assert.equal((sent[0]!.poll as { question: { text: string } }).question.text, 'Is Leo the Sauce Boss?');
    assert.equal(fx(p.id).status, 'active');
  });
});

describe('name swap (body_swap)', () => {
  it('the target and the sender swap their own names for the same hour, then both come back', async () => {
    const t = member('N1', 'Krool', 'K. Rool');
    const s = member('S1', 'Ash');
    const b = row('N1', 'body_swap');
    use({ discord_effects: [b] });
    const c = client([t, s]);
    await tick(c, true);            // the target side + a pending partner row
    await tick(c, true);            // the partner side
    assert.deepEqual([t.nickname, s.nickname], ['Ash', 'K. Rool']);
    const partner = sb.tables.discord_effects!.find((r) => r.target_id === 'S1')!;
    assert.equal(partner.revert_at, fx(b.id).revert_at);
    fx(b.id).revert_at = iso(1000); // a cleanse on the target ends the swap for both
    await tick(c, true);
    await tick(c, true);
    assert.deepEqual([t.nickname, s.nickname], ['K. Rool', null]);
    assert.deepEqual([fx(b.id).status, partner.status], ['reverted', 'reverted']);
  });
  it('a sender the bot cannot rename (the owner): only the target is renamed', async () => {
    const t = member('N2', 'Krool');
    const s = member('S1', 'Owner'); s.manageable = false;
    const b = row('N2', 'body_swap');
    use({ discord_effects: [b] });
    await tick(client([t, s]), true);
    assert.equal(t.nickname, 'Owner');
    assert.equal(sb.tables.discord_effects!.length, 1);
    assert.equal((fx(b.id).options as Record<string, unknown>).partner_error, 'not_manageable');
  });
});

describe('a fanfare line from the card (Discord Pizza Party)', () => {
  it('uses options.line with the mention and the sender', async () => {
    const f = row('F1', 'fanfare', { duration_s: 172800, options: { sender_id: 'S1', card_id: 7, line: '🍕 {target} is here and the pizza is too! (from {sender})' } });
    use({ discord_effects: [f] });
    const c = client([member('F1', 'Za')]);
    await tick(c, true);
    const posts: Record<string, unknown>[] = [];
    const ch = { isTextBased: () => true, send: async (o: Record<string, unknown>) => { posts.push(o); } };
    await onEffectVoice(c, { id: 'F1', channelId: null, channel: null }, { id: 'F1', channelId: 'V', channel: ch });
    assert.equal(posts[0]?.content, '🍕 <@F1> is here and the pizza is too! (from Ash)');
  });
});

describe('Speechless (Bonzan\'s Donkey Kong): a 1-minute timeout', () => {
  it('times the target out for 60 s', async () => {
    const m = member('D1', 'Kong');
    const t = row('D1', 'timeout', { duration_s: 60 });
    use({ discord_effects: [t] });
    await tick(client([m]), true);
    assert.deepEqual(m.timeouts, [60_000]);
    assert.equal(fx(t.id).status, 'done');
  });
});
