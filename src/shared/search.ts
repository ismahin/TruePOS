export type SearchMatchRange = {
  start: number;
  end: number;
};

export type SearchableProduct = {
  name: string;
  sku: string;
  barcode: string;
  category?: string;
};

export function normalizeSearchText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/[\s\-_./\\]+/g, "");
}

function searchTokens(query: string) {
  return normalizeSearchText(query).split(" ").filter(Boolean);
}

function isSeparator(character: string) {
  return /[\s\-_./\\]/.test(character);
}

function mergeRanges(ranges: SearchMatchRange[]) {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: SearchMatchRange[] = [{ ...sorted[0] }];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

function pushAllIndexes(haystack: string, needle: string, ranges: SearchMatchRange[]) {
  if (!needle) return;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    ranges.push({ start: index, end: index + needle.length });
    index = haystack.indexOf(needle, index + Math.max(1, needle.length));
  }
}

/** Contiguous compact match, ignoring separators in the original text. */
export function findCompactMatchRanges(text: string, query: string): SearchMatchRange[] {
  const compactQuery = compactSearchText(query);
  if (!compactQuery) return [];
  const lower = text.toLowerCase();
  let queryIndex = 0;
  let rangeStart = -1;

  for (let textIndex = 0; textIndex < lower.length; textIndex += 1) {
    const character = lower[textIndex];
    if (isSeparator(character)) continue;
    if (character === compactQuery[queryIndex]) {
      if (rangeStart === -1) rangeStart = textIndex;
      queryIndex += 1;
      if (queryIndex === compactQuery.length) {
        return [{ start: rangeStart, end: textIndex + 1 }];
      }
    } else if (rangeStart !== -1) {
      textIndex = rangeStart;
      queryIndex = 0;
      rangeStart = -1;
    }
  }

  return [];
}

/**
 * Fuzzy subsequence match: query chars appear in order in the text
 * (e.g. "es32" inside "ESP32").
 */
export function findSubsequenceRanges(text: string, query: string): SearchMatchRange[] {
  const compactQuery = compactSearchText(query);
  if (!compactQuery) return [];
  const lower = text.toLowerCase();
  const matchedIndexes: number[] = [];
  let queryIndex = 0;

  for (let textIndex = 0; textIndex < lower.length && queryIndex < compactQuery.length; textIndex += 1) {
    const character = lower[textIndex];
    if (isSeparator(character)) continue;
    if (character === compactQuery[queryIndex]) {
      matchedIndexes.push(textIndex);
      queryIndex += 1;
    }
  }

  if (queryIndex < compactQuery.length || matchedIndexes.length === 0) return [];

  const ranges: SearchMatchRange[] = [];
  let start = matchedIndexes[0];
  let end = matchedIndexes[0] + 1;
  for (let index = 1; index < matchedIndexes.length; index += 1) {
    const current = matchedIndexes[index];
    if (current === end) {
      end = current + 1;
    } else {
      ranges.push({ start, end });
      start = current;
      end = current + 1;
    }
  }
  ranges.push({ start, end });
  return ranges;
}

export function findMatchRanges(text: string, query: string): SearchMatchRange[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!text || !normalizedQuery) return [];
  const lower = text.toLowerCase();
  const ranges: SearchMatchRange[] = [];

  pushAllIndexes(lower, normalizedQuery, ranges);
  for (const token of searchTokens(normalizedQuery)) {
    if (token === normalizedQuery) continue;
    pushAllIndexes(lower, token, ranges);
  }

  if (ranges.length === 0) {
    ranges.push(...findCompactMatchRanges(text, normalizedQuery));
  }
  if (ranges.length === 0) {
    ranges.push(...findSubsequenceRanges(text, normalizedQuery));
  }

  return mergeRanges(ranges.filter((range) => range.end > range.start && range.start >= 0 && range.end <= text.length));
}

function subsequenceQuality(haystack: string, needle: string) {
  if (!haystack || !needle || needle.length > haystack.length) return 0;
  let hayIndex = 0;
  let needleIndex = 0;
  let first = -1;
  let last = -1;
  while (hayIndex < haystack.length && needleIndex < needle.length) {
    if (haystack[hayIndex] === needle[needleIndex]) {
      if (first === -1) first = hayIndex;
      last = hayIndex;
      needleIndex += 1;
    }
    hayIndex += 1;
  }
  if (needleIndex < needle.length || first < 0 || last < first) return 0;
  const span = last - first + 1;
  const density = needle.length / span;
  // Prefer denser matches and queries that cover more of the field.
  const coverage = needle.length / haystack.length;
  return density * 0.7 + coverage * 0.3;
}

