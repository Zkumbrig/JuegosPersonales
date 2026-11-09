// Frases nuevas generadas con IA (Gemini) para los juegos de fiesta.
// Funciona como un complemento: si no hay clave, la cuota se agota o la red falla, el juego sigue con la lista curada
// (server/content.ts) y nadie lo nota. Las frases se piden por lotes, se filtran y se gastan una sola vez.
// No se envía ningún dato de los jugadores: solo se piden frases genéricas.

import { DARES, LIKELY, NEVER, TRUTHS, WOULD } from './content';
import type { SqlDb } from './db';

export type AiKind = 'never' | 'likely' | 'would' | 'truth' | 'dare';
type Level = 1 | 2 | 3;

const BATCH = 50;
const LOW_WATER = 12; // al bajar de aquí se pide otro lote
const MAX_POOL = 120;
const COOLDOWN_MS = 3 * 60_000; // pausa de un depósito tras un error (cada uno tiene la suya)
const COOLDOWN_QUOTA_MS = 20 * 60_000;

const LEVEL_TEXT: Record<Level, string> = {
  1: 'SUAVE: para romper el hielo, anécdotas vergonzosas o graciosas de la vida cotidiana. Nada sexual.',
  2: 'PICANTE: ya hay confianza; ligues, celos, ex parejas, mensajes comprometedores, vergüenzas fuertes. Insinuaciones, sin explicitud.',
  3: 'EXTREMO: solo para adultos y valientes; sexo, fantasías, infidelidad, sexting, secretos oscuros, pero NADA gráfico, nada ilegal ni peligroso, nada con menores y nada que obligue a nadie.',
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
  return inter / Math.min(a.size, b.size) >= 0.6 && inter >= 3;
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

/** Temas para repartir cada lote: así las frases no se parecen entre sí ni a las de la noche anterior. */
const TOPICS = [
  'el trabajo y la oficina', 'viajes y vacaciones', 'redes sociales y chats de grupo', 'comida y cocina', 'ex parejas y citas',
  'dinero y compras', 'la universidad y el colegio', 'fiestas y borracheras', 'familia y suegros', 'tecnología y el celular',
  'mascotas', 'el gimnasio y el deporte', 'series, películas y música', 'vecinos y la casa', 'el transporte y el tráfico',
  'mentiras y excusas', 'ropa y apariencia', 'trabajos raros y primeras veces', 'amigos y secretos', 'internet y las búsquedas',
];
const pickTopics = (n: number) => [...TOPICS].sort(() => Math.random() - 0.5).slice(0, n);

export class AiContent {
  private pools = new Map<string, Entry[]>();
  private seen = new Set<string>(); // lo ya generado y lo curado: no se repite
  private sigs: { kind: AiKind; sig: Set<string> }[] = []; // para detectar frases parecidas, no solo idénticas
  private seeded = false;
  private inflight = new Set<string>();
  private retryAt = new Map<string, number>(); // cada depósito tiene su propia pausa: un fallo no frena a los demás
  private quotaUntil = 0; // la cuota sí es de todos
  private db: SqlDb | null = null;
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
   * Conecta la base de datos: las frases aprobadas se cargan en los depósitos (primero las que menos han salido) y se vigilan
   * las repetidas. Si falta la migración 0003 o la base no responde, todo sigue como antes (solo en memoria).
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
        const pool = this.pools.get(key) ?? [];
        if (pool.length < MAX_POOL) pool.push({ item, id: String(r.id) });
        this.pools.set(key, pool);
        loaded++;
      }
      if (retire.length) await db.query(`update ai_phrases set status = 'rejected' where id = any($1::uuid[])`, [retire]);
      console.log(`[ai] ${loaded} frase(s) guardadas cargadas${retire.length ? `, ${retire.length} retirada(s) por no funcionar` : ''}`);
    } catch (e) {
      console.error('[ai] la base de datos no está lista para las frases (¿falta la migración 0003?); se guardan solo en memoria:', (e as Error).message);
      this.db = null;
    }
  }

  /** Saca una frase generada con su identificador (para medirla), o null si no hay. Pide más en segundo plano. */
  takeWithId(kind: AiKind, level: Level): Taken | null {
    if (!this.enabled) return null;
    const key = keyOf(kind, level);
    const pool = this.pools.get(key) ?? [];
    if (pool.length < LOW_WATER) void this.refill(kind, level);
    const e = pool.shift();
    if (!e) return null;
    this.record(e.id, { shown: 1 });
    return e;
  }

  /** Saca una frase generada, o null si no hay (entonces se usa la lista curada). */
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

  /** Al arrancar: rellena en segundo plano los depósitos que están bajos (lo guardado en la base de datos ya cuenta). */
  async prefill(gapMs = 6_000) {
    if (!this.enabled) return;
    for (const kind of KINDS) {
      for (const level of LEVELS) {
        if (this.size(kind, level) >= LOW_WATER) continue;
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
      const res = await db.query(
        `insert into ai_phrases (kind, level, text, text_b, model, source) values ($1, $2, $3, $4, $5, 'gemini')
         on conflict do nothing returning id`,
        [kind, level, a, b, process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'],
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
        pool.push({ item, id });
        added++;
      }
      this.pools.set(key, pool.slice(-MAX_POOL));
      return added;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      const quota = /429|quota|RESOURCE_EXHAUSTED/i.test(msg);
      if (quota) this.quotaUntil = Date.now() + COOLDOWN_QUOTA_MS;
      else this.retryAt.set(key, Date.now() + COOLDOWN_MS);
      console.warn(`[ai] ${key}: ${msg} (se usa la lista curada ${quota ? 'unos 20' : 'unos 3'} min)`);
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

  private async generate(kind: AiKind, level: Level): Promise<unknown[]> {
    const spec = KIND[kind];
    const pool = spec.examples();
    const sample = Array.from({ length: 16 }, () => pool[Math.floor(Math.random() * pool.length)]).filter((v, i, a) => a.indexOf(v) === i);
    const { good, bad } = await this.learned(kind, level);
    const prompt = [
      `Eres guionista de juegos de fiesta entre amigos adultos (+18), en español latino neutro, sin regionalismos ni emojis.`,
      `Genera ${BATCH} ${spec.what}, TODAS distintas entre sí, originales y variadas en temática.`,
      `Intensidad: ${LEVEL_TEXT[level]}`,
      spec.format,
      `Reglas: sin nombres propios, sin pedir datos personales, nada con menores, nada ilegal o peligroso, nada discriminatorio, nada que obligue a nadie (todo se puede rechazar).`,
      `Reparte las frases entre temas como estos (y otros distintos): ${pickTopics(6).join(', ')}.`,
      `Estas ya las tenemos: ${sample.map((s) => `"${s}"`).join(' | ')}`,
      good.length ? `Estas funcionaron MUY BIEN en mesas reales (imita su gancho y su nivel, no su tema): ${good.map((s) => `"${s}"`).join(' | ')}` : '',
      bad.length ? `Estas funcionaron mal (evita ese estilo): ${bad.map((s) => `"${s}"`).join(' | ')}` : '',
      `Dame ideas NUEVAS: otros temas, otras situaciones y otra estructura. Evita lo parecido a esas (mismo tema con otras palabras cuenta como repetido).`,
      `Responde SOLO con un arreglo JSON de ${spec.shape === 'pair' ? 'objetos {a,b}' : 'cadenas'}.`,
    ].filter(Boolean).join('\n');

    const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
    const generationConfig: Record<string, unknown> = {
      temperature: 1.1,
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
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('respuesta sin lista');
    return parsed;
  }
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
