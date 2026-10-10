import type { ReactionKind } from '../../shared/protocol';

export interface Bubble { id: number; from: string; kind: ReactionKind; x: number }

/** Reacciones que flotan ahora mismo en pantalla (efímeras: no viajan en el estado de la mesa). */
/** Estado del selector de reacciones (lo abre el botón de la cabecera de la sala). */
export const ui = $state({ open: false });

export const bubbles = $state<{ list: Bubble[] }>({ list: [] });
let seq = 0;

export function pushReaction(from: string, kind: ReactionKind) {
  const id = ++seq;
  // Reparto horizontal aleatorio para que varias reacciones no se pisen
  const b: Bubble = { id, from, kind, x: 12 + Math.round(Math.random() * 70) };
  bubbles.list = [...bubbles.list.slice(-13), b];
  setTimeout(() => { bubbles.list = bubbles.list.filter((x) => x.id !== id); }, 2600);
}
