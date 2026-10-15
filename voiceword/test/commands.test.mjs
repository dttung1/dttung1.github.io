import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUtterance, dictationText, toNumber, strip } from '../addin/commands.js';

const cmd = (s) => parseUtterance(s, 'command');
const op = (s) => { const r = cmd(s); assert.equal(r?.kind, 'ops', `"${s}" → ${JSON.stringify(r)}`); return r.ops; };

test('bỏ dấu giữ nguyên độ dài', () => {
  const s = 'Đậm nghiêng Hà Nội';
  assert.equal(strip(s).length, s.length);
  assert.equal(strip(s).toLowerCase(), 'dam nghieng ha noi');
});

test('số đọc bằng chữ', () => {
  assert.equal(toNumber('14'), 14);
  assert.equal(toNumber('1,5'), 1.5);
  assert.equal(toNumber('muoi bon'), 14);
  assert.equal(toNumber('hai muoi'), 20);
  assert.equal(toNumber('ba'), 3);
});

test('đọc chữ: dấu câu và xuống dòng', () => {
  assert.deepEqual(dictationText('hôm nay trời đẹp chấm'), ['hôm nay trời đẹp.']);
  assert.deepEqual(dictationText('bạn khỏe không chấm hỏi'), ['bạn khỏe không?']);
  assert.deepEqual(dictationText('kính gửi phẩy'), ['kính gửi,']);
  assert.deepEqual(dictationText('chấm điểm bài thi'), ['chấm điểm bài thi']);
  assert.deepEqual(dictationText('mục một xuống dòng mục hai'), ['mục một', 'mục hai']);
  assert.deepEqual(dictationText('gọi là mở ngoặc kép AI đóng ngoặc kép'), ['gọi là “AI”']);
});

test('chế độ đọc chữ: chỉ nhận lệnh khi có từ khóa', () => {
  assert.equal(parseUtterance('in đậm câu vừa rồi', 'dictation').kind, 'dictation');
  const r = parseUtterance('Lệnh in đậm câu vừa rồi', 'dictation');
  assert.equal(r.kind, 'ops');
  assert.equal(parseUtterance('hoàn tác', 'dictation').kind, 'undo');
});

test('định dạng chữ', () => {
  assert.deepEqual(op('in đậm câu vừa rồi'), [{ name: 'format_text', input: { target: { type: 'last_sentence' }, bold: true } }]);
  assert.deepEqual(op('bỏ in đậm')[0].input, { target: { type: 'auto' }, bold: false });
  assert.deepEqual(op('in đậm và gạch chân đoạn này')[0].input, { target: { type: 'current_paragraph' }, bold: true, underline: true });
  assert.deepEqual(op('cỡ chữ 14 cho cả văn bản')[0].input, { target: { type: 'whole_document' }, font_size: 14 });
  assert.deepEqual(op('cỡ chữ mười bốn')[0].input, { target: { type: 'auto' }, font_size: 14 });
  assert.equal(op('phông Times New Roman cho toàn bộ')[0].input.font_name, 'Times New Roman');
  assert.equal(op('màu đỏ câu vừa rồi')[0].input.color, '#C00000');
  assert.deepEqual(op('in đậm chữ Hà Nội')[0].input, { target: { type: 'find_text', text: 'Hà Nội' }, bold: true });
});

test('định dạng đoạn', () => {
  assert.deepEqual(op('tiêu đề cấp 2')[0], { name: 'set_paragraph', input: { target: { type: 'auto' }, style: 'heading2' } });
  assert.equal(op('tiêu đề một đoạn này')[0].input.style, 'heading1');
  assert.equal(op('căn giữa')[0].input.alignment, 'center');
  assert.equal(op('căn đều hai bên cả văn bản')[0].input.alignment, 'justify');
  assert.equal(op('đánh số đoạn này')[0].input.style, 'list_number');
  assert.equal(op('gạch đầu dòng')[0].input.style, 'list_bullet');
  assert.equal(op('giãn dòng 1,5')[0].input.line_spacing, 1.5);
});

test('lệnh khác', () => {
  assert.deepEqual(op('ngắt trang'), [{ name: 'insert_break', input: { kind: 'page' } }]);
  assert.deepEqual(op('chèn bảng 3 cột 4 hàng'), [{ name: 'insert_table', input: { rows: 4, columns: 3 } }]);
  assert.deepEqual(op('tạo bảng ba cột'), [{ name: 'insert_table', input: { rows: 2, columns: 3 } }]);
  assert.deepEqual(op('xóa câu vừa rồi'), [{ name: 'delete', input: { target: { type: 'last_sentence' } } }]);
  assert.equal(op('định dạng theo thể thức văn bản hành chính')[0].name, 'apply_preset');
  assert.equal(cmd('đồng ý').kind, 'confirm');
});

test('câu phức tạp chuyển cho AI', () => {
  for (const s of [
    'chuyển các đoạn nói về ngân sách thành danh sách đánh số',
    'viết lại đoạn này cho trang trọng hơn',
    'soạn giấy mời họp phụ huynh vào thứ bảy',
    'tóm tắt văn bản thành ba ý',
  ]) assert.equal(cmd(s).kind, 'ai', s);
});
