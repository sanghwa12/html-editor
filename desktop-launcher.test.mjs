import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rmdir } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { ensureEditor } from './desktop-launcher.mjs';

test('desktop launcher starts an editor and reuses the same server on the next launch', { timeout: 15000 }, async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'html-editor-desktop-'));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  let started;
  try {
    started = await ensureEditor(port, folder);
    assert.equal(started.started, true);
    assert.ok(started.pid);
    const session = await fetch(started.origin + '/api/session').then(r => r.json());
    assert.equal(session.projectRoot, folder);
    assert.deepEqual(session.files, []);
    const again = await ensureEditor(port, folder);
    assert.equal(again.started, false);
    assert.equal(again.origin, started.origin);
    const icon = await fetch(started.origin + '/app-icon.ico');
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get('content-type'), 'image/x-icon');
  } finally {
    if (started?.pid) process.kill(started.pid);
    await rmdir(folder);
  }
});
