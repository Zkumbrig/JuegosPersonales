// Frases nuevas para los juegos de fiesta. Salen de Gemini solo cuando el banco guardado está bajo.
// Si la clave falta, la cuota se agota o el modelo está saturado, se reutilizan las frases ya guardadas
// en Supabase. La lista escrita (server/content.ts) solo entra cuando ese banco también está vacío.
// No se envía ningún dato de los jugadores: solo se piden frases genéricas.
// Las frases largas y de Extremo se escriben aquí, en el editor, y se guardan: la partida no llama a otro modelo.

import { DARES, LIKELY, NEVER, TRUTHS, WOULD } from './content';
import type { SqlDb } from './db';

export type AiKind = 'never' | 'likely' | 'would' | 'truth' | 'dare';
type Level = 1 | 2 | 3;

const BATCH = 15; // lotes cortos: a partir de ahí las frases se parecen entre sí
const LOW_WATER = 12; // al bajar de aquí, durante la partida, se pide otro lote
export const STOCK_LIMIT = Math.max(1, Number(process.env.AI_STOCK_LIMIT) || 120); // tope por juego y nivel
const MAX_POOL = 120;
const COOLDOWN_MS = 3 * 60_000; // pausa de un depósito tras un error (cada uno tiene la suya)
const COOLDOWN_QUOTA_MS = 20 * 60_000;

const LEVEL_TEXT: Record<Level, string> = {
  1: 'SUAVE: romper el hielo entre conocidos. Vergüenzas cotidianas, trabajo, viajes, comida, redes y mentiras pequeñas. Nada sexual, nada de desnudos, nada de infidelidad. Si la frase serviría en una comida familiar, está bien.',
  2: 'PICANTE: ya hay confianza y se nota el deseo. Ligues, celos, ex, apps de citas, mensajes que no debiste mandar, casi besos, miradas y secretos de una cita. Lo sexual se entiende claro, pero no describas el acto ni uses palabrotas de cama. Tiene que sentirse más atrevido que una anécdota de oficina.',
  3: 'EXTREMO +18: adultos con confianza. Lenguaje adulto directo, sin eufemismos de colegio. No escribas sexo, sexting, desnudos ni la cama: eso ya está guardado y en la partida se mezcla solo. Esta tanda es otra discordia, y cada frase un conflicto distinto: hipocresía, bandos, rumores, humillación, lealtad, celos, reputación, exclusiones, familia, trabajo y lo que partiría la mesa. Prohibido: menores, no consentimiento, violencia, algo ilegal o peligroso, y obligar a alguien.',
};

const KIND: Record<AiKind, { what: string; format: string; shape: 'text' | 'pair'; examples: () => string[] }> = {
  never: {
    what: 'frases para el juego "Yo nunca" (quien lo hizo, bebe)',
    format: 'Cada frase empieza por "Yo nunca" y termina en punto. Ej: "Yo nunca he mandado un mensaje a la persona equivocada."',
    shape: 'text',
    examples: () => NEVER.map((i) => i.text),
  },
  likely: {
    what: 'preguntas para "¿Quién es más probable que…?"',
    format: 'Escribe SOLO la continuación, sin "¿Quién es más probable que" delante, en tercera persona, terminando en "?". Ej: "llegue tarde a su propia boda?"',
    shape: 'text',
    examples: () => LIKELY.map((i) => i.text),
  },
  would: {
    what: 'dilemas para "Preferirías…"',
    format: 'Cada elemento es un objeto {"a": "...", "b": "..."} con dos opciones breves y parejas en dificultad, sin "Preferirías" delante.',
    shape: 'pair',
    examples: () => WOULD.map((w) => `${w.a} / ${w.b}`),
  },
  truth: {
    what: 'preguntas para "Verdad" en Verdad o reto',
    format: 'Cada pregunta va entre signos "¿...?" y se dirige a "tú".',
    shape: 'text',
    examples: () => TRUTHS.map((i) => i.text),
  },
  dare: {
    what: 'retos para "Reto" en Verdad o reto',
    format:
      'Cada reto es una ACCIÓN que se hace con el cuerpo, la voz o un objeto cotidiano, NO una pregunta ni una confesión (para eso está "Verdad"). ' +
      'Ejemplos de tipos de acción: imitar, mímica, un mini baile, una escena actuada, una voz o acento, hablar de cierta forma durante unas rondas, ' +
      'leer algo en voz dramática, un reto de equilibrio o de cara seria, enviar un mensaje o audio simpático con el celular delante de todos, ' +
      'poner una pose o una cara, hacer reír a alguien sin tocarlo. ' +
      'Se juega en un departamento pequeño y todos sentados cerca: sin salir de la habitación, sin balcón, escaleras, cocina ni baño, sin gritar ni hacer ruido fuerte ' +
      '(hay vecinos), sin mojar ni ensuciar nada, sin comida ni bebida específica, sin objetos que no haya en cualquier sala (usa celular, cojín, vaso, una prenda, tu propia ropa puesta), ' +
      'sin saltar, correr ni pararse sobre muebles, sin tocar a nadie, sin besos, sin quitarse ropa. Debe poder hacerse en menos de 30 segundos y se puede rechazar con un trago.',
    shape: 'text',
    examples: () => DARES.map((i) => i.text),
  },
};

