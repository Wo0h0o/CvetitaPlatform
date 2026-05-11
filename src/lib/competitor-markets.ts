/**
 * Best-effort detection of which national markets a competitor serves.
 *
 * Combines four signals from the homepage HTML + TLD:
 *   1) <link rel="alternate" hreflang="..."> tags
 *   2) Currency strings present in the markup
 *   3) Top-level domain heuristic
 *   4) Sister-domain discovery (hreflang href values)
 *
 * Returns ISO country codes (BG, RO, EL, DE, UK, IT, GR) deduped & sorted.
 */

const TLD_MARKET: Record<string, string> = {
  bg: "BG",
  ro: "RO",
  gr: "EL", // Greece — using EL per ISO 639 (consistent with i18n in this project)
  de: "DE",
  uk: "UK",
  it: "IT",
  hu: "HU",
  pl: "PL",
};

// Lang code (hreflang) → market mapping. Lang ≠ country, but a strong signal.
const HREFLANG_MARKET: Record<string, string> = {
  bg: "BG",
  "bg-bg": "BG",
  ro: "RO",
  "ro-ro": "RO",
  el: "EL",
  "el-gr": "EL",
  "el-cy": "EL",
  de: "DE",
  "de-de": "DE",
  "de-at": "DE",
  en: "UK",
  "en-gb": "UK",
  "en-uk": "UK",
  it: "IT",
  "it-it": "IT",
  hu: "HU",
  "hu-hu": "HU",
};

const CURRENCY_MARKET: Array<{ pattern: RegExp; market: string }> = [
  { pattern: /\bBGN\b|\bлв\.?/, market: "BG" },
  { pattern: /\bRON\b|\blei\b/i, market: "RO" },
  { pattern: /\bHUF\b|\bFt\b/, market: "HU" },
  { pattern: /\bPLN\b|\bzł\b/i, market: "PL" },
  { pattern: /£\d/, market: "UK" },
];

export interface MarketDetection {
  markets: string[];
  sisterDomains: string[];
}

export function extractMarketsFromHtml(html: string, domain: string): MarketDetection {
  const markets = new Set<string>();
  const sisterDomains = new Set<string>();

  // 1) TLD heuristic — primary market signal
  const tldMatch = domain.toLowerCase().match(/\.([a-z]{2,3})(?:\.[a-z]{2,3})?$/);
  if (tldMatch && TLD_MARKET[tldMatch[1]]) {
    markets.add(TLD_MARKET[tldMatch[1]]);
  }

  // 2) hreflang tags
  const hreflangRegex = /<link[^>]+rel=["']alternate["'][^>]*hreflang=["']([^"']+)["'][^>]*href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hreflangRegex.exec(html))) {
    const lang = m[1].toLowerCase();
    const href = m[2];
    if (HREFLANG_MARKET[lang]) {
      markets.add(HREFLANG_MARKET[lang]);
    }
    // Sister domains: alternate href on a *different* domain
    try {
      const u = new URL(href, `https://${domain}`);
      if (u.hostname && u.hostname.replace(/^www\./, "") !== domain.replace(/^www\./, "")) {
        sisterDomains.add(u.hostname.replace(/^www\./, ""));
      }
    } catch {
      // ignore malformed URL
    }
  }

  // Alt order: href first, hreflang second (some sites flip them)
  const altReverseRegex = /<link[^>]+rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*hreflang=["']([^"']+)["']/gi;
  while ((m = altReverseRegex.exec(html))) {
    const lang = m[2].toLowerCase();
    const href = m[1];
    if (HREFLANG_MARKET[lang]) markets.add(HREFLANG_MARKET[lang]);
    try {
      const u = new URL(href, `https://${domain}`);
      if (u.hostname && u.hostname.replace(/^www\./, "") !== domain.replace(/^www\./, "")) {
        sisterDomains.add(u.hostname.replace(/^www\./, ""));
      }
    } catch {
      // ignore
    }
  }

  // 3) Currency strings
  for (const { pattern, market } of CURRENCY_MARKET) {
    if (pattern.test(html)) markets.add(market);
  }

  // €/EUR is ambiguous (whole eurozone); only add if no national signal exists
  if (markets.size === 0 && /€\d|\bEUR\b/.test(html)) {
    // We can't pinpoint a single market — leave empty so UI shows "неустановен".
  }

  return {
    markets: Array.from(markets).sort(),
    sisterDomains: Array.from(sisterDomains).sort(),
  };
}

/**
 * Flag emoji for a 2-letter market code. Returns empty string for unknown.
 */
export function marketFlag(market: string): string {
  const flags: Record<string, string> = {
    BG: "🇧🇬",
    RO: "🇷🇴",
    EL: "🇬🇷",
    GR: "🇬🇷",
    DE: "🇩🇪",
    UK: "🇬🇧",
    IT: "🇮🇹",
    HU: "🇭🇺",
    PL: "🇵🇱",
  };
  return flags[market] || "🏳️";
}

export function marketLabel(market: string): string {
  const labels: Record<string, string> = {
    BG: "България",
    RO: "Румъния",
    EL: "Гърция",
    GR: "Гърция",
    DE: "Германия",
    UK: "Великобритания",
    IT: "Италия",
    HU: "Унгария",
    PL: "Полша",
  };
  return labels[market] || market;
}
