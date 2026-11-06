// Test stub for watch-db-mem.sh. Usage: node stub-server.mjs <dir> <port-file>
// GET /customer/v1/privileged/metrics: <dir>/metrics.txt, only with "Authorization: Basic base64(service_role:<dir>/key)"
//   (else 401). <dir>/metrics.code overrides the status (500 = the endpoint is down).
// POST /admin-alert: only with "x-internal-token: <dir>/token" (else 401). <dir>/alert.code overrides the status
//   (500 = the bot is down). A taken post appends its JSON body to <dir>/alerts.log.
import http from 'node:http';
import fs from 'node:fs';
const [dir, portFile] = process.argv.slice(2);
const read = (f, d = '') => { try { return fs.readFileSync(`${dir}/${f}`, 'utf8').trim(); } catch { return d; } };
const srv = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/customer/v1/privileged/metrics') {
    const code = Number(read('metrics.code', '200'));
    if (code !== 200) { res.statusCode = code; return res.end('down'); }
    const want = 'Basic ' + Buffer.from(`service_role:${read('key')}`).toString('base64');
    if (req.headers.authorization !== want) { res.statusCode = 401; return res.end('no'); }
    return res.end(read('metrics.txt') + '\n');
  }
  if (req.method === 'POST' && req.url === '/admin-alert') {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      const code = Number(read('alert.code', '200'));
      if (code !== 200) { res.statusCode = code; return res.end('{"sent":0}'); }
      if (req.headers['x-internal-token'] !== read('token')) { res.statusCode = 401; return res.end('{}'); }
      // <dir>/alert.body: the 200 answer (default the new bot: {"channel":true,"sent":0}). The old bot answers {"sent":N}.
      // Every attempt goes to attempts.log. alerts.log has only the posts whose answer says that someone got it.
      const ans = read('alert.body', '{"channel":true,"sent":0}');
      fs.appendFileSync(`${dir}/attempts.log`, b + '\n');
      if (/"channel":true|"sent":[1-9]/.test(ans)) fs.appendFileSync(`${dir}/alerts.log`, b + '\n');
      res.end(ans);
    });
    return;
  }
  res.statusCode = 404; res.end();
});
srv.listen(0, '127.0.0.1', () => fs.writeFileSync(portFile, String(srv.address().port)));
