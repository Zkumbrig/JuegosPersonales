// Comentarios de la mesa: una frase corta y con gracia que reacciona a lo que acaba de pasar en un juego de fiesta.
// Siempre hay uno inmediato escrito a mano (esta lista, sin red ni coste); si la IA está activa, puede llegar uno más
// ocurrente que habla de la pregunta concreta (ver aiContent.quip). Las frases juegan con la situación, nunca se burlan
// de nadie en serio, y evitan marcar género porque no sabemos cómo se identifica cada persona.
// "bebe/beben" se reescribe solo en el modo sin alcohol (soften, en el cliente).

import { pick } from './util';

export type QuipCtx =
  | { game: 'never'; total: number; drinkers: string[] }
  | { game: 'likely'; total: number; drinkers: string[]; votes: number }
  | { game: 'would'; a: number; b: number; drinkers: string[] }
  | { game: 'truth'; kind: 'truth' | 'dare'; resolved: 'done' | 'drink'; name: string }
  | { game: 'reflex'; total: number; early: string[]; best: { name: string; ms: number } | null; last: { name: string; ms: number } | null };

/** "Ana", "Ana y Beto", "Ana, Beto y Carla". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

export function curatedQuip(c: QuipCtx): string {
  switch (c.game) {
    case 'never': {
      const n = c.drinkers.length;
      if (n === 0) return pick(['Cero culpables. O son santos, o mienten muy bien.', 'Nadie ha hecho nada. Qué mesa tan decente… sospechosamente decente.', 'Silencio total. Alguien aquí está mintiendo con mucha confianza.']);
      if (n === 1) return pick([`${c.drinkers[0]} bebe en solitario. Todos lo miramos con mucho interés.`, `Solo ${c.drinkers[0]}. Valiente confesión, y ahora toca contar la historia.`, `${c.drinkers[0]} carga con la culpa de toda la mesa.`]);
      if (c.total >= 3 && n === c.total) return pick(['Todos beben. Esto ya no es un juego, es terapia de grupo.', 'Unanimidad en la culpa. Esta mesa tiene muchas historias que contar.', 'Todos culpables. Menos mal que nadie lleva micrófono.']);
      if (n * 2 > c.total) return pick([`${joinNames(c.drinkers)} beben. La mayoría ha hecho algo, y ahora quiero detalles.`, 'Casi toda la mesa ha caído. La decencia no ganó hoy.']);
      return pick([`${joinNames(c.drinkers)} beben. Los demás: cara de póker, por favor.`, `${joinNames(c.drinkers)} se declaran culpables. Los otros, ya veremos.`]);
    }
    case 'likely': {
      const n = c.drinkers.length;
      if (n === 0) return 'Nadie votó. Qué diplomacia, o qué miedo.';
      if (n > 1) return pick([`Empate entre ${joinNames(c.drinkers)}. La mesa no se decide y todos tienen sospechosos favoritos.`, `${joinNames(c.drinkers)} comparten el título. Que lo celebren juntos.`]);
      if (c.total >= 3 && c.votes === c.total) return pick([`Unanimidad: la mesa entera votó a ${c.drinkers[0]}. Ya no hay defensa posible.`, `Todos señalaron a ${c.drinkers[0]}. Cuando todos coinciden, algo de verdad hay.`]);
      if (c.votes >= 3) return pick([`${c.drinkers[0]} se lleva ${c.votes} votos. La mesa lo tiene clarísimo.`, `${c.drinkers[0]} gana con ${c.votes} votos. No hace falta pedir explicaciones, ya las dio la mesa.`]);
      return pick([`${c.drinkers[0]} gana por poco. Algo habrá hecho para merecerlo.`, `El pueblo ha hablado: ${c.drinkers[0]}.`]);
    }
    case 'would': {
      const total = c.a + c.b;
      if (c.a === c.b) return pick(['Empate perfecto. Nadie cede y todos se miran juzgando.', 'Mitad y mitad: la mesa está dividida y nadie quiere cambiar de bando.']);
      if (c.a === 0 || c.b === 0) return pick(['Unanimidad. Aquí no hubo ni debate: la mesa lo tiene claro.', 'Todos de acuerdo. Qué raro que nadie quiera defender la otra opción.']);
      const min = Math.min(c.a, c.b);
      if (min === 1 && total >= 3) return pick([`${c.drinkers[0]} votó distinto a toda la mesa. Eso es personalidad, o mala decisión.`, `Una sola persona contra todos: ${c.drinkers[0]}. Que explique su elección.`]);
      return pick([`${joinNames(c.drinkers)} quedaron en minoría. A veces la razón no es de la mayoría.`, `La mayoría decidió. ${joinNames(c.drinkers)} pagan el precio de pensar distinto.`]);
    }
    case 'truth': {
      if (c.resolved === 'drink') {
        return c.kind === 'truth'
          ? pick([`${c.name} prefirió beber antes que responder. Respuesta bastante elocuente.`, `${c.name} se saltó la verdad. La mesa sacará sus propias conclusiones.`])
          : pick([`${c.name} no se atrevió con el reto. Se ve que había dignidad en juego.`, `${c.name} rechazó el reto y lo pagó. Decisión sensata, aunque aburrida.`]);
      }
      return c.kind === 'truth'
        ? pick([`${c.name} dijo la verdad. Aplausos, y ahora que nadie lo olvide.`, `${c.name} respondió con valentía. La mesa guarda el secreto, o no.`])
        : pick([`${c.name} cumplió el reto. Ovación para quien lo hizo sin pensar demasiado.`, `Reto cumplido por ${c.name}. Respeto para quien no huyó.`]);
    }
    case 'reflex': {
      if (c.early.length) return pick([`${joinNames(c.early)} se adelantó. La ansiedad le ganó a los reflejos.`, `${joinNames(c.early)} no aguantó la espera. Paciencia, que no era una carrera de verdad.`]);
      if (c.best && c.best.ms < 250) return pick([`${c.best.name} reaccionó en ${c.best.ms} ms. Eso ya no es reflejo, es magia.`, `${c.best.name} volando: ${c.best.ms} ms. El móvil casi no alcanzó a medirlo.`]);
      if (c.last && c.total >= 2) return pick([`${c.last.name} fue el más lento. Hoy el sueño ganó a los reflejos.`, `El último fue ${c.last.name}, con ${c.last.ms} ms. Quizá la mano estaba ocupada con otra cosa.`]);
      return 'Duelo cerrado. Los reflejos son lo de menos si luego se brinda.';
    }
  }
}
