import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mkdtemp, realpath, writeFile, readFile, readdir, mkdir, rm } from 'node:fs/promises';

test('standalone editor opens an unrelated folder or HTML file and saves backups beside that file', { timeout: 20000 }, async () => {
  const tempRoot = await realpath(os.tmpdir());
  const project = await mkdtemp(path.join(tempRoot, 'html-editor-검증 '));
  const filename = '한글 문서.html';
  const source = '<!doctype html><html><head></head><body><h1>원본</h1></body></html>';
  let child;
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill(); await exited;
    }
  }
  async function start(target) {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url)), target], {
      cwd: tempRoot, env: { ...process.env, HTML_EDITOR_PORT: String(port) }, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await Promise.race([
      once(child.stdout, 'data'),
      once(child, 'exit').then(([code]) => { throw new Error('Server exited: ' + code); })
    ]);
    return `http://127.0.0.1:${port}`;
  }
  try {
    await writeFile(path.join(project, filename), source);
    await writeFile(path.join(project, 'index.html'), '<h1>Index</h1>');
    await writeFile(path.join(project, 'style.css'), 'h1{color:navy}');
    let origin = await start(path.join(project, filename));
    let session = await fetch(origin + '/api/session').then(r => r.json());
    assert.equal(session.defaultFile, filename);
    assert.equal(session.projectRoot, project);
    assert.deepEqual(session.files.sort(), ['index.html', filename].sort());
    const file = await fetch(origin + '/api/file?name=' + encodeURIComponent(filename)).then(r => r.json());
    assert.equal(file.source, source);
    assert.equal(await fetch(origin + '/assets/' + session.project + '/style.css').then(r => r.text()), 'h1{color:navy}');
    const post = (route, input) => fetch(origin + route, { method: 'POST', headers: {
      Origin: origin, 'Content-Type': 'application/json', 'X-Editor-Token': session.token
    }, body: JSON.stringify(input) });
    const preview = await post('/api/preview', { source }).then(r => r.json());
    assert.ok(preview.html.includes('data-hle-source='));
    const changed = source.replace('원본', '수정');
    assert.equal((await post('/api/save', { name: filename, source: changed, revision: file.revision })).status, 200);
    assert.equal(await readFile(path.join(project, filename), 'utf8'), changed);
    const backups = await readdir(path.join(project, '.html-editor-backups'));
    assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(project, '.html-editor-backups', backups[0]), 'utf8'), source);
    assert.equal((await fetch(origin + '/assets/' + session.project + '/.html-editor-backups/' + encodeURIComponent(backups[0]))).status, 403);
    assert.equal((await post('/api/save', { name: filename, source, revision: file.revision })).status, 409);
    const firstProject = session.project;
    const secondFolder = path.join(project, '다른 폴더');
    await mkdir(secondFolder);
    await writeFile(path.join(secondFolder, filename), changed);
    await writeFile(path.join(secondFolder, 'style.css'), 'h1{color:teal}');
    const browse = await post('/api/browse', { path: project }).then(r => r.json());
    assert.equal(browse.path, project);
    assert.equal(browse.parent, path.dirname(project));
    assert.ok(browse.entries.some(entry => entry.directory && entry.path === secondFolder));
    assert.ok(browse.entries.some(entry => !entry.directory && entry.name === filename));
    assert.ok(!browse.entries.some(entry => entry.name === 'style.css'));
    assert.equal((await post('/api/browse', { path: path.join(project, 'missing-folder') })).status, 404);
    const openedResponse = await post('/api/open', { path: path.join(secondFolder, filename) });
    assert.equal(openedResponse.status, 200);
    const opened = await openedResponse.json();
    assert.notEqual(opened.project, firstProject);
    assert.equal(opened.projectRoot, secondFolder);
    assert.equal(opened.source, changed);
    assert.equal(opened.defaultFile, filename);
    assert.deepEqual(opened.files, [filename]);
    assert.equal(await fetch(origin + '/assets/' + opened.project + '/style.css').then(r => r.text()), 'h1{color:teal}');
    assert.equal(await fetch(origin + '/assets/' + firstProject + '/style.css').then(r => r.text()), 'h1{color:navy}');
    // Identical names and revisions must still save into the correct folder in each tab.
    assert.equal((await post('/api/save', { project: firstProject, name: filename, source: '첫 폴더 수정', revision: opened.revision })).status, 200);
    assert.equal(await readFile(path.join(project, filename), 'utf8'), '첫 폴더 수정');
    assert.equal(await readFile(path.join(secondFolder, filename), 'utf8'), changed);
    assert.equal((await post('/api/save', { project: opened.project, name: filename, source: '다른 폴더 수정', revision: opened.revision })).status, 200);
    assert.equal(await readFile(path.join(secondFolder, filename), 'utf8'), '다른 폴더 수정');
    const secondBackups = await readdir(path.join(secondFolder, '.html-editor-backups'));
    assert.equal(secondBackups.length, 1);
    assert.equal(await readFile(path.join(secondFolder, '.html-editor-backups', secondBackups[0]), 'utf8'), changed);
    assert.equal((await post('/api/open', { path: path.join(project, 'missing.html') })).status, 404);
    assert.equal((await post('/api/open', { path: path.join(project, 'style.css') })).status, 400);
    assert.equal((await post('/api/save', { project: 'unknown', name: filename, source, revision: opened.revision })).status, 409);
    const restored = await fetch(origin + '/api/session?project=' + opened.project).then(r => r.json());
    assert.equal(restored.projectRoot, secondFolder);
    await stop();
    origin = await start(project);
    session = await fetch(origin + '/api/session').then(r => r.json());
    assert.equal(session.defaultFile, null);
    assert.equal(session.projectRoot, project);
    assert.equal((await fetch(origin + '/')).status, 200);
  } finally {
    await stop();
    if (path.dirname(project) !== tempRoot || !path.basename(project).startsWith('html-editor-검증 ')) throw new Error('Unexpected cleanup path');
    await rm(project, { recursive: true });
  }
});