/** Rechaza frases con temas que nunca queremos, aunque la IA se pase. */
const BLOCK = /\b(menor(es)? de edad|ni[ñn][oa]s?|adolescente|pedof|violaci[oó]n|violar|incesto|zoofil|suicid|autolesi|matar|asesin|nazi|racis|droga dura|coca[ií]na|hero[ií]na|\bhttps?:|www\.)/i;

/** Los retos no pueden implicar contacto físico, besos ni quitarse ropa: regla de la casa (todo es de palabra o gestos propios). */
const BLOCK_DARE = /\b(tocar|toques|tocando|t[oó]cale|besa|besar|beso|besos|lame|lamer|muerde|morder|desnud|qu[ií]tate|quitarte|quitar la ropa|ropa interior|sin ropa|acaricia|acariciar|masaj|abraza|abrazar|cu[eé]llo de|espalda de|dibuja con tu dedo|brazo de|mano de|o[ií]do|susurr|quitar[ií]as|quitara|llama a|llamar a|llamada a|gritar|grita|gritando|saltar|salta|saltando|correr|corre|escalera|balc[oó]n|cocina|ba[ñn]o|afuera|la calle|vecin|ventana|mojar|encima de la (mesa|silla|cama)|a la persona (a tu|de tu))/i;

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, '').replace(/\s+/g, ' ').trim();

/** Estilo que no se reparte: se guarda para que el generador no lo repita. */
export function aside(text: string): boolean {
  const t = norm(text);
  return /refrigerador|por el resto de (mi|tu|su) vida|\brealiza\b|\bdemuestra\b|bajo la ducha|en la ducha/.test(t);
}

export type AiItem = string | [string, string];

/** Valida y limpia una frase según el tipo de juego. Devuelve null si no sirve. */
export function cleanItem(kind: AiKind, raw: unknown): AiItem | null {
  if (kind === 'would') {
    if (!raw || typeof raw !== 'object') return null;
    const { a, b } = raw as { a?: unknown; b?: unknown };
    if (typeof a !== 'string' || typeof b !== 'string') return null;
    const A = a.trim().replace(/\s+/g, ' ');
    const B = b.trim().replace(/\s+/g, ' ');
    if (A.length < 6 || B.length < 6 || A.length > 90 || B.length > 90 || norm(A) === norm(B)) return null;
    if (BLOCK.test(A) || BLOCK.test(B) || /^preferir/i.test(A)) return null;
    return [A, B];
  }
  if (typeof raw !== 'string') return null;
  let t = raw.trim().replace(/\s+/g, ' ');
  if (t.length < 12 || t.length > 150 || BLOCK.test(t) || /[{}<>[\]]/.test(t)) return null;
  if (kind === 'never') {
    if (!/^yo nunca/i.test(t)) return null;
    if (!/[.!]$/.test(t)) t += '.';
  } else if (kind === 'likely') {
    t = t.replace(/^¿?\s*qui[eé]n es m[aá]s probable que\s*/i, '');
    if (t.startsWith('¿')) return null;
    if (!t.endsWith('?')) t += '?';
  } else if (kind === 'truth') {
    if (!t.startsWith('¿') || !t.endsWith('?')) return null;
  } else if (/^[¿?]/.test(t) || BLOCK_DARE.test(t)) return null;
  return t.charAt(0) === t.charAt(0).toUpperCase() || kind === 'likely' ? t : t.charAt(0).toUpperCase() + t.slice(1);
}

const STOP = new Set('que para con una uno unos unas los las del por como pero mas muy sus tus esta este esto esa ese eso hay has han fue ser sea hacer tiene tener'.split(' '));
/** Huella de una frase: raíces (5 letras) de sus palabras con contenido. */
export function sig(text: string): Set<string> {
  return new Set(norm(text).split(' ').filter((w) => w.length > 3 && !STOP.has(w)).map((w) => w.slice(0, 5)));
}
/** ¿Dos frases hablan de lo mismo? (mucho solapamiento de palabras con contenido) */
export function similar(a: Set<string>, b: Set<string>): boolean {
  if (a.size < 3 || b.size < 3) return false;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / Math.min(a.size, b.size) >= 0.75 && inter >= 4;
}

const keyOf =(kind: AiKind, level: Level) => `${kind}:${level}`;
const textOf = (i: AiItem) => (typeof i === 'string' ? i : `${i[0]} / ${i[1]}`);

export interface Taken { item: AiItem; id: string | null }
interface Entry { item: AiItem; id: string | null }

/** Lo que se mide de cada frase: solo conteos. */
export interface PhraseStats { shown: number; answered: number; hits: number; accepted: number; declined: number; skipped: number }
export type PhraseDelta = Partial<PhraseStats>;
const zero = (): PhraseStats => ({ shown: 0, answered: 0, hits: 0, accepted: 0, declined: 0, skipped: 0 });
const FIELDS = ['shown', 'answered', 'hits', 'accepted', 'declined', 'skipped'] as const;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Qué tan bien "mueve" una frase a la mesa, de 0 a 1 (null si aún hay pocos datos).
 * - Yo nunca: lo ideal es que divida a la mesa (≈ la mitad dice «yo sí»); si nadie o todos, aburre.
 * - ¿Quién es más probable?: que alguien destaque, sin ser siempre unanimidad.
 * - Preferirías: que la mesa se parta casi por la mitad.
 * - Verdad / reto: que la mayoría lo haga (≈ 70 %); si casi todos lo rechazan, es demasiado fuerte o raro.
 * Cada vez que el anfitrión la salta, baja.
 */
