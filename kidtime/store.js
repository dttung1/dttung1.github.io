// Lớp dữ liệu realtime. Giao diện chung cho cả demo và Supabase:
//   get() · subscribe(fn) · mutate(fn) · mode · offlineAfter
// Demo: localStorage + BroadcastChannel → mọi tab cùng thiết bị thấy thay đổi ngay.
import { CONFIG } from './config.js';
import { defaultState, uid } from './model.js';
import { agentStep, rollDay } from './agent.js';

const KEY = 'kidtime.demo.v1';
const LEADER_KEY = 'kidtime.leader';

function createDemoStore() {
  let mem = null;
  const read = () => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.v === 1) return s;
    } catch { /* bộ nhớ trình duyệt bị chặn → dùng bản trong RAM */ }
    return mem || defaultState();
  };
  const write = (s) => {
    mem = s;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* bỏ qua */ }
  };

  let state = read();
  rollDay(state);
  const subs = new Set();
  const emit = () => subs.forEach((fn) => fn(state));
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('kidtime') : null;

  channel?.addEventListener('message', (e) => { if (e.data?.v === 1) { state = e.data; mem = state; emit(); } });
  window.addEventListener('storage', (e) => { if (e.key === KEY) { state = read(); emit(); } });

  return {
    mode: 'demo',
    offlineAfter: CONFIG.offlineAfterMs.demo,
    speed: CONFIG.demoSpeed,
    get: () => state,
    subscribe(fn) { subs.add(fn); fn(state); return () => subs.delete(fn); },
    mutate(fn) {
      state = read();
      fn(state);
      write(state);
      channel?.postMessage(state);
      emit();
    },
    reset() {
      state = defaultState();
      write(state);
      channel?.postMessage(state);
      emit();
    },
  };
}

export async function createStore(opts = {}) {
  if (CONFIG.supabaseUrl && CONFIG.supabaseAnonKey) {
    const { createSupabaseStore } = await import('./store-supabase.js');
    return createSupabaseStore(opts);
  }
  return createDemoStore();
}

// Chạy agent mô phỏng. Chỉ một tab làm "laptop" tại một thời điểm:
// laptop.html (ưu tiên 2) giành quyền trước app phụ huynh (ưu tiên 1).
export function runSimulator(store, { priority = 1, auto = true } = {}) {
  const me = { id: uid(), priority };
  let last = Date.now();
  const amLeader = () => {
    const now = Date.now();
    let cur = null;
    try { cur = JSON.parse(localStorage.getItem(LEADER_KEY)); } catch { return true; }
    const stale = !cur || now - cur.at > 2500;
    if (stale || cur.id === me.id || me.priority > cur.priority) {
      try { localStorage.setItem(LEADER_KEY, JSON.stringify({ ...me, at: now })); } catch { /* bỏ qua */ }
      return true;
    }
    return false;
  };
  const tick = () => {
    const now = Date.now();
    const dtMs = Math.min(now - last, 3000);
    last = now;
    if (!amLeader()) return;
    store.mutate((s) => agentStep(s, { now, dtMs, speed: store.speed || 1, auto }));
  };
  const timer = setInterval(tick, 1000);
  tick();
  return () => clearInterval(timer);
}
