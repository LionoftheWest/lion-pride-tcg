// UI-25: "requests on" for the client = the env flag AND the SQL is live. FEATURE_TRADE_REQUEST=1 with no
// create_trade_request gave every member "Something went wrong" (a 500). The probe calls create_trade_request
// with the same member twice: the function returns null at once and writes no row. A missing function = off.
// Read once a minute (singleFlight keeps one call at a time).
export function createTradeRequestProbe({ supabase, flag, singleFlight, now = Date.now, ttl = 60000, warn = () => {} }) {
  let st = { at: -Infinity, ok: false };
  return async function tradeRequestOn() {
    if (!flag) return false;
    if (now() - st.at >= ttl) {
      await singleFlight('tradeReqSql', async () => {
        try {
          const { error } = await supabase.rpc('create_trade_request', { p_from: '0', p_to: '0', p_request: 0 });
          st = { at: now(), ok: !error };
          if (error) warn(`trade requests: FEATURE_TRADE_REQUEST=1 but create_trade_request is not usable: ${error.message}`);
        } catch { st = { at: now(), ok: false }; }
      });
    }
    return st.ok;
  };
}
