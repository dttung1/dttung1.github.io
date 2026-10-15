// Thực thi thao tác trên tài liệu Word qua Office.js (Word API).
// Cùng tên thao tác với server/tools.js để thao tác từ quy tắc và từ Claude đi chung một đường.
/* global Word */

const STYLE = { normal: 'Normal', title: 'Title', heading1: 'Heading1', heading2: 'Heading2', heading3: 'Heading3', quote: 'Quote', list_bullet: 'ListBullet', list_number: 'ListNumber' };
const ALIGN = { left: 'Left', center: 'Centered', right: 'Right', justify: 'Justified' };
const TARGETS = new Set(['auto', 'selection', 'current_paragraph', 'last_paragraph', 'last_sentence', 'whole_document', 'find_text', 'paragraph_range']);
const CM = 28.3465; // điểm (pt) trên 1 cm
const LINE = 12;    // Word tính "bội số dòng" theo 12 pt = 1 dòng

const TARGET_LABEL = {
  auto: 'vùng chọn', selection: 'vùng chọn', current_paragraph: 'đoạn hiện tại', last_paragraph: 'đoạn vừa rồi',
  last_sentence: 'câu vừa rồi', whole_document: 'cả văn bản', paragraph_range: 'các đoạn đã chọn',
};
export const targetLabel = (t) => (t?.type === 'find_text' ? `“${t.text}”` : TARGET_LABEL[t?.type] || 'vùng chọn');

export class ExecError extends Error {}

// ---------- Kiểm tra thao tác (kể cả thao tác do AI đề xuất) ----------
const num = (v, lo, hi) => v === undefined || (typeof v === 'number' && v >= lo && v <= hi);
export function validate(op) {
  const i = op?.input || {};
  if (!HANDLERS[op?.name]) return `Thao tác lạ: ${op?.name}`;
  if ('target' in i || ['format_text', 'set_paragraph', 'replace_text', 'delete', 'select'].includes(op.name)) {
    if (!TARGETS.has(i.target?.type)) return 'Vùng tác động không hợp lệ';
    if (i.target.type === 'find_text' && !String(i.target.text || '').trim()) return 'Thiếu cụm từ cần tìm';
  }
  if (!num(i.font_size, 1, 200) || !num(i.line_spacing, 0.5, 5) || !num(i.first_line_indent_cm, -5, 10) || !num(i.space_after_pt, 0, 200)) return 'Giá trị ngoài phạm vi';
  if (op.name === 'insert_table' && !(num(i.rows, 1, 50) && num(i.columns, 1, 12))) return 'Bảng quá lớn (tối đa 50 hàng, 12 cột)';
  if (i.style && !STYLE[i.style]) return 'Kiểu đoạn không hỗ trợ';
  if (i.alignment && !ALIGN[i.alignment]) return 'Kiểu căn lề không hỗ trợ';
  return null;
}

export function needsConfirm(op) {
  return op.name === 'delete' || op.name === 'replace_all' || (op.name === 'replace_text' && op.input.target?.type === 'whole_document');
}