function fieldScore(
  fieldValue: string,
  query: string,
  weights: { exact: number; prefix: number; includes: number; compact: number; tokenPrefix: number; fuzzy: number }
) {
  const field = normalizeSearchText(fieldValue);
  const q = normalizeSearchText(query);
  if (!field || !q) return 0;
  if (field === q) return weights.exact;
  if (field.startsWith(q)) return weights.prefix;
  if (field.includes(q)) return weights.includes + Math.max(0, 40 - Math.abs(field.length - q.length));

  const compactField = compactSearchText(fieldValue);
  const compactQuery = compactSearchText(query);
  if (compactField && compactQuery) {
    if (compactField === compactQuery) return weights.compact + 80;
    if (compactField.startsWith(compactQuery)) return weights.compact + 40;
    if (compactField.includes(compactQuery)) return weights.compact;

    const quality = subsequenceQuality(compactField, compactQuery);
    if (quality > 0) {
      // Require reasonable density so random letters don't flood results.
      if (quality >= 0.45 || compactQuery.length <= 3) {
        return Math.round(weights.fuzzy * quality);
      }
    }
  }

  const tokens = searchTokens(q);
  if (tokens.length > 1 && tokens.every((token) => field.includes(token) || compactField.includes(compactSearchText(token)))) {
    return weights.tokenPrefix;
  }

  const words = field.split(" ");
  if (tokens.some((token) => words.some((word) => word.startsWith(token)))) {
    return weights.tokenPrefix - 20;
  }

  return 0;
}

export function scoreProductMatch(product: SearchableProduct, query: string) {
  const q = normalizeSearchText(query);
  if (!q) return 0;

  const barcodeScore = fieldScore(product.barcode, q, {
    exact: 10_000,
    prefix: 8_500,
    includes: 7_000,
    compact: 9_000,
    tokenPrefix: 6_500,
    fuzzy: 5_500
  });
  const skuScore = fieldScore(product.sku, q, {
    exact: 9_500,
    prefix: 8_000,
    includes: 6_500,
    compact: 8_800,
    tokenPrefix: 6_000,
    fuzzy: 5_200
  });
  const nameScore = fieldScore(product.name, q, {
    exact: 5_000,
    prefix: 4_200,
    includes: 3_200,
    compact: 3_800,
    tokenPrefix: 3_600,
    fuzzy: 2_800
  });
  const categoryScore = fieldScore(product.category ?? "", q, {
    exact: 1_500,
    prefix: 1_200,
    includes: 900,
    compact: 1_000,
    tokenPrefix: 800,
    fuzzy: 500
  });

  return Math.max(barcodeScore, skuScore, nameScore, categoryScore);
}

export function rankSearchResults<T extends SearchableProduct>(items: T[], query: string) {
  const q = normalizeSearchText(query);
  if (!q) return [...items];

  return items
    .map((item, index) => ({ item, index, score: scoreProductMatch(item, q) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name) || a.index - b.index)
    .map((entry) => entry.item);
}

/** Rank any list using the same product-search scoring against mapped name/sku/barcode/category fields. */
export function rankBySearchFields<T>(items: T[], query: string, getFields: (item: T) => SearchableProduct) {
  const q = normalizeSearchText(query);
  if (!q) return [...items];

  return items
    .map((item, index) => ({ item, index, score: scoreProductMatch(getFields(item), q) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      const nameA = getFields(a.item).name;
      const nameB = getFields(b.item).name;
      return b.score - a.score || nameA.localeCompare(nameB) || a.index - b.index;
    })
    .map((entry) => entry.item);
}

export function bestSearchMatch<T extends SearchableProduct>(items: T[], query: string) {
  const ranked = rankSearchResults(items, query);
  return ranked[0];
}

/** When searching, always take the top ranked hit; otherwise keep the current selection if still present. */
export function pickBestProductId<T extends { id: string }>(items: T[], query: string, currentId = "") {
  if (items.length === 0) return "";
  if (normalizeSearchText(query)) return items[0]?.id ?? "";
  if (currentId && items.some((item) => item.id === currentId)) return currentId;
  return items[0]?.id ?? "";
}
