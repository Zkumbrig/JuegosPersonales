/**
 * Mantiene la pantalla encendida mientras se juega: si el celular se apaga, se corta la conexión
 * y la mesa se queda esperando. Es una mejora opcional (no todos los navegadores la admiten).
 */
let sentinel: WakeLockSentinel | null = null;
let wanted = false;

async function acquire() {
  if (!wanted || sentinel || document.visibilityState !== 'visible') return;
  try {
    const s = await navigator.wakeLock?.request('screen');
    if (!s) return;
    sentinel = s;
    s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
  } catch {
    sentinel = null; // denegado (ahorro de batería, etc.): no pasa nada
  }
}

export function keepAwake(on: boolean) {
  wanted = on;
  if (on) void acquire();
  else {
    const s = sentinel;
    sentinel = null;
    s?.release().catch(() => {});
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void acquire(); // el navegador lo suelta al ocultar la pestaña
});
