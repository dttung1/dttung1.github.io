// Bộ hiểu lệnh tiếng Việt theo quy tắc: chạy ngay trên máy, không cần mạng, không gửi dữ liệu đi đâu.
// Câu nào không khớp quy tắc sẽ được chuyển cho AI (Claude) qua máy chủ trung gian.
//
// Kết quả của parseUtterance():
//   { kind: 'dictation', text, newParagraph }   – chèn chữ đọc vào tài liệu
//   { kind: 'ops', ops: [...], source: 'rule' } – các thao tác định dạng (cùng định dạng với công cụ của Claude)
//   { kind: 'undo' } | { kind: 'confirm', yes }  – hoàn tác / trả lời xác nhận
//   { kind: 'ai', text }                         – cần AI hiểu giúp

// Bỏ dấu từng ký tự, giữ nguyên độ dài để vị trí khớp trên chuỗi không dấu dùng được cho chuỗi gốc.
export function strip(s) {
  let out = '';
  for (const ch of s) {
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
    out += ch === 'đ' ? 'd' : ch === 'Đ' ? 'D' : base.length === 1 ? base : ch;
  }
  return out;
}

const clean = (s) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

const WAKE = /^(lenh|trinh soan thao|tro ly|may oi|ra lenh)\b[ ,:]*/;

// ---------- Số đọc bằng chữ ----------
const DIGIT = { khong: 0, mot: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5, lam: 5, sau: 6, bay: 7, tam: 8, chin: 9 };
const NUM = String.raw`(\d+(?:[.,]\d+)?|(?:(?:mot|hai|ba|bon|tu|nam|sau|bay|tam|chin) )?muoi(?: (?:mot|hai|ba|bon|tu|lam|nam|sau|bay|tam|chin))?|mot|hai|ba|bon|tu|nam|sau|bay|tam|chin)`;
export function toNumber(s) {
  s = s.trim();
  if (/^\d/.test(s)) return parseFloat(s.replace(',', '.'));
  const w = s.split(' ');
  if (!w.includes('muoi')) return DIGIT[w[0]];
  const i = w.indexOf('muoi');
  const tens = i === 0 ? 1 : DIGIT[w[0]];
  const ones = w[i + 1] ? DIGIT[w[i + 1]] : 0;
  return tens * 10 + ones;
}

// ---------- Đọc chữ: các từ đặc biệt ----------
const PUNCT_END = [
  ['cham hoi', '?'], ['cham than', '!'], ['cham phay', ';'], ['hai cham', ':'], ['ba cham', '…'],
  ['cham', '.'], ['phay', ','],
];
const PUNCT_ANY = [
  ['mo ngoac kep', ' “'], ['dong ngoac kep', '”'], ['mo ngoac', ' ('], ['dong ngoac', ')'],
];

export function dictationText(original) {
  const segments = [];
  let text = clean(original);
  // "xuống dòng" ở bất kỳ đâu → tách đoạn.
  const parts = [];
  let low = strip(text).toLowerCase();
  let idx;
  while ((idx = low.search(/\b(xuong dong|dong moi)\b/)) >= 0) {
    const m = low.slice(idx).match(/^(xuong dong|dong moi)/)[0];
    parts.push(text.slice(0, idx));
    text = text.slice(idx + m.length);
    low = low.slice(idx + m.length);
  }
  parts.push(text);
  for (let p of parts) {
    p = clean(p);
    let l = strip(p).toLowerCase();
    for (const [w, sym] of PUNCT_ANY) {
      let j;
      while ((j = l.search(new RegExp(`\\b${w}\\b`))) >= 0) {
        p = p.slice(0, j) + sym + p.slice(j + w.length);
        l = l.slice(0, j) + sym + l.slice(j + w.length);
      }
    }
    // Dấu câu chỉ khi nằm cuối câu nói (tránh nhầm "chấm điểm", "phẩy tay").
    for (const [w, sym] of PUNCT_END) {
      if (l === w) { p = sym; break; }
      if (l.endsWith(' ' + w)) { p = p.slice(0, p.length - w.length).trimEnd() + sym; break; }
    }
    segments.push(p.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:?!…)”])/g, '$1').replace(/([(“])\s+/g, '$1').trim());
  }
  return segments;
}

// ---------- Vùng tác động ----------
const TARGETS = [
  [/\b(cau vua roi|cau vua noi|cau vua doc|cau cuoi|cau truoc)\b/, 'last_sentence'],
  [/\b(doan vua roi|doan truoc|doan cuoi|doan vua doc)\b/, 'last_paragraph'],
  [/\b(doan nay|doan hien tai|doan van nay)\b/, 'current_paragraph'],
  [/\b(ca van ban|toan bo van ban|toan van ban|toan bo|tat ca van ban|ca tai lieu)\b/, 'whole_document'],
  [/\b(phan da chon|phan chon|vung chon|doan chon|cho chon)\b/, 'selection'],
];

