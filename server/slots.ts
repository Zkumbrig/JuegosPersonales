import { rnd } from './util';
import { SLOT_PAY, type SlotSymbol } from '../shared/protocol';

// Pesos sobre 20 posiciones por rodillo. RTP teórico ≈ 96 %:
//   trío (5·.0429 + 10·.0156 + 20·.008 + 50·.0034 + 200·.000125) + dos cerezas (1·.2389)
const REEL: [SlotSymbol, number][] = [
  ['cherry', 7], ['lemon', 5], ['bell', 4], ['diamond', 3], ['seven', 1],
];
const TOTAL = REEL.reduce((a, [, w]) => a + w, 0);

function pick(): SlotSymbol {
  let r = rnd(TOTAL);
  for (const [sym, w] of REEL) {
    if (r < w) return sym;
    r -= w;
  }
  return 'cherry';
}

export function multiplier(reels: SlotSymbol[]): number {
  if (reels[0] === reels[1] && reels[1] === reels[2]) return SLOT_PAY[reels[0]];
  if (reels.filter((s) => s === 'cherry').length === 2) return 1;
  return 0;
}

export function spin(): { reels: SlotSymbol[]; mult: number } {
  const reels = [pick(), pick(), pick()];
  return { reels, mult: multiplier(reels) };
}
