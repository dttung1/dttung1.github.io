// Điều phối: giọng nói → hiểu lệnh (quy tắc hoặc AI) → xác nhận nếu cần → thực thi trong Word.
/* global Office */
import { parseUtterance } from './commands.js';
import * as word from './executor.js';
import { createWebSpeech, createAzureSpeech, createRelayListener, SOURCES } from './speech.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const HINT = {
  dictation: 'Nói nội dung để gõ. Nói “chấm”, “phẩy”, “xuống dòng” để chèn dấu. Bắt đầu bằng “Lệnh…” để ra lệnh.',
  command: 'Mọi câu nói được hiểu là lệnh định dạng hoặc yêu cầu soạn thảo.',
};

// ---------- Cài đặt (lưu trên máy này) ----------
const SETTINGS_KEY = 'voiceword.settings';
let settings = { aiEnabled: true, serverUrl: '', token: '', speechSource: 'auto' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); } catch { /* bỏ qua */ }
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* bỏ qua */ } };

const state = { mode: 'dictation', listening: false, pending: null, inWord: false, platform: 'Browser' };

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
const server = () => settings.serverUrl.replace(/\/$/, '');
const desktop = () => ['PC', 'Mac'].includes(state.platform);

// Nguồn thực sự dùng: "Tự động" → Word desktop dùng trang micro riêng (micro trong khung Word không chắc dùng được),
// Word trên web dùng nhận dạng của trình duyệt.
function effectiveSource() {
  if (settings.speechSource !== 'auto') return settings.speechSource;
  return desktop() && server() ? 'relay' : 'webspeech';
}

const listening = (on) => {
  state.listening = on;
  $('mic').setAttribute('aria-pressed', String(on));
  if (voice.source !== 'relay') $('mic').setAttribute('aria-label', on ? 'Dừng nghe' : 'Bắt đầu nghe');
  setStatus(on ? (state.mode === 'dictation' ? 'Đang nghe · đọc chữ' : 'Đang nghe · ra lệnh') : idleText());
};
const idleText = () => (voice.source === 'relay'
  ? (voice.connected ? 'Đã nối với trang micro · bật micro ở trang đó' : 'Nhấn để mở trang micro')
  : 'Nhấn micro để bắt đầu');

const common = {
  lang: 'vi-VN',
  onInterim: (t) => { $('interim').textContent = t; },
  onFinal: (t) => { $('interim').textContent = ''; handle(t); },
  onState: listening,
  onError: (msg) => { listening(false); setStatus(msg); },
};

