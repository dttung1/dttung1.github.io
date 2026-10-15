// Điều phối: giọng nói → hiểu lệnh (quy tắc hoặc AI) → xác nhận nếu cần → thực thi trong Word.
/* global Office */
import { parseUtterance } from './commands.js';
import * as word from './executor.js';
import { createRecognizer } from './speech.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const HINT = {
  dictation: 'Nói nội dung để gõ. Nói “chấm”, “phẩy”, “xuống dòng” để chèn dấu. Bắt đầu bằng “Lệnh…” để ra lệnh.',
  command: 'Mọi câu nói được hiểu là lệnh định dạng hoặc yêu cầu soạn thảo.',
};

// ---------- Cài đặt (lưu trên máy này) ----------
const SETTINGS_KEY = 'voiceword.settings';
let settings = { aiEnabled: true, serverUrl: '', token: '' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); } catch { /* bỏ qua */ }
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* bỏ qua */ } };

const state = { mode: 'dictation', listening: false, pending: null, inWord: false };

// Ngoài Word (xem thử trên trình duyệt): chỉ mô tả thao tác, không sửa tài liệu.
const preview = {
  execute: async () => [],
  insertDictation: async () => {},
  undo: async () => {},
  readContext: async () => ({ selection: '', currentParagraph: '', outline: [], paragraphCount: 0 }),
  canUndo: () => false,
};
const doc = () => (state.inWord ? word : preview);

// ---------- Lịch sử ----------
const ICON_OK = '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>';
const ICON_ERR = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';
const BADGE = { rule: '<span class="badge rule">Quy tắc</span>', ai: '<span class="badge ai">AI</span>', text: '<span class="badge text">Đọc chữ</span>' };

function addEntry(said, source) {
  const list = $('history');
  list.querySelector('.empty')?.remove();
  const li = document.createElement('li');
  li.innerHTML = `<div class="said">“${esc(said)}”${BADGE[source] || ''}</div><div class="did wait">Đang xử lý…</div>`;
  list.prepend(li);
  while (list.children.length > 30) list.lastChild.remove();
  const did = li.querySelector('.did');
  return {
    ok(lines) { did.className = 'did ok'; did.innerHTML = `${ICON_OK}<span>${lines.map(esc).join('<br>')}</span>`; },
    err(msg) { did.className = 'did err'; did.innerHTML = `${ICON_ERR}<span>${esc(msg)}</span>`; },
    wait(msg) { did.textContent = msg; },
  };
}

function setStatus(text) { $('status').textContent = text; }
function refreshUndo() { $('undo').disabled = !doc().canUndo(); }

// ---------- Xử lý một câu nói ----------
async function handle(raw) {
  const r = parseUtterance(raw, state.mode);
  if (!r) return;

  if (r.kind === 'confirm') {
    if (state.pending) return r.yes ? confirmPending() : cancelPending();
    return;
  }
  if (r.kind === 'undo') {
    const e = addEntry(raw, 'rule');
    try { await doc().undo(); e.ok(['Đã hoàn tác']); } catch (err) { e.err(err.message); }
    return refreshUndo();
  }
  if (r.kind === 'dictation') {
    const e = addEntry(raw, 'text');
    try {
      await doc().insertDictation(r.segments);
      e.ok([r.segments.filter(Boolean).join(' ↵ ') || '↵ Xuống dòng']);
    } catch (err) { e.err(err.message); }
    return refreshUndo();
  }
  if (r.kind === 'ops') return run(raw, r.ops, 'rule');
  if (r.kind === 'ai') return askAI(raw, r.text);
}

