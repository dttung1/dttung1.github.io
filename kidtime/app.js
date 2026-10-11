// App phụ huynh KidTime (PWA cho iPhone).
import { createStore, runSimulator } from './store.js';
import { morph, esc } from './morph.js';
import { I } from './icons.js';
import {
  APPS, CATS, WEB_CATS, uid, limitToday, remaining, studyOn, deriveStatus,
  fmtMin, fmtShort, timeAgo, isWeekend, dayKey,
} from './model.js';

const TABS = [
  { id: 'home', label: 'Tổng quan', icon: I.home },
  { id: 'time', label: 'Thời gian', icon: I.clock },
  { id: 'safe', label: 'An toàn', icon: I.shield },
  { id: 'report', label: 'Báo cáo', icon: I.chart },
];

const ui = { tab: 'home', sheet: null };
try { ui.tab = sessionStorage.getItem('kidtime.tab') || 'home'; } catch { /* bỏ qua */ }

const store = await createStore({ role: 'parent' });
if (store.mode === 'demo') runSimulator(store, { priority: 1, auto: true });

// ---------- Lệnh gửi tới laptop: theo dõi "Đang gửi…" → "Đã áp dụng" ----------
const pending = new Map(); // id → { label, at, type }

function send(type, payload, label) {
  const id = uid();
  store.mutate((s) => s.commands.push({ id, type, payload, status: 'sent', at: Date.now() }));
  pending.set(id, { label, at: Date.now(), type });
  setTimeout(() => {
    if (!pending.has(id)) return;
    pending.delete(id);
    toast('Laptop chưa phản hồi', 'Lệnh sẽ được áp dụng khi laptop online trở lại.', 'warn');
    render();
  }, 10000);
  render();
}

function checkAcks(s) {
  for (const [id, p] of pending) {
    const c = s.commands.find((x) => x.id === id);
    if (c?.status === 'done') {
      pending.delete(id);
      const secs = ((c.doneAt || Date.now()) - p.at) / 1000;
      toast(p.label, `Laptop xác nhận sau ${secs.toFixed(1).replace('.', ',')} giây`, 'ok');
    }
  }
}
const busy = (...types) => [...pending.values()].some((p) => types.includes(p.type));

// ---------- Thông báo realtime ----------
let seenAlerts = null;
let seenRequests = null;
function notifyNew(s) {
  if (!seenAlerts) {
    seenAlerts = new Set(s.alerts.map((a) => a.id));
    seenRequests = new Set(s.requests.map((r) => r.id));
    return;
  }
  for (const r of s.requests) {
    if (seenRequests.has(r.id)) continue;
    seenRequests.add(r.id);
    if (r.status === 'pending') toast(`${s.child.name} xin thêm ${r.minutes} phút`, r.reason || 'Chạm để duyệt', 'ask', () => setTab('home'));
  }
  for (const a of s.alerts) {
    if (seenAlerts.has(a.id)) continue;
    seenAlerts.add(a.id);
    if (['warn', 'block'].includes(a.type)) toast(a.text, s.device.name, a.type);
  }
}

const TOAST_IC = { ok: [I.check, 'var(--ok)'], warn: [I.alert, 'var(--warn)'], block: [I.ban, 'var(--danger)'], ask: [I.hand, 'var(--accent)'] };
function toast(title, sub, type = 'ok', onTap) {
  const root = document.getElementById('toasts');
  const el = document.createElement('div');
  const [ic, color] = TOAST_IC[type] || TOAST_IC.ok;
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="row-ic" style="color:${color};background:var(--fill)">${ic}</span>
    <div class="grow"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  el.addEventListener('click', () => { onTap?.(); close(); });
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  root.prepend(el);
  while (root.children.length > 3) root.lastChild.remove();
  setTimeout(close, 4200);
}
window.addEventListener('kidtime-error', (e) => toast('Không đồng bộ được', e.detail, 'warn'));

