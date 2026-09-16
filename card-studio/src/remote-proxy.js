/**
 * A tiny password gate in front of the Card Studio, so it can be exposed over a
 * public tunnel safely. Streams every request through to the local studio on
 * 4321 after checking HTTP Basic Auth. Does NOT touch the studio process.
 *
 *   STUDIO_USER=… STUDIO_PASS=… node src/remote-proxy.js
 */
import 'dotenv/config';
import http from 'node:http';

const USER = process.env.STUDIO_USER || 'studio';
const PASS = process.env.STUDIO_PASS || '';
const PORT = Number(process.env.PROXY_PORT) || 4322;
const TARGET = { host: '127.0.0.1', port: Number(process.env.STUDIO_PORT) || 4321 };
const expected = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

const server = http.createServer((req, res) => {
  if (!PASS || req.headers.authorization !== expected) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Card Studio"' });
    res.end('Authentication required.');
    return;
  }
  const proxyReq = http.request(
    { host: TARGET.host, port: TARGET.port, method: req.method, path: req.url, headers: req.headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', (e) => {
    res.writeHead(502);
    res.end('Studio not reachable: ' + e.message);
  });
  req.pipe(proxyReq);
});

server.listen(PORT, () => console.log(`Remote proxy on ${PORT} -> studio ${TARGET.port}`));
