import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse as parseHTML } from 'parse5';
import { parse as parseJS } from 'acorn';
import { instrument, locateElement } from './source-map.mjs';

test('Korean text, comments and quoted > preserve exact source offsets', () => {
  const source = '<!doctype html>\n<!-- <h1>not an element</h1> -->\n<h1 title="x > y">한국어 제목</h1><img src="a.png"/>';
  const result = instrument(source);
  const h1 = Object.entries(result.entries).find(([, item]) => item.tag === 'h1');
  assert.equal(source.slice(h1[1].start, h1[1].end), '<h1');
  assert.equal(h1[1].start, source.indexOf('<h1 title'));
  assert.equal(Object.values(result.entries).filter(item => item.tag === 'h1').length, 1);
  assert.match(result.html, /<img data-hle-source=\d+ src="a.png"\/>/);
  assert.equal(locateElement(result, { id: h1[0], text: '한국어 제목' }).kind, 'html');
});

test('generated SVG and dynamic text remain parseable and map to their original source', async () => {
  const source = await readFile(new URL('./test-fixtures/generated-scene.html', import.meta.url), 'utf8');
  const result = instrument(source);
  assert.deepEqual(result.errors, []);
  const tree = parseHTML(result.html);
  function visit(node) {
    if (node.tagName === 'script') parseJS(node.childNodes.map(n => n.value || '').join(''), { ecmaVersion: 'latest' });
    (node.childNodes || []).forEach(visit);
  }
  visit(tree);
  const generatedPath = Object.entries(result.entries).find(([, item]) => item.tag === 'path' && item.kind === 'generated');
  assert.ok(generatedPath);
  const found = locateElement(result, { id: generatedPath[0], text: '', tag: 'path' });
  assert.equal(source.slice(found.start, found.end), '<path');
  const heading = Object.entries(result.entries).find(([, item]) => item.tag === 'h2' && source.slice(item.start, item.start + 40).includes('id="detail-title"'));
  const text = locateElement(result, { id: heading[0], text: '분자 설계', tag: 'h2' });
  assert.equal(text.kind, 'text');
  assert.equal(source.slice(text.start, text.end), '분자 설계');
});

test('template expressions and nested SVG strings map independently without altering JS', () => {
  const source = '<script>const icon=\'<path d="M1 2"/>\'; const x=3; const html=`<svg><g transform="translate(${x})">${icon}<text>${x}</text></g></svg>`;</script>';
  const result = instrument(source);
  assert.deepEqual(result.errors, []);
  parseJS(result.html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''), { ecmaVersion: 'latest' });
  assert.equal(Object.values(result.entries).filter(e => e.kind === 'generated').length, 4);
});

test('malformed JavaScript is reported at its original source line while static HTML stays inspectable', () => {
  const source = '<html>\n<head></head>\n<body><h1>Hello</h1>\n<script>const broken = ;</script></body></html>';
  const result = instrument(source);
  assert.equal(result.errors[0].line, 4);
  assert.ok(Object.values(result.entries).some(e => e.tag === 'h1'));
});

test('duplicate text values do not misleadingly select one arbitrary declaration', () => {
  const source = '<h2 id="title"></h2><script>const a="같음", b="같음";</script>';
  const result = instrument(source);
  const id = Object.keys(result.entries).find(id => result.entries[id].tag === 'h2');
  assert.equal(locateElement(result, { id, text: '같음' }).kind, 'html');
});