// ---------- Màn hình ----------
const tile = (id, size = 36) => {
  const a = APPS[id] || { name: id, color: '#64748B' };
  return `<span class="tile" style="background:${a.color};width:${size}px;height:${size}px">${esc(a.name[0])}</span>`;
};
const sw = (on, act, attrs = '', cls = '') =>
  `<button class="switch ${cls}" role="switch" aria-checked="${on}" data-act="${act}" ${attrs}></button>`;
const now = () => Date.now();

function header(s) {
  const t = TABS.find((x) => x.id === ui.tab);
  const title = ui.tab === 'home' ? esc(s.child.name) : t.label;
  const sub = ui.tab === 'home' ? `${esc(s.device.name)} · ${esc(s.device.os || 'Windows')}` : esc(s.device.name);
  return `<header class="topbar">
    ${ui.tab === 'home' ? `<div class="avatar" aria-hidden="true">${esc(s.child.name[0])}</div>` : ''}
    <div class="title"><h1>${title}</h1><div class="sub">${sub}</div></div>
    <button class="icon-btn" data-act="sheet" data-sheet="settings" aria-label="Cài đặt">${I.gear}</button>
  </header>`;
}

function requestCard(s, r) {
  const alt = r.minutes === 15 ? 30 : 15;
  return `<div class="card request" data-key="req-${r.id}">
    <div class="who"><div class="avatar" style="width:36px;height:36px;font-size:15px" aria-hidden="true">${esc(s.child.name[0])}</div>
      <div>${esc(s.child.name)} xin thêm ${r.minutes} phút<small>${timeAgo(r.at)}</small></div></div>
    ${r.reason ? `<q>${esc(r.reason)}</q>` : '<div style="height:12px"></div>'}
    <div class="row">
      <button class="btn soft small" data-act="deny" data-id="${r.id}">Từ chối</button>
      <button class="btn soft small" data-act="approve" data-id="${r.id}" data-min="${alt}">+${alt} phút</button>
      <button class="btn primary small" data-act="approve" data-id="${r.id}" data-min="${r.minutes}">Đồng ý</button>
    </div>
  </div>`;
}