async function askAI(raw, text) {
  const e = addEntry(raw, 'ai');
  if (!settings.aiEnabled) return e.err('Chưa hiểu lệnh này. Bật “Dùng AI” trong Cài đặt để xử lý lệnh phức tạp.');
  if (!settings.serverUrl || !settings.token) return e.err('Chưa cấu hình máy chủ AI (Cài đặt → Địa chỉ máy chủ, Mã truy cập).');
  e.wait('Đang hỏi AI…');
  try {
    const context = await doc().readContext();
    const res = await fetch(`${settings.serverUrl.replace(/\/$/, '')}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}` },
      body: JSON.stringify({ utterance: text, context }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Máy chủ trả lỗi ${res.status}`);
    if (!body.ops?.length) return e.ok([body.message || 'AI không đề xuất thay đổi nào']);
    await run(raw, body.ops, 'ai', e, body.message);
  } catch (err) {
    e.err(err instanceof TypeError ? 'Không kết nối được máy chủ AI' : err.message);
  }
}

async function run(raw, ops, source, entry = addEntry(raw, source), message = '') {
  for (const op of ops) {
    const bad = word.validate(op);
    if (bad) return entry.err(bad);
  }
  if (ops.some(word.needsConfirm)) {
    state.pending = { ops, entry, message };
    $('confirm-list').innerHTML = ops.map((o) => `<li>${esc(word.describe(o))}</li>`).join('');
    $('confirm').hidden = false;
    entry.wait('Chờ xác nhận…');
    return;
  }
  await apply(ops, entry, message);
}

async function apply(ops, entry, message) {
  try {
    const notes = await doc().execute(ops);
    entry.ok([...(message ? [message] : []), ...ops.map(word.describe), ...notes]);
  } catch (err) {
    entry.err(err.message);
  }
  refreshUndo();
}

function confirmPending() {
  const p = state.pending;
  hideConfirm();
  if (p) apply(p.ops, p.entry, p.message);
}
function cancelPending() {
  state.pending?.entry.err('Đã hủy');
  hideConfirm();
}
function hideConfirm() { state.pending = null; $('confirm').hidden = true; }

// ---------- Giọng nói ----------
const recognizer = createRecognizer({
  lang: 'vi-VN',
  onInterim: (t) => { $('interim').textContent = t; },
  onFinal: (t) => { $('interim').textContent = ''; handle(t); },
  onState: (on) => {
    state.listening = on;
    $('mic').setAttribute('aria-pressed', String(on));
    $('mic').setAttribute('aria-label', on ? 'Dừng nghe' : 'Bắt đầu nghe');
    setStatus(on ? (state.mode === 'dictation' ? 'Đang nghe · đọc chữ' : 'Đang nghe · ra lệnh') : 'Nhấn micro để bắt đầu');
  },
  onError: (msg) => { setStatus(msg); $('mic').setAttribute('aria-pressed', 'false'); },
});

if (!recognizer.supported) {
  $('mic').disabled = true;
  setStatus('Môi trường này chưa hỗ trợ nhận giọng nói');
  $('interim').textContent = 'Dùng ô nhập bên dưới, hoặc mở Word trên trình duyệt Edge/Chrome.';
}

$('mic').addEventListener('click', () => (state.listening ? recognizer.stop() : recognizer.start()));

// ---------- Giao diện ----------
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  $('mode-hint').textContent = HINT[mode];
  $('typed-input').placeholder = mode === 'dictation' ? 'Hoặc gõ nội dung, ví dụ: kính gửi phụ huynh phẩy' : 'Hoặc gõ lệnh, ví dụ: in đậm câu vừa rồi';
  if (state.listening) setStatus(mode === 'dictation' ? 'Đang nghe · đọc chữ' : 'Đang nghe · ra lệnh');
}
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

$('typed').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('typed-input').value.trim();
  if (!v) return;
  $('typed-input').value = '';
  handle(v);
});
$('confirm-yes').addEventListener('click', confirmPending);
$('confirm-no').addEventListener('click', cancelPending);
$('undo').addEventListener('click', () => handle('hoàn tác'));
$('toggle-help').addEventListener('click', () => {
  const open = $('help').hidden;
  $('help').hidden = !open;
  $('toggle-help').setAttribute('aria-expanded', String(open));
});

// Cài đặt
$('open-settings').addEventListener('click', () => {
  $('ai-enabled').checked = settings.aiEnabled;
  $('server-url').value = settings.serverUrl;
  $('server-token').value = settings.token;
  $('server-status').textContent = '';
  $('settings').showModal();
});
$('settings-form').addEventListener('submit', () => {
  settings = { aiEnabled: $('ai-enabled').checked, serverUrl: $('server-url').value.trim(), token: $('server-token').value.trim() };
  saveSettings();
});
$('test-server').addEventListener('click', async () => {
  const url = $('server-url').value.trim().replace(/\/$/, '');
  $('server-status').textContent = 'Đang kiểm tra…';
  try {
    const res = await fetch(`${url}/health`);
    const body = await res.json();
    $('server-status').textContent = res.ok ? `Kết nối tốt · model ${body.model}` : `Lỗi ${res.status}`;
  } catch {
    $('server-status').textContent = 'Không kết nối được. Kiểm tra địa chỉ (phải là https) và cấu hình CORS của máy chủ.';
  }
});

setMode('dictation');

if (typeof Office === 'undefined') {
  $('host-note').textContent = 'Không tải được Office.js: hãy mở trong Word.';
} else Office.onReady((info) => {
  state.inWord = info.host === Office.HostType.Word;
  if (state.inWord && !Office.context.requirements.isSetSupported('WordApi', '1.3')) {
    $('host-note').textContent = 'Phiên bản Word này quá cũ (cần WordApi 1.3 trở lên).';
    state.inWord = false;
  } else {
    $('host-note').textContent = state.inWord ? 'Đã kết nối với tài liệu' : 'Đang xem thử ngoài Word: lệnh chỉ được hiển thị, chưa sửa tài liệu.';
  }
});
