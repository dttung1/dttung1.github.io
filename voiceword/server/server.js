// Máy chủ trung gian: giữ API key, kiểm tra quyền truy cập, giới hạn lượt gọi, rồi chuyển lệnh cho Claude.
// Chạy: ANTHROPIC_API_KEY=... APP_TOKEN=... node server.js
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { interpret, createClient, CommandError, Anthropic, MODEL } from './claude.js';

const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://dttung1.github.io,https://localhost:3000').split(',').map((s) => s.trim());
const RATE_PER_MIN = Number(process.env.RATE_PER_MIN || 30);
const MAX_BODY = 64 * 1024;

export function createHandler({ client, token = process.env.APP_TOKEN, log = console } = {}) {
  if (!token) throw new Error('Thiếu APP_TOKEN: đặt một chuỗi bí mật để add-in dùng khi gọi máy chủ.');
  const hits = new Map(); // ip → [timestamps]

  const limited = (ip) => {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
    list.push(now);
    hits.set(ip, list);
    return list.length > RATE_PER_MIN;
  };

  return async (req, res) => {
    const origin = req.headers.origin;
    if (origin && ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    }
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, model: MODEL });
    if (req.method !== 'POST' || req.url !== '/api/command') return send(404, { error: 'Không tìm thấy' });
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'Sai mã truy cập' });
    if (limited(req.socket.remoteAddress)) return send(429, { error: 'Quá nhiều lệnh, thử lại sau ít phút' });

    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) return send(413, { error: 'Dữ liệu quá lớn' });
    }
    let body;
    try { body = JSON.parse(raw); } catch { return send(400, { error: 'JSON không hợp lệ' }); }
    const utterance = String(body.utterance || '').trim().slice(0, 1000);
    if (!utterance) return send(400, { error: 'Thiếu câu lệnh' });

    const started = Date.now();
    try {
      const result = await interpret(client, { utterance, context: body.context });
      // Chỉ ghi số liệu, không ghi nội dung tài liệu.
      log.info?.(`[command] ${Date.now() - started}ms ops=${result.ops.length} in=${result.usage?.input_tokens} out=${result.usage?.output_tokens}`);
      send(200, result);
    } catch (err) {
      if (err instanceof CommandError) return send(err.status, { error: err.message });
      if (err instanceof Anthropic.RateLimitError) return send(429, { error: 'AI đang quá tải, thử lại sau' });
      if (err instanceof Anthropic.AuthenticationError) { log.error?.('API key không hợp lệ'); return send(500, { error: 'Máy chủ cấu hình sai' }); }
      if (err instanceof Anthropic.APIError) { log.error?.(`Claude API ${err.status}: ${err.message}`); return send(502, { error: 'AI tạm thời không phản hồi' }); }
      log.error?.(err);
      send(500, { error: 'Lỗi máy chủ' });
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const handler = createHandler({ client: createClient() });
  const port = Number(process.env.PORT || 8787);
  const { TLS_CERT, TLS_KEY } = process.env;
  const server = TLS_CERT && TLS_KEY
    ? https.createServer({ cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) }, handler)
    : http.createServer(handler);
  server.listen(port, () => console.log(`VoiceWord server: ${TLS_CERT ? 'https' : 'http'}://localhost:${port} · model ${MODEL}`));
}
