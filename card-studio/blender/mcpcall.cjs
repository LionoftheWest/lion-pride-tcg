// Minimal client for the BlenderMCP addon socket (127.0.0.1:9876).
// Usage: node mcpcall.js '{"type":"ping"}'
//        node mcpcall.js '{"type":"execute_code","params":{"code":"..."}}'
const net = require('net');
const payload = process.argv[2];
if (!payload) { console.error('no payload'); process.exit(1); }
const s = net.connect(9876, '127.0.0.1');
let buf = Buffer.alloc(0);
s.setTimeout(120000);
s.on('connect', () => s.write(payload));
s.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  try {
    const j = JSON.parse(buf.toString('utf8'));
    process.stdout.write(JSON.stringify(j));
    s.end();
    process.exit(0);
  } catch (e) { /* keep reading until full JSON */ }
});
s.on('timeout', () => { console.error('TIMEOUT'); process.exit(2); });
s.on('error', (e) => { console.error('ERR', e.message); process.exit(1); });
s.on('close', () => { if (buf.length) { process.stdout.write(buf.toString('utf8')); } });