async function fetchSpeechToken() {
  const res = await fetch(`${server()}/api/speech-token`, { headers: { Authorization: `Bearer ${settings.token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Không lấy được mã Azure Speech');
  return body;
}

// Phiên ghép với trang micro: lưu lại để mở lại Word không phải ghép lần nữa (hết hạn sau 12 giờ).
const PAIR_KEY = 'voiceword.pair';
function savedPair() {
  try {
    const p = JSON.parse(localStorage.getItem(PAIR_KEY));
    if (p && p.server === server() && p.expiresAt > Date.now() + 60000) return p;
  } catch { /* bỏ qua */ }
  return null;
}
async function newPair() {
  const res = await fetch(`${server()}/api/pair`, { method: 'POST', headers: { Authorization: `Bearer ${settings.token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Máy chủ trả lỗi ${res.status}`);
  const p = { ...body, server: server() };
  try { localStorage.setItem(PAIR_KEY, JSON.stringify(p)); } catch { /* bỏ qua */ }
  return p;
}

const voice = { source: null, rec: null, connected: false, pair: null };

function setupVoice() {
  voice.rec?.stop();
  voice.source = effectiveSource();
  voice.connected = false;
  $('mic').disabled = false;
  $('mic').classList.toggle('relay', voice.source === 'relay');
  $('interim').textContent = '';

  if (voice.source === 'relay') {
    $('mic').setAttribute('aria-label', 'Mở trang micro');
    if (!server() || !settings.token) {
      voice.rec = null;
      setStatus('Cần máy chủ để dùng trang micro');
      $('interim').textContent = 'Mở Cài đặt → nhập địa chỉ máy chủ và mã truy cập.';
      return;
    }
    voice.pair = savedPair();
    voice.rec = voice.pair ? listenRelay(voice.pair) : null;
    voice.rec?.start();
    setStatus(idleText());
    return;
  }

  voice.rec = voice.source === 'azure'
    ? (server() && settings.token ? createAzureSpeech({ ...common, getToken: fetchSpeechToken }) : { supported: false })
    : createWebSpeech(common);
  if (!voice.rec.supported) {
    $('mic').disabled = true;
    setStatus(voice.source === 'azure' ? 'Azure Speech cần máy chủ (Cài đặt)' : 'Môi trường này chưa hỗ trợ nhận giọng nói');
    $('interim').textContent = desktop() ? 'Trên Word desktop, chọn “Trang micro riêng” trong Cài đặt.' : 'Dùng ô nhập bên dưới.';
    return;
  }
  setStatus(idleText());
}

function listenRelay(pair) {
  return createRelayListener({
    serverUrl: server(),
    appToken: settings.token,
    pair: pair.pair,
    onInterim: common.onInterim,
    onFinal: common.onFinal,
    onMic: (on) => listening(on),
    onConnected: (on) => { voice.connected = on; if (!state.listening) setStatus(idleText()); },
    onError: (msg, fatal) => {
      setStatus(msg);
      if (fatal) { voice.pair = null; try { localStorage.removeItem(PAIR_KEY); } catch { /* bỏ qua */ } }
    },
  });
}

async function openMicPage() {
  try {
    if (!voice.pair) {
      setStatus('Đang tạo phiên ghép…');
      voice.pair = await newPair();
      voice.rec?.stop();
      voice.rec = listenRelay(voice.pair);
      voice.rec.start();
    }
    const url = new URL('mic.html', location.href);
    url.hash = new URLSearchParams({ s: server(), p: voice.pair.pair, k: voice.pair.key }).toString();
    // Word desktop: mở trình duyệt mặc định của Windows/Mac (nơi micro chắc chắn dùng được).
    if (typeof Office !== 'undefined' && Office.context?.ui?.openBrowserWindow) Office.context.ui.openBrowserWindow(url.href);
    else window.open(url.href, '_blank', 'noopener');
    setStatus('Đã mở trang micro trong trình duyệt');
  } catch (e) {
    setStatus(e instanceof TypeError ? 'Không kết nối được máy chủ' : e.message);
  }
}

$('mic').addEventListener('click', () => {
  if (voice.source === 'relay') return openMicPage();
  if (!voice.rec?.supported) return;
  if (state.listening) voice.rec.stop(); else voice.rec.start();
});

// Kiểm tra môi trường: micro có dùng được trong khung Word không, máy chủ có Azure Speech không.
async function diagnose() {
  const out = [];
  const add = (ok, text) => out.push({ ok, text });
  add(true, `Nền tảng: ${{ PC: 'Word trên Windows', Mac: 'Word trên Mac', OfficeOnline: 'Word trên web' }[state.platform] || 'Trình duyệt (xem thử)'}`);
  const hasWebSpeech = !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
  add(hasWebSpeech, `Nhận dạng của trình duyệt: ${hasWebSpeech ? 'có' : 'không có'}`);
  let micOk = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    micOk = true;
    add(true, 'Micro trong khung Word: dùng được');
  } catch (e) {
    add(false, `Micro trong khung Word: bị chặn (${e?.name || 'không hỗ trợ'})`);
  }
  let health = null;
  const url = $('server-url').value.trim().replace(/\/$/, '');
  if (url) {
    try {
      health = await fetch(`${url}/health`).then((r) => r.json());
      add(true, `Máy chủ: kết nối tốt · model ${health.model}`);
      add(!!health.speech, `Azure Speech trên máy chủ: ${health.speech ? 'đã cấu hình' : 'chưa cấu hình'}`);
    } catch { add(false, 'Máy chủ: không kết nối được (phải là https và cho phép CORS)'); }
  } else add(false, 'Máy chủ: chưa nhập địa chỉ');

  let tip;
  if (micOk && health?.speech) tip = ['azure', 'Nên chọn “Azure Speech trong Word”.'];
  else if (micOk && hasWebSpeech && state.platform === 'OfficeOnline') tip = ['webspeech', 'Nên chọn “Trình duyệt (Word bản web)”.'];
  else if (health) tip = ['relay', 'Nên chọn “Trang micro riêng”: micro chạy trong Edge/Chrome cạnh Word.'];
  else tip = [null, 'Cần cấu hình máy chủ để dùng giọng nói trên Word desktop. Tạm thời dùng ô nhập chữ.'];
  return { out, tip };
}

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
  $('speech-source').value = settings.speechSource;
  $('server-status').textContent = `Đang dùng: ${SOURCES[voice.source] || '—'}`;
  $('diag').hidden = true;
  $('settings').showModal();
});
$('settings-form').addEventListener('submit', () => {
  settings = {
    aiEnabled: $('ai-enabled').checked,
    serverUrl: $('server-url').value.trim(),
    token: $('server-token').value.trim(),
    speechSource: $('speech-source').value,
  };
  saveSettings();
  setupVoice();
});
$('test-server').addEventListener('click', async () => {
  $('server-status').textContent = 'Đang kiểm tra…';
  const { out, tip } = await diagnose();
  $('diag').innerHTML = out.map((r) => `<li class="${r.ok ? 'good' : 'bad'}">${esc(r.text)}</li>`).join('') + `<li class="tip">${esc(tip[1])}</li>`;
  $('diag').hidden = false;
  $('server-status').textContent = '';
  if (tip[0]) $('speech-source').value = tip[0];
});

setMode('dictation');

if (typeof Office === 'undefined') {
  $('host-note').textContent = 'Không tải được Office.js: hãy mở trong Word.';
  setupVoice();
} else Office.onReady((info) => {
  state.inWord = info.host === Office.HostType.Word;
  state.platform = Office.context?.diagnostics?.platform || 'Browser';
  setupVoice();
  if (state.inWord && !Office.context.requirements.isSetSupported('WordApi', '1.3')) {
    $('host-note').textContent = 'Phiên bản Word này quá cũ (cần WordApi 1.3 trở lên).';
    state.inWord = false;
  } else {
    $('host-note').textContent = state.inWord ? 'Đã kết nối với tài liệu' : 'Đang xem thử ngoài Word: lệnh chỉ được hiển thị, chưa sửa tài liệu.';
  }
});