function homeView(s) {
  const st = deriveStatus(s, { offlineAfter: store.offlineAfter });
  const online = st.code !== 'offline';
  const study = studyOn(s);
  const total = limitToday(s) + s.today.bonus;
  const left = remaining(s);
  const studyLeft = study ? ((s.policy.study.until - now()) * store.speed) / 60000 : 0;
  const frac = study ? Math.min(1, studyLeft / (s.policy.study.total || 60)) : Math.max(0, Math.min(1, left / Math.max(total, 1)));
  const C = 2 * Math.PI * 54;
  const tone = `tone-${st.tone}`;
  const app = APPS[s.device.app];

  let center;
  if (st.code === 'locked') center = `${I.lock}<div class="small">Đã khóa</div>`;
  else if (study) center = `<div class="big num">${fmtShort(studyLeft)}</div><div class="small">học còn lại</div>`;
  else center = `<div class="big num">${fmtShort(left)}</div><div class="small">còn lại</div>`;

  const lockedBusy = busy('lock', 'unlock');
  let main;
  if (lockedBusy) main = `<button class="btn soft block" disabled><span class="spin"></span>Đang gửi tới laptop…</button>`;
  else if (st.code === 'locked' && st.reason === 'parent') main = `<button class="btn success block" data-act="unlock">${I.unlock}Mở khóa</button>`;
  else if (st.code === 'locked' && st.reason === 'timeup') main = `<button class="btn primary block" data-act="sheet" data-sheet="add">${I.plus}Thêm giờ để mở khóa</button>`;
  else if (st.code === 'locked' && st.reason === 'bedtime') main = `<button class="btn soft block" data-act="unlock" data-min="30">${I.moon}Cho dùng thêm 30 phút</button>`;
  else main = `<button class="btn danger block" data-act="lock">${I.lock}Khóa máy ngay</button>`;

  const pendingReqs = s.requests.filter((r) => r.status === 'pending');
  const feed = s.alerts.slice(-6).reverse();
  const FEED_IC = { warn: [I.alert, 'var(--warn)'], block: [I.ban, 'var(--danger)'], lock: [I.lock, 'var(--danger)'], ok: [I.check, 'var(--ok)'], study: [I.book, 'var(--study)'], info: [I.info, 'var(--accent)'] };

  return `
    ${store.mode === 'demo' ? `<div class="demo"><span><b>Demo</b> · 1 giây = 1 phút</span><a href="laptop.html" target="_blank" rel="noopener">Mở laptop mô phỏng ›</a></div>` : ''}
    ${pendingReqs.map((r) => requestCard(s, r)).join('')}
    <section class="card ${tone}" aria-live="polite">
      <div class="hero">
        <div class="ring" role="img" aria-label="${esc(st.label)}">
          <svg viewBox="0 0 132 132"><circle class="track" cx="66" cy="66" r="54"/>
            <circle class="val" cx="66" cy="66" r="54" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - (st.code === 'locked' ? 1 : frac))).toFixed(1)}"/></svg>
          <div class="center">${center}</div>
        </div>
        <div>
          <span class="pill"><span class="dot ${online ? 'live' : ''}"></span>${online ? 'Trực tuyến' : 'Ngoại tuyến'}</span>
          <h2>${esc(st.label)}</h2>
          <div class="meta">
            <div class="num">Đã dùng ${fmtShort(s.today.used)} / ${fmtShort(total)}</div>
            ${s.today.bonus ? `<div>Gồm ${fmtShort(s.today.bonus)} thưởng thêm</div>` : ''}
            <div>Cập nhật ${timeAgo(s.device.lastSeen)}</div>
          </div>
        </div>
      </div>
      <div class="now">
        ${online && !s.device.locked && app ? tile(s.device.app) : `<span class="row-ic" style="background:var(--fill);color:var(--text2);width:36px;height:36px;border-radius:9px">${s.device.locked ? I.lock : I.laptop}</span>`}
        <div class="grow">
          <div class="label">${online ? (s.device.locked ? 'Trên laptop' : 'Đang dùng') : 'Lần cuối online'}</div>
          <div class="name">${!online ? timeAgo(s.device.lastSeen) : s.device.locked ? 'Màn hình khóa đang hiển thị' : esc(app?.name || '—')}</div>
        </div>
        ${online && !s.device.locked && app ? `<span class="chip ${app.cat}">${CATS[app.cat].label}</span><span class="value num" style="font-size:14px;color:var(--text2)">${fmtShort((now() - s.device.appSince) * store.speed / 60000)}</span>` : ''}
      </div>
    </section>

    <div class="main-action">${main}</div>
    <div class="quick">
      <button data-act="add" data-min="15" ${busy('add_time') ? 'disabled' : ''}><span class="ic">${I.plus}</span>+15 phút</button>
      <button data-act="add" data-min="30" ${busy('add_time') ? 'disabled' : ''}><span class="ic">${I.plus}</span>+30 phút</button>
      ${study
        ? `<button data-act="study-stop" ${busy('study_stop') ? 'disabled' : ''}><span class="ic study">${I.book}</span>Tắt chế độ học</button>`
        : `<button data-act="sheet" data-sheet="study" ${busy('study_start') ? 'disabled' : ''}><span class="ic study">${I.book}</span>Chế độ học</button>`}
    </div>

    <div class="section-title">Hoạt động gần đây</div>
    <div class="list feed">
      ${feed.length ? feed.map((a) => {
        const [ic, c] = FEED_IC[a.type] || FEED_IC.info;
        return `<div class="row" data-key="a-${a.id}"><span class="row-ic" style="color:${c};background:var(--fill)">${ic}</span>
          <div class="grow">${esc(a.text)}<div class="when">${timeAgo(a.at)}</div></div></div>`;
      }).join('') : '<div class="empty">Chưa có hoạt động</div>'}
    </div>`;
}

