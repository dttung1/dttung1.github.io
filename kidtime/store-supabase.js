// Adapter Supabase: cùng giao diện với store demo nhưng đồng bộ qua Postgres + Realtime.
// Bản prototype: laptop.html đăng nhập cùng tài khoản phụ huynh để đóng vai agent.
// Agent Windows thật sẽ dùng khóa thiết bị riêng (xem docs, mục Bảo mật).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { CONFIG } from './config.js';
import { defaultState, dayKey, emptyToday } from './model.js';

const IMPORTANT = ['locked', 'lockReason', 'app', 'parentLock', 'bedtimeOverrideUntil'];
const THROTTLE_MS = 4000;

const fail = (where) => ({ error }) => {
  if (!error) return;
  console.error(`[kidtime] ${where}`, error);
  window.dispatchEvent(new CustomEvent('kidtime-error', { detail: `Lỗi đồng bộ (${where}): ${error.message}` }));
};

function loginForm(sb) {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'kt-login';
    box.innerHTML = `
      <form>
        <h1>KidTime</h1>
        <p>Đăng nhập bằng email. Chúng tôi sẽ gửi đường dẫn đăng nhập.</p>
        <input type="email" required placeholder="email@vidu.com" autocomplete="email">
        <button type="submit">Gửi đường dẫn</button>
        <p class="kt-login-msg" role="status"></p>
      </form>`;
    document.body.append(box);
    const msg = box.querySelector('.kt-login-msg');
    box.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = box.querySelector('input').value.trim();
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } });
      msg.textContent = error ? error.message : 'Đã gửi. Mở email trên thiết bị này để đăng nhập.';
    });
    sb.auth.onAuthStateChange((_e, session) => { if (session) { box.remove(); resolve(session); } });
  });
}

const rowToReq = (r) => ({ id: r.id, minutes: r.minutes, reason: r.reason, status: r.status, grant: r.grant_min, at: Date.parse(r.created_at), respondedAt: r.responded_at && Date.parse(r.responded_at) });
const rowToAlert = (r) => ({ id: r.id, type: r.type, text: r.text, at: Date.parse(r.created_at) });
const rowToCmd = (r) => ({ id: r.id, type: r.type, payload: r.payload, status: r.status, at: Date.parse(r.created_at), doneAt: r.done_at && Date.parse(r.done_at) });
const iso = (t) => (t ? new Date(t).toISOString() : null);

