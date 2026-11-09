// Página privada del administrador: cuántas frases de la IA hay guardadas y cuáles funcionan mejor y peor en las mesas.
// Solo muestra el texto de las frases y conteos: nada de personas.

import type { AiContent } from './ai';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const KIND_NAME: Record<string, string> = { never: 'Yo nunca', likely: '¿Quién es más probable?', would: 'Preferirías…', truth: 'Verdad', dare: 'Reto' };
const LEVEL_NAME: Record<number, string> = { 1: 'Suave', 2: 'Picante', 3: 'Extremo' };

type Report = NonNullable<Awaited<ReturnType<AiContent['report']>>>;

const table = (head: string[], rows: unknown[][]) =>
  `<table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>` +
  (rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}">Todavía no hay datos</td></tr>`) +
  '</table>';

export function renderPhrases(report: Report | null): string {
  if (!report) {
    return '<!doctype html><meta charset="utf-8"><title>Frases</title><p style="font:16px system-ui;padding:24px">Las frases guardadas necesitan la base de datos (DATABASE_URL) y la migración 0003.</p>';
  }
  const total = report.totals.reduce((n, r) => n + Number(r.total), 0);
  const stock = table(
    ['Juego', 'Nivel', 'Guardadas', 'Activas', 'Retiradas', 'Veces mostradas'],
    report.totals.map((r) => [KIND_NAME[String(r.kind)] ?? r.kind, LEVEL_NAME[Number(r.level)] ?? r.level, r.total, r.approved, r.rejected, r.shown]),
  );
  const rank = (rows: Report['best']) =>
    table(['Frase', 'Juego', 'Nivel', 'Veces', 'Nota'], rows.map((r) => [r.text, KIND_NAME[r.kind] ?? r.kind, LEVEL_NAME[r.level] ?? r.level, r.shown, `${Math.round(r.score * 100)} %`]));
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Frases</title>
<style>body{font:16px/1.5 system-ui;background:#0d0a12;color:#eee;max-width:980px;margin:0 auto;padding:20px}table{border-collapse:collapse;margin:8px 0 26px;width:100%}td,th{padding:6px 12px;border-bottom:1px solid #333;text-align:left;vertical-align:top}h2{margin:28px 0 4px;font-size:1.05rem;color:#ecb8a4}small{color:#999}</style></head><body>
<h1>Frases de la IA</h1>
<p>Guardadas en total: <b>${esc(total)}</b>. La nota mide si la frase «mueve» a la mesa (que divida opiniones, que se cumpla, que nadie la salte); se calcula con 3 o más apariciones.</p>
<h2>Existencias</h2>${stock}
<h2>Las que mejor funcionan</h2>${rank(report.best)}
<h2>Las que peor funcionan</h2>${rank(report.worst)}
<p><small>Solo texto de frases y conteos: sin datos personales. Añade ?format=json para los datos crudos.</small></p></body></html>`;
}
