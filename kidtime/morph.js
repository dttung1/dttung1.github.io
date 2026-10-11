// Cập nhật DOM tại chỗ (không thay cả cây) để nút không bị mất lần chạm,
// ô nhập đang gõ không bị ghi đè và animation chỉ chạy khi phần tử thực sự mới.

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function morph(target, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(target, tpl.content);
}

function same(a, b) {
  return a.nodeType === b.nodeType && a.nodeName === b.nodeName &&
    (a.nodeType !== 1 || a.getAttribute('data-key') === b.getAttribute('data-key'));
}

function patch(a, b) {
  if (a.nodeType === 3 || a.nodeType === 8) {
    if (a.data !== b.data) a.data = b.data;
    return;
  }
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  if (a.tagName === 'INPUT') {
    if (a !== document.activeElement && a.value !== b.getAttribute('value')) a.value = b.getAttribute('value') ?? '';
    return;
  }
  patchChildren(a, b);
}

function patchChildren(a, b) {
  const an = [...a.childNodes];
  const bn = [...b.childNodes];
  bn.forEach((n, i) => {
    const cur = an[i];
    if (!cur) a.appendChild(n);
    else if (same(cur, n)) patch(cur, n);
    else cur.replaceWith(n);
  });
  for (let i = bn.length; i < an.length; i++) an[i].remove();
}
