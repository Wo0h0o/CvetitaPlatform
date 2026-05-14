/**
 * MarketFlag — inline SVG flags for our 6 markets.
 *
 * Why SVG and not emoji (🇧🇬🇬🇷🇷🇴):
 * Unicode regional-indicator pairs rely on an emoji font to render as a
 * flag. When the font is missing or overridden by CSS, they fall back to
 * the bare letter pair ("BG", "GR", "RO") — which is exactly what was
 * happening in the TopBar switcher on Windows. SVG renders identically
 * on every OS and respects font-size via the `size` prop.
 *
 * Sizes are keyed to common UI contexts:
 *   - 16: TopBar chip, inline list items
 *   - 20: StoreCard header, PageHeader
 *   - 24: big contexts (future)
 *
 * Aspect ratio is 3:2 (ISO standard for national flags).
 */

interface MarketFlagProps {
  /** Market code — "bg", "gr", "ro", "de", "it", "uk", "sk", "hu". Case-insensitive. */
  market: string;
  /** Height in px. Width is auto-derived from 3:2 aspect. Defaults to 16. */
  size?: number;
  className?: string;
  /** If false, the flag is aria-hidden (decorative). Defaults to false. */
  labelled?: boolean;
}

const MARKET_LABEL: Record<string, string> = {
  bg: "България",
  gr: "Гърция",
  ro: "Румъния",
  de: "Германия",
  it: "Италия",
  uk: "Великобритания",
  sk: "Словакия",
  hu: "Унгария",
};

