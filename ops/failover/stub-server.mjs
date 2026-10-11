// Test stub for watch-main.sh: GET /public /direct /control /local /local-hunt (body has "hunt":true) answer the code in <dir>/<name>.code
// (default 200). POST /hook records the body to <dir>/hook.log. Usage: node stub-server.mjs <dir> <port-file>
import http from 'node:http';
import fs from 'node:fs';
const [dir, portFile] = process.argv.slice(2);
const srv = http.createServer((req, res) => {
  const name = req.url.replace(/^\//, '').split('?')[0];
  if (req.method === 'POST') {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => { fs.appendFileSync(`${dir}/hook.log`, b + '\n'); res.end('ok'); });
    return;
  }
  let code = 200;
  try { code = Number(fs.readFileSync(`${dir}/${name}.code`, 'utf8').trim()); } catch {}
  res.statusCode = code; res.end(name === 'local-hunt' ? '{"hunt":true}' : 'x');
});
srv.listen(0, '127.0.0.1', () => fs.writeFileSync(portFile, String(srv.address().port)));
