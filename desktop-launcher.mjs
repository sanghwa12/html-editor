import { spawn } from 'node:child_process';
import { openSync, closeSync, existsSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.dirname(fileURLToPath(import.meta.url));
const logPath = path.join(root, 'desktop-launcher.log');

async function editorIsRunning(origin) {
  let response;
  try { response = await fetch(origin + '/api/session', { signal: AbortSignal.timeout(800) }); }
  catch { return false; }
  const session = await response.json().catch(() => null);
  if (!response.ok || !session || !Array.isArray(session.files) || typeof session.projectRoot !== 'string' || typeof session.project !== 'string' || typeof session.token !== 'string') {
    throw new Error('The editor port is occupied by another application.');
  }
  return true;
}

export async function ensureEditor(port = Number(process.env.HTML_EDITOR_PORT || 8787), target = os.homedir()) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid HTML_EDITOR_PORT.');
  const origin = `http://127.0.0.1:${port}`;
  if (await editorIsRunning(origin)) return { origin, started: false };
  const log = openSync(logPath, 'a');
  let child;
  try {
    child = spawn(process.execPath, [path.join(root, 'server.mjs'), target], {
      cwd: root, env: { ...process.env, HTML_EDITOR_PORT: String(port) },
      detached: true, windowsHide: true, stdio: ['ignore', log, log]
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  } finally { closeSync(log); }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await editorIsRunning(origin)) return { origin, started: true, pid: child.pid };
    if (child.exitCode !== null) break;
    await delay(150);
  }
  throw new Error('The HTML editor server did not start.');
}

async function openEditorWindow(origin) {
  const chrome = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(folder => path.join(folder, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(existsSync);
  const child = chrome
    ? spawn(chrome, ['--app=' + origin + '/'], { detached: true, stdio: 'ignore', windowsHide: false })
    : spawn('rundll32.exe', ['url.dll,FileProtocolHandler', origin + '/'], { detached: true, stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const { origin } = await ensureEditor(); await openEditorWindow(origin); }
  catch (error) { await appendFile(logPath, new Date().toISOString() + ' ' + error.message + '\n'); process.exitCode = 1; }
}