export function phraseScore(kind: AiKind, s: PhraseStats): number | null {
  if (s.shown < 3) return null;
  let base: number;
  if (kind === 'truth' || kind === 'dare') {
    const tries = s.accepted + s.declined;
    if (tries < 3) return null;
    base = 1 - Math.abs(s.accepted / tries - 0.7) / 0.7;
  } else {
    if (s.answered < 4) return null;
    const r = s.hits / s.answered;
    base = kind === 'never' ? 1 - Math.abs(r - 0.5) * 2 : kind === 'would' ? r / 0.5 : 1 - Math.abs(r - 0.55) / 0.55;
  }
  return clamp01(base - Math.min(0.5, s.skipped / s.shown));
}

const RETIRE_BELOW = 0.15; // con 6 apariciones o más y una nota tan baja, la frase se retira
const KINDS: readonly AiKind[] = ['never', 'likely', 'would', 'truth', 'dare'];
const LEVELS: readonly Level[] = [1, 2, 3];
const DUP = Symbol('duplicada');

/** Temas por intensidad: el extremo no puede salir hablando de mascotas ni el suave de la cama. */
const TOPICS: Record<Level, string[]> = {
  1: [
    'el trabajo y la oficina', 'viajes y vacaciones', 'redes sociales y chats de grupo', 'comida y cocina',
    'dinero y compras', 'la universidad y el colegio', 'fiestas y borracheras inocentes', 'familia y suegros',
    'tecnología y el celular', 'mascotas', 'el gimnasio y el deporte', 'series, películas y música',
    'vecinos y la casa', 'el transporte y el tráfico', 'mentiras y excusas', 'ropa y apariencia',
  ],
  2: [
    'ligues que se quedaron a medias', 'celos', 'ex parejas', 'apps de citas', 'mensajes mandados de madrugada',
    'un casi beso', 'miradas y ropa', 'una cita que salió mal', 'mentir para verse con alguien',
    'un crush dentro del grupo', 'dinero gastado para impresionar', 'historias del celular que nadie debería leer',
  ],
  3: [
    'un rumor que parte al grupo', 'elegir un bando en una pelea de pareja', 'humillar con una sonrisa',
    'lealtad contra conveniencia', 'un ex que aparece en la fiesta', 'una alianza secreta dentro de la mesa',
    'celos de la vida de un amigo', 'reputación si alguien graba', 'sacar a alguien del plan',
    'la doble cara entre la mesa y el auto', 'el crédito de una idea ajena',
    'una versión para la familia y otra para el grupo', 'el nuevo al que no presentan',
    'un brindis que en realidad es un reclamo', 'la amistad que no sobreviviría un viaje',
    'el chat que no mostrarías si te pasan el celular',
  ],
};
const pickTopics = (level: Level, n: number) => [...TOPICS[level]].sort(() => Math.random() - 0.5).slice(0, n);

function leveledExamples(kind: AiKind, level: Level): string[] {
  if (kind === 'would') return WOULD.filter((w) => w.level === level).map((w) => `${w.a} / ${w.b}`);
  const src = kind === 'never' ? NEVER : kind === 'likely' ? LIKELY : kind === 'truth' ? TRUTHS : DARES;
  return src.filter((i) => i.level === level).map((i) => i.text);
}

export class AiContent {
  private pools = new Map<string, Entry[]>();
  /** Todas las frases aprobadas de Supabase: se reciclan cuando el modelo no puede generar más. */
  private bank = new Map<string, Entry[]>();
  private bankAt = new Map<string, number>();
  private servedLap = new Set<string>();
  private seen = new Set<string>(); // lo ya generado y lo curado: no se repite
  private sigs: { kind: AiKind; sig: Set<string> }[] = []; // para detectar frases parecidas, no solo idénticas
  private seeded = false;
  private inflight = new Set<string>();
  private retryAt = new Map<string, number>(); // cada depósito tiene su propia pausa: un fallo no frena a los demás
  private quotaUntil = 0; // la cuota sí es de todos
  private db: SqlDb | null = null;
  private writer = { model: 'gemini-3.1-flash-lite', source: 'gemini' };
  private deltas = new Map<string, PhraseStats>();
  private flushing = false;
  /** Para pruebas: sustituye a la llamada de red. */
  fetcher: typeof fetch = (...a) => fetch(...a);

  get enabled() {
    return !!process.env.GEMINI_API_KEY && process.env.AI_CONTENT !== '0';
  }

  /** ¿Se guardan las frases y su medición en la base de datos? */
  get persistent() {
    return this.db !== null;
  }

  private ensureSeeded() {
    if (this.seeded) return;
    this.seeded = true;
    for (const k of Object.keys(KIND) as AiKind[]) {
      for (const e of KIND[k].examples()) {
        this.seen.add(norm(e));
        this.sigs.push({ kind: k, sig: sig(e) });
      }
    }
  }

