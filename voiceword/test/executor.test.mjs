import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeWord } from './fake-word.mjs';
import { execute, insertDictation, undo, canUndo, validate, needsConfirm, describe, readContext } from '../addin/executor.js';
import { parseUtterance } from '../addin/commands.js';

const run = (s) => execute(parseUtterance(s, 'command').ops);

test('in đậm câu vừa rồi', async () => {
  const doc = createFakeWord(['Kính gửi phụ huynh. Nhà trường thông báo lịch họp.']);
  await run('in đậm câu vừa rồi');
  assert.deepEqual(doc.paras[0].marks, [{ text: 'Nhà trường thông báo lịch họp.', bold: true }]);
});

test('không chọn gì → tự lấy câu cuối; đoạn trống → lấy đoạn trước', async () => {
  const doc = createFakeWord(['Câu một. Câu hai?', '']);
  await run('gạch chân');
  assert.deepEqual(doc.paras[0].marks, [{ text: 'Câu hai?', underline: 'Single' }]);
});

test('có vùng chọn → định dạng vùng chọn', async () => {
  const doc = createFakeWord(['Xin chào'], { selection: 'chào' });
  await run('in nghiêng');
  assert.equal(doc.paras[0].marks.length, 0);
  assert.equal(doc.paras[0].font.italic, true); // vùng chọn mô phỏng là đoạn chứa con trỏ
});

test('in đậm mọi chỗ có cụm từ', async () => {
  const doc = createFakeWord(['Hà Nội mùa thu.', 'Về Hà Nội.']);
  await run('in đậm chữ Hà Nội');
  assert.equal(doc.paras[0].marks[0].text, 'Hà Nội');
  assert.equal(doc.paras[1].marks[0].text, 'Hà Nội');
});

test('không tìm thấy cụm từ → báo lỗi dễ hiểu', async () => {
  createFakeWord(['abc']);
  await assert.rejects(run('in đậm chữ Huế'), /Không tìm thấy “Huế”/);
});

test('định dạng đoạn theo chỉ số (thao tác AI đề xuất)', async () => {
  const doc = createFakeWord(['Tiêu đề', 'Ngân sách 1', 'Ngân sách 2', 'Kết luận']);
  await execute([{ name: 'set_paragraph', input: { target: { type: 'paragraph_range', paragraph_start: 1, paragraph_end: 2 }, style: 'list_number', line_spacing: 1.5 } }]);
  assert.deepEqual(doc.paras.map((p) => p.styleBuiltIn), ['Normal', 'ListNumber', 'ListNumber', 'Normal']);
  assert.equal(doc.paras[1].lineSpacing, 18);
});

test('chèn nhiều đoạn tại con trỏ', async () => {
  const doc = createFakeWord(['Mở đầu: ']);
  await execute([{ name: 'insert_text', input: { text: 'dòng 1\ndòng 2', location: 'cursor' } }]);
  assert.deepEqual(doc.paras.map((p) => p.text), ['Mở đầu: dòng 1', 'dòng 2']);
});

test('đọc chữ: viết hoa đầu câu, thêm khoảng trắng, xuống dòng', async () => {
  const doc = createFakeWord(['Kính gửi phụ huynh.']);
  await insertDictation(parseUtterance('nhà trường xin thông báo phẩy', 'dictation').segments);
  assert.equal(doc.paras[0].text, 'Kính gửi phụ huynh. Nhà trường xin thông báo,');
  await insertDictation(parseUtterance('lịch họp như sau hai chấm xuống dòng thời gian', 'dictation').segments);
  assert.deepEqual(doc.paras.map((p) => p.text), ['Kính gửi phụ huynh. Nhà trường xin thông báo, lịch họp như sau:', 'Thời gian']);
});

test('hoàn tác khôi phục văn bản', async () => {
  createFakeWord(['']);
  while (canUndo()) await undo(); // bỏ điểm hoàn tác của các bài trước
  const doc = createFakeWord(['Một.']);
  await insertDictation(['hai.']);
  assert.equal(doc.paras[0].text, 'Một. Hai.');
  await undo();
  assert.equal(doc.paras[0].text, 'Một.');
  await assert.rejects(undo(), /Không còn gì để hoàn tác/);
});

test('thay tất cả và chèn bảng', async () => {
  const doc = createFakeWord(['công ty A và công ty B']);
  const notes = await execute([{ name: 'replace_all', input: { find: 'công ty', replace: 'Công ty' } }]);
  assert.equal(doc.paras[0].text, 'Công ty A và Công ty B');
  assert.deepEqual(notes, ['2 chỗ']);
  await run('chèn bảng 3 cột 2 hàng');
  assert.deepEqual(doc.tables[0].values, [['', '', ''], ['', '', '']]);
});

test('thể thức NĐ 30 chỉ áp cho đoạn thường', async () => {
  const doc = createFakeWord(['CÔNG VĂN', 'Nội dung']);
  doc.paras[0].styleBuiltIn = 'Title';
  await run('định dạng theo thể thức văn bản hành chính');
  assert.equal(doc.wholeFont.name, 'Times New Roman');
  assert.equal(doc.paras[0].alignment, 'Left');
  assert.equal(doc.paras[1].alignment, 'Justified');
  assert.equal(doc.paras[1].font.size, 14);
});

test('kiểm tra thao tác và xác nhận', () => {
  assert.match(validate({ name: 'run_macro', input: {} }), /Thao tác lạ/);
  assert.match(validate({ name: 'format_text', input: { target: { type: 'everything' } } }), /không hợp lệ/);
  assert.match(validate({ name: 'insert_table', input: { rows: 500, columns: 3 } }), /quá lớn/);
  assert.equal(validate({ name: 'format_text', input: { target: { type: 'auto' }, font_size: 14 } }), null);
  assert.equal(needsConfirm({ name: 'delete', input: { target: { type: 'last_sentence' } } }), true);
  assert.equal(needsConfirm({ name: 'format_text', input: { target: { type: 'whole_document' } } }), false);
  assert.equal(describe({ name: 'format_text', input: { target: { type: 'last_sentence' }, bold: true, font_size: 14 } }), 'In đậm, cỡ 14 · câu vừa rồi');
});

test('ngữ cảnh gửi AI chỉ có dàn ý rút gọn', async () => {
  createFakeWord(['Tiêu đề', 'x'.repeat(500)], { cursor: 1 });
  const c = await readContext();
  assert.equal(c.paragraphCount, 2);
  assert.equal(c.outline[1].text.length, 80);
  assert.equal(c.currentParagraphIndex, 1);
});
