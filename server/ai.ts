// Frases nuevas generadas con IA (Gemini) para los juegos de fiesta.
// Funciona como un complemento: si no hay clave, la cuota se agota o la red falla, el juego sigue con la lista curada
// (server/content.ts) y nadie lo nota. Las frases se piden por lotes, se filtran y se gastan una sola vez.
// No se envía ningún dato de los jugadores: solo se piden frases genéricas.

import { DARES, LIKELY, NEVER, TRUTHS, WOULD } from './content';

export type AiKind = 'never' | 'likely' | 'would' | 'truth' | 'dare';
type Level = 1 | 2 | 3;

const BATCH = 50;
const LOW_WATER = 12; // al bajar de aquí se pide otro lote
const MAX_POOL = 120;
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