  /**
   * Conecta la base de datos: las frases aprobadas entran por las menos jugadas, y dentro de ese grupo se mezclan
   * para que una noche no salga solo de la última tanda. Si falta la migración 0003 o la base no responde, todo sigue en memoria.
   */
  async attachDb(db: SqlDb | null) {
    this.db = db;
    if (!db) return;
    try {
      this.ensureSeeded();
      const res = await db.query(
        `select id, kind, level, text, text_b, shown, answered, hits, accepted, declined, skipped
           from ai_phrases where status = 'approved' order by shown asc, created_at desc limit 6000`,
      );
      const retire: string[] = [];
      const buckets = new Map<string, { entry: Entry; shown: number }[]>();
      let loaded = 0;
      for (const r of res.rows) {
        const kind = r.kind as AiKind;
        const level = Number(r.level) as Level;
        if (!KINDS.includes(kind) || !LEVELS.includes(level)) continue;
        const item: AiItem = kind === 'would' ? [String(r.text), String(r.text_b ?? '')] : String(r.text);
        if (typeof item !== 'string' && !item[1]) continue;
        const text = textOf(item);
        this.seen.add(norm(text));
        this.sigs.push({ kind, sig: sig(text) });
        const stats: PhraseStats = { shown: Number(r.shown), answered: Number(r.answered), hits: Number(r.hits), accepted: Number(r.accepted), declined: Number(r.declined), skipped: Number(r.skipped) };
        const score = phraseScore(kind, stats);
        if (score !== null && stats.shown >= 6 && score < RETIRE_BELOW) { retire.push(String(r.id)); continue; }
        const key = keyOf(kind, level);
        const entry = { item, id: String(r.id) };
        const bucket = buckets.get(key) ?? [];
        bucket.push({ entry, shown: Number(r.shown) });
        buckets.set(key, bucket);
        loaded++;
      }
      for (const [key, rows] of buckets) {
        let i = 0;
        while (i < rows.length) {
          let j = i + 1;
          while (j < rows.length && rows[j].shown === rows[i].shown) j++;
          for (let k = j - 1; k > i; k--) {
            const s = i + Math.floor(Math.random() * (k - i + 1));
            [rows[k], rows[s]] = [rows[s], rows[k]];
          }
          i = j;
        }
        const entries = rows.map((row) => row.entry);
        this.bank.set(key, entries);
        this.pools.set(key, entries.slice(0, MAX_POOL));
      }
      if (retire.length) await db.query(`update ai_phrases set status = 'rejected' where id = any($1::uuid[])`, [retire]);
      const held = await db.query(
        `select kind, text, text_b from ai_phrases where status = 'pending' and source = 'gemini' limit 6000`,
      );
      for (const r of held.rows) {
        const kind = r.kind as AiKind;
        if (!KINDS.includes(kind)) continue;
        const text = r.text_b ? `${r.text} / ${r.text_b}` : String(r.text);
        this.seen.add(norm(text));
        this.sigs.push({ kind, sig: sig(text) });
      }
      console.log(`[ai] ${loaded} frase(s) guardadas cargadas${retire.length ? `, ${retire.length} retirada(s) por no funcionar` : ''}${held.rows.length ? `, ${held.rows.length} aparte para el generador` : ''}`);
    } catch (e) {
      console.error('[ai] la base de datos no está lista para las frases (¿falta la migración 0003?); se guardan solo en memoria:', (e as Error).message);
      this.db = null;
    }
  }

  /**
   * El modelo no responde y todavía hay frases guardadas: la mesa debe usarlas, no la lista escrita.
   * Si el banco está vacío, devuelve false y el juego puede recurrir a lo escrito.
   */
  preferSaved(kind: AiKind, level: Level) {
    const key = keyOf(kind, level);
    return this.blocked(key) && (this.bank.get(key)?.length ?? 0) > 0;
  }

  private blocked(key: string) {
    const now = Date.now();
    return now < this.quotaUntil || now < (this.retryAt.get(key) ?? 0);
  }

  private lapId(key: string, entry: Entry) {
    return `${key}\n${entry.id ?? textOf(entry.item)}`;
  }

  /** Guarda la frase en el banco de respaldo, sin duplicar la misma fila. */
  private keep(key: string, entry: Entry) {
    if (!entry.id) return;
    const list = this.bank.get(key) ?? [];
    if (!list.some((e) => e.id === entry.id)) list.push(entry);
    this.bank.set(key, list);
  }

  /** Otra vuelta al banco cuando ya no quedan frases nuevas. No repite la vuelta actual hasta agotarla. */
  private fromBank(key: string): Entry | null {
    const list = this.bank.get(key);
    if (!list?.length) return null;
    const queued = new Set((this.pools.get(key) ?? []).map((e) => e.id).filter((id): id is string => !!id));
    const start = this.bankAt.get(key) ?? 0;
    for (let n = 0; n < list.length; n++) {
      const entry = list[(start + n) % list.length];
      if (entry.id && queued.has(entry.id)) continue;
      if (this.servedLap.has(this.lapId(key, entry))) continue;
      this.bankAt.set(key, (start + n + 1) % list.length);
      this.servedLap.add(this.lapId(key, entry));
      return entry;
    }
    for (const entry of list) this.servedLap.delete(this.lapId(key, entry));
    const first = list.find((entry) => !(entry.id && queued.has(entry.id)));
    if (!first) return null;
    this.servedLap.add(this.lapId(key, first));
    this.bankAt.set(key, (list.indexOf(first) + 1) % list.length);
    return first;
  }

  /** Saca una frase generada con su identificador (para medirla). Si no hay nuevas, recicla las guardadas. */
  takeWithId(kind: AiKind, level: Level): Taken | null {
    if (!this.enabled) return null;
    const key = keyOf(kind, level);
    const pool = this.pools.get(key) ?? [];
    if (pool.length < LOW_WATER && !this.blocked(key)) void this.refill(kind, level);
    const fresh = pool.shift();
    const e = fresh ?? this.fromBank(key);
    if (!e) return null;
    if (fresh) this.servedLap.add(this.lapId(key, e));
    this.record(e.id, { shown: 1 });
    return e;
  }

