import type { GameId } from '../../shared/protocol';

export interface Rules {
  title: string;
  icon: string;
  lead: string;
  points: string[];
  /** Lista ordenada opcional (por ejemplo, el ranking de manos del póker). */
  ranking?: { title: string; items: string[] };
}

export const RULES: Record<GameId, Rules> = {
  blackjack: {
    title: 'Blackjack', icon: 'blackjack',
    lead: 'Suma más que el crupier sin pasarte de 21.',
    points: [
      'Del 2 al 10 valen su número, J, Q y K valen 10, y el As vale 1 u 11.',
      'Toca una ficha para apostar (puedes tocar varias veces). La ronda empieza cuando todos han apostado o a los 15 segundos.',
      'En tu turno: Pedir (otra carta), Plantarme, Doblar (doblas la apuesta, recibes una sola carta y te plantas; solo con tus dos primeras cartas) o Dividir.',
      'Dividir: si tus dos primeras cartas valen lo mismo (dos ochos, o un 10 y una figura), puedes separarlas en dos manos. Pagas otra apuesta igual y cada mano recibe una carta nueva. Con ases solo recibes una carta por mano, y un 21 tras dividir no es Blackjack (paga 1 a 1).',
      'Seguro: si el crupier enseña un As, puedes asegurarte por la mitad de tu apuesta. Si tiene Blackjack, el seguro paga 2 a 1 y compensa lo que pierdes; si no, pierdes el seguro y la ronda sigue.',
      'Blackjack (As + carta de 10 con las dos primeras) paga 3 a 2. Ganar paga 1 a 1. Un empate te devuelve la apuesta.',
      'El crupier se planta con 17 o más. Si llegas con la ronda empezada, esperas a la siguiente.',
    ],
  },
  roulette: {
    title: 'Ruleta', icon: 'roulette',
    lead: 'Ruleta europea: del 0 al 36, con un solo cero.',
    points: [
      'Coloca fichas en el tapete. El tiempo (20 s) empieza con la primera apuesta de la mesa.',
      'Número exacto paga 35 a 1. Docena o columna paga 2 a 1.',
      'Rojo, negro, par, impar, 1-18 y 19-36 pagan 1 a 1.',
      'El 0 pierde todas las apuestas externas (colores, par/impar, mitades, docenas y columnas).',
      'Repetir pone otra vez las fichas de tu tirada anterior. Doblar duplica las que tienes ahora en el tapete.',
      'Deshacer quita tu última ficha y Quitar retira todas. Un puntito dorado en una casilla significa que otro jugador ha apostado ahí.',
    ],
  },
  slots: {
    title: 'Tragaperras', icon: 'slots',
    lead: 'Elige tu apuesta y presiona Girar.',
    points: [
      'Tres símbolos iguales dan premio: siete ×200, diamantes ×50, campanas ×20, limones ×10, cerezas ×5.',
      'Dos cerezas devuelven tu apuesta (×1).',
      'El premio se suma cuando los rodillos se paran. A la larga devuelve alrededor del 96 % de lo apostado.',
    ],
  },
  poker: {
    title: 'Póker', icon: 'poker',
    lead: "Texas Hold'em sin límite. Ciegas de 10 y 20.",
    points: [
      'Te sientas con 200, 500 o 1000 fichas de tu cartera. Al levantarte, las que te queden vuelven a ella.',
      'Cada jugador recibe 2 cartas privadas y hay 5 comunitarias (flop de 3, turn y river). Tu mano es la mejor combinación de 5 entre tus 2 y las 5 de la mesa.',
      'En tu turno: Retirarte, Pasar o Igualar, o Subir (como mínimo lo mismo que la última subida). All-in es apostarlo todo.',
      'Gana quien tenga la mejor mano al final o quien se quede solo porque todos se retiran. Los all-in crean botes aparte.',
      'Cada mano empieza cuando todos presionan Repartir (o 10 s después del segundo jugador listo). Tienes 25 s por turno.',
    ],
    ranking: {
      title: 'Manos, de mayor a menor',
      items: ['Escalera de color', 'Póker (cuatro iguales)', 'Full (trío y pareja)', 'Color (cinco del mismo palo)', 'Escalera', 'Trío', 'Doble pareja', 'Pareja', 'Carta alta'],
    },
  },
  party: {
    title: 'Zona Fiesta', icon: 'party',
    lead: 'Seis juegos para jugar cada uno desde su celular.',
    points: [
      'El anfitrión elige el juego y la intensidad: Suave, Picante o Extremo.',
      'Las respuestas son secretas y se revelan a la vez cuando contesta todo el mundo.',
      'Modo sin alcohol: "beber" pasa a ser "perder un punto". Sirve para quien conduce o no bebe.',
      'Nadie está obligado a nada: cualquier reto se puede rechazar. Beban con moderación y alternen con agua.',
    ],
  },
  never: {
    title: 'Yo nunca', icon: 'never',
    lead: 'Sale una frase que empieza por "Yo nunca…".',
    points: [
      'Presiona "Yo sí" si lo has hecho o "Yo no" si no. Nadie ve tu respuesta hasta que contestan todos.',
      'Beben quienes dijeron "Yo sí". El anfitrión pasa a la siguiente frase.',
    ],
  },
  likely: {
    title: '¿Quién es más probable?', icon: 'likely',
    lead: 'Sale una situación y votan por la persona que mejor encaja.',
    points: [
      'Tu voto es secreto hasta que votan todos. Puedes votarte a ti.',
      'La persona con más votos bebe. Si hay empate en lo más alto, beben todos los empatados.',
    ],
  },
  would: {
    title: 'Preferirías…', icon: 'would',
    lead: 'Dos opciones, una sola elección.',
    points: [
      'Elige A o B. Se revela a la vez cuando todos han elegido.',
      'Bebe la minoría. Si hay empate o todos coinciden, nadie bebe: brindan.',
    ],
  },
  truth: {
    title: 'Verdad o reto', icon: 'truth',
    lead: 'Cada turno hay una persona en el centro.',
    points: [
      'Quien está en el centro elige Verdad o Reto y toda la mesa ve la carta.',
      'Puede cumplirla o pasar y beber. Nadie puede obligarle.',
      'El turno va rotando entre los jugadores conectados.',
    ],
  },
  reflex: {
    title: 'Duelo de reflejos', icon: 'reflex',
    lead: 'La pantalla pasa de roja a verde: toca lo más rápido que puedas.',
    points: [
      'Si tocas antes de que se ponga verde, te adelantas y bebes.',
      'Bebe también quien no llega a tocar, o el más lento si todos tocaron a tiempo.',
      'Cada celular mide su propio tiempo desde que le llega el aviso, para que la conexión no decida.',
    ],
  },
  kings: {
    title: 'Rey de copas', icon: 'kings',
    lead: 'Por turnos, cada persona saca una carta y cumple su regla.',
    points: [
      'Cada carta tiene una regla distinta que aparece en pantalla.',
      'Con los Reyes se llena el vaso central: quien saque el cuarto se lo bebe entero.',
      'En el modo sin alcohol, "beber" se cambia por perder puntos.',
    ],
  },
};
