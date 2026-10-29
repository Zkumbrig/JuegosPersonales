// Frases nuevas generadas con IA (Gemini) para los juegos de fiesta.
// Funciona como un complemento: si no hay clave, la cuota se agota o la red falla, el juego sigue con la lista curada
// (server/content.ts) y nadie lo nota. Las frases se piden por lotes, se filtran y se gastan una sola vez.
// No se envía ningún dato de los jugadores: solo se piden frases genéricas.

import { DARES, LIKELY, NEVER, TRUTHS, WOULD } from './content';

export type AiKind = 'never' | 'likely' | 'would' | 'truth' | 'dare';
type Level = 1 | 2 | 3;

const BATCH = 25;
const LOW_WATER = 8; // al bajar de aquí se pide otro lote
const MAX_POOL = 80;
const COOLDOWN_MS = 5 * 60_000;
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

export class AiContent {
  private pools = new Map<string, AiItem[]>();
  private seen = new Set<string>(); // lo ya generado y lo curado: no se repite
  private sigs: { kind: AiKind; sig: Set<string> }[] = []; // para detectar frases parecidas, no solo idénticas
  private inflight = new Set<string>();
  private retryAt = 0;
  /** Para pruebas: sustituye a la llamada de red. */
  fetcher: typeof fetch = (...a) => fetch(...a);

  get enabled() {
    return !!process.env.GEMINI_API_KEY && process.env.AI_CONTENT !== '0';
  }

  /** Saca una frase generada, o null si no hay (entonces se usa la lista curada). Pide más en segundo plano. */
  take(kind: AiKind, level: Level): AiItem | null {
    if (!this.enabled) return null;
    const key = keyOf(kind, level);
    const pool = this.pools.get(key) ?? [];
    if (pool.length < LOW_WATER) void this.refill(kind, level);
    return pool.shift() ?? null;
  }

  size(kind: AiKind, level: Level) {
    return this.pools.get(keyOf(kind, level))?.length ?? 0;
  }

  async refill(kind: AiKind, level: Level): Promise<number> {
    const key = keyOf(kind, level);
    if (!this.enabled || this.inflight.has(key) || Date.now() < this.retryAt) return 0;
    this.inflight.add(key);
    try {
      if (this.seen.size === 0) {
        for (const k of Object.keys(KIND) as AiKind[]) {
          for (const e of KIND[k].examples()) {
            this.seen.add(norm(e));
            this.sigs.push({ kind: k, sig: sig(e) });
          }
        }
      }
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
        this.seen.add(n);
        this.sigs.push({ kind, sig: s });
        pool.push(item);
        added++;
      }
      this.pools.set(key, pool.slice(-MAX_POOL));
      return added;
    } catch (e) {
      const quota = /429|quota|RESOURCE_EXHAUSTED/i.test(String((e as Error)?.message));
      this.retryAt = Date.now() + (quota ? COOLDOWN_QUOTA_MS : COOLDOWN_MS);
      console.warn(`[ai] ${key}: ${(e as Error)?.message ?? e} (se usa la lista curada ${quota ? 'unos 20' : 'unos 5'} min)`);
      return 0;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async generate(kind: AiKind, level: Level): Promise<unknown[]> {
    const spec = KIND[kind];
    const pool = spec.examples();
    const sample = Array.from({ length: 16 }, () => pool[Math.floor(Math.random() * pool.length)]).filter((v, i, a) => a.indexOf(v) === i);
    const prompt = [
      `Eres guionista de juegos de fiesta entre amigos adultos (+18), en español latino neutro, sin regionalismos ni emojis.`,
      `Genera ${BATCH} ${spec.what}, TODAS distintas entre sí, originales y variadas en temática.`,
      `Intensidad: ${LEVEL_TEXT[level]}`,
      spec.format,
      `Reglas: sin nombres propios, sin pedir datos personales, nada con menores, nada ilegal o peligroso, nada discriminatorio, nada que obligue a nadie (todo se puede rechazar).`,
      `Estas ya las tenemos: ${sample.map((s) => `"${s}"`).join(' | ')}`,
      `Dame ideas NUEVAS: otros temas, otras situaciones y otra estructura. Evita lo parecido a esas (mismo tema con otras palabras cuenta como repetido).`,
      `Responde SOLO con un arreglo JSON de ${spec.shape === 'pair' ? 'objetos {a,b}' : 'cadenas'}.`,
    ].join('\n');

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
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`Gemini respondió ${res.status}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('respuesta sin lista');
    return parsed;
  }
}

export const aiContent = new AiContent();