  /** Saca una frase generada, o null si no hay ninguna guardada (entonces se usa la lista escrita). */
  take(kind: AiKind, level: Level): AiItem | null {
    return this.takeWithId(kind, level)?.item ?? null;
  }

  size(kind: AiKind, level: Level) {
    return this.pools.get(keyOf(kind, level))?.length ?? 0;
  }

  /** Apunta lo que pasó con una frase (se guarda en segundo plano con `flush`). */
  record(id: string | null | undefined, d: PhraseDelta) {
    if (!id || !this.db) return;
    const cur = this.deltas.get(id) ?? zero();
    for (const f of FIELDS) cur[f] += Math.max(0, Math.round(d[f] ?? 0));
    this.deltas.set(id, cur);
  }

  /** Escribe en la base de datos lo apuntado. Se llama cada pocos segundos y al apagar; si falla, se reintenta. */
  async flush() {
    const db = this.db;
    if (!db || this.flushing || this.deltas.size === 0) return;
    this.flushing = true;
    try {
      for (const [id, d] of [...this.deltas]) {
        this.deltas.delete(id);
        try {
          await db.query(
            `update ai_phrases set shown = shown + $2, answered = answered + $3, hits = hits + $4, accepted = accepted + $5,
                    declined = declined + $6, skipped = skipped + $7, used_at = case when $2 > 0 then now() else used_at end
              where id = $1`,
            [id, d.shown, d.answered, d.hits, d.accepted, d.declined, d.skipped],
          );
        } catch (e) {
          const back = this.deltas.get(id) ?? zero();
          for (const f of FIELDS) back[f] += d[f];
          this.deltas.set(id, back);
          console.error('[ai] no se pudo guardar la medición de una frase (se reintentará):', (e as Error).message);
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Cuántas frases aprobadas hay ya guardadas para este juego y nivel. */
  private stock(kind: AiKind, level: Level) {
    return this.bank.get(keyOf(kind, level))?.length ?? 0;
  }

  /** Al arrancar: si un juego aún no llega al tope, pide un lote más. No repite la llamada si ya hay suficientes. */
  async prefill(gapMs = 6_000) {
    if (!this.enabled) return;
    for (const kind of KINDS) {
      for (const level of LEVELS) {
        if (this.stock(kind, level) >= STOCK_LIMIT) continue;
        await this.refill(kind, level);
        if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
      }
    }
  }

  private async save(kind: AiKind, level: Level, item: AiItem): Promise<string | null | typeof DUP> {
    const db = this.db;
    if (!db) return null;
    try {
      const [a, b] = typeof item === 'string' ? [item, null] : item;
      const status = aside(textOf(item)) ? 'pending' : 'approved';
      const res = await db.query(
        `insert into ai_phrases (kind, level, text, text_b, model, source, status) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict do nothing returning id`,
        [kind, level, a, b, this.writer.model, this.writer.source, status],
      );
      return res.rows[0] ? String(res.rows[0].id) : DUP; // sin fila: ya existía exactamente igual
    } catch (e) {
      console.error('[ai] no se pudo guardar una frase (queda solo en memoria):', (e as Error).message);
      return null;
    }
  }

  async refill(kind: AiKind, level: Level): Promise<number> {
    const key = keyOf(kind, level);
    const now = Date.now();
    if (!this.enabled || this.inflight.has(key) || now < this.quotaUntil || now < (this.retryAt.get(key) ?? 0)) return 0;
    if (this.stock(kind, level) >= STOCK_LIMIT) return 0;
    this.inflight.add(key);
    try {
      this.ensureSeeded();
      const raw = await this.generate(kind, level);
      const pool = this.pools.get(key) ?? [];
      let added = 0;
      for (const r of raw) {
        const item = cleanItem(kind, r);
        if (!item) continue;
        const n = norm(textOf(item));
        if (this.seen.has(n)) continue;
        const s = sig(textOf(item));
        if (this.sigs.some((o) => o.kind === kind && similar(o.sig, s))) continue; // misma idea con otras palabras
        const id = await this.save(kind, level, item);
        if (id === DUP) continue;
        this.seen.add(n);
        this.sigs.push({ kind, sig: s });
        if (id && aside(textOf(item))) continue; // queda guardada, pero no entra a la mesa
        const entry = { item, id };
        this.keep(key, entry);
        pool.push(entry);
        added++;
      }
      this.pools.set(key, pool.slice(-MAX_POOL));
      return added;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      const quota = /429|quota|RESOURCE_EXHAUSTED/i.test(msg);
      if (quota) this.quotaUntil = Date.now() + COOLDOWN_QUOTA_MS;
      else this.retryAt.set(key, Date.now() + COOLDOWN_MS);
      const saved = (this.bank.get(key)?.length ?? 0) > 0;
      console.warn(`[ai] ${key}: ${msg} (${saved ? 'se reutilizan las frases ya guardadas' : 'se usa la lista escrita'} ${quota ? 'unos 20' : 'unos 3'} min)`);
      return 0;
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Las frases que mejor y peor funcionaron en las mesas reales (para enseñarle a la IA qué buscar y qué evitar). */
  async learned(kind: AiKind, level: Level): Promise<{ good: string[]; bad: string[] }> {
    const none = { good: [], bad: [] };
    const db = this.db;
    if (!db) return none;
    try {
      const res = await db.query(
        `select text, text_b, shown, answered, hits, accepted, declined, skipped from ai_phrases
          where kind = $1 and level = $2 and shown >= 3 order by shown desc limit 400`,
        [kind, level],
      );
      const scored: { t: string; s: number }[] = [];
      for (const r of res.rows) {
        const s = phraseScore(kind, { shown: Number(r.shown), answered: Number(r.answered), hits: Number(r.hits), accepted: Number(r.accepted), declined: Number(r.declined), skipped: Number(r.skipped) });
        if (s !== null) scored.push({ t: kind === 'would' ? `${r.text} / ${r.text_b}` : String(r.text), s });
      }
      if (scored.length < 8) return none; // todavía hay pocos datos para aprender algo fiable
      scored.sort((a, b) => b.s - a.s);
      return { good: scored.slice(0, 6).map((x) => x.t), bad: scored.slice(-4).filter((x) => x.s < 0.35).map((x) => x.t) };
    } catch {
      return none;
    }
  }

  /** Resumen para el administrador: cuántas frases hay y cuáles funcionan mejor y peor. */
  async report() {
    const db = this.db;
    if (!db) return null;
    const totals = (await db.query(
      `select kind, level::int as level, count(*)::int as total,
              count(*) filter (where status = 'approved')::int as approved, count(*) filter (where status = 'rejected')::int as rejected,
              coalesce(sum(shown), 0)::int as shown
         from ai_phrases group by 1, 2 order by 1, 2`,
    )).rows;
    const rows = (await db.query(
      `select kind, level::int as level, text, text_b, shown, answered, hits, accepted, declined, skipped from ai_phrases where shown >= 3 limit 3000`,
    )).rows;
    const scored = rows
      .map((r) => ({
        kind: String(r.kind), level: Number(r.level), shown: Number(r.shown),
        text: r.text_b ? `${r.text} / ${r.text_b}` : String(r.text),
        score: phraseScore(r.kind as AiKind, { shown: Number(r.shown), answered: Number(r.answered), hits: Number(r.hits), accepted: Number(r.accepted), declined: Number(r.declined), skipped: Number(r.skipped) }),
      }))
      .filter((x): x is typeof x & { score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score);
    return { totals, best: scored.slice(0, 10), worst: scored.slice(-10).reverse() };
  }

  /** Frases apartadas de la mesa: el generador las ve para no repetir ese estilo. */
  private async lessons(kind: AiKind, level: Level): Promise<string[]> {
    const db = this.db;
    if (!db) return [];
    try {
      const res = await db.query(
        `select text, text_b from ai_phrases
          where kind = $1 and level = $2 and status = 'pending' and source = 'gemini'
          order by random() limit 4`,
        [kind, level],
      );
      return res.rows.map((r) => (r.text_b ? `${r.text} / ${r.text_b}` : String(r.text)));
    } catch {
      return [];
    }
  }

  /** Frases ya escritas con otro modelo para este juego y nivel. Si no hay, se usan las de la lista. */
  private async baseSamples(kind: AiKind, level: Level): Promise<{ lines: string[]; fromCursor: boolean }> {
    const db = this.db;
    if (db) {
      try {
        const res = await db.query(
          `select text, text_b from ai_phrases
            where kind = $1 and level = $2 and status = 'approved' and source = 'cursor'
            order by random() limit 8`,
          [kind, level],
        );
        const lines = res.rows.map((r) => (r.text_b ? `${r.text} / ${r.text_b}` : String(r.text)));
        if (lines.length >= 4) return { lines, fromCursor: true };
      } catch { /* sin esa columna, se usa la lista escrita */ }
    }
    const pool = leveledExamples(kind, level);
    const lines = Array.from({ length: 8 }, () => pool[Math.floor(Math.random() * pool.length)]).filter((v, i, a) => v && a.indexOf(v) === i);
    return { lines, fromCursor: false };
  }

  private async generate(kind: AiKind, level: Level): Promise<unknown[]> {
    const spec = KIND[kind];
    const { lines: sample, fromCursor } = await this.baseSamples(kind, level);
    const lessons = await this.lessons(kind, level);
    const { good, bad } = await this.learned(kind, level);
    const heat = level === 1
      ? 'Quédate en lo cotidiano. Si aparece sexo, desnudos o infidelidad, esa frase no sirve.'
      : level === 2
        ? 'Tiene que picar más que una anécdota de oficina: deseo, celos o un mensaje comprometedor, sin describir el acto.'
        : 'Si una frase se podría leer en una cena familiar, está mal: usa lenguaje adulto directo. Cada frase es un conflicto distinto. No escribas sexo ni sexting.';
    const dareHeat = kind === 'dare' && level === 3
      ? 'El reto es de voz, cara o gesto, sin contacto y sin sexo. Alterna una imitación, un anuncio y una cara. Nada de sexting.'
      : kind === 'dare' && level === 1
        ? 'El reto es inocente, sin carga sexual.'
        : '';
    const prompt = [
      `Eres guionista de juegos de fiesta entre amigos adultos (+18), en español latinoamericano neutro. Di celular y no móvil, computadora y no ordenador, auto y no coche, apartamento y no piso, ducha y no regadera. Esas palabras son el vocabulario, no el tema de la frase. Sin vosotros y sin jerga de un solo país. Sin emojis.`,
      `Genera ${BATCH} ${spec.what}, TODAS distintas entre sí, originales y variadas en temática.`,
      `Intensidad: ${LEVEL_TEXT[level]}`,
      heat,
      spec.format,
      dareHeat,
      'Cada frase se dice en voz alta de un solo golpe: una situación concreta, sin explicarla. Alguien que ya va por la segunda copa tiene que entenderla a la primera.',
      level < 3 ? 'Esto no sirve y no lo repitas: pegar el refrigerador, el horno o la ducha a una frase que no los necesita; dilemas de "por el resto de tu vida"; empezar con "Realiza" o "Demuestra". Picante no describe la ducha ni el acto.' : '',
      `Reglas: sin nombres propios, sin pedir datos personales, nada con menores, nada ilegal o peligroso, nada discriminatorio, nada que obligue a nadie (todo se puede rechazar).`,
      `Reparte las frases entre temas como estos (y otros del mismo nivel): ${pickTopics(level, 6).join(', ')}.`,
      sample.length
        ? (fromCursor
          ? `Basa el tono, el español latinoamericano y la intensidad en estas frases ya escritas para este juego. No las copies: otro conflicto, otra situación. ${sample.map((s) => `"${s}"`).join(' | ')}`
          : `Estas ya existen en este nivel: no las copies y no te quedes en su misma suavidad. ${sample.map((s) => `"${s}"`).join(' | ')}`)
        : '',
      good.length ? `Estas funcionaron MUY BIEN en mesas reales (imita su gancho y su nivel, no su tema): ${good.map((s) => `"${s}"`).join(' | ')}` : '',
      bad.length ? `Estas funcionaron mal (evita ese estilo): ${bad.map((s) => `"${s}"`).join(' | ')}` : '',
      lessons.length ? `Estas no se juegan. Están guardadas para que no repitas su estilo ni su idea: ${lessons.map((s) => `"${s}"`).join(' | ')}` : '',
      `Dame ideas NUEVAS: otros temas, otras situaciones y otra estructura. Evita lo parecido a esas (mismo tema con otras palabras cuenta como repetido).`,
      `Responde SOLO con un arreglo JSON de ${spec.shape === 'pair' ? 'objetos {a,b}' : 'cadenas'}.`,
    ].filter(Boolean).join('\n');

    const model = process.env.GEMINI_PARTY_MODEL || process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
    this.writer = { model, source: 'gemini' };
    const generationConfig: Record<string, unknown> = {
      temperature: level === 3 ? 1.25 : 1.15,
      responseMimeType: 'application/json',
      responseSchema:
        spec.shape === 'pair'
          ? { type: 'ARRAY', items: { type: 'OBJECT', properties: { a: { type: 'STRING' }, b: { type: 'STRING' } }, required: ['a', 'b'] } }
          : { type: 'ARRAY', items: { type: 'STRING' } },
    };
    // Sin "pensar" (o lo mínimo): más rápido y gasta menos cuota.
    if (/2\.5/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    else if (/gemini-3/.test(model)) generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };

    const res = await this.fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig }),
      signal: AbortSignal.timeout(150_000),
    });
    if (!res.ok) throw new Error(`Gemini respondió ${res.status}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return asList(JSON.parse(text));
  }
}

function asList(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const list = Object.values(parsed).find(Array.isArray);
    if (list) return list;
  }
  throw new Error('respuesta sin lista');
}

// ---------- Comentarios con gracia sobre la pregunta de la ronda ----------
// Se pide UNA frase corta por ronda revelada. Solo viaja el texto de la pregunta y un resumen sin nombres
// ("3 de 5 dijeron que sí"): nunca nombres ni datos de los jugadores. Tiene límites propios para cuidar la cuota.
const QUIP_PER_MIN = 8;
const QUIP_PER_DAY = 250;
const QUIP_TIMEOUT_MS = 6_000;

export interface QuipRequest {
  game: 'never' | 'likely' | 'would' | 'truth';
  prompt: string;
  /** Resumen del resultado, sin nombres. Ej: "3 de 5 personas dijeron que sí lo han hecho". */
  outcome: string;
  level: Level;
  /** ¿Alguien bebe en esta ronda? Sirve para descartar comentarios que contradicen el resultado. */
  anyDrink?: boolean;
}

/** Arranques y muletillas que delatan un comentario de relleno. */
const FILLER = /^(parece que|veo que|se nota que|qué (grupo|mesa|bonito|lindo|valiente)|interesante|vaya|bueno|bien|claro|ah)\b|\b(todos a beber|a beber ahora|increíble|wow|sin duda alguna|en conclusión)\b/i;
const MAX_WORDS = 16;

/**
 * Una frase de comentario válida: corta, sin emojis ni temas vetados, sin muletillas y, si se pasa la petición,
 * que hable de la pregunta (comparte alguna palabra con ella) y no contradiga el resultado. Devuelve null si no sirve.
 */
export function cleanQuip(raw: unknown, req?: QuipRequest): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().replace(/^["“«'\s]+|["”»'\s]+$/g, '').replace(/\s+/g, ' ');
  if (/^skip\b/i.test(t)) return null; // la IA decidió que no había nada gracioso: habla la lista escrita a mano
  if (t.length < 12 || t.length > 150 || t.split(' ').length > MAX_WORDS) return null;
  if (BLOCK.test(t) || /[{}<>[\]]/.test(t) || /\p{Extended_Pictographic}/u.test(t) || FILLER.test(t)) return null;
  if (req) {
    const stems = sig(req.prompt);
    if (stems.size >= 2) {
      const mine = sig(t);
      let shared = 0;
      for (const w of mine) if (stems.has(w)) shared++;
      if (shared === 0) return null; // no habla de la pregunta
    }
    if (req.anyDrink === false && /\b(beb(e|en|an|er|emos|iendo)|tragos?)\b/i.test(t)) return null;
    if (req.anyDrink === true && /\b(nadie (ha|lo|bebe|confiesa)|cero culpables|todos son santos)\b/i.test(t)) return null;
  }
  return t;
}

const GAME_LABEL: Record<QuipRequest['game'], string> = {
  never: 'Yo nunca (quien lo ha hecho, bebe)',
  likely: '¿Quién es más probable que…? (el más votado bebe)',
  would: 'Preferirías… (la minoría bebe)',
  truth: 'Verdad o reto',
};

export class QuipMaker {
  private stamps: number[] = [];
  private day = '';
  private today = 0;
  private retryAt = 0;
  private recent: Set<string>[] = []; // huellas de los últimos comentarios: no se repite la misma idea
  fetcher: typeof fetch = (...a) => fetch(...a);

  get enabled() {
    return !!process.env.GEMINI_API_KEY && process.env.AI_CONTENT !== '0' && process.env.AI_QUIPS !== '0';
  }

  private fresh(q: string): boolean {
    const s = sig(q);
    if (this.recent.some((o) => similar(o, s))) return false;
    this.recent.push(s);
    if (this.recent.length > 40) this.recent.shift();
    return true;
  }

  private allow(): boolean {
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) { this.day = day; this.today = 0; }
    this.stamps = this.stamps.filter((t) => now - t < 60_000);
    if (now < this.retryAt || this.stamps.length >= QUIP_PER_MIN || this.today >= QUIP_PER_DAY) return false;
    this.stamps.push(now);
    this.today++;
    return true;
  }

  /** Devuelve un comentario de la IA o null (sin clave, sin cuota, error o frase no válida): entonces vale el escrito a mano. */
  async make(req: QuipRequest): Promise<string | null> {
    if (!this.enabled || !this.allow()) return null;
    const prompt = [
      'Eres el presentador de una noche de juegos entre amigos adultos (+18): sarcástico, cariñoso y rápido, en español latino neutro.',
      `Juego: ${GAME_LABEL[req.game]}.`,
      `Pregunta o reto: "${req.prompt}"`,
      `Resultado: ${req.outcome}.`,
      'Escribe UNA sola frase de reacción graciosa (máximo 14 palabras). Tiene que reírse de algo ESPECÍFICO de la pregunta (un objeto, una situación, un detalle concreto) y usar el resultado.',
      'Reglas: sin inventar nada que no esté en la pregunta o el resultado; sin nombres propios, sin emojis, sin insultos ni burlas al cuerpo o a la identidad de nadie, sin marcar género, nada sexual explícito. Ironía seca, como un amigo que se ríe contigo, no de ti. No expliques el chiste.',
      'Nunca empieces con "Parece que", "Veo que", "Qué grupo" ni "Interesante". Evita frases que servirían para cualquier pregunta ("todos tenemos secretos").',
      'Ejemplos BUENOS (pregunta → resultado → frase):',
      '- "Yo nunca he dejado morir una planta." → 3 de 5 sí → "Tres verdugos de plantas confesos; el balcón pide abogado."',
      '- "Yo nunca he buscado mi nombre en internet." → 4 de 5 sí → "Cuatro se googlean y el quinto miente con mucha seguridad."',
      '- "Tener hipo para siempre o estornudar sin parar" → 2 y 2 → "Empate: la mitad prefiere sonar a motor y la otra a gato."',
      'Ejemplos MALOS (no hagas esto): "Qué grupo tan talentoso." · "Parece que alguien recordó los lunes." · "Todos a beber ahora mismo." · cualquier frase sin relación con la pregunta.',
      'Si no se te ocurre algo realmente gracioso y específico, responde exactamente: SKIP',
      'Responde solo con la frase (o SKIP).',
    ].join('\n');
    // Primero el modelo que mejor escribe humor; si está saturado o sin cuota, el de siempre (más barato y con más margen).
    const models = [process.env.GEMINI_QUIP_MODEL || 'gemini-3.5-flash', process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'].filter((m, i, a) => a.indexOf(m) === i);
    let lastError: Error | null = null;
    for (const model of models) {
      const generationConfig: Record<string, unknown> = { temperature: 1, maxOutputTokens: 80 };
      if (/2\.5/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
      else if (/gemini-3/.test(model)) generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
      try {
        const res = await this.fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig }),
          signal: AbortSignal.timeout(QUIP_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`Gemini respondió ${res.status}`);
        const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const q = cleanQuip(data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '', req);
        return q && this.fresh(q) ? q : null; // una respuesta recibida (aunque sea SKIP) termina aquí: no se prueba otro modelo
      } catch (e) {
        lastError = e as Error; // error de red, saturación o cuota: se intenta con el siguiente modelo
      }
    }
    const msg = String(lastError?.message ?? lastError?.name ?? '');
    if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) this.retryAt = Date.now() + COOLDOWN_QUOTA_MS;
    else if (/\b50[0-4]\b|UNAVAILABLE|abort|timeout/i.test(msg)) this.retryAt = Date.now() + 60_000; // servicio saturado: un minuto de pausa
    return null;
  }
}

export const quipMaker = new QuipMaker();

export const aiContent = new AiContent();