function timeView(s) {
  const p = s.policy;
  const study = studyOn(s);
  const stepper = (key) => `<div class="stepper">
      <button data-act="limit" data-key="${key}" data-d="-15" aria-label="Bớt 15 phút">−</button>
      <span class="num">${fmtShort(p.limits[key])}</span>
      <button data-act="limit" data-key="${key}" data-d="15" aria-label="Thêm 15 phút">+</button></div>`;
  return `
    <div class="section-title">Giới hạn mỗi ngày</div>
    <div class="list">
      <div class="row"><div class="grow">Ngày thường<div class="hint">Thứ 2 – Thứ 6${!isWeekend() ? ' · hôm nay' : ''}</div></div>${stepper('weekday')}</div>
      <div class="row"><div class="grow">Cuối tuần<div class="hint">Thứ 7, Chủ nhật${isWeekend() ? ' · hôm nay' : ''}</div></div>${stepper('weekend')}</div>
    </div>
    <div class="section-foot">Chỉ tính lúc con thực sự dùng máy. Laptop cảnh báo trước 10 phút rồi tự khóa.</div>

    <div class="section-title">Lịch dùng máy</div>
    <div class="list">
      <div class="row"><span class="row-ic" style="background:var(--accent-soft);color:var(--accent)">${I.clock}</span>
        <label class="grow" for="t-start">Được dùng từ</label><input id="t-start" type="time" value="${p.schedule.start}" data-field="start"></div>
      <div class="row"><span class="row-ic" style="background:var(--study-soft);color:var(--study)">${I.moon}</span>
        <label class="grow" for="t-bed">Giờ đi ngủ</label><input id="t-bed" type="time" value="${p.schedule.bedtime}" data-field="bedtime"></div>
    </div>
    <div class="section-foot">Ngoài khung giờ này laptop tự khóa, kể cả khi mất mạng.</div>

    <div class="section-title">Chế độ học</div>
    <div class="card pad tone-study">
      ${study
        ? `<span class="pill"><span class="dot live"></span>Đang bật</span>
           <div style="margin-bottom:12px">Còn ${fmtMin(((p.study.until - now()) * store.speed) / 60000)}. Chỉ mở được ứng dụng trong danh sách dưới đây, không trừ vào giờ giải trí.</div>
           <button class="btn soft block" data-act="study-stop">Tắt chế độ học</button>`
        : `<div style="margin-bottom:12px;color:var(--text2);font-size:15px">Chỉ cho mở ứng dụng học tập. Thời gian học không trừ vào giờ giải trí.</div>
           <div class="chips">${[30, 60, 90].map((m) => `<button class="btn study small" data-act="study-start" data-min="${m}">${m} phút</button>`).join('')}</div>`}
    </div>
    <div class="section-title">Được dùng khi học</div>
    <div class="list">
      ${Object.entries(APPS).filter(([id]) => !p.blockedApps.includes(id)).map(([id, a]) => `
        <div class="row has-tile">${tile(id, 32)}<div class="grow">${esc(a.name)}<div class="hint">${CATS[a.cat].label}</div></div>
        ${sw(p.study.apps.includes(id), 'study-app', `data-id="${id}" aria-label="Cho dùng ${esc(a.name)} khi học"`)}</div>`).join('')}
    </div>`;
}

