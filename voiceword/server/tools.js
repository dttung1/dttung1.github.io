// Danh sách công cụ Claude được phép dùng. Cùng tên/tham số với addin/executor.js (bên thực thi trong Word).
// Claude chỉ "đề xuất" thao tác; add-in mới là bên sửa tài liệu.

const TARGET = {
  type: 'object',
  description:
    'Which part of the document to act on. auto = the selection if any, else the last sentence. ' +
    'find_text = every occurrence of `text`. paragraph_range = paragraphs by 0-based index from the outline (inclusive).',
  properties: {
    type: {
      type: 'string',
      enum: ['auto', 'selection', 'current_paragraph', 'last_paragraph', 'last_sentence', 'whole_document', 'find_text', 'paragraph_range'],
    },
    text: { type: 'string', description: 'Only for find_text: the exact text to find.' },
    paragraph_start: { type: 'integer', description: 'Only for paragraph_range.' },
    paragraph_end: { type: 'integer', description: 'Only for paragraph_range.' },
  },
  required: ['type'],
  additionalProperties: false,
};

const tool = (name, description, properties, required = []) => ({
  name,
  description,
  strict: true,
  input_schema: { type: 'object', properties, required, additionalProperties: false },
});

export const TOOLS = [
  tool('format_text', 'Character formatting. Only include the properties the user asked to change.', {
    target: TARGET,
    bold: { type: 'boolean' },
    italic: { type: 'boolean' },
    underline: { type: 'boolean' },
    font_size: { type: 'number', description: 'Points, e.g. 13 or 14.' },
    font_name: { type: 'string' },
    color: { type: 'string', description: 'Hex color like #C00000.' },
    highlight: { type: 'boolean', description: 'true = yellow highlight, false = remove highlight.' },
  }, ['target']),

  tool('set_paragraph', 'Paragraph formatting and built-in styles (headings, lists, alignment, spacing).', {
    target: TARGET,
    style: { type: 'string', enum: ['normal', 'title', 'heading1', 'heading2', 'heading3', 'quote', 'list_bullet', 'list_number'] },
    alignment: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
    line_spacing: { type: 'number', description: 'Multiple of single spacing, e.g. 1, 1.15, 1.5.' },
    first_line_indent_cm: { type: 'number' },
    space_after_pt: { type: 'number' },
  }, ['target']),

  tool('insert_text', 'Insert new text the user dictated or asked you to write. Use \\n to separate paragraphs.', {
    text: { type: 'string' },
    location: { type: 'string', enum: ['cursor', 'after_current_paragraph', 'end_of_document', 'start_of_document'] },
  }, ['text', 'location']),

  tool('replace_text', 'Replace the text of the target with new text (e.g. a rewritten paragraph). Keeps the target position.', {
    target: TARGET,
    text: { type: 'string' },
  }, ['target', 'text']),

  tool('replace_all', 'Find and replace every occurrence in the document. The user will be asked to confirm.', {
    find: { type: 'string' },
    replace: { type: 'string' },
    match_case: { type: 'boolean' },
  }, ['find', 'replace']),

  tool('delete', 'Delete the target. The user will be asked to confirm.', { target: TARGET }, ['target']),

  tool('insert_table', 'Insert a table after the current paragraph. `values` is rows of cell text; the first row is the header.', {
    rows: { type: 'integer' },
    columns: { type: 'integer' },
    values: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
  }, ['rows', 'columns']),

  tool('insert_break', 'Insert a page break, line break, or new paragraph at the cursor.', {
    kind: { type: 'string', enum: ['page', 'line', 'paragraph'] },
  }, ['kind']),

  tool('apply_preset', 'Apply a whole-document formatting preset. nd30_2020 = Vietnamese administrative documents (Nghị định 30/2020/NĐ-CP): Times New Roman 14, justified, first-line indent 1 cm, 6pt after paragraphs.', {
    preset: { type: 'string', enum: ['nd30_2020'] },
  }, ['preset']),

  tool('select', 'Move the selection to the target so the user can see it.', { target: TARGET }, ['target']),
];

export const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

export const SYSTEM_PROMPT = `You are the voice assistant inside a Microsoft Word add-in used by Vietnamese speakers.
Each user turn is one spoken command, transcribed by speech recognition (it may contain recognition errors or missing diacritics - infer the intended Vietnamese words), followed by a JSON snapshot of the document context: the selected text, the paragraph at the cursor, and an outline of paragraphs with their 0-based index and style.

How to respond:
- Carry out the command by calling the formatting tools. Plan every edit in this one response; you will not see the results, so call all needed tools now, in order.
- Use the narrowest target that matches what the user said. Prefer paragraph_range with indexes from the outline when the user refers to paragraphs by their content.
- When the user asks you to write or rewrite content, write natural, correct Vietnamese with full diacritics, matching the tone they asked for (administrative documents use formal language).
- Do not change content the user did not ask to change.
- If the command is unclear or no tool can do it, do not guess: call no tools and reply with one short Vietnamese sentence explaining what you need.
- When you do call tools, you may add one short Vietnamese sentence describing what you did. Keep it under 20 words.`;