export function describe(op) {
  const i = op.input || {};
  const t = targetLabel(i.target);
  switch (op.name) {
    case 'format_text': {
      const parts = [];
      if (i.bold !== undefined) parts.push(i.bold ? 'in đậm' : 'bỏ đậm');
      if (i.italic !== undefined) parts.push(i.italic ? 'in nghiêng' : 'bỏ nghiêng');
      if (i.underline !== undefined) parts.push(i.underline ? 'gạch chân' : 'bỏ gạch chân');
      if (i.font_size) parts.push(`cỡ ${i.font_size}`);
      if (i.font_name) parts.push(i.font_name);
      if (i.color) parts.push(`màu ${i.color}`);
      if (i.highlight !== undefined) parts.push(i.highlight ? 'tô vàng' : 'bỏ tô');
      return `${cap(parts.join(', '))} · ${t}`;
    }
    case 'set_paragraph': {
      const parts = [];
      if (i.style) parts.push({ normal: 'văn bản thường', title: 'tiêu đề chính', heading1: 'tiêu đề 1', heading2: 'tiêu đề 2', heading3: 'tiêu đề 3', quote: 'trích dẫn', list_bullet: 'gạch đầu dòng', list_number: 'đánh số' }[i.style]);
      if (i.alignment) parts.push({ left: 'căn trái', center: 'căn giữa', right: 'căn phải', justify: 'căn đều' }[i.alignment]);
      if (i.line_spacing) parts.push(`giãn dòng ${i.line_spacing}`);
      if (i.first_line_indent_cm !== undefined) parts.push(`thụt đầu dòng ${i.first_line_indent_cm} cm`);
      if (i.space_after_pt !== undefined) parts.push(`cách sau ${i.space_after_pt} pt`);
      return `${cap(parts.join(', '))} · ${t}`;
    }
    case 'insert_text': return `Chèn ${i.text.length} ký tự`;
    case 'replace_text': return `Viết lại ${t}`;
    case 'replace_all': return `Thay tất cả “${i.find}” → “${i.replace}”`;
    case 'delete': return `Xóa ${t}`;
    case 'insert_table': return `Chèn bảng ${i.columns} cột × ${i.rows} hàng`;
    case 'insert_break': return { page: 'Ngắt trang', line: 'Xuống dòng (cùng đoạn)', paragraph: 'Xuống dòng' }[i.kind];
    case 'apply_preset': return 'Áp dụng thể thức văn bản hành chính (NĐ 30/2020)';
    case 'select': return `Chọn ${t}`;
    default: return op.name;
  }
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---------- Xác định vùng tác động ----------
async function lastParagraph(ctx) {
  const p = ctx.document.getSelection().paragraphs.getFirst();
  p.load('text');
  await ctx.sync();
  if (p.text.trim()) return p;
  const prev = p.getPreviousOrNullObject();
  prev.load('text');
  await ctx.sync();
  return prev.isNullObject ? p : prev;
}

async function resolve(ctx, target) {
  const body = ctx.document.body;
  const sel = ctx.document.getSelection();
  switch (target.type) {
    case 'selection': return [sel];
    case 'auto': {
      sel.load('text');
      await ctx.sync();
      if (sel.text.trim()) return [sel];
      return resolve(ctx, { type: 'last_sentence' });
    }
    case 'current_paragraph': return [sel.paragraphs.getFirst().getRange('Whole')];
    case 'last_paragraph': return [(await lastParagraph(ctx)).getRange('Whole')];
    case 'last_sentence': {
      const p = await lastParagraph(ctx);
      const parts = p.getRange('Whole').getTextRanges(['.', '?', '!', '…'], true);
      parts.load('items/text');
      await ctx.sync();
      const items = parts.items.filter((r) => r.text.trim());
      if (!items.length) throw new ExecError('Không tìm thấy câu nào gần con trỏ');
      return [items[items.length - 1]];
    }
    case 'whole_document': return [body.getRange('Whole')];
    case 'find_text': {
      const found = body.search(target.text, { matchCase: false });
      found.load('items');
      await ctx.sync();
      if (!found.items.length) throw new ExecError(`Không tìm thấy “${target.text}” trong văn bản`);
      return found.items;
    }
    case 'paragraph_range': {
      const ps = body.paragraphs;
      ps.load('items');
      await ctx.sync();
      const a = Math.max(0, target.paragraph_start ?? 0);
      const b = Math.min(ps.items.length - 1, target.paragraph_end ?? a);
      if (a > b) throw new ExecError('Không có đoạn nào ở vị trí đó');
      return ps.items.slice(a, b + 1).map((p) => p.getRange('Whole'));
    }
    default: throw new ExecError('Vùng tác động không hợp lệ');
  }
}

async function paragraphsOf(ctx, ranges) {
  const cols = ranges.map((r) => { const ps = r.paragraphs; ps.load('items'); return ps; });
  await ctx.sync();
  return cols.flatMap((c) => c.items);
}

// ---------- Từng thao tác ----------
const HANDLERS = {
  async format_text(ctx, i) {
    for (const r of await resolve(ctx, i.target)) {
      const f = r.font;
      if (i.bold !== undefined) f.bold = i.bold;
      if (i.italic !== undefined) f.italic = i.italic;
      if (i.underline !== undefined) f.underline = i.underline ? 'Single' : 'None';
      if (i.font_size) f.size = i.font_size;
      if (i.font_name) f.name = i.font_name;
      if (i.color) f.color = i.color;
      if (i.highlight !== undefined) f.highlightColor = i.highlight ? 'Yellow' : null;
    }
  },

  async set_paragraph(ctx, i) {
    for (const p of await paragraphsOf(ctx, await resolve(ctx, i.target))) {
      if (i.style) p.styleBuiltIn = STYLE[i.style];
      if (i.alignment) p.alignment = ALIGN[i.alignment];
      if (i.line_spacing) p.lineSpacing = i.line_spacing * LINE;
      if (i.first_line_indent_cm !== undefined) p.firstLineIndent = i.first_line_indent_cm * CM;
      if (i.space_after_pt !== undefined) p.spaceAfter = i.space_after_pt;
    }
  },

  async insert_text(ctx, i) {
    const lines = String(i.text).split(/\r?\n/);
    const body = ctx.document.body;
    const sel = ctx.document.getSelection();
    if (i.location === 'end_of_document') { lines.forEach((l) => body.insertParagraph(l, 'End')); return; }
    if (i.location === 'start_of_document') { [...lines].reverse().forEach((l) => body.insertParagraph(l, 'Start')); return; }
    let last;
    if (i.location === 'after_current_paragraph') {
      last = sel.paragraphs.getLast();
      for (const l of lines) last = last.insertParagraph(l, 'After');
    } else {
      const r = sel.insertText(lines[0], 'Replace');
      last = r.paragraphs.getLast();
      for (const l of lines.slice(1)) last = last.insertParagraph(l, 'After');
    }
    last.getRange('End').select();
  },

  async replace_text(ctx, i) {
    for (const r of await resolve(ctx, i.target)) r.insertText(i.text, 'Replace');
  },

  async replace_all(ctx, i) {
    const found = ctx.document.body.search(i.find, { matchCase: !!i.match_case });
    found.load('items');
    await ctx.sync();
    if (!found.items.length) throw new ExecError(`Không tìm thấy “${i.find}”`);
    found.items.forEach((r) => r.insertText(i.replace, 'Replace'));
    return `${found.items.length} chỗ`;
  },

  async delete(ctx, i) {
    for (const r of await resolve(ctx, i.target)) r.delete();
  },

  async insert_table(ctx, i) {
    const rows = i.rows, cols = i.columns;
    const values = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => String(i.values?.[r]?.[c] ?? '')));
    const p = ctx.document.getSelection().paragraphs.getLast();
    const table = p.insertTable(rows, cols, 'After', values);
    if (i.values?.length) table.headerRowCount = 1;
  },

  async insert_break(ctx, i) {
    const sel = ctx.document.getSelection();
    if (i.kind === 'page') sel.insertBreak('Page', 'After');
    else if (i.kind === 'line') sel.insertBreak('Line', 'After');
    else sel.paragraphs.getLast().insertParagraph('', 'After').getRange('Start').select();
  },

  async apply_preset(ctx) {
    // Nghị định 30/2020/NĐ-CP: Times New Roman, cỡ 13–14, căn đều, thụt đầu dòng 1–1,27 cm, cách đoạn ≥ 6 pt.
    const body = ctx.document.body;
    const whole = body.getRange('Whole');
    whole.font.name = 'Times New Roman';
    const ps = body.paragraphs;
    ps.load('items/styleBuiltIn,items/tableNestingLevel');
    await ctx.sync();
    for (const p of ps.items) {
      if (p.tableNestingLevel > 0) continue;
      if (['Normal', 'ListParagraph'].includes(p.styleBuiltIn)) {
        p.font.size = 14;
        p.alignment = 'Justified';
        p.firstLineIndent = 1 * CM;
        p.spaceAfter = 6;
        p.lineSpacing = 1.15 * LINE;
      }
    }
    return 'Lề trang chỉnh trong Bố cục → Lề: trên 20, dưới 20, trái 30, phải 15 mm';
  },

  async select(ctx, i) {
    (await resolve(ctx, i.target))[0].select();
  },
};