function safeView(s) {
  const p = s.policy;
  return `
    <div class="section-title">Lọc trang web</div>
    <div class="list">
      ${WEB_CATS.map((c) => `<div class="row"><span class="row-ic" style="background:var(--danger-soft);color:var(--danger)">${I.globe}</span>
        <div class="grow">${c.label}${c.hint ? `<div class="hint">${c.hint}</div>` : ''}</div>
        ${sw(!!p.web[c.key], 'web', `data-key="${c.key}" aria-label="Chặn ${c.label}"`, 'red')}</div>`).join('')}
    </div>
    <div class="section-foot">Bật = chặn. Áp dụng cho mọi trình duyệt trên laptop.</div>

    <div class="section-title">Tìm kiếm</div>
    <div class="list">
      <div class="row"><span class="row-ic" style="background:var(--ok-soft);color:var(--ok)">${I.search}</span>
        <div class="grow">Tìm kiếm an toàn<div class="hint">Google, Bing, YouTube chế độ hạn chế</div></div>
        ${sw(!!p.web.safeSearch, 'web', 'data-key="safeSearch" aria-label="Tìm kiếm an toàn"')}</div>
    </div>

    <div class="section-title">Ứng dụng bị chặn</div>
    <div class="list">
      ${Object.entries(APPS).map(([id, a]) => `
        <div class="row has-tile">${tile(id, 32)}<div class="grow">${esc(a.name)}<div class="hint">${CATS[a.cat].label}</div></div>
        ${sw(p.blockedApps.includes(id), 'block-app', `data-id="${id}" aria-label="Chặn ${esc(a.name)}"`, 'red')}</div>`).join('')}
    </div>
    <div class="section-foot">Ứng dụng bị chặn sẽ tự đóng trong vài giây và bạn nhận được thông báo.</div>`;
}

function reportView(s) {
  const t = s.today;
  const byCat = { study: 0, fun: 0, other: 0 };
  for (const [id, m] of Object.entries(t.byApp)) byCat[APPS[id]?.cat || 'other'] += m;
  const total = byCat.study + byCat.fun + byCat.other;
  const top = Object.entries(t.byApp).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = top[0]?.[1] || 1;
  const days = [...s.history.slice(-6), { day: t.day, used: t.used, study: t.study }];
  const peak = Math.max(...days.map((d) => d.used + d.study), 60);
  const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const today = dayKey();

  return `
    <div class="section-title">Hôm nay</div>
    <div class="stat-row">
      <div class="stat"><div class="k">Tổng</div><div class="v num">${fmtShort(total)}</div></div>
      <div class="stat"><div class="k"><span class="sw" style="background:var(--study)"></span>Học</div><div class="v num">${fmtShort(byCat.study)}</div></div>
      <div class="stat"><div class="k"><span class="sw" style="background:var(--fun)"></span>Giải trí</div><div class="v num">${fmtShort(byCat.fun)}</div></div>
    </div>
    <div class="card pad" style="margin-top:10px">
      <div style="display:flex;justify-content:space-between;font-size:15px"><span>Phân bổ thời gian</span><span class="num" style="color:var(--text2)">${total ? Math.round((byCat.study / total) * 100) : 0}% học tập</span></div>
      <div class="split" role="img" aria-label="Học ${fmtMin(byCat.study)}, giải trí ${fmtMin(byCat.fun)}, khác ${fmtMin(byCat.other)}">
        ${['study', 'fun', 'other'].map((k) => (byCat[k] ? `<span style="width:${(byCat[k] / total) * 100}%;background:${CATS[k].color}"></span>` : '')).join('')}
      </div>
      <div class="legend" style="padding:10px 0 0">${['study', 'fun', 'other'].map((k) => `<span><span class="sw" style="background:${CATS[k].color}"></span>${CATS[k].label} ${fmtShort(byCat[k])}</span>`).join('')}</div>
    </div>

    <div class="section-title">Dùng nhiều nhất</div>
    <div class="list">
      ${top.length ? top.map(([id, m]) => `<div class="bar-row" data-key="top-${id}">${tile(id)}
        <div><div class="name">${esc(APPS[id]?.name || id)}</div><div class="bar"><i style="width:${(m / max) * 100}%;background:${CATS[APPS[id]?.cat || 'other'].color}"></i></div></div>
        <span class="num" style="color:var(--text2);font-size:15px">${fmtShort(m)}</span></div>`).join('') : '<div class="empty">Chưa có dữ liệu hôm nay</div>'}
    </div>

    <div class="section-title">7 ngày qua</div>
    <div class="card">
      <div class="week">${days.map((d) => {
        const [y, mo, da] = d.day.split('-').map(Number);
        const dow = DOW[new Date(y, mo - 1, da).getDay()];
        const h = (v) => `${(v / peak) * 120}px`;
        return `<div class="col"><span class="tot num">${fmtShort(d.used + d.study)}</span>
          <div class="stack"><span style="height:${h(d.study)};background:var(--study)"></span><span style="height:${h(d.used)};background:var(--fun)"></span></div>
          <span class="lbl ${d.day === today ? 'today' : ''}">${d.day === today ? 'Nay' : dow}</span></div>`;
      }).join('')}</div>
      <div class="legend"><span><span class="sw" style="background:var(--study)"></span>Chế độ học</span><span><span class="sw" style="background:var(--fun)"></span>Tính vào giới hạn</span></div>
    </div>`;
}

