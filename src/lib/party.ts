/**
 * Modo sin alcohol: reescribe el texto para que "beber" pase a ser "perder un punto".
 * Se hace en el cliente para que el servidor no tenga que duplicar todo el contenido.
 */
export function soften(text: string | null, soft: boolean): string {
  if (!text) return '';
  if (!soft) return text;
  return text
    .replace('Echa un poco de tu bebida en el vaso central', 'Deja un objeto tuyo en el centro de la mesa')
    .replace('Te bebes el vaso central entero. ¡Suerte!', 'Pierdes tres puntos. ¡Suerte!')
    .replace('Quien saque el cuarto rey se lo bebe', 'Quien saque el cuarto rey pierde tres puntos')
    .replace(/\bbebes\b/gi, 'pierdes un punto')
    .replace(/\bbebe\b/gi, 'pierde un punto')
    .replace(/\bbeben\b/gi, 'pierden un punto')
    .replace(/\bbebo\b/gi, 'pierdo un punto')
    .replace(/\bbeber\b/gi, 'perder un punto')
    .replace(/\bbebas\b/gi, 'pierdas un punto');
}

export const drinkNoun = (soft: boolean) => (soft ? 'puntos' : 'tragos');
