import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, readdir, writeFile, mkdir, realpath, stat } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { instrument } from './source-map.mjs';

const editorRoot = path.dirname(fileURLToPath(import.meta.url));
if (!process.argv[2]) {
  console.error('사용법: node server.mjs "편집할 HTML 파일 또는 폴더 경로"');
  process.exit(1);
}
const digest = data => createHash('sha256').update(data).digest('hex');
const projects = new Map();
async function openTarget(input, fileOnly = false) {
  if (typeof input !== 'string' || !input.trim()) throw Object.assign(new Error('HTML 파일 경로가 필요합니다.'), { status: 400 });
  const target = await realpath(path.resolve(input));
  const info = await stat(target);
  let root, defaultFile = null;
  if (info.isDirectory() && !fileOnly) root = target;
  else if (info.isFile() && /\.html?$/i.test(target)) {
    root = path.dirname(target);
    defaultFile = path.basename(target);
  } else throw Object.assign(new Error('HTML 파일(.html/.htm)을 선택해 주세요.'), { status: 400 });
  const project = { id: digest(root).slice(0, 16), root, defaultFile };
  const listing = await files(project);
  const data = defaultFile ? await readFile(target) : null;
  projects.set(project.id, project);
  return { project: project.id, projectRoot: root, defaultFile, files: listing, ...(data ? { source: data.toString('utf8'), revision: digest(data) } : {}) };
}
function getProject(id) {
  const project = projects.get(id || initial.project);
  if (!project) throw Object.assign(new Error('열었던 폴더 연결이 만료되었습니다. 파일 열기로 다시 선택해 주세요.'), { status: 409 });
  return project;
}
const token = randomBytes(24).toString('hex');
const port = Number(process.env.HTML_EDITOR_PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('HTML_EDITOR_PORT는 1~65535 사이의 정수여야 합니다.');
  process.exit(1);
}
const origin = `http://127.0.0.1:${port}`;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.pdb': 'text/plain', '.ico': 'image/x-icon' };
const files = async project => (await readdir(project.root, { withFileTypes: true })).filter(f => f.isFile() && /\.html?$/i.test(f.name)).map(f => f.name).sort();
let initial;
try { initial = await openTarget(process.argv[2]); }
catch (error) { console.error(error.message); process.exit(1); }
async function filePath(project, name) {
  if (!(await files(project)).includes(name)) throw Object.assign(new Error('편집할 HTML 파일을 찾을 수 없습니다.'), { status: 404 });
  return path.join(project.root, name);
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': types['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw Object.assign(new Error('HTML은 5MB까지 편집할 수 있습니다.'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function serveFile(res, root, relative, assets = false) {
  const resolved = await realpath(path.resolve(root, relative));
  const relativePath = path.relative(root, resolved);
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(path.sep).some(p => p.startsWith('.'))) {
    throw Object.assign(new Error('허용되지 않은 경로입니다.'), { status: 403 });
  }
  const data = await readFile(resolved);
  res.writeHead(200, { 'Content-Type': types[path.extname(resolved)] || 'application/octet-stream', 'Cache-Control': 'no-store', ...(assets ? { 'Access-Control-Allow-Origin': '*' } : {}) });
  res.end(data);
}

let saving = false;
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}`) return json(res, 403, { error: '로컬 편집기 주소로 접속해 주세요.' });
    const url = new URL(req.url, origin);
    if (req.method === 'GET') {
      if (url.pathname === '/api/session') {
        const project = getProject(url.searchParams.get('project'));
        return json(res, 200, { token, project: project.id, files: await files(project), projectRoot: project.root, defaultFile: project.defaultFile });
      }
      if (url.pathname === '/api/file') {
        const data = await readFile(await filePath(getProject(url.searchParams.get('project')), url.searchParams.get('name')));
        return json(res, 200, { source: data.toString('utf8'), revision: digest(data) });
      }
      const asset = url.pathname.match(/^\/assets\/([a-f0-9]{16})\/(.*)$/);
      if (asset) return await serveFile(res, getProject(asset[1]).root, decodeURIComponent(asset[2]), true);
      if (url.pathname.startsWith('/vendor/')) return await serveFile(res, path.join(editorRoot, 'node_modules', 'codemirror'), decodeURIComponent(url.pathname.slice(8)));
      const publicFiles = { '/': 'index.html', '/editor.js': 'editor.js', '/editor.css': 'editor.css', '/bridge.js': 'bridge.js', '/locate.js': 'locate.js', '/app-icon.ico': 'assets/html-editor-cat.ico' };
      if (publicFiles[url.pathname]) return await serveFile(res, editorRoot, publicFiles[url.pathname]);
      return json(res, 404, { error: '파일을 찾을 수 없습니다.' });
    }
    if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['x-editor-token'] !== token) return json(res, 403, { error: '편집기에서 다시 시도해 주세요.' });
    const input = await body(req);
    if (url.pathname === '/api/browse') {
      const folder = await realpath(input.path ? path.resolve(input.path) : getProject(input.project).root);
      const entries = (await readdir(folder, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() || (entry.isFile() && /\.html?$/i.test(entry.name)))
        .map(entry => ({ name: entry.name, path: path.join(folder, entry.name), directory: entry.isDirectory() }))
        .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'ko'));
      return json(res, 200, { path: folder, parent: path.dirname(folder), entries });
    }
    if (url.pathname === '/api/open') return json(res, 200, await openTarget(input.path, true));
    if (typeof input.source !== 'string') return json(res, 400, { error: 'HTML 내용이 필요합니다.' });
    if (url.pathname === '/api/preview') return json(res, 200, instrument(input.source));
    if (url.pathname === '/api/save') {
      if (saving) return json(res, 409, { error: '다른 저장 작업이 진행 중입니다.' });
      saving = true;
      try {
        const project = getProject(input.project);
        const target = await filePath(project, input.name);
        const previous = await readFile(target);
        if (digest(previous) !== input.revision) return json(res, 409, { error: '파일이 외부에서 변경되었습니다. 편집 내용을 내려받은 뒤 파일을 다시 열어 비교해 주세요.' });
        const backupDir = path.join(project.root, '.html-editor-backups');
        await mkdir(backupDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await writeFile(path.join(backupDir, `${input.name}.${stamp}.bak`), previous, { flag: 'wx' });
        await writeFile(target, input.source, 'utf8');
        return json(res, 200, { revision: digest(Buffer.from(input.source)), saved: true });
      } finally { saving = false; }
    }
    return json(res, 404, { error: '알 수 없는 요청입니다.' });
  } catch (error) {
    json(res, error.status || (error.code === 'ENOENT' ? 404 : 500), { error: error.message });
  }
});
server.listen(port, '127.0.0.1', () => console.log(`HTML editor: ${origin}/\nFolder: ${initial.projectRoot}\nClose this window or press Ctrl+C to stop.`));
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `${port} 포트가 사용 중입니다. 기존 편집기를 종료하거나 HTML_EDITOR_PORT를 다른 값으로 지정해 주세요.` : error.message);
  process.exitCode = 1;
});
