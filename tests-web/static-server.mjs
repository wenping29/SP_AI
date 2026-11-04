// 仅用于真机验证的最小静态服务器：node static-server.mjs <port> <dir>
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const [,, portArg = '8899', dirArg = '.'] = process.argv;
const root = path.resolve(dirArg);

http.createServer(async (req, res) => {
  const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'fixture.html';
  const file = path.join(root, name);
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(Number(portArg), '127.0.0.1', () => {
  console.log(`static server on http://127.0.0.1:${portArg}`);
});