// ---------- Hoàn tác: Word API không có undo nên tự chụp lại thân văn bản trước mỗi lệnh ----------
const history = [];
const MAX_HISTORY = 15;

async function snapshot(ctx) {
  const ooxml = ctx.document.body.getOoxml();
  await ctx.sync();
  history.push(ooxml.value);
  if (history.length > MAX_HISTORY) history.shift();
}

export const canUndo = () => history.length > 0;

export async function undo() {
  const ooxml = history.pop();
  if (!ooxml) throw new ExecError('Không còn gì để hoàn tác');
  await Word.run(async (ctx) => {
    ctx.document.body.insertOoxml(ooxml, 'Replace');
    await ctx.sync();
  });
}

export async function execute(ops) {
  for (const op of ops) {
    const err = validate(op);
    if (err) throw new ExecError(err);
  }
  const notes = [];
  await Word.run(async (ctx) => {
    await snapshot(ctx);
    try {
      for (const op of ops) {
        const note = await HANDLERS[op.name](ctx, op.input || {});
        if (note) notes.push(note);
      }
      await ctx.sync();
    } catch (e) {
      history.pop(); // thao tác lỗi, không cần điểm hoàn tác
      throw e instanceof ExecError ? e : new ExecError(wordError(e));
    }
  });
  return notes;
}

