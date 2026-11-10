// Carga frases escritas a mano (o con un modelo de Cursor) en ai_phrases.
// Uso:   npx tsx server/seedphrases.ts db/seed/never-suave.json          (solo revisa, no escribe)
//        npx tsx server/seedphrases.ts db/seed/never-suave.json --apply  (guarda en la base de DATABASE_URL)
// Usa las mismas reglas del juego (cleanItem, filtros y frases parecidas), así que nada entra que luego se rechace.
import { readFileSync } from 'node:fs';
import { cleanItem, sig, similar, type AiItem, type AiKind } from './ai';
import { DARES, LIKELY, NEVER, TRUTHS, WOULD } from './content';
import { getDb } from './db';

try { process.loadEnvFile(); } catch { /* sin .env */ }
const file = process.argv[2];
const apply = process.argv.includes('--apply');
if (!file) { console.error('Falta el archivo JSON.'); process.exit(1); }

const spec = JSON.parse(readFileSync(file, 'utf8')) as { kind: AiKind; level: 1 | 2 | 3; model?: string; items: unknown[] };
const curated: Record<AiKind, string[]> = {
  never: NEVER.map((i) => i.text), likely: LIKELY.map((i) => i.text), truth: TRUTHS.map((i) => i.text),
  dare: DARES.map((i) => i.text), would: WOULD.map((w) => `${w.a} / ${w.b}`),
};
const textOf = (i: AiItem) => (typeof i === 'string' ? i : `${i[0]} / ${i[1]}`);

const db = apply ? await getDb() : null;
if (apply && !db) { console.error('No hay conexión a la base (DATABASE_URL).'); process.exit(1); }

const taken: Set<string>[] = curated[spec.kind].map((t) => sig(t));
if (db) {
  const { rows } = await db.query(`select text, text_b from ai_phrases where kind = $1`, [spec.kind]);
  for (const r of rows) taken.push(sig(textOf(r.text_b ? [r.text, r.text_b] : r.text)));
}

let ok = 0, bad = 0, parecidas = 0, guardadas = 0;
for (const raw of spec.items) {
  const item = cleanItem(spec.kind, raw);
  if (!item) { bad++; console.log('  descartada (formato o filtro):', JSON.stringify(raw)); continue; }
  const s = sig(textOf(item));
  if (taken.some((o) => similar(o, s))) { parecidas++; console.log('  descartada (parecida a otra):', textOf(item)); continue; }
  taken.push(s);
  ok++;
  if (db) {
    const [a, b] = typeof item === 'string' ? [item, null] : item;
    const res = await db.query(
      `insert into ai_phrases (kind, level, text, text_b, model, source) values ($1, $2, $3, $4, $5, 'cursor')
       on conflict do nothing returning id`,
      [spec.kind, spec.level, a, b, spec.model ?? 'cursor'],
    );
    if (res.rows[0]) guardadas++;
  }
}
console.log(`${spec.kind} nivel ${spec.level}: ${ok} válidas, ${bad} con formato malo, ${parecidas} parecidas.`);
console.log(apply ? `Guardadas en la base: ${guardadas}.` : 'Modo revisión: no se escribió nada. Añade --apply para guardar.');
process.exit(0);
