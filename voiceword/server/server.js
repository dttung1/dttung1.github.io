// Máy chủ trung gian: giữ API key, kiểm tra quyền truy cập, giới hạn lượt gọi, rồi chuyển lệnh cho Claude.
// Chạy: ANTHROPIC_API_KEY=... APP_TOKEN=... node server.js
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { interpret, createClient, CommandError, Anthropic, MODEL } from './claude.js';
import { createRelay, issueSpeechToken } from './relay.js';

const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://dttung1.github.io,https://localhost:3000').split(',').map((s) => s.trim());
const RATE_PER_MIN = Number(process.env.RATE_PER_MIN || 30);
const MAX_BODY = 64 * 1024;

export function createHandler({ client, token = process.env.APP_TOKEN, log = console, relay = createRelay(), speechToken = issueSpeechToken } = {}) {
  if (!token) throw new Error('Thiếu APP_TOKEN: đặt một chuỗi bí mật để add-in dùng khi gọi máy chủ.');
  const hits = new Map(); // khóa → [thời điểm]
  const speechEnabled = !!(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION) || speechToken !== issueSpeechToken;

  const limited = (key, perMin = RATE_PER_MIN) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < 60000);
    list.push(now);
    hits.set(key, list);
    return list.length > perMin;
  };

  const readJson = async (req) => {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) throw Object.assign(new Error('Dữ liệu quá lớn'), { status: 413 });
    }
    try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('JSON không hợp lệ'), { status: 400 }); }
  };

  return async (req, res) => {
    const origin = req.headers.origin;
    if (origin && ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Pair-Id, X-Pair-Key');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    }
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    if (req.method === 'GET' && path === '/health') return send(200, { ok: true, model: MODEL, speech: speechEnabled });

    const authed = req.headers.authorization === `Bearer ${token}`;
    const ip = req.socket.remoteAddress;

    // ----- Trang micro → add-in -----
    const m = path.match(/^\/api\/pair\/([\w-]{4,20})\/(events|say)$/);
    if (req.method === 'POST' && path === '/api/pair') {
      if (!authed) return send(401, { error: 'Sai mã truy cập' });
      if (limited(`pair:${ip}`, 20)) return send(429, { error: 'Quá nhiều yêu cầu' });
      return send(200, relay.create());
    }
    if (m && req.method === 'GET' && m[2] === 'events') {
      if (!authed) return send(401, { error: 'Sai mã truy cập' });
      if (!relay.exists(m[1])) return send(404, { error: 'Phiên ghép đã hết hạn' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': ok\n\n');
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      const off = relay.subscribe(m[1], (ev) => (ev ? res.write(`data: ${JSON.stringify(ev)}\n\n`) : res.end()));
      req.on('close', () => { clearInterval(ping); off?.(); });
      return;
    }
    if (m && req.method === 'POST' && m[2] === 'say') {
      if (!relay.checkKey(m[1], req.headers['x-pair-key'])) return send(401, { error: 'Mã ghép không đúng hoặc đã hết hạn' });
      if (limited(`say:${m[1]}`, 600)) return send(429, { error: 'Quá nhiều yêu cầu' });
      let body;
      try { body = await readJson(req); } catch (e) { return send(e.status, { error: e.message }); }
      const ev = { type: body.type === 'mic' ? 'mic' : 'text', text: String(body.text || '').slice(0, 2000), final: !!body.final, on: !!body.on };
      return send(200, { delivered: relay.publish(m[1], ev) });
    }

    // ----- Mã Azure Speech ngắn hạn -----
    if (req.method === 'GET' && path === '/api/speech-token') {
      const pairOk = relay.checkKey(String(req.headers['x-pair-id'] || ''), req.headers['x-pair-key']);
      if (!authed && !pairOk) return send(401, { error: 'Sai mã truy cập' });
      if (limited(`tok:${ip}`, 30)) return send(429, { error: 'Quá nhiều yêu cầu' });
      try {
        const t = await speechToken();
        return t ? send(200, t) : send(501, { error: 'Máy chủ chưa cấu hình Azure Speech' });
      } catch (e) { log.error?.(e.message); return send(502, { error: 'Không lấy được mã Azure Speech' }); }
    }

    // ----- Lệnh cho Claude -----
    if (req.method !== 'POST' || path !== '/api/command') return send(404, { error: 'Không tìm thấy' });
    if (!authed) return send(401, { error: 'Sai mã truy cập' });
    if (limited(`cmd:${ip}`)) return send(429, { error: 'Quá nhiều lệnh, thử lại sau ít phút' });

    let body;
    try { body = await readJson(req); } catch (e) { return send(e.status, { error: e.message }); }
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
