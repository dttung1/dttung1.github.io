// Laptop mô phỏng: đóng vai agent Windows để thử app phụ huynh realtime.
import { createStore, runSimulator } from './store.js';
import { createRequest } from './agent.js';
import { morph, esc } from './morph.js';
import { I } from './icons.js';
import { APPS, CATS, remaining, studyOn, fmtShort, fmtMin } from './model.js';

const store = await createStore({ role: 'agent' });
runSimulator(store, { priority: 2, auto: false });

const ui = { askMin: 30, reason: '' };
const root = document.getElementById('root');
let seen = null;
let seenReq = null;

const LOCK_TEXT = {
  parent: ['Bố mẹ đã tạm khóa máy', 'Hãy nghỉ ngơi một chút nhé.'],
  bedtime: ['Đến giờ nghỉ rồi', 'Laptop sẽ mở lại vào giờ được dùng máy.'],
  timeup: ['Hết thời gian hôm nay', 'Con có thể xin bố mẹ thêm giờ nếu cần làm bài.'],
};

function winToast(title, sub) {
  const el = document.createElement('div');
  el.className = 'wtoast';
  el.innerHTML = `<b>KidTime</b> · ${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
  document.body.append(el);
  setTimeout(() => el.remove(), 4000);
}

function notify(s) {
  if (!seen) { seen = new Set(s.alerts.map((a) => a.id)); seenReq = new Map(s.requests.map((r) => [r.id, r.status])); return; }
  for (const a of s.alerts) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    if (['warn', 'block', 'study', 'ok'].includes(a.type)) winToast(a.text);
  }
  for (const r of s.requests) {
    const prev = seenReq.get(r.id);
    if (prev === 'pending' && r.status !== 'pending') {
      winToast(r.status === 'approved' ? `Bố mẹ đã đồng ý thêm ${r.grant} phút` : 'Bố mẹ chưa đồng ý lần này', r.status === 'denied' ? 'Con thử lại sau nhé.' : '');
    }
    seenReq.set(r.id, r.status);
  }
}

function requestBlock(s) {
  const last = s.requests[s.requests.length - 1];
  if (last?.status === 'pending') {
    return `<div class="status">Đã gửi yêu cầu ${last.minutes} phút. Đang chờ bố mẹ trả lời…</div>`;
  }
  return `<form data-form="ask">
    <div class="seg">${[15, 30, 45].map((m) => `<button type="button" data-act="askmin" data-min="${m}" aria-pressed="${ui.askMin === m}">${m} phút</button>`).join('')}</div>
    <input name="reason" maxlength="120" placeholder="Lý do (ví dụ: con làm bài tập Toán)" value="${esc(ui.reason)}">
    <button class="btn primary block" type="submit">Xin thêm giờ</button>
  </form>`;
}

function render() {
  const s = store.get();
  const d = s.device;
  const study = studyOn(s);
  const left = remaining(s);
  const app = APPS[d.app];
  const clock = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const studyLeft = study ? ((s.policy.study.until - Date.now()) * store.speed) / 60000 : 0;
  const trayCls = study ? 'study' : left <= 10 ? 'warn' : '';
  const [lt, ls] = LOCK_TEXT[d.lockReason] || ['', ''];

  morph(root, `
  <div class="desk">
    <div class="note">Mô phỏng agent trên laptop Windows · ${store.mode === 'demo' ? 'đồng bộ với app phụ huynh ở tab khác' : 'đồng bộ cloud'} · 1 giây = ${store.speed} giây dùng máy</div>
    <div class="stage">
      <div class="win">
        <div class="bar">${app ? `<span class="tile" style="background:${app.color}">${esc(app.name[0])}</span>${esc(app.name)}` : ''}<span class="ctl">–▢✕</span></div>
        <div class="body">
          <h2>Xin chào ${esc(s.child.name)} 👋</h2>
          <div style="color:#555;font-size:14px">${study ? `Đang ở <b>chế độ học</b> (còn ${fmtMin(studyLeft)}). Chỉ mở được ứng dụng học tập.` : `Hôm nay còn <b>${fmtMin(left)}</b>. Chọn ứng dụng để mở:`}</div>
          <div class="apps">${Object.entries(APPS).map(([id, a]) => {
            const blocked = s.policy.blockedApps.includes(id);
            const off = study && !s.policy.study.apps.includes(id);
            return `<button data-act="open" data-id="${id}" aria-current="${d.app === id}" class="${blocked || off ? 'dim' : ''}">
              <span class="tile" style="background:${a.color}">${esc(a.name[0])}</span>${esc(a.name)}
              <span class="${blocked ? 'lockmark' : ''}" style="${blocked ? '' : 'color:#888'}">${blocked ? 'Bị chặn' : CATS[a.cat].label}</span></button>`;
          }).join('')}</div>
        </div>
      </div>
    </div>
    <div class="taskbar">
      <span class="start" aria-hidden="true"><i><b></b><b></b><b></b><b></b></i></span>
      <div class="tray">
        <button class="ask-btn" data-act="ask">Xin thêm giờ</button>
        <span class="kt ${trayCls}"><span class="dot"></span>${study ? `Học ${fmtShort(studyLeft)}` : `Còn ${fmtShort(left)}`}</span>
        <span class="clock">${clock}</span>
      </div>
    </div>
  </div>
  ${d.locked || ui.asking ? `
  <div class="lock" role="dialog" aria-modal="true">
    <div class="box">
      ${d.locked ? `${I.lock}<div class="big">${clock}</div><h2>${lt}</h2><p>${ls}</p>` : `<h2>Xin thêm thời gian</h2><p>Bố mẹ sẽ nhận được thông báo ngay trên điện thoại.</p>`}
      ${d.lockReason === 'parent' ? '' : requestBlock(s)}
      ${!d.locked ? '<button class="btn soft block" data-act="close" style="background:rgba(255,255,255,.1)">Đóng</button>' : ''}
    </div>
  </div>` : ''}`);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id, min } = el.dataset;
  if (act === 'open') store.mutate((s) => { if (s.device.app !== id) { s.device.app = id; s.device.appSince = Date.now(); } });
  if (act === 'askmin') ui.askMin = +min;
  if (act === 'ask') ui.asking = true;
  if (act === 'close') ui.asking = false;
  render();
});
document.addEventListener('input', (e) => { if (e.target.name === 'reason') ui.reason = e.target.value; });
document.addEventListener('submit', (e) => {
  if (e.target.dataset.form !== 'ask') return;
  e.preventDefault();
  store.mutate((s) => createRequest(s, ui.askMin, ui.reason.trim()));
  ui.reason = '';
  render();
});

store.subscribe((s) => { notify(s); render(); });
setInterval(render, 1000);
