// This function is serialized into the sandboxed preview; it cannot access editor files.
export function previewBridge(config) {
  let inspect = config.inspect, hovered = null, box = null, label = null;
  const send = (type, extra = {}) => parent.postMessage({ channel: 'lab-html-editor', version: config.version, type, ...extra }, '*');
  function hide() { if (box) box.style.display = 'none'; }
  function outline(element) {
    if (!box || !element) return;
    const rect = element.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    label.textContent = element.tagName.toLowerCase() + (element.id ? '#' + element.id : '');
  }
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.channel !== 'lab-html-editor' || event.data.version !== config.version) return;
    if (event.data.type === 'mode') { inspect = event.data.inspect; hide(); }
  });
  window.addEventListener('error', event => send('error', { message: event.message || '미리보기 자원을 불러오지 못했습니다.' }));
  window.addEventListener('unhandledrejection', event => send('error', { message: String(event.reason?.message || event.reason) }));
  document.addEventListener('pointermove', event => {
    if (!inspect || !(event.target instanceof Element)) return;
    hovered = event.target;
    outline(hovered);
  }, true);
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) hide(); }, true);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    if (inspect) {
      event.preventDefault(); event.stopImmediatePropagation();
      const owner = event.target.closest('[data-hle-source]');
      if (owner) send('select', { id: owner.getAttribute('data-hle-source'), text: event.target.textContent?.trim().slice(0, 241), tag: event.target.tagName.toLowerCase(), fallback: owner !== event.target });
      outline(event.target);
    } else {
      const link = event.target.closest('a[href]');
      if (link && !link.getAttribute('href').startsWith('#')) {
        event.preventDefault(); event.stopImmediatePropagation();
        send('link', { href: link.getAttribute('href') });
      }
    }
  }, true);
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); event.stopImmediatePropagation(); send('save');
    }
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    box = document.createElement('div');
    Object.assign(box.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', display: 'none', border: '2px solid #19a893', background: '#19a89312', boxSizing: 'border-box' });
    label = document.createElement('span');
    Object.assign(label.style, { position: 'absolute', left: '-2px', top: '0', transform: 'translateY(-100%)', background: '#137b70', color: 'white', font: '11px/1.5 Consolas,monospace', padding: '2px 5px', whiteSpace: 'nowrap' });
    box.append(label); document.documentElement.append(box);
    send('ready');
  });
}
