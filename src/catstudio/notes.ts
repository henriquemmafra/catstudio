/**
 * CatStudio — avisos de geometria mostrados ao usuário (central de mensagens
 * do VolView). Cada aviso aparece uma única vez por volume.
 */
import { surfaceWarning } from '@/src/store/messages';
import type { Note } from './geometry';

const shown = new Set<string>();

export function reportGeometryNotes(
  volumeId: string,
  notes: Note[],
  label: string,
  warn: (title: string, detail: string) => void = surfaceWarning
) {
  notes.forEach((note) => {
    const key = `${volumeId}|${note.title}`;
    if (shown.has(key)) return;
    shown.add(key);
    warn(`${label}: ${note.title}`, note.detail);
  });
}