// Chèn chữ đọc: tự viết hoa đầu câu, tự thêm khoảng trắng, "xuống dòng" tách đoạn.
export async function insertDictation(segments) {
  await Word.run(async (ctx) => {
    await snapshot(ctx);
    const sel = ctx.document.getSelection();
    const p = sel.paragraphs.getFirst();
    p.load('text');
    await ctx.sync();
    const before = p.text.replace(/\s+$/, '');
    let first = segments[0] || '';
    if (first) {
      const startOfSentence = !before || /[.?!…:]$/.test(before);
      if (startOfSentence) first = cap(first);
      const needSpace = before && !/^[.,;:?!…)”]/.test(first) && !/\s$/.test(p.text);
      sel.insertText((needSpace ? ' ' : '') + first, 'Replace').getRange('End').select();
    }
    let last = p;
    for (const seg of segments.slice(1)) last = last.insertParagraph(cap(seg), 'After');
    if (segments.length > 1) last.getRange('End').select();
    await ctx.sync();
  });
}

// Ngữ cảnh gửi cho AI: phần đang chọn, đoạn hiện tại và dàn ý (không gửi toàn văn).
export async function readContext() {
  let out;
  await Word.run(async (ctx) => {
    const sel = ctx.document.getSelection();
    sel.load('text');
    const cur = sel.paragraphs.getFirst();
    cur.load('text');
    const ps = ctx.document.body.paragraphs;
    ps.load('items/text,items/styleBuiltIn');
    await ctx.sync();
    const outline = ps.items.slice(0, 120).map((p, i) => ({ i, style: p.styleBuiltIn, text: p.text.slice(0, 80) }));
    out = {
      selection: sel.text,
      currentParagraph: cur.text,
      currentParagraphIndex: ps.items.findIndex((p) => p.text === cur.text),
      paragraphCount: ps.items.length,
      outline,
    };
  });
  return out;
}

function wordError(e) {
  if (e?.code === 'ItemNotFound') return 'Không tìm thấy vùng cần sửa';
  if (e?.code === 'AccessDenied') return 'Tài liệu đang ở chế độ chỉ đọc';
  if (e?.code === 'ApiNotFound') return 'Phiên bản Word này chưa hỗ trợ thao tác đó';
  return e?.message || 'Word không thực hiện được thao tác';
}