export function MarketFlag({
  market,
  size = 16,
  className,
  labelled = false,
}: MarketFlagProps) {
  const code = market.toLowerCase();
  const height = size;
  const width = Math.round((size * 3) / 2);

  const commonProps = {
    width,
    height,
    viewBox: "0 0 3 2",
    preserveAspectRatio: "none" as const,
    className: `inline-block shrink-0 rounded-[1.5px] ${className ?? ""}`.trim(),
    "aria-hidden": labelled ? undefined : true,
    "aria-label": labelled ? MARKET_LABEL[code] ?? code.toUpperCase() : undefined,
    role: labelled ? "img" : undefined,
  };

  // Bulgaria 🇧🇬 — white, green (#00966E), red (#D62612) horizontal.
  if (code === "bg") {
    return (
      <svg {...commonProps}>
        <rect width="3" height="2" fill="#fff" />
        <rect y="0.6667" width="3" height="0.6667" fill="#00966E" />
        <rect y="1.3333" width="3" height="0.6667" fill="#D62612" />
      </svg>
    );
  }

  // Greece 🇬🇷 — 9 blue/white stripes + canton with white cross on blue.
  // Official blue is #0D5EAF. Simplified to the 9 stripes + canton for
  // a 3:2 viewBox; canton is 5 stripes tall and ~5/13 wide.
  if (code === "gr") {
    const blue = "#0D5EAF";
    const stripe = 2 / 9;
    const canton = stripe * 5; // height
    return (
      <svg {...commonProps}>
        <rect width="3" height="2" fill="#fff" />
        {/* 4 blue stripes at rows 1, 3, 5, 7, 9 (1-indexed) */}
        <rect y={stripe * 1} width="3" height={stripe} fill={blue} />
        <rect y={stripe * 3} width="3" height={stripe} fill={blue} />
        <rect y={stripe * 5} width="3" height={stripe} fill={blue} />
        <rect y={stripe * 7} width="3" height={stripe} fill={blue} />
        {/* Canton (top-left, covers first 5 stripes' height) */}
        <rect width={canton} height={canton} fill={blue} />
        {/* White cross inside canton — vertical and horizontal arms */}
        <rect
          x={canton * 0.4}
          y={0}
          width={canton * 0.2}
          height={canton}
          fill="#fff"
        />
        <rect
          x={0}
          y={canton * 0.4}
          width={canton}
          height={canton * 0.2}
          fill="#fff"
        />
      </svg>
    );
  }

  // Romania 🇷🇴 — blue (#002B7F), yellow (#FCD116), red (#CE1126) vertical.
  if (code === "ro") {
    return (
      <svg {...commonProps}>
        <rect width="1" height="2" fill="#002B7F" />
        <rect x="1" width="1" height="2" fill="#FCD116" />
        <rect x="2" width="1" height="2" fill="#CE1126" />
      </svg>
    );
  }

  // Germany 🇩🇪 — black, red (#DD0000), gold (#FFCE00) horizontal thirds.
  if (code === "de") {
    return (
      <svg {...commonProps}>
        <rect width="3" height="0.6667" fill="#000000" />
        <rect y="0.6667" width="3" height="0.6667" fill="#DD0000" />
        <rect y="1.3333" width="3" height="0.6667" fill="#FFCE00" />
      </svg>
    );
  }

  // Italy 🇮🇹 — green (#009246), white, red (#CE2B37) vertical thirds.
  if (code === "it") {
    return (
      <svg {...commonProps}>
        <rect width="1" height="2" fill="#009246" />
        <rect x="1" width="1" height="2" fill="#ffffff" />
        <rect x="2" width="1" height="2" fill="#CE2B37" />
      </svg>
    );
  }

  // United Kingdom 🇬🇧 — Union Jack. Approximated for a 3:2 viewBox: blue
  // field with white + red diagonals and a centred white-edged red cross.
  // Exact ratios are simplified for inline SVG; readable at 16px.
  if (code === "uk") {
    return (
      <svg {...commonProps}>
        {/* Blue field */}
        <rect width="3" height="2" fill="#012169" />
        {/* White diagonals (X) */}
        <path d="M0,0 L3,2 M3,0 L0,2" stroke="#ffffff" strokeWidth="0.4" />
        {/* Red diagonals (offset for the Northern Ireland convention) */}
        <path d="M0,0 L3,2" stroke="#C8102E" strokeWidth="0.2" />
        <path d="M3,0 L0,2" stroke="#C8102E" strokeWidth="0.2" />
        {/* White cross of St George (background) */}
        <rect x="1.25" width="0.5" height="2" fill="#ffffff" />
        <rect y="0.75" width="3" height="0.5" fill="#ffffff" />
        {/* Red cross of St George (foreground) */}
        <rect x="1.35" width="0.3" height="2" fill="#C8102E" />
        <rect y="0.85" width="3" height="0.3" fill="#C8102E" />
      </svg>
    );
  }

  // Slovakia 🇸🇰 — white, blue (#0B4EA2), red (#EE1C25) horizontal thirds.
  // Coat of arms (white double-cross on red shield over three blue hills) is
  // unreadable at 16px so we omit it — same simplification ISO flag libraries
  // make at small sizes. Still unambiguously SK against HU and CZ.
  if (code === "sk") {
    return (
      <svg {...commonProps}>
        <rect width="3" height="0.6667" fill="#ffffff" />
        <rect y="0.6667" width="3" height="0.6667" fill="#0B4EA2" />
        <rect y="1.3333" width="3" height="0.6667" fill="#EE1C25" />
      </svg>
    );
  }

  // Hungary 🇭🇺 — red (#CE2939), white, green (#477050) horizontal thirds.
  if (code === "hu") {
    return (
      <svg {...commonProps}>
        <rect width="3" height="0.6667" fill="#CE2939" />
        <rect y="0.6667" width="3" height="0.6667" fill="#ffffff" />
        <rect y="1.3333" width="3" height="0.6667" fill="#477050" />
      </svg>
    );
  }

  // Unknown market — neutral grey placeholder. Keeps layout stable.
  return (
    <svg {...commonProps}>
      <rect width="3" height="2" fill="var(--surface-2, #e5e7eb)" />
      <rect
        x="0.1"
        y="0.1"
        width="2.8"
        height="1.8"
        fill="none"
        stroke="var(--border, #d4d4d8)"
        strokeWidth="0.05"
      />
    </svg>
  );
}
