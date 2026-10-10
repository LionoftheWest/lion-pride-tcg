// The G3 UI check only: a stand-in for @discord/embedded-app-sdk (from discord-ui-preview/sdk-stub.js).
// The check server (serve.mjs) answers every /api call from the recorded fixtures, so the member is the
// fixture member, never a real one. Never ship this file: build.mjs aliases it for the check build only.
const ID = '100000000000000001';
const NAME = 'Member A';
const realFetch = window.fetch.bind(window);
window.fetch = (url, opts) => {
  if (String(url).startsWith('/api/token')) return Promise.resolve(new Response(JSON.stringify({ access_token: `lt:${ID}` }), { headers: { 'content-type': 'application/json' } }));
  return realFetch(url, opts);
};
export class DiscordSDK {
  constructor() { this.instanceId = 'ui-check-room'; }
  // UI-56 loader states (cookie ci_loader, set by run.mjs for a spec with `loader`): wait = the sign-in never answers, error = it fails.
  async ready() {
    const mode = /(?:^|; )ci_loader=(\w+)/.exec(document.cookie)?.[1];
    if (mode === 'wait') await new Promise(() => {});
    if (mode === 'error') throw new Error('OAuth2 Authorize Error: Unknown Error');
  }
  commands = {
    authorize: async () => ({ code: 'ui-check' }),
    authenticate: async () => ({ user: { id: ID, username: 'member_a', global_name: NAME } }),
  };
}
