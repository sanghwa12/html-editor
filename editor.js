import { previewBridge } from './bridge.js';
import { locateElement } from './locate.js';

const $ = id => document.getElementById(id);
const frame = $('preview');
let token, project, currentFile, revision, savedSource = '', lineEnding = '\n', mapping, renderedSource = '', version = 0, inspect = true;
let timer, saving = false, opening = false, highlight, lineHighlight, changingFile = false;
let selectedPath = null, parentPath = '', browseVersion = 0;
const editor = CodeMirror.fromTextArea($('source'), {
  mode: 'htmlmixed', lineNumbers: true, indentUnit: 2, tabSize: 2, matchBrackets: true,
  lineWrapping: false, viewportMargin: 30,
  extraKeys: { 'Ctrl-S': save, 'Cmd-S': save, 'Ctrl-Shift-Z': cm => cm.redo(), Tab: cm => cm.replaceSelection('  ') }
});

function error(message) { $('error').textContent = message; $('error').hidden = !message; }
function dirty() { return editor.getValue() !== savedSource; }
function confirmDiscard() {
  if (!dirty()) return Promise.resolve(true);
  return new Promise(resolve => {
    const dialog = $('unsaved-dialog');
    dialog.returnValue = 'cancel';
    dialog.onclose = () => resolve(dialog.returnValue === 'discard');
    dialog.showModal();
  });
}
function updateSaveState() {
  const changed = dirty();
  $('save-state').textContent = saving ? '저장 중…' : changed ? '저장하지 않은 변경' : '저장됨';
  $('save-state').classList.toggle('dirty', changed);
  $('save').disabled = saving || opening || !currentFile || !changed;
  $('file').disabled = saving || opening;
  $('open-file').disabled = saving || opening;
  $('open-file').textContent = opening ? '파일 선택 중…' : '파일 열기';
}
async function request(url, input) {
  const response = await fetch(url, input ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Editor-Token': token }, body: JSON.stringify(input) } : {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '요청에 실패했습니다.');
  return data;
}
function clearHighlight() {
  highlight?.clear(); highlight = null;
  if (lineHighlight != null) editor.removeLineClass(lineHighlight, 'background', 'source-highlight');
  lineHighlight = null;
}
function setMode(value) {
  inspect = value;
  $('inspect').classList.toggle('active', value); $('inspect').setAttribute('aria-pressed', String(value));
  $('interact').classList.toggle('active', !value); $('interact').setAttribute('aria-pressed', String(!value));
  frame.contentWindow?.postMessage({ channel: 'lab-html-editor', version, type: 'mode', inspect }, '*');
  $('hint').textContent = value ? '요소 선택: 오른쪽 요소 클릭 → 왼쪽 코드로 이동' : '페이지 조작: 버튼·애니메이션 실행 · 코드가 바뀌면 처음부터 다시 실행됩니다.';
}
function fitPreview() {
  const area = $('preview-area');
  const available = Math.max(100, area.clientWidth - 24);
  const width = Number($('viewport').value) || available;
  const scale = Math.min(1, available / width);
  const height = Math.max(600, (area.clientHeight - 24) / scale);
  Object.assign(frame.style, { width: width + 'px', height: height + 'px', transform: `scale(${scale})` });
  Object.assign($('frame-wrap').style, { width: width * scale + 'px', height: height * scale + 'px' });
  $('scale').textContent = `${Math.round(width)}px · ${Math.round(scale * 100)}%`;
}
async function render() {
  clearTimeout(timer);
  const ownVersion = ++version, source = editor.getValue();
  $('preview-state').textContent = '갱신 중…';
  try {
    const result = await request('/api/preview', { source });
    if (ownVersion !== version) return;
    mapping = result; renderedSource = source;
    const bridge = `(${previewBridge.toString()})(${JSON.stringify({ version, inspect })});`;
    const bootstrap = `<base href="${location.origin}/assets/${project}/"><script>${bridge.replace(/<\/script/gi, '<\\/script')}<\/script>`;
    frame.srcdoc = result.html.replace(/<head\b[^>]*>/i, match => match + bootstrap);
    if (!/<head\b/i.test(result.html)) frame.srcdoc = bootstrap + result.html;
    $('loading').hidden = true;
    $('preview-state').textContent = result.errors.length ? 'JavaScript 오류 있음' : '실시간 반영됨';
    error(result.errors.length ? `${result.errors[0].line}행: ${result.errors[0].message}` : '');
    fitPreview();
  } catch (issue) { if (ownVersion === version) { error(issue.message); $('preview-state').textContent = '연결 확인 필요'; } }
}
async function openFile(name) {
  if (opening || saving) return;
  if (!(await confirmDiscard())) { $('file').value = currentFile; return; }
  try {
    const requestedProject = project;
    const data = await request('/api/file?project=' + project + '&name=' + encodeURIComponent(name));
    if (project !== requestedProject || opening) return;
    await loadDocument(name, data);
  } catch (issue) { error(issue.message); }
}
function setProject(session) {
  project = session.project;
  $('file').title = session.projectRoot;
  $('file').replaceChildren(...session.files.map(name => new Option(name, name)));
}
async function loadDocument(name, data) {
  clearTimeout(timer); ++version; clearHighlight();
  currentFile = name; revision = data.revision;
  lineEnding = data.source.includes('\r\n') ? '\r\n' : '\n';
  changingFile = true; editor.setValue(data.source); savedSource = editor.getValue(); editor.clearHistory(); changingFile = false;
  $('file').value = name; document.title = `${name} · HTML 편집기`;
  history.replaceState(null, '', '?' + new URLSearchParams({ project, file: name }));
  $('selection-info').textContent = '오른쪽 요소를 클릭하면 코드로 이동합니다.';
  updateSaveState(); await render();
}
async function chooseFile() {
  if (opening || saving) return;
  opening = true; updateSaveState(); editor.setOption('readOnly', true); error('');
  $('file-dialog').showModal();
  await browseDirectory($('file').title);
}
async function browseDirectory(folder) {
  const ownVersion = ++browseVersion;
  selectedPath = null; $('picker-open').disabled = true;
  $('picker-selection').textContent = 'HTML 파일을 선택하세요.';
  $('picker-error').textContent = '';
  $('picker-list').textContent = '폴더를 불러오는 중…';
  $('picker-up').disabled = true; $('picker-go').disabled = true;
  try {
    const result = await request('/api/browse', { project, path: folder });
    if (ownVersion !== browseVersion || !$('file-dialog').open) return;
    $('picker-path').value = result.path; parentPath = result.parent;
    $('picker-up').disabled = result.path === result.parent;
    $('picker-list').replaceChildren();
    if (!result.entries.length) $('picker-list').textContent = '폴더 또는 HTML 파일이 없습니다.';
    for (const entry of result.entries) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'file-entry'; button.title = entry.path;
      button.textContent = (entry.directory ? '📁 ' : '📄 ') + entry.name;
      button.setAttribute('aria-label', (entry.directory ? '폴더 ' : '파일 ') + entry.name);
      button.onclick = () => {
        if (entry.directory) return browseDirectory(entry.path);
        selectedPath = entry.path;
        for (const row of $('picker-list').children) row.classList.remove('selected');
        button.classList.add('selected');
        $('picker-selection').textContent = entry.name; $('picker-open').disabled = false;
      };
      $('picker-list').append(button);
    }
  } catch (issue) {
    if (ownVersion === browseVersion) { $('picker-error').textContent = issue.message; $('picker-list').textContent = ''; }
  } finally { if (ownVersion === browseVersion) $('picker-go').disabled = false; }
}
async function openSelectedFile() {
  if (!selectedPath) return;
  const ownVersion = browseVersion;
  $('picker-open').disabled = true;
  try {
    if (!(await confirmDiscard())) { $('file-dialog').close(); return; }
    const data = await request('/api/open', { path: selectedPath });
    if (ownVersion !== browseVersion || !$('file-dialog').open) return;
    setProject(data);
    await loadDocument(data.defaultFile, data);
    $('file-dialog').close();
  } catch (issue) { $('picker-error').textContent = issue.message; }
  finally { $('picker-open').disabled = !selectedPath; }
}
async function save() {
  if (saving || opening || !currentFile || !dirty()) return;
  saving = true; updateSaveState();
  const source = editor.getValue();
  try {
    const result = await request('/api/save', { project, name: currentFile, source: source.replace(/\n/g, lineEnding), revision });
    revision = result.revision; savedSource = source; error('');
  } catch (issue) { error(issue.message); }
  finally { saving = false; updateSaveState(); }
}
window.addEventListener('message', event => {
  const message = event.data;
  if (event.source !== frame.contentWindow || message?.channel !== 'lab-html-editor' || message.version !== version) return;
  if (message.type === 'select') {
    if (!mapping || editor.getValue() !== renderedSource) { $('selection-info').textContent = '미리보기가 갱신된 뒤 다시 클릭해 주세요.'; return; }
    const found = locateElement(mapping, message);
    if (!found) { $('selection-info').textContent = '이 요소의 소스 위치를 찾지 못했습니다.'; return; }
    clearHighlight();
    const from = editor.posFromIndex(found.start), to = editor.posFromIndex(found.end);
    editor.focus(); editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, Math.max(60, editor.getScrollInfo().clientHeight / 3));
    lineHighlight = editor.addLineClass(from.line, 'background', 'source-highlight');
    highlight = editor.markText(from, to, { className: 'source-token' });
    $('selection-info').textContent = `${message.tag} → ${from.line + 1}행${found.kind === 'text' ? ' · 문구 원본' : message.fallback ? ' · 상위 컨테이너' : found.kind === 'generated' ? ' · 생성 코드' : ''}`;
  }
  if (message.type === 'error') error('미리보기 오류: ' + message.message);
  if (message.type === 'save') save();
  if (message.type === 'link') {
    const url = new URL(message.href, location.origin + '/assets/' + project + '/');
    const name = decodeURIComponent(url.pathname.split('/').pop());
    if (url.origin === location.origin && [...$('file').options].some(option => option.value === name)) openFile(name);
    else error('이 편집기에서는 같은 폴더의 HTML 링크만 열 수 있습니다.');
  }
});
editor.on('change', () => {
  if (changingFile) return;
  clearHighlight(); updateSaveState(); clearTimeout(timer);
  timer = setTimeout(render, 250);
});
editor.on('cursorActivity', () => { const pos = editor.getCursor(); $('position').textContent = `${pos.line + 1}행 · ${pos.ch + 1}열`; });
$('save').onclick = save;
$('open-file').onclick = chooseFile;
$('picker-go').onclick = () => browseDirectory($('picker-path').value);
$('picker-up').onclick = () => browseDirectory(parentPath);
$('picker-path').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); browseDirectory($('picker-path').value); } };
$('picker-open').onclick = openSelectedFile;
$('picker-cancel').onclick = () => $('file-dialog').close();
$('file-dialog').onclose = () => { ++browseVersion; opening = false; editor.setOption('readOnly', false); updateSaveState(); };
$('file').onchange = () => openFile($('file').value);
$('inspect').onclick = () => setMode(true);
$('interact').onclick = () => setMode(false);
$('refresh').onclick = render;
$('undo').onclick = () => editor.undo();
$('redo').onclick = () => editor.redo();
$('viewport').onchange = fitPreview;
$('download').onclick = () => {
  const url = URL.createObjectURL(new Blob([editor.getValue()], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = currentFile || 'edited.html'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); } });