function sheetView(s) {
  if (!ui.sheet) return '';
  let body = '';
  if (ui.sheet === 'add') {
    body = `<h3>Thêm thời gian</h3><p>Thêm vào quỹ hôm nay của ${esc(s.child.name)}. Laptop mở khóa ngay nếu đang hết giờ.</p>
      <div class="grid2">${[15, 30, 45, 60].map((m) => `<button class="btn primary" data-act="add" data-min="${m}">+${m} phút</button>`).join('')}</div>`;
  } else if (ui.sheet === 'study') {
    body = `<h3>Bật chế độ học</h3><p>Chỉ mở được ${s.policy.study.apps.length} ứng dụng học tập. Không trừ vào giờ giải trí.</p>
      <div class="grid2">${[30, 45, 60, 90].map((m) => `<button class="btn study" data-act="study-start" data-min="${m}">${m} phút</button>`).join('')}</div>`;
  } else if (ui.sheet === 'settings') {
    body = `<h3>Cài đặt</h3>
      <p>${store.mode === 'demo' ? 'Đang chạy chế độ demo: dữ liệu lưu trên thiết bị này, laptop được mô phỏng.' : 'Đang đồng bộ realtime qua cloud.'}</p>
      <div class="list" style="margin-bottom:12px">
        <div class="row"><div class="grow">Tên con</div><span class="value">${esc(s.child.name)}</span></div>
        <div class="row"><div class="grow">Laptop</div><span class="value">${esc(s.device.name)}</span></div>
        <div class="row"><div class="grow">Phiên bản chính sách</div><span class="value num">v${s.policy.version}</span></div>
      </div>
      <div class="card pad" style="margin-bottom:12px"><b style="font-size:15px">Cài lên màn hình chính iPhone</b>
        <ol style="margin-top:8px"><li>Mở trang này bằng Safari</li><li>Chạm nút Chia sẻ</li><li>Chọn “Thêm vào MH chính”</li></ol></div>
      ${store.mode === 'demo'
        ? `<a class="btn soft block" href="laptop.html" target="_blank" rel="noopener" style="text-decoration:none;margin-bottom:10px">${I.laptop}Mở laptop mô phỏng</a>
           <button class="btn soft block" data-act="reset" style="color:var(--danger)">Đặt lại dữ liệu demo</button>`
        : '<button class="btn soft block" data-act="signout" style="color:var(--danger)">Đăng xuất</button>'}`;
  }
  return `<div class="scrim" data-act="close"></div>
    <div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>${body}
    <button class="btn soft block cancel" data-act="close">Đóng</button></div>`;
}

