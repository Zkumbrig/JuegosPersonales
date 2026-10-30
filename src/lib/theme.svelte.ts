// Estilos de la casa. Rosé es el predeterminado.
export const THEMES = [
  { id: 'rose', name: 'Rosé', colors: ['#b5506b', '#ecb8a4'] },
  { id: 'fiesta', name: 'Fiesta', colors: ['#236058', '#ffb15e'] },
  { id: 'neon', name: 'Neón', colors: ['#3a1a7a', '#4cc9f0'] },
  { id: 'zafiro', name: 'Zafiro', colors: ['#1c4f9c', '#c4d3ea'] },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

function load(): ThemeId {
  try {
    const v = localStorage.getItem('rc_theme');
    if (THEMES.some((t) => t.id === v)) return v as ThemeId;
  } catch { /* modo privado */ }
  return 'rose';
}

export const theme = $state<{ id: ThemeId }>({ id: load() });

function apply(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color || '#0d0709');
}

export function setTheme(id: ThemeId) {
  theme.id = id;
  try { localStorage.setItem('rc_theme', id); } catch { /* ignore */ }
  apply(id);
}

apply(theme.id);
