export const normalizeText = text => text.replace(/\s+/g, ' ').trim();

export function locateElement(mapping, selection) {
  const entry = mapping.entries[selection.id];
  if (!entry) return null;
  const text = normalizeText(selection.text || '');
  if (text && text.length <= 240 && (entry.kind === 'generated' || !entry.text)) {
    const matches = mapping.literals.filter(item => item.text === text);
    if (matches.length === 1) return { ...matches[0], tag: selection.tag, kind: 'text' };
  }
  return entry;
}
