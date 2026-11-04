// 本地假 ASR：只用来在真机里跑通「录音 → 上传 → 扣分 → 填字」这条链路
// node stub-asr.mjs [port]
import http from 'node:http';

const port = Number(process.argv[2] || 5099);
const reply = { text: '这是本地识别服务返回的测试文字，用来验证语音输入链路。' };

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const record = {
      method: req.method,
      url: req.url,
      contentType: req.headers['content-type'] || '',
      auth: req.headers.authorization ? 'present' : 'missing',
      bytes: body.length,
      at: new Date().toISOString(),
    };
    console.log(JSON.stringify(record));
    res.writeHead(req.url.includes('transcriptions') ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url.includes('transcriptions') ? reply : { error: 'not found' }));
  });
});

server.listen(port, '127.0.0.1', () => console.log(`stub asr on ${port}`));
