// Logic agent (bản mô phỏng). Agent Windows thật (C# service) sẽ làm đúng các bước này:
// nhận lệnh → áp dụng → ack; đếm thời gian; tự khóa theo máy trạng thái; gửi cảnh báo.
import { APPS, uid, dayKey, emptyToday, inSchedule, remaining, studyOn, trim } from './model.js';

const REASON_TEXT = {
  parent: 'Laptop đã khóa theo yêu cầu của bạn',
  bedtime: 'Laptop tự khóa: ngoài giờ dùng máy',
  timeup: 'Laptop tự khóa: đã hết thời gian hôm nay',
};

function alert(state, type, text, now) {
  state.alerts.push({ id: uid(), type, text, at: now });
}

// Thời lượng tính bằng "phút sử dụng" → mili giây thật (demo chạy nhanh hơn speed lần).
const durMs = (minutes, speed) => (minutes * 60000) / speed;

export function rollDay(state, now = Date.now()) {
  const day = dayKey(new Date(now));
  if (state.today.day === day) return;
  state.history.push({ day: state.today.day, used: Math.round(state.today.used), study: Math.round(state.today.study) });
  state.history = state.history.slice(-6);
  state.today = emptyToday(day);
}

export function processCommands(state, { now = Date.now(), speed = 1 } = {}) {
  for (const c of state.commands) {
    if (c.status !== 'sent') continue;
    const m = c.payload?.minutes || 0;
    switch (c.type) {
      case 'lock':
        state.device.parentLock = true;
        break;
      case 'unlock':
        state.device.parentLock = false;
        if (state.device.lockReason === 'bedtime') state.device.bedtimeOverrideUntil = now + durMs(m || 30, speed);
        if (m && state.device.lockReason === 'timeup') state.today.bonus += m;
        alert(state, 'ok', 'Laptop đã được mở khóa', now);
        break;
      case 'add_time':
        state.today.bonus += m;
        state.today.warned = false;
        alert(state, 'ok', `Đã thêm ${m} phút cho hôm nay`, now);
        break;
      case 'study_start':
        state.policy.study.until = now + durMs(m, speed);
        state.policy.study.total = m;
        state.policy.version++;
        alert(state, 'study', `Bắt đầu chế độ học ${m} phút`, now);
        break;
      case 'study_stop':
        state.policy.study.until = null;
        state.policy.version++;
        alert(state, 'study', 'Đã tắt chế độ học', now);
        break;
    }
    c.status = 'done';
    c.doneAt = now;
  }
}

function pickApp(state, onlyStudy) {
  const pool = Object.keys(APPS).filter((id) =>
    onlyStudy ? state.policy.study.apps.includes(id) : !state.policy.blockedApps.includes(id) || Math.random() < 0.15);
  return pool[Math.floor(Math.random() * pool.length)] || 'word';
}

// Một nhịp của agent. dtMs: thời gian thật đã trôi qua. auto: tự đổi app & tự xin giờ (khi không có laptop.html mở).
export function agentStep(state, { now = Date.now(), dtMs = 1000, speed = 1, auto = false } = {}) {
  rollDay(state, now);
  processCommands(state, { now, speed });
  const d = state.device;

  if (state.policy.study.until && state.policy.study.until <= now) {
    state.policy.study.until = null;
    state.policy.version++;
    alert(state, 'study', 'Chế độ học đã kết thúc', now);
  }
  const study = studyOn(state, now);
  const override = d.bedtimeOverrideUntil && d.bedtimeOverrideUntil > now;

  let reason = null;
  if (d.parentLock) reason = 'parent';
  else if (!inSchedule(state.policy.schedule, new Date(now)) && !override) reason = 'bedtime';
  else if (!study && remaining(state) <= 0) reason = 'timeup';

  if (reason !== d.lockReason) {
    if (reason) alert(state, reason === 'parent' ? 'lock' : 'warn', REASON_TEXT[reason], now);
    d.lockReason = reason;
    d.locked = !!reason;
  }

  if (!d.locked) {
    // Chặn app không được phép.
    const blocked = state.policy.blockedApps.includes(d.app);
    const offStudy = study && !state.policy.study.apps.includes(d.app);
    if (blocked || offStudy) {
      alert(state, 'block', `Đã chặn ${APPS[d.app].name}${offStudy && !blocked ? ' (đang chế độ học)' : ''}`, now);
      d.app = pickApp(state, study);
      d.appSince = now;
    } else if (auto && now - d.appSince > durMs(8 + Math.random() * 20, speed)) {
      d.app = pickApp(state, study);
      d.appSince = now;
    }

    const dt = (dtMs / 60000) * speed;
    state.today.byApp[d.app] = (state.today.byApp[d.app] || 0) + dt;
    if (study) state.today.study += dt;
    else state.today.used += dt;

    if (!study && !state.today.warned && remaining(state) <= 10) {
      state.today.warned = true;
      alert(state, 'warn', 'Còn 10 phút sử dụng hôm nay', now);
    }
  } else if (auto && reason === 'timeup' && !state.today.autoAsked) {
    state.today.autoAsked = true;
    createRequest(state, 30, 'Con chưa làm xong bài tập Toán ạ', now);
  }

  d.lastSeen = now;
  trim(state);
}

export function createRequest(state, minutes, reason, now = Date.now()) {
  state.requests.push({ id: uid(), minutes, reason, at: now, status: 'pending' });
}