new ResizeObserver(() => { fitPreview(); editor.refresh(); }).observe($('preview-area'));
$('divider').addEventListener('pointerdown', event => {
  event.preventDefault(); $('divider').setPointerCapture(event.pointerId); document.body.classList.add('resizing');
});
$('divider').addEventListener('pointermove', event => {
  if (!$('divider').hasPointerCapture(event.pointerId)) return;
  const rect = $('workbench').getBoundingClientRect();
  document.documentElement.style.setProperty('--code-width', Math.max(25, Math.min(70, (event.clientX - rect.left) / rect.width * 100)) + '%');
});
$('divider').addEventListener('pointerup', event => { $('divider').releasePointerCapture(event.pointerId); document.body.classList.remove('resizing'); });
$('divider').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--code-width'));
  document.documentElement.style.setProperty('--code-width', Math.max(25, Math.min(70, value + (event.key === 'ArrowLeft' ? -3 : 3))) + '%');
});
try {
  const params = new URLSearchParams(location.search);
  let session = await request('/api/session'); token = session.token;
  if (params.has('project')) session = await request('/api/session?project=' + encodeURIComponent(params.get('project'))).catch(() => session);
  setProject(session);
  if (!session.files.length) {
    $('loading').textContent = '파일 열기를 눌러 편집할 HTML을 선택하세요.';
    $('preview-state').textContent = '파일 선택 대기';
    $('save-state').textContent = '파일 선택 대기';
  } else {
    const requested = params.get('file');
    await openFile(session.files.includes(requested) ? requested : session.files.includes(session.defaultFile) ? session.defaultFile : session.files.includes('index.html') ? 'index.html' : session.files[0]);
  }
} catch (issue) { error(issue.message); $('loading').textContent = '편집기 연결을 확인해 주세요.'; }