export async function createSupabaseStore({ role = 'parent' } = {}) {
  const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
  let { data: { session } } = await sb.auth.getSession();
  if (!session) session = await loginForm(sb);

  // Lấy laptop đầu tiên của tài khoản; chưa có thì tạo từ dữ liệu mặc định.
  let { data: dev } = await sb.from('devices').select('*').order('created_at').limit(1).maybeSingle();
  if (!dev) {
    const d = defaultState();
    const { lastSeen, name, ...status } = d.device;
    ({ data: dev } = await sb.from('devices').insert({ name, child_name: d.child.name, status, last_seen: iso(lastSeen) }).select().single());
    const { version, ...policy } = d.policy;
    await sb.from('policies').insert({ device_id: dev.id, data: policy, version }).then(fail('tạo chính sách'));
  }
  const id = dev.id;

  const [pol, usage, reqs, alerts, cmds] = await Promise.all([
    sb.from('policies').select('*').eq('device_id', id).single(),
    sb.from('usage_daily').select('*').eq('device_id', id).gte('day', dayKey(new Date(Date.now() - 6 * 86400000))).order('day'),
    sb.from('time_requests').select('*').eq('device_id', id).order('created_at', { ascending: false }).limit(20),
    sb.from('alerts').select('*').eq('device_id', id).order('created_at', { ascending: false }).limit(30),
    sb.from('commands').select('*').eq('device_id', id).order('created_at', { ascending: false }).limit(20),
  ]);

  const today = dayKey();
  const usageRows = usage.data || [];
  const todayRow = usageRows.find((r) => r.day === today);
  let state = {
    v: 1,
    child: { name: dev.child_name },
    device: { name: dev.name, ...dev.status, lastSeen: Date.parse(dev.last_seen) || 0 },
    policy: { ...pol.data.data, version: pol.data.version },
    today: todayRow ? { ...emptyToday(today), ...todayRow.data, day: today } : emptyToday(today),
    history: usageRows.filter((r) => r.day !== today).map((r) => ({ day: r.day, used: r.data.used, study: r.data.study })),
    requests: (reqs.data || []).reverse().map(rowToReq),
    alerts: (alerts.data || []).reverse().map(rowToAlert),
    commands: (cmds.data || []).reverse().map(rowToCmd),
  };

  const subs = new Set();
  const emit = () => subs.forEach((fn) => fn(state));

  const upsertIn = (list, item) => {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item; else list.push(item);
  };

  // Agent là nguồn sự thật cho trạng thái thiết bị và thời gian dùng → bỏ qua tiếng vọng của chính nó.
  const owns = (table) => role === 'agent' && (table === 'devices' || table === 'usage_daily');
  const onChange = (table) => ({ new: row }) => {
    if (!row || owns(table)) return;
    if (table === 'devices') state.device = { name: row.name, ...row.status, lastSeen: Date.parse(row.last_seen) || 0 };
    if (table === 'policies') state.policy = { ...row.data, version: row.version };
    if (table === 'usage_daily') {
      if (row.day > state.today.day) {
        state.history = [...state.history, { day: state.today.day, used: state.today.used, study: state.today.study }].slice(-6);
        state.today = { ...emptyToday(row.day), ...row.data, day: row.day };
      } else if (row.day === state.today.day) {
        state.today = { ...state.today, ...row.data };
      }
    }
    if (table === 'time_requests') upsertIn(state.requests, rowToReq(row));
    if (table === 'alerts') upsertIn(state.alerts, rowToAlert(row));
    if (table === 'commands') upsertIn(state.commands, rowToCmd(row));
    state = { ...state };
    emit();
  };

  const ch = sb.channel(`kidtime-${id}`);
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: `id=eq.${id}` }, onChange('devices'));
  for (const t of ['policies', 'usage_daily', 'time_requests', 'alerts', 'commands']) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `device_id=eq.${id}` }, onChange(t));
  }
  ch.subscribe();

  // Ghi thay đổi. Trạng thái thiết bị & thời gian dùng được gộp mỗi vài giây, trừ khi có thay đổi quan trọng.
  let pending = { device: false, today: false };
  let timer = null;
  const writeDevice = () => {
    const { name, lastSeen, ...status } = state.device;
    return sb.from('devices').update({ status, last_seen: iso(lastSeen) }).eq('id', id).then(fail('trạng thái laptop'));
  };
  const writeToday = () => {
    const { day, ...data } = state.today;
    return sb.from('usage_daily').upsert({ device_id: id, day, data }).then(fail('thời gian dùng'));
  };
  const flush = async () => {
    timer = null;
    const p = pending;
    pending = { device: false, today: false };
    if (p.device) await writeDevice();
    if (p.today) await writeToday();
  };
  const later = (key) => { pending[key] = true; if (!timer) timer = setTimeout(flush, THROTTLE_MS); };

  function syncList(before, after, table, toRow) {
    const old = new Map(before.map((x) => [x.id, JSON.stringify(x)]));
    for (const item of after) {
      const prev = old.get(item.id);
      if (prev === JSON.stringify(item)) continue;
      const row = { id: item.id, device_id: id, ...toRow(item) };
      (prev ? sb.from(table).update(row).eq('id', item.id) : sb.from(table).insert(row)).then(fail(table));
    }
  }

  return {
    mode: 'cloud',
    offlineAfter: CONFIG.offlineAfterMs.cloud,
    speed: 1,
    get: () => state,
    subscribe(fn) { subs.add(fn); fn(state); return () => subs.delete(fn); },
    mutate(fn) {
      const before = structuredClone(state);
      fn(state);
      state = { ...state };
      emit();

      if (JSON.stringify(before.device) !== JSON.stringify(state.device)) {
        if (IMPORTANT.some((k) => before.device[k] !== state.device[k])) writeDevice(); else later('device');
      }
      if (JSON.stringify(before.today) !== JSON.stringify(state.today)) {
        if (before.today.bonus !== state.today.bonus || before.today.day !== state.today.day) writeToday(); else later('today');
      }
      if (JSON.stringify(before.policy) !== JSON.stringify(state.policy)) {
        const { version, ...data } = state.policy;
        sb.from('policies').update({ data, version, updated_at: iso(Date.now()) }).eq('device_id', id).then(fail('chính sách'));
      }
      syncList(before.requests, state.requests, 'time_requests', (r) => ({
        minutes: r.minutes, reason: r.reason, status: r.status, grant_min: r.grant ?? null, created_at: iso(r.at), responded_at: iso(r.respondedAt),
      }));
      syncList(before.alerts, state.alerts, 'alerts', (a) => ({ type: a.type, text: a.text, created_at: iso(a.at) }));
      syncList(before.commands, state.commands, 'commands', (c) => ({
        type: c.type, payload: c.payload || {}, status: c.status, created_at: iso(c.at), done_at: iso(c.doneAt),
      }));
    },
    async signOut() { await sb.auth.signOut(); location.reload(); },
  };
}