function extractTarget(orig, low) {
  for (const [re, target] of TARGETS) {
    const m = low.match(re);
    if (m) {
      const cut = (s) => (s.slice(0, m.index) + s.slice(m.index + m[0].length)).replace(/\s+cho\s*$/, '').replace(/\s+/g, ' ').trim();
      return { target: { type: target }, orig: cut(orig), low: cut(low) };
    }
  }
  // "… chữ Hà Nội" / "… từ 'ngân sách'" → mọi chỗ có cụm từ đó.
  const m = low.match(/(?:^|\s)(?:cho )?(?:cac |nhung )?(?:chu|tu|cum tu)\s+["“']?(.+?)["”']?$/);
  const notPhrase = /^(dam|nghieng|thuong|mau|co|to|\d|in |hoa|dau)/;
  if (m && m.index > 0 && !notPhrase.test(m[1]) && !/\b(co|phong|font|mau)$/.test(low.slice(0, m.index).trim())) {
    const start = m.index + m[0].lastIndexOf(m[1]);
    const text = orig.slice(start, start + m[1].length).trim();
    return { target: { type: 'find_text', text }, orig: orig.slice(0, m.index).trim(), low: low.slice(0, m.index).trim() };
  }
  return { target: { type: 'auto' }, orig, low };
}

const COLORS = {
  'xanh duong': '#1F4E9E', 'xanh nuoc bien': '#1F4E9E', 'xanh la': '#2E7D32', 'xanh': '#1F4E9E',
  do: '#C00000', den: '#000000', vang: '#BF8F00', cam: '#E26B0A', tim: '#7030A0', xam: '#7F7F7F',
};
const FONTS = { 'times new roman': 'Times New Roman', times: 'Times New Roman', arial: 'Arial', calibri: 'Calibri', cambria: 'Cambria', tahoma: 'Tahoma', 'segoe ui': 'Segoe UI' };

function formatOps(low, target) {
  const f = {};
  const neg = /\b(bo|tat|huy|khong)\s+$/;
  const flag = (re, key) => {
    const m = low.match(re);
    if (m) f[key] = !neg.test(low.slice(0, m.index) + ' ');
  };
  flag(/\b(in dam|to dam|chu dam|boi dam)\b/, 'bold');
  flag(/\b(in nghieng|chu nghieng|nghieng)\b/, 'italic');
  flag(/\b(gach chan|gach duoi)\b/, 'underline');
  let m = low.match(new RegExp(String.raw`\b(?:co chu|chu co|kich thuoc chu|co)\s+${NUM}\b`));
  if (m) f.font_size = toNumber(m[1]);
  m = low.match(/\b(?:phong chu|phong|font chu|font)\s+(?:chu\s+)?(.+)$/);
  if (m) {
    const key = Object.keys(FONTS).find((k) => m[1].startsWith(k));
    if (key) f.font_name = FONTS[key];
  }
  m = low.match(/\b(?:mau chu|chu mau|mau|to mau)\s+(xanh duong|xanh nuoc bien|xanh la|xanh|do|den|vang|cam|tim|xam)\b/);
  if (m) f.color = COLORS[m[1]];
  if (/\b(to vang|danh dau|highlight|to sang)\b/.test(low)) f.highlight = !/\b(bo|tat|huy) (to vang|danh dau|highlight|to sang)\b/.test(low);
  return Object.keys(f).length ? [{ name: 'format_text', input: { target, ...f } }] : [];
}

const STYLES = [
  [new RegExp(String.raw`\btieu de (?:cap |muc )?${NUM}\b`), (m) => `heading${Math.min(3, Math.max(1, toNumber(m[1])))}`],
  [/\b(tieu de chinh|ten tai lieu|ten van ban)\b/, () => 'title'],
  [/\b(van ban thuong|chu thuong|binh thuong|kieu thuong)\b/, () => 'normal'],
  [/\b(trich dan)\b/, () => 'quote'],
  [/\b(danh so|danh sach so|danh sach co so)\b/, () => 'list_number'],
  [/\b(gach dau dong|danh sach|cham dau dong)\b/, () => 'list_bullet'],
];
const ALIGN = { giua: 'center', trai: 'left', phai: 'right', deu: 'justify', 'hai ben': 'justify', 'deu hai ben': 'justify' };

function paragraphOps(low, target) {
  const p = {};
  for (const [re, fn] of STYLES) {
    const m = low.match(re);
    if (m) { p.style = fn(m); break; }
  }
  let m = low.match(/\bcan (?:le )?(deu hai ben|hai ben|giua|trai|phai|deu)\b/);
  if (m) p.alignment = ALIGN[m[1]];
  m = low.match(new RegExp(String.raw`\b(?:gian dong|khoang cach dong|cach dong)\s+${NUM}\b`));
  if (m) p.line_spacing = toNumber(m[1]);
  m = low.match(new RegExp(String.raw`\b(?:thut dau dong|thut le|thut dong dau)\s+${NUM}\b`));
  if (m) p.first_line_indent_cm = toNumber(m[1]);
  else if (/\bthut dau dong\b/.test(low)) p.first_line_indent_cm = 1;
  return Object.keys(p).length ? [{ name: 'set_paragraph', input: { target, ...p } }] : [];
}

function ruleOps(orig, low0) {
  if (/^(hoan tac|undo|quay lai|tro lai|huy thao tac vua roi)$/.test(low0)) return { kind: 'undo' };
  if (/^(dong y|dung roi|xac nhan|co|ok|lam di)$/.test(low0)) return { kind: 'confirm', yes: true };
  if (/^(huy|khong|thoi|bo qua|dung lai)$/.test(low0)) return { kind: 'confirm', yes: false };

  if (/^(ngat trang|sang trang moi|trang moi|chen ngat trang)$/.test(low0)) return ops([{ name: 'insert_break', input: { kind: 'page' } }]);
  if (/^(xuong dong|dong moi|doan moi)$/.test(low0)) return ops([{ name: 'insert_break', input: { kind: 'paragraph' } }]);
  if (/\b(the thuc van ban hanh chinh|van ban hanh chinh|nghi dinh 30|nd 30)\b/.test(low0) && /\b(dinh dang|ap dung|chuan|theo|can)\b/.test(low0)) {
    return ops([{ name: 'apply_preset', input: { preset: 'nd30_2020' } }]);
  }
  let m = low0.match(new RegExp(String.raw`^(?:chen|tao|them|ke) bang(?: gom)? ${NUM} cot(?:(?: va| x)? ${NUM} (?:hang|dong))?`));
  if (m) {
    const columns = toNumber(m[1]);
    const rows = m[2] ? toNumber(m[2]) : 2;
    return ops([{ name: 'insert_table', input: { rows, columns } }]);
  }

  const { target, orig: o, low } = extractTarget(orig, low0);
  if (/^(xoa|xoa bo)$/.test(low)) return ops([{ name: 'delete', input: { target } }]);
  if (/^(chon|boi den|danh dau chon)$/.test(low)) return ops([{ name: 'select', input: { target } }]);

  const list = [...formatOps(low, target), ...paragraphOps(low, target)];
  if (!list.length) return null;
  // Câu còn thừa nhiều từ không hiểu → để AI xử lý cho chắc.
  const known = /\b(in|dam|nghieng|gach|chan|duoi|co|chu|phong|font|mau|to|vang|danh|dau|tieu|de|cap|muc|can|le|giua|trai|phai|deu|hai|ben|gian|dong|cach|thut|so|sach|van|ban|thuong|binh|trich|dan|bo|tat|huy|khong|va|cho|voi|kich|thuoc|highlight|sang|boi|xanh|do|den|cam|tim|xam|la|duong|nuoc|bien|dong|times|new|roman|arial|calibri|cambria|tahoma|segoe|ui|kieu|chinh|ten|tai|lieu|lai|thanh|sang|\d+|mot|ba|bon|tu|nam|sau|bay|tam|chin|muoi|lam)\b/g;
  const leftover = low.replace(known, '').replace(/[\s,.]+/g, ' ').trim();
  if (leftover.split(' ').filter(Boolean).length > 2) return null;
  void o;
  return ops(list);
}

const ops = (list) => ({ kind: 'ops', ops: list, source: 'rule' });

export function parseUtterance(raw, mode = 'dictation') {
  const orig = clean(raw).replace(/[.!?]+$/, '');
  if (!orig) return null;
  let low = strip(orig).toLowerCase();
  let text = orig;

  const wake = low.match(WAKE);
  if (mode === 'dictation' && !wake) {
    const ruleOnly = ruleOps(orig, low);
    // Trong chế độ đọc chữ, chỉ nhận vài lệnh ngắn không cần từ khóa.
    if (ruleOnly && ['undo'].includes(ruleOnly.kind)) return ruleOnly;
    if (ruleOnly?.kind === 'ops' && ruleOnly.ops[0].name === 'insert_break' && ruleOnly.ops[0].input.kind === 'page') return ruleOnly;
    const segs = dictationText(raw);
    return { kind: 'dictation', segments: segs };
  }
  if (wake) {
    text = orig.slice(wake[0].length);
    low = low.slice(wake[0].length);
  }
  if (!low) return null;
  return ruleOps(text, low) || { kind: 'ai', text };
}
