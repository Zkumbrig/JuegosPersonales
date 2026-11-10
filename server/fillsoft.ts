// Pide a Gemini frases de Suave y Picante durante 30 minutos.
// Se apoya en las ya guardadas y descarta las que se parecen a las de la base.
try { process.loadEnvFile(); } catch { /* sin .env */ }
process.env.AI_STOCK_LIMIT = '800';
process.env.AI_CONTENT = '1';

const { AiContent } = await import('./ai');
const { getDb } = await import('./db');

const MINUTES = 30;
const KINDS = ['never', 'likely', 'would', 'truth', 'dare'] as const;
const LEVELS = [1, 2] as const;
const NAME = { 1: 'suave', 2: 'picante' } as const;

const db = await getDb();
if (!db) { console.error('No hay conexión a la base.'); process.exit(1); }
const ai = new AiContent();
if (!ai.enabled) { console.error('Gemini no está activo.'); process.exit(1); }
await ai.attachDb(db);

const end = Date.now() + MINUTES * 60_000;
const saved = new Map<string, number>();
let quiet = 0;
console.log(`Gemini, suave y picante, hasta ${new Date(end).toLocaleTimeString()}.`);

while (Date.now() < end) {
  let round = 0;
  for (const kind of KINDS) {
    for (const level of LEVELS) {
      if (Date.now() >= end) break;
      const key = `${kind} ${NAME[level]}`;
      const n = await ai.refill(kind, level as 1 | 2);
      saved.set(key, (saved.get(key) ?? 0) + n);
      round += n;
      console.log(`${key}: +${n} (en esta tanda ${saved.get(key)})`);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  if (round === 0) {
    quiet++;
    console.log(quiet < 2 ? 'Este pase no dejó frases nuevas.' : 'Pausa de un minuto: la cuota puede estar ocupada.');
    if (quiet >= 2) await new Promise((r) => setTimeout(r, 60_000));
  } else quiet = 0;
}

console.log('Tanda terminada.');
for (const [key, n] of saved) console.log(`  ${key}: ${n}`);
process.exit(0);
