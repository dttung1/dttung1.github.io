// Mô hình Word rút gọn để kiểm tra executor.js mà không cần Word thật.
// Chỉ mô phỏng phần API mà executor dùng; mọi thuộc tính coi như đã load.

export function createFakeWord(texts, { cursor = texts.length - 1, selection = '' } = {}) {
  const P = (text) => ({ text, styleBuiltIn: 'Normal', alignment: 'Left', font: {}, marks: [], tableNestingLevel: 0 });
  const doc = { paras: texts.map(P), cursor, selection, tables: [], breaks: [], selected: null, wholeFont: {} };

  const noop = () => {};
  const collection = (items) => ({ items, load: noop, getFirst: () => items[0], getLast: () => items[items.length - 1] });

  const markFont = (po, text) => new Proxy({}, { set(_, k, v) { po.marks.push({ text, [k]: v }); return true; } });

  class Para {
    constructor(po) { this.po = po; }
    load() {}
    get text() { return this.po.text; }
    get isNullObject() { return false; }
    get font() { return this.po.font; }
    get tableNestingLevel() { return this.po.tableNestingLevel; }
    get styleBuiltIn() { return this.po.styleBuiltIn; }
    set styleBuiltIn(v) { this.po.styleBuiltIn = v; }
    set alignment(v) { this.po.alignment = v; }
    set lineSpacing(v) { this.po.lineSpacing = v; }
    set firstLineIndent(v) { this.po.firstLineIndent = v; }
    set spaceAfter(v) { this.po.spaceAfter = v; }
    get index() { return doc.paras.indexOf(this.po); }
    getRange(where = 'Whole') { return where === 'Whole' ? new Range({ po: this.po }) : new Range({ po: this.po, caret: where }); }
    getPreviousOrNullObject() {
      const i = this.index;
      return i > 0 ? new Para(doc.paras[i - 1]) : { isNullObject: true, load: noop };
    }
    insertParagraph(text, loc) {
      const po = P(text);
      doc.paras.splice(this.index + (loc === 'After' ? 1 : 0), 0, po);
      return new Para(po);
    }
    insertTable(rows, columns, loc, values) {
      const t = { rows, columns, values, after: this.po.text };
      doc.tables.push(t);
      return t;
    }
  }

  class Range {
    // { po } = cả đoạn · { po, start, end } = một phần · { whole: true } · { sel: true } = vùng chọn/con trỏ
    constructor(spec) { Object.assign(this, spec); }
    load() {}
    get text() {
      if (this.sel) return doc.selection;
      if (this.whole) return doc.paras.map((p) => p.text).join('\n');
      if (this.start !== undefined) return this.po.text.slice(this.start, this.end);
      return this.caret ? '' : this.po.text;
    }
    get font() {
      if (this.whole) return new Proxy({}, { set(_, k, v) { doc.wholeFont[k] = v; return true; } });
      if (this.start !== undefined) return markFont(this.po, this.text);
      if (this.sel) return doc.paras[doc.cursor].font;
      return this.po.font;
    }
    get paragraphs() {
      if (this.whole) return collection(doc.paras.map((p) => new Para(p)));
      if (this.sel) return collection([new Para(doc.paras[doc.cursor])]);
      return collection([new Para(this.po)]);
    }
    getRange() { return this; }
    getTextRanges(marks) {
      const out = [];
      let start = 0;
      const t = this.po.text;
      for (let i = 0; i < t.length; i++) {
        if (marks.includes(t[i])) { out.push(new Range({ po: this.po, start, end: i + 1 })); start = i + 1; }
      }
      if (start < t.length) out.push(new Range({ po: this.po, start, end: t.length }));
      // trimSpacing
      for (const r of out) { while (r.po.text[r.start] === ' ') r.start++; }
      return collection(out);
    }
    insertText(text, loc) {
      if (this.sel) {
        const po = doc.paras[doc.cursor];
        po.text += text; // con trỏ coi như ở cuối đoạn
        return new Range({ po, caret: 'End' });
      }
      if (this.start !== undefined && loc === 'Replace') {
        this.po.text = this.po.text.slice(0, this.start) + text + this.po.text.slice(this.end);
        return new Range({ po: this.po, start: this.start, end: this.start + text.length });
      }
      if (loc === 'Replace') { this.po.text = text; return this; }
      throw new Error(`insertText ${loc} chưa mô phỏng`);
    }
    insertBreak(kind) { doc.breaks.push(kind); }
    delete() {
      if (this.start !== undefined) this.po.text = (this.po.text.slice(0, this.start) + this.po.text.slice(this.end)).trim();
      else doc.paras.splice(doc.paras.indexOf(this.po), 1);
    }
    select() { doc.selected = this; }
  }

  const body = {
    get paragraphs() { return collection(doc.paras.map((p) => new Para(p))); },
    getRange() { return new Range({ whole: true }); },
    search(q) {
      const found = [];
      for (const po of doc.paras) {
        const low = po.text.toLowerCase();
        let i = -1;
        while ((i = low.indexOf(q.toLowerCase(), i + 1)) >= 0) found.push(new Range({ po, start: i, end: i + q.length }));
      }
      return collection(found);
    },
    insertParagraph(text, loc) {
      const po = P(text);
      if (loc === 'End') doc.paras.push(po); else doc.paras.unshift(po);
      return new Para(po);
    },
    getOoxml() { return { value: JSON.stringify(doc.paras) }; },
    insertOoxml(v) { doc.paras = JSON.parse(v); },
  };

  const ctx = {
    document: { body, getSelection: () => new Range({ sel: true }) },
    sync: async () => {},
  };
  globalThis.Word = { run: async (fn) => fn(ctx) };
  return doc;
}
