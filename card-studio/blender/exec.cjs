// Send a Python file to the live Blender addon as execute_code, print the reply.
// Usage: node exec.cjs <pyfile>
const net = require('net');
const fs = require('fs');
const code = fs.readFileSync(process.argv[2], 'utf8');
const payload = JSON.stringify({ type: 'execute_code', params: { code } });
const s = net.connect(9876, '127.0.0.1');
let buf = Buffer.alloc(0);
s.setTimeout(180000);
s.on('connect', () => s.write(payload));
s.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  try { const j = JSON.parse(buf.toString('utf8')); process.stdout.write(JSON.stringify(j)); s.end(); process.exit(0); } catch (e) {}
});
s.on('timeout', () => { console.error('TIMEOUT'); process.exit(2); });
s.on('error', (e) => { console.error('ERR', e.message); process.exit(1); });
