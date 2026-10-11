// Mô hình dữ liệu và các phép tính dùng chung cho app phụ huynh và agent.

export const APPS = {
  word:      { name: 'Microsoft Word',  cat: 'study', color: '#2B579A' },
  olm:       { name: 'OLM.vn',          cat: 'study', color: '#0E9F6E' },
  vioedu:    { name: 'VioEdu',          cat: 'study', color: '#F59E0B' },
  teams:     { name: 'Microsoft Teams', cat: 'study', color: '#5B5FC7' },
  scratch:   { name: 'Scratch',         cat: 'study', color: '#F7931E' },
  youtube:   { name: 'YouTube',         cat: 'fun',   color: '#E11D48' },
  minecraft: { name: 'Minecraft',       cat: 'fun',   color: '#65A30D' },
  roblox:    { name: 'Roblox',          cat: 'fun',   color: '#374151' },
  tiktok:    { name: 'TikTok',          cat: 'fun',   color: '#111827' },
  paint:     { name: 'Paint',           cat: 'other', color: '#0EA5E9' },
  explorer:  { name: 'File Explorer',   cat: 'other', color: '#CA8A04' },
};

export const CATS = {
  study: { label: 'Học tập',  color: 'var(--study)' },
  fun:   { label: 'Giải trí', color: 'var(--fun)' },
  other: { label: 'Khác',     color: 'var(--other)' },
};

export const WEB_CATS = [
  { key: 'adult',    label: 'Nội dung người lớn', hint: 'Luôn nên chặn' },
  { key: 'gambling', label: 'Cờ bạc, cá cược' },
  { key: 'violence', label: 'Bạo lực, kinh dị' },
  { key: 'social',   label: 'Mạng xã hội', hint: 'Facebook, TikTok, Instagram' },
  { key: 'games',    label: 'Web game' },
  { key: 'proxy',    label: 'VPN, proxy vượt chặn', hint: 'Ngăn con tắt bộ lọc' },
];

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isWeekend(d = new Date()) {
  const w = d.getDay();
  return w === 0 || w === 6;
}

export function emptyToday(day = dayKey()) {
  return { day, used: 0, study: 0, bonus: 0, byApp: {}, warned: false, autoAsked: false };
}

export function defaultState() {
  const now = Date.now();
  const today = emptyToday();
  Object.assign(today, { used: 34, study: 25, byApp: { word: 25, youtube: 22, paint: 12 } });
  const history = [];
  const seed = [95, 130, 110, 160, 85, 120];
  for (let i = 6; i >= 1; i--) {
    const d = new Date(now - i * 86400000);
    const used = seed[6 - i];
    history.push({ day: dayKey(d), used, study: Math.round(used * 0.45) });
  }
  return {
    v: 1,
    child: { name: 'Minh' },
    device: {
      name: 'Laptop của Minh', os: 'Windows 11',
      lastSeen: now, app: 'word', appSince: now,
      parentLock: false, locked: false, lockReason: null, bedtimeOverrideUntil: null,
    },
    policy: {
      version: 1,
      limits: { weekday: 120, weekend: 180 },
      schedule: { start: '06:30', bedtime: '21:30' },
      study: { until: null, apps: ['word', 'olm', 'vioedu', 'teams', 'scratch'] },
      web: { adult: true, gambling: true, violence: true, social: true, games: false, proxy: true, safeSearch: true },
      blockedApps: ['roblox', 'tiktok'],
    },
    today,
    history,
    requests: [],
    alerts: [{ id: uid(), type: 'info', text: 'Laptop đã kết nối với KidTime', at: now - 3600000 }],
    commands: [],
  };
}

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export function inSchedule(schedule, d = new Date()) {
  const m = d.getHours() * 60 + d.getMinutes();
  const s = toMin(schedule.start), b = toMin(schedule.bedtime);
  return s <= b ? m >= s && m < b : m >= s || m < b;
}

export function limitToday(state, d = new Date()) {
  return isWeekend(d) ? state.policy.limits.weekend : state.policy.limits.weekday;
}

export function remaining(state) {
  return limitToday(state) + state.today.bonus - state.today.used;
}

export function studyOn(state, now = Date.now()) {
  return !!state.policy.study.until && state.policy.study.until > now;
}

// Trạng thái hiển thị theo thứ tự ưu tiên (xem docs, mục 3).
export function deriveStatus(state, { now = Date.now(), offlineAfter = 60000 } = {}) {
  const d = state.device;
  if (now - d.lastSeen > offlineAfter) return { code: 'offline', label: 'Ngoại tuyến', tone: 'muted' };
  if (d.locked) {
    const label = { parent: 'Đã khóa bởi bạn', bedtime: 'Ngoài giờ dùng máy', timeup: 'Đã hết giờ' }[d.lockReason] || 'Đã khóa';
    return { code: 'locked', reason: d.lockReason, label, tone: 'danger' };
  }
  if (studyOn(state, now)) return { code: 'study', label: 'Chế độ học', tone: 'study' };
  if (remaining(state) <= 10) return { code: 'warning', label: 'Sắp hết giờ', tone: 'warn' };
  return { code: 'active', label: 'Đang dùng máy', tone: 'ok' };
}

export function fmtMin(min) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} phút`;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

export function fmtShort(min) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}g${String(m).padStart(2, '0')}` : `${m}p`;
}

export function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'vừa xong';
  if (s < 60) return `${s} giây trước`;
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return new Date(ts).toLocaleDateString('vi-VN');
}

// Giới hạn độ dài các danh sách để state gọn.
export function trim(state) {
  state.alerts = state.alerts.slice(-30);
  state.commands = state.commands.slice(-20);
  state.requests = state.requests.slice(-20);
}
