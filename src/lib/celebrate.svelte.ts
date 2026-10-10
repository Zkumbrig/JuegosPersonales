export const fx = $state({ n: 0, big: false });

/** Lanza la lluvia de monedas. `big` = premio gordo (más monedas). */
export function celebrate(big = false) {
  fx.big = big;
  fx.n++;
}
