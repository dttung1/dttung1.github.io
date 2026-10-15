// Gọi Claude để hiểu một câu lệnh và trả về danh sách thao tác cho add-in thực hiện.
import Anthropic from '@anthropic-ai/sdk';
import { TOOLS, TOOL_NAMES, SYSTEM_PROMPT } from './tools.js';

export const MODEL = process.env.MODEL || 'claude-opus-5-5';
// Model chạy safeguard có thể từ chối nhầm; "fallbacks: default" để máy chủ Anthropic tự chạy lại bằng model dự phòng.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

const MAX_CONTEXT_CHARS = 12000;

function contextBlock(context = {}) {
  const json = JSON.stringify({
    selection: String(context.selection || '').slice(0, 3000),
    current_paragraph: String(context.currentParagraph || '').slice(0, 2000),
    current_paragraph_index: context.currentParagraphIndex ?? null,
    paragraph_count: context.paragraphCount ?? null,
    outline: Array.isArray(context.outline) ? context.outline.slice(0, 120) : [],
  });
  return json.length > MAX_CONTEXT_CHARS ? json.slice(0, MAX_CONTEXT_CHARS) + '…' : json;
}

export class CommandError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export async function interpret(client, { utterance, context }) {
  const params = {
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: process.env.EFFORT || 'low' },
    // Hệ thống + danh sách công cụ không đổi giữa các lệnh → đánh dấu để được lưu đệm (rẻ hơn khi đủ dài).
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: TOOLS,
    messages: [{
      role: 'user',
      content: `Lệnh: ${utterance}\n\nNgữ cảnh tài liệu (JSON):\n${contextBlock(context)}`,
    }],
  };

  const response = FALLBACK_MODELS.has(MODEL)
    ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : await client.messages.create(params);

  if (response.stop_reason === 'refusal') {
    return { ops: [], message: 'Xin lỗi, yêu cầu này không thực hiện được.', usage: response.usage, model: response.model };
  }
  if (response.stop_reason === 'max_tokens') {
    throw new CommandError('Câu trả lời của AI bị cắt ngắn, hãy chia lệnh nhỏ hơn.');
  }

  const ops = [];
  const texts = [];
  for (const block of response.content) {
    if (block.type === 'tool_use' && TOOL_NAMES.has(block.name)) ops.push({ name: block.name, input: block.input });
    else if (block.type === 'text' && block.text.trim()) texts.push(block.text.trim());
  }
  return { ops, message: texts.join(' '), usage: response.usage, model: response.model };
}

export function createClient() {
  return new Anthropic();
}

export { Anthropic };
