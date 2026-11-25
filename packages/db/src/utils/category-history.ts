import {
  isGenericName,
  type SimilarityFields,
  scoreSimilarTransaction,
  vendorKey,
} from "./transaction-matching";

/**
 * A vendor identity the team has categorised before, with how many of its
 * transactions went to `categorySlug`. Money in and money out are kept apart:
 * a vendor you pay can also refund you.
 */
export type CategoryHistoryEntry = SimilarityFields & {
  categorySlug: string;
  incoming: boolean;
  count: number;
};

/**
 * Stricter than the 0.65 used to suggest similar transactions in the UI:
 * this categorises without asking. Same merchant or counterparty scores
 * 0.95; name-only matches need containment or better.
 */
export const HISTORY_MATCH_THRESHOLD = 0.85;

/** Share of the vendor's past transactions the winning category needs. */
export const HISTORY_MIN_SHARE = 0.75;

function nameKey(name: string): string {
  return vendorKey(name) || name;
}

function tokens(fields: SimilarityFields): string[] {
  const all = [fields.name, fields.merchantName, fields.counterpartyName]
    .flatMap((value) => vendorKey(value).split(" "))
    .filter((token) => token.length >= 3);
  return [...new Set(all)];
}

/**
 * Picks categories from a team's own history, before (and instead of) asking
 * the AI. Build it once per batch; `suggest` is cheap per transaction.
 */
export class CategoryHistory {
  private readonly byToken = new Map<string, CategoryHistoryEntry[]>();
  private readonly counterpartiesByName = new Map<string, string[]>();

  constructor(entries: CategoryHistoryEntry[]) {
    for (const entry of entries) {
      for (const token of tokens(entry)) {
        const list = this.byToken.get(token) ?? [];
        list.push(entry);
        this.byToken.set(token, list);
      }

      if (entry.counterpartyName) {
        const name = entry.name.trim().toLowerCase();
        const list = this.counterpartiesByName.get(name) ?? [];
        list.push(entry.counterpartyName);
        this.counterpartiesByName.set(name, list);
      }
    }
  }

  /**
   * The category this vendor's past transactions agree on, or null when
   * there is no history or it is split (e.g. a PayPal counterparty used for
   * many shops).
   */
  suggest(
    transaction: SimilarityFields & { amount: number },
  ): { categorySlug: string; matches: number } | null {
    const incoming = transaction.amount > 0;
    const genericName = isGenericName([
      ...(transaction.counterpartyName ? [transaction.counterpartyName] : []),
      ...(this.counterpartiesByName.get(
        transaction.name.trim().toLowerCase(),
      ) ?? []),
    ]);

    const candidates = new Set<CategoryHistoryEntry>();
    for (const token of tokens(transaction)) {
      for (const entry of this.byToken.get(token) ?? []) {
        if (entry.incoming === incoming) candidates.add(entry);
      }
    }

    const votes = new Map<string, number>();
    let total = 0;
    // Names are compared as vendor keys, so "Albert Heijn 1234" and
    // "Albert Heijn 5678" are one vendor; merchants and counterparties
    // already are.
    const source = { ...transaction, name: nameKey(transaction.name) };
    for (const entry of candidates) {
      if (
        scoreSimilarTransaction(
          source,
          { ...entry, name: nameKey(entry.name) },
          genericName,
        ) < HISTORY_MATCH_THRESHOLD
      ) {
        continue;
      }
      votes.set(
        entry.categorySlug,
        (votes.get(entry.categorySlug) ?? 0) + entry.count,
      );
      total += entry.count;
    }

    let best: { categorySlug: string; matches: number } | null = null;
    for (const [categorySlug, matches] of votes) {
      if (!best || matches > best.matches) best = { categorySlug, matches };
    }

    return best && best.matches / total >= HISTORY_MIN_SHARE ? best : null;
  }
}
