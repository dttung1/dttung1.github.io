// Chuyển tiếp chữ từ "trang micro" (mở bằng Edge/Chrome) sang add-in trong Word desktop.
// Add-in tạo một cặp ghép (pair) → mở trang micro kèm mã → trang micro gửi chữ → add-in nhận qua luồng SSE.
import crypto from 'node:crypto';

const TTL_MS = 12 * 60 * 60 * 1000;
const MAX_PAIRS = 1000;

export function createRelay({ now = () => Date.now() } = {}) {
  const pairs = new Map(); // id → { key, expires, listeners:Set<fn> }

  const sweep = () => {
    for (const [id, p] of pairs) if (p.expires < now()) { p.listeners.forEach((fn) => fn(null)); pairs.delete(id); }
  };

  return {
    create() {
      sweep();
      if (pairs.size >= MAX_PAIRS) throw new Error('Quá nhiều phiên ghép');
      const id = crypto.randomBytes(6).toString('base64url');
      const key = crypto.randomBytes(18).toString('base64url');
      pairs.set(id, { key, expires: now() + TTL_MS, listeners: new Set(), seq: 0, log: [], waiters: new Set() });
      return { pair: id, key, expiresAt: now() + TTL_MS };
    },
    checkKey(id, key) {
      const p = pairs.get(id);
      if (!p || p.expires < now() || typeof key !== 'string' || key.length !== p.key.length) return false;
      return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(p.key));
    },
    exists: (id) => pairs.has(id) && pairs.get(id).expires >= now(),
    subscribe(id, fn) {
      const p = pairs.get(id);
      if (!p) return null;
      p.listeners.add(fn);
      return () => p.listeners.delete(fn);
    },
    publish(id, event) {
      const p = pairs.get(id);
      if (!p) return 0;
      const ev = { ...event, seq: ++p.seq };
      p.log.push(ev);
      if (p.log.length > 200) p.log.shift();
      const delivered = p.listeners.size + p.waiters.size + (now() - (p.lastPoll || 0) < 30000 ? 1 : 0);
      p.listeners.forEach((fn) => fn(ev));
      p.waiters.forEach((fn) => fn());
      return delivered > 0 ? 1 : 0;
    },
    // Long-polling: trả ngay các sự kiện sau `after`; nếu chưa có thì chờ tối đa timeoutMs.
    // after < 0 → chỉ lấy mốc hiện tại (không phát lại chữ cũ khi add-in vừa mở).
    poll(id, after, timeoutMs = 25000) {
      const p = pairs.get(id);
      if (!p || p.expires < now()) return Promise.resolve(null);
      p.lastPoll = now();
      const take = () => ({ events: p.log.filter((e) => e.seq > after), last: p.seq });
      if (after < 0) return Promise.resolve({ events: [], last: p.seq });
      if (p.log.some((e) => e.seq > after)) return Promise.resolve(take());
      return new Promise((resolve) => {
        const done = () => { clearTimeout(t); p.waiters.delete(done); p.lastPoll = now(); resolve(take()); };
        const t = setTimeout(done, timeoutMs);
        p.waiters.add(done);
      });
    },
  };
}

// Mã Azure Speech ngắn hạn (10 phút) để trình duyệt nhận dạng giọng nói mà không lộ khóa Azure.
export async function issueSpeechToken({ key = process.env.AZURE_SPEECH_KEY, region = process.env.AZURE_SPEECH_REGION, fetchImpl = fetch } = {}) {
  if (!key || !region) return null;
  const res = await fetchImpl(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Length': '0' },
  });
  if (!res.ok) throw new Error(`Azure Speech trả lỗi ${res.status}`);
  return { token: await res.text(), region };
}