function tabbar(s) {
  const n = s.requests.filter((r) => r.status === 'pending').length;
  return `<nav class="tabbar" aria-label="Điều hướng"><div class="inner">${TABS.map((t) => `
    <button data-act="tab" data-tab="${t.id}" ${ui.tab === t.id ? 'aria-current="page"' : ''}>${t.icon}${t.label}
      ${t.id === 'home' && n ? `<span class="badge">${n}</span>` : ''}</button>`).join('')}</div></nav>`;
}

const VIEWS = { home: homeView, time: timeView, safe: safeView, report: reportView };
const root = document.getElementById('app');
const sheetRoot = document.getElementById('sheet');

function render() {
  const s = store.get();
  morph(root, `${header(s)}<main id="view">${VIEWS[ui.tab](s)}</main>${tabbar(s)}`);
  morph(sheetRoot, sheetView(s));
}

// ---------- Hành động ----------
function setTab(tab) {
  ui.tab = tab;
  try { sessionStorage.setItem('kidtime.tab', tab); } catch { /* bỏ qua */ }
  render();
  window.scrollTo({ top: 0 });
}

function policy(fn, msg = 'Đã lưu · laptop áp dụng ngay') {
  store.mutate((s) => { fn(s.policy); s.policy.version++; });
  toast(msg, null, 'ok');
}

const toggleIn = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

const ACTIONS = {
  tab: (d) => setTab(d.tab),
  sheet: (d) => { ui.sheet = d.sheet; render(); },
  close: () => { ui.sheet = null; render(); },
  lock: () => send('lock', {}, 'Đã khóa laptop'),
  unlock: (d) => send('unlock', d.min ? { minutes: +d.min } : {}, 'Đã mở khóa laptop'),
  add: (d) => { ui.sheet = null; send('add_time', { minutes: +d.min }, `Đã thêm ${d.min} phút`); },
  'study-start': (d) => { ui.sheet = null; send('study_start', { minutes: +d.min }, `Đã bật chế độ học ${d.min} phút`); },
  'study-stop': () => send('study_stop', {}, 'Đã tắt chế độ học'),
  approve: (d) => {
    const m = +d.min;
    store.mutate((s) => {
      const r = s.requests.find((x) => x.id === d.id);
      if (r) Object.assign(r, { status: 'approved', grant: m, respondedAt: Date.now() });
    });
    send('add_time', { minutes: m }, `Đã đồng ý thêm ${m} phút`);
  },
  deny: (d) => {
    store.mutate((s) => {
      const r = s.requests.find((x) => x.id === d.id);
      if (r) Object.assign(r, { status: 'denied', respondedAt: Date.now() });
    });
    toast('Đã từ chối yêu cầu', `${store.get().child.name} sẽ thấy thông báo trên laptop`, 'ok');
  },
  limit: (d) => policy((p) => { p.limits[d.key] = Math.min(480, Math.max(15, p.limits[d.key] + +d.d)); }),
  web: (d) => policy((p) => { p.web[d.key] = !p.web[d.key]; }),
  'block-app': (d) => policy((p) => {
    p.blockedApps = toggleIn(p.blockedApps, d.id);
    p.study.apps = p.study.apps.filter((x) => !p.blockedApps.includes(x));
  }),
  'study-app': (d) => policy((p) => { p.study.apps = toggleIn(p.study.apps, d.id); }),
  reset: () => { ui.sheet = null; store.reset(); seenAlerts = null; toast('Đã đặt lại demo', null, 'ok'); },
  signout: () => store.signOut(),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el.dataset); }
});
document.addEventListener('change', (e) => {
  const f = e.target.dataset?.field;
  if (f && e.target.value) policy((p) => { p.schedule[f] = e.target.value; });
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.sheet) ACTIONS.close(); });

store.subscribe((s) => { checkAcks(s); notifyNew(s); render(); });
setInterval(render, 1000); // làm mới "x giây trước" và trạng thái online/offline

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
