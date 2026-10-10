/**
 * Iconos propios de Royale Club. Una sola familia: rejilla de 24, trazo de 1.7 con puntas redondas
 * y un relleno translúcido (clase "d") que da el efecto "dúo". Se pintan con `currentColor`,
 * así heredan el color y el tema sin coste. Cero emojis, cero archivos.
 */
const dot = (cx: number, cy: number, r = 1) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;

export const ICONS: Record<string, string> = {
  // ----- Juegos de casino -----
  blackjack:
    '<rect class="d" x="9.5" y="4.5" width="11" height="15" rx="2.2" transform="rotate(9 15 12)"/>' +
    '<rect x="3.5" y="5" width="10.5" height="14.5" rx="2.2" transform="rotate(-9 8.7 12.2)"/>' +
    '<path d="M15.6 9.4l1.9 2.7-1.9 2.7-1.9-2.7z"/>',
  roulette:
    '<circle cx="12" cy="12" r="9"/><circle class="d" cx="12" cy="12" r="3"/>' +
    '<path d="M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6l4.3 4.3M14.1 14.1l4.3 4.3M18.4 5.6l-4.3 4.3M9.9 14.1l-4.3 4.3"/>',
  slots:
    '<rect x="3" y="4" width="18" height="16" rx="3"/><rect class="d" x="6" y="8" width="12" height="6" rx="1.5"/>' +
    '<path d="M10 8v6M14 8v6M9 17h6"/>',
  poker:
    '<path class="d" d="M12 3c3.6 3.9 7 6.2 7 9.6a3.6 3.6 0 0 1-6.3 2.4l.8 4.5h-3l.8-4.5A3.6 3.6 0 0 1 5 12.6C5 9.2 8.4 6.9 12 3z"/>' +
    '<path d="M9 21h6"/>',
  chip:
    '<circle class="d" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.6"/>' +
    '<path d="M12 3v3.2M12 17.8V21M3 12h3.2M17.8 12H21"/>',

  // ----- Juegos de fiesta -----
  party:
    '<path class="d" d="M5.5 4h10l-.9 5.2a4.1 4.1 0 0 1-8.2 0L5.5 4z"/><path d="M10.5 13.3V20M7.5 20.5h6"/><path d="M19 3v4M17 5h4"/>',
  never:
    '<path class="d" d="M2.8 12S6 6 12 6s9.2 6 9.2 6-3.2 6-9.2 6-9.2-6-9.2-6z"/><circle cx="12" cy="12" r="2.6"/><path d="M4 4l16 16"/>',
  likely:
    '<circle class="d" cx="9.5" cy="8" r="3.3"/><path d="M3.5 20c0-3.6 2.7-6 6-6s6 2.4 6 6"/><path d="M15.5 4.5h4v4M19.5 4.5l-5 5"/>',
  would:
    '<path d="M12 4v16M7 20h10M5 7h14"/><path class="d" d="M5 7l-2.5 6a3.2 3.2 0 0 0 5 0L5 7zM19 7l-2.5 6a3.2 3.2 0 0 0 5 0L19 7z"/>',
  truth:
    '<path class="d" d="M5 4.5h14v7.2a7 7 0 0 1-14 0V4.5z"/><path d="M8.5 10.2l2.2 1.1M15.5 10.2l-2.2 1.1M9 15.2c1.6 1.6 4.4 1.6 6 0"/>',
  reflex: '<path class="d" d="M13.2 2.5L5 13.4h6l-.9 8.1 8.4-11.2h-6.1l.8-7.8z"/>',
  kings: '<path class="d" d="M3.5 18.5l-1-10 5 3.8L12 5l4.5 7.3 5-3.8-1 10z"/><path d="M4 21.5h16"/>',

  // ----- Fiesta: acciones -----
  drink:
    '<path class="d" d="M5 8.5h10.5v10.7a1.3 1.3 0 0 1-1.3 1.3H6.3A1.3 1.3 0 0 1 5 19.2V8.5z"/>' +
    '<path d="M15.5 10.5h2a2.5 2.5 0 0 1 2.5 2.5v1.5a2.5 2.5 0 0 1-2.5 2.5h-2"/>' +
    '<path d="M5 8.5c-.6-2.2 1-3.7 2.8-3.1.8-1.6 3.2-1.8 4.1-.2 1.7-.5 3.6.6 3.6 3.3"/><path d="M8.7 12.5v4.5M12 12.5v4.5"/>',
  flame:
    '<path class="d" d="M12 21.2c-3.9 0-6.5-2.6-6.5-6 0-3 2-4.7 3.4-6.6.6-.8 1-1.8 1-3 2.6 1.4 4 3.6 4 5.4 1-.6 1.6-1.6 1.8-2.8 1.4 1.7 2.8 4 2.8 7 0 3.3-2.6 6-6.5 6z"/>' +
    '<path d="M12 21.2c-1.6 0-2.8-1.1-2.8-2.6 0-1.4 1.2-2.3 2.8-3.9 1.6 1.6 2.8 2.5 2.8 3.9 0 1.5-1.2 2.6-2.8 2.6z"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  minus: '<path d="M6 12h12"/>',
  skip: '<path class="d" d="M5 5.5l9 6.5-9 6.5z"/><path d="M18.5 5v14"/>',
  trophy:
    '<path class="d" d="M8 4h8v5.2a4 4 0 0 1-8 0V4z"/><path d="M8 5.5H5.2A2.7 2.7 0 0 0 8 10M16 5.5h2.8A2.7 2.7 0 0 1 16 10M12 13.2V17M8.5 20.5h7M10 17h4"/>',

  // ----- Interfaz -----
  sound:
    '<path class="d" d="M4 9.8v4.4h3.6L12.5 18V6L7.6 9.8H4z"/><path d="M16 9.2a4 4 0 0 1 0 5.6M18.6 6.6a7.8 7.8 0 0 1 0 10.8"/>',
  mute: '<path class="d" d="M4 9.8v4.4h3.6L12.5 18V6L7.6 9.8H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
  palette:
    '<path class="d" d="M12 3a9 9 0 1 0 0 18c1.5 0 2.1-1 1.7-2.2-.4-1.3.5-2.3 1.8-2.3H17a4 4 0 0 0 4-4C21 6.8 17 3 12 3z"/>' +
    dot(7.6, 11.3) + dot(10.2, 7.6) + dot(14.6, 7.6) + dot(17.2, 11),
  exit: '<path d="M10 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H10"/><path d="M15 8l4 4-4 4M19 12H9.5"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  undo: '<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h9a4.5 4.5 0 1 1 0 9h-3"/>',
  trash: '<path d="M5 7h14M10 4h4M7 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7"/>',
  users:
    '<circle class="d" cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c0-3.4 2.7-5.5 6-5.5s6 2.1 6 5.5"/><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8M18 14.4c1.9.7 3 2.4 3 5.1"/>',
  lock: '<rect class="d" x="5" y="10.5" width="14" height="10" rx="2.4"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  unlock: '<rect class="d" x="5" y="10.5" width="14" height="10" rx="2.4"/><path d="M8 10.5V8a4 4 0 0 1 7.5-2"/>',
  tv: '<rect class="d" x="3" y="4.5" width="18" height="12.5" rx="2.2"/><path d="M8 20.5h8M12 17v3.5"/>',
  help:
    '<circle class="d" cx="12" cy="12" r="9"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.7 2.2c-.8.5-1.3 1-1.3 1.9"/>' + dot(12, 17.2, 1.1),
  laugh:
    '<circle class="d" cx="12" cy="12" r="9"/><path d="M8.2 10.2c.5-.9 1.5-.9 2 0M13.8 10.2c.5-.9 1.5-.9 2 0"/><path d="M7.6 13.4h8.8a4.4 4.4 0 0 1-8.8 0z"/>',
  wow:
    '<circle class="d" cx="12" cy="12" r="9"/>' + dot(9, 10) + dot(15, 10) + '<ellipse cx="12" cy="15.4" rx="2.1" ry="2.7"/>',
  heart:
    '<path class="d" d="M12 20.3C5.6 15.6 3.4 12.5 3.4 9.5a4.3 4.3 0 0 1 8.6-1.6 4.3 4.3 0 0 1 8.6 1.6c0 3-2.2 6.1-8.6 10.8z"/>',
  qr:
    '<rect class="d" x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect class="d" x="14" y="3.5" width="6.5" height="6.5" rx="1.2"/>' +
    '<rect class="d" x="3.5" y="14" width="6.5" height="6.5" rx="1.2"/><path d="M14 14h3v3M20.5 14v.1M14 20.5h6.5M20.5 17.5v3"/>',
  user: '<circle class="d" cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.9 3-6.5 7-6.5s7 2.6 7 6.5"/>',
  sparkle: '<path class="d" d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 16v4M17 18h4"/>',
};

/** Rellenos de los palos (cartas y decoración). */
export const SUITS: Record<string, string> = {
  S: '<path d="M12 2.5c3.7 4 7.5 6.5 7.5 10.2a3.9 3.9 0 0 1-6.7 2.7l.9 5.1H10.3l.9-5.1a3.9 3.9 0 0 1-6.7-2.7C4.5 9 8.3 6.5 12 2.5z"/>',
  H: '<path d="M12 21.5C5 16.3 2.8 12.8 2.8 9.6A4.6 4.6 0 0 1 12 7.6a4.6 4.6 0 0 1 9.2 2c0 3.2-2.2 6.7-9.2 11.9z"/>',
  D: '<path d="M12 2l7 10-7 10-7-10z"/>',
  C: '<circle cx="12" cy="7.6" r="4.2"/><circle cx="6.8" cy="14" r="4.2"/><circle cx="17.2" cy="14" r="4.2"/><path d="M12 12.5l-1.6 9h3.2z"/>',
};
