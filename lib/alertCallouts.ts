import type { MarketingFlag } from "./vault";

// Keep visible alert text aligned with the latest snapshot without reopening
// dismissed alerts or replacing task/report cards.
export function syncAlertCallouts<T extends { kind: string; target: string; label: string }>(
  cards: T[], flags: MarketingFlag[], dashboard: string,
): T[] {
  const active = new Map(flags.filter(flag => flag.level !== "info").map(flag => [`${dashboard}#${flag.code}`, flag.text]));
  let changed = false;
  const result = cards.flatMap(card => {
    if (card.kind !== "doc" || !card.target.startsWith(`${dashboard}#`)) return [card];
    const text = active.get(card.target);
    if (text === undefined) { changed = true; return []; }
    if (text === card.label) return [card];
    changed = true;
    return [{ ...card, label: text }];
  });
  return changed ? result : cards;
}
