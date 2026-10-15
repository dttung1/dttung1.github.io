// Trang micro: chạy trong trình duyệt thường (nơi micro chắc chắn dùng được),
// gửi chữ nhận dạng sang add-in qua máy chủ. Thông tin ghép nằm sau dấu # nên không gửi lên GitHub Pages.
import { createWebSpeech, createAzureSpeech } from './speech.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const server = (params.get('s') || '').replace(/\/$/, '');
const pair = params.get('p') || '';
const key = params.get('k') || '';
history.replaceState(null, '', location.pathname); // xóa mã khỏi thanh địa chỉ

let listening = false;
let recognizer = null;

function setLink(state, text) {
  $('link').className = `pill ${state}`;
  $('link').lastChild.textContent = text;
}

async function send(body) {
  const res = await fetch(`${server}/api/pair/${pair}/say`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pair-Key': key },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { setLink('off', 'Mã ghép hết hạn. Mở lại từ Word.'); return 0; }
  const { delivered = 0 } = await res.json().catch(() => ({}));
  setLink(delivered ? 'on' : 'off', delivered ? 'Đã kết nối với Word' : 'Word chưa mở khung “Soạn bằng giọng nói”');
  return delivered;
}

let interimTimer = null;
let pendingInterim = '';
const handlers = {
  onInterim(t) {
    $('interim').textContent = t;
    pendingInterim = t;
    if (!interimTimer) interimTimer = setTimeout(() => { interimTimer = null; send({ type: 'text', text: pendingInterim, final: false }).catch(() => {}); }, 300);
  },
  async onFinal(t) {
    $('interim').textContent = '';
    try {
      const n = await send({ type: 'text', text: t, final: true });
      $('last').textContent = t;
      $('last').classList.toggle('muted', !n);
    } catch { setLink('off', 'Mất kết nối máy chủ'); }
  },
  onState(on) {
    listening = on;
    $('mic').setAttribute('aria-pressed', String(on));
    $('mic').setAttribute('aria-label', on ? 'Dừng nghe' : 'Bắt đầu nghe');
    $('status').textContent = on ? 'Đang nghe…' : 'Nhấn micro hoặc phím Space';
    send({ type: 'mic', on }).catch(() => {});
  },
  onError(msg) { $('status').textContent = msg; },
};

function build(source) {
  recognizer?.stop();
  recognizer = source === 'azure'
    ? createAzureSpeech({
      ...handlers,
      getToken: async () => {
        const res = await fetch(`${server}/api/speech-token`, { headers: { 'X-Pair-Id': pair, 'X-Pair-Key': key } });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Không lấy được mã Azure Speech');
        return body;
      },
    })
    : createWebSpeech(handlers);
  if (!recognizer.supported) $('status').textContent = 'Trình duyệt này không có nhận dạng giọng nói. Chọn Azure Speech.';
}

const toggle = () => (listening ? recognizer.stop() : recognizer.start());
$('mic').addEventListener('click', toggle);
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); toggle(); }
});
$('source').addEventListener('change', (e) => {
  try { localStorage.setItem('voiceword.micSource', e.target.value); } catch { /* bỏ qua */ }
  build(e.target.value);
});

if (!server || !pair || !key) {
  setLink('off', 'Thiếu thông tin ghép');
  $('status').textContent = 'Hãy mở trang này từ nút “Mở trang micro” trong Word.';
  $('mic').disabled = true;
} else {
  const health = await fetch(`${server}/health`).then((r) => r.json()).catch(() => null);
  if (!health) setLink('off', 'Không kết nối được máy chủ');
  else send({ type: 'mic', on: false }).catch(() => {});
  let saved = null;
  try { saved = localStorage.getItem('voiceword.micSource'); } catch { /* bỏ qua */ }
  const source = health?.speech ? (saved || 'azure') : 'webspeech';
  if (!health?.speech) $('source').querySelector('[value="azure"]').disabled = true;
  $('source').value = source;
  build(source);
}
