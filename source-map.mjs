import { parse as parseHTML } from 'parse5';
import { parse as parseJS } from 'acorn';
import { normalizeText } from './locate.js';
export { locateElement } from './locate.js';

// All offsets refer to the untouched source. Instrumentation exists only in the preview.
export function instrument(source) {
  const entries = {}, literals = [], edits = [], errors = [];
  let nextId = 1;
  function mark(start, tag, kind, text = '') {
    const id = String(nextId++);
    entries[id] = { start, end: start + tag.length + 1, tag, kind, text: normalizeText(text) };
    edits.push({ at: start + tag.length + 1, text: ` data-hle-source=${id}` });
  }
  function markupInString(start, end) {
    const raw = source.slice(start, end);
    for (const match of raw.matchAll(/<([a-zA-Z][\w:-]*)(?=[\s/>])/g)) {
      mark(start + match.index, match[1], 'generated');
    }
  }
  function script(code, offset, module) {
    let ast;
    try {
      ast = parseJS(code, { ecmaVersion: 'latest', sourceType: module ? 'module' : 'script' });
    } catch (error) {
      errors.push({ message: error.message, line: source.slice(0, offset + error.pos).split('\n').length });
      return;
    }
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'Literal' && typeof node.value === 'string') {
        literals.push({ text: normalizeText(node.value), start: offset + node.start + 1, end: offset + node.end - 1 });
        markupInString(offset + node.start + 1, offset + node.end - 1);
      }
      if (node.type === 'TemplateElement') markupInString(offset + node.start, offset + node.end);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object' && value.type) walk(value);
      }
    }
    walk(ast);
  }
  function textOf(node) {
    return node.nodeName === '#text' ? node.value : (node.childNodes || []).map(textOf).join('');
  }
  function visit(node) {
    const loc = node.sourceCodeLocation;
    if (node.tagName && loc?.startTag) {
      const tag = source.slice(loc.startTag.startOffset + 1).match(/^[\w:-]+/)[0];
      mark(loc.startTag.startOffset, tag, 'html', textOf(node));
      if (node.tagName === 'script' && !node.attrs.some(a => a.name === 'src')) {
        const type = node.attrs.find(a => a.name === 'type')?.value || '';
        if (['', 'module', 'text/javascript', 'application/javascript'].includes(type)) {
          script(textOf(node), loc.startTag.endOffset, type === 'module');
        }
      }
    }
    (node.childNodes || []).forEach(visit);
    if (node.content) visit(node.content);
  }
  visit(parseHTML(source, { sourceCodeLocationInfo: true }));
  let html = source;
  for (const edit of edits.sort((a, b) => b.at - a.at)) html = html.slice(0, edit.at) + edit.text + html.slice(edit.at);
  return { html, entries, literals, errors };
}
