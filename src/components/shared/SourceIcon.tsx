/**
 * SourceIcon — inline monochrome SVG marks for the three data sources
 * we visualise on the home dashboard: Shopify, Meta, Google Ads.
 *
 * Why inline SVG (and not the official brand assets):
 *   • Trademark guidelines: Meta and Google forbid recolouring or
 *     stretching their official multicolour logos. Monochrome silhouette
 *     redrawn from public path data avoids that — same visual anchor,
 *     no brand-asset misuse.
 *   • Palette consistency: the platform is greyscale + accent-green.
 *     Splashing red/blue/yellow brand colours into the header strip
 *     would break the design contract. `currentColor` makes these icons
 *     inherit the surrounding text colour (text-text-3, text-text-2,
 *     accent — whatever the call site uses).
 *   • Zero new dependencies. Mirrors the `MarketFlag` pattern that already
 *     hand-rolls per-country SVGs for the same reasons.
 *
 * Sizes follow the existing scale used by MarketFlag: 14 (inline next to
 * 12px text), 16 (column headers), 20 (section headers).
 *
 * The icons function as VISUAL ANCHORS only — every label that uses one
 * still spells out the source name in БГ text. The icon disambiguates at
 * a glance ("which strip is this?") without becoming the sole signal.
 */

export type DataSource = "shopify" | "meta" | "google_ads";

interface SourceIconProps {
  source: DataSource;
  /** Rendered pixel size. Defaults to 16 — column-header scale. */
  size?: number;
  /** Optional className for spacing / colour overrides. */
  className?: string;
  /** Custom aria-label; defaults to a БГ source name. */
  "aria-label"?: string;
}

const DEFAULT_LABELS: Record<DataSource, string> = {
  shopify: "Shopify",
  meta: "Meta",
  google_ads: "Google Ads",
};

export function SourceIcon({
  source,
  size = 16,
  className,
  "aria-label": ariaLabel,
}: SourceIconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "currentColor",
    role: "img" as const,
    "aria-label": ariaLabel ?? DEFAULT_LABELS[source],
    className,
  };

  if (source === "shopify") {
    // The classic Shopify shopping-bag mark. Path adapted from the
    // simple-icons (CC0) shopify glyph — reduced to a single fill so it
    // sits comfortably alongside text glyphs at small sizes.
    return (
      <svg {...common}>
        <path d="M15.337 2.687c-.176-.135-.394-.214-.62-.227l-.46-.026a4.6 4.6 0 0 0-3.06-.717c-.6.057-1.18.31-1.667.717-1.04.873-1.612 2.392-1.842 3.523-.74.23-1.43.444-2.005.622-1.13.35-1.165.385-1.314 1.45L1.45 20.79 14.31 23l5.7-1.23c.054-.027-2.51-18.61-2.673-18.804a.846.846 0 0 0-.205-.198l-1.795-.08zM13.66 4.93l.59-.183c-.084-.272-.213-.59-.413-.872a1.92 1.92 0 0 0-.563-.527c.342-.108.7-.158 1.062-.146l.085.001-.76 1.726zm-1.18.37c-.747.232-1.547.482-2.341.728.222-.85.643-2.04 1.317-2.61.232-.197.5-.34.792-.422.293.34.486.766.575 1.235.041.218.06.42.058.6l-.4.47zm-1.36-3.04c.21.27.397.602.494.992-.485.15-1.014.314-1.546.479.247-.65.62-1.123 1.052-1.47z"/>
      </svg>
    );
  }

  if (source === "meta") {
    // Meta's "infinity ribbon" mark (post-2021 rebrand). Geometric
    // simplification of the official wordmark glyph — recognisable at
    // 16px without trademark concerns.
    return (
      <svg {...common}>
        <path d="M11.998 4.5c-2.55 0-4.418 1.91-5.873 4.27C4.083 11.94 2.61 14 0 14c.83 1.86 2.34 3 4.07 3 2.42 0 4.12-1.62 5.86-4.34.42-.66.83-1.35 1.24-2.04l.83-1.37c.78 1.27 1.53 2.52 2.27 3.66 1.65 2.55 3.4 4.09 5.74 4.09 1.77 0 3.3-1.13 4.99-3-2.66 0-4.08-2.04-5.87-4.95C17.71 6.93 15.59 4.5 12 4.5zm0 2.3c2.42 0 3.97 1.74 5.34 3.97 1.46 2.37 3.06 4.93 5.66 5.18-.7.5-1.43.75-2.16.75-1.55 0-2.86-1.16-4.4-3.54-.78-1.2-1.55-2.5-2.36-3.82l-.83-1.37-.6.99c-.42.7-.83 1.39-1.24 2.05C8.13 13.66 6.62 14.7 4.07 14.7c-.73 0-1.46-.25-2.16-.75 2.6-.25 4.2-2.81 5.66-5.18 1.37-2.23 2.92-3.97 5.34-3.97z"/>
      </svg>
    );
  }

  // google_ads — the trapezoidal "Ad" mark from the 2018 brand refresh,
  // reduced to a single colour. Two stacked angled bars suggest the
  // ad-creative concept without invoking the multi-colour scheme.
  return (
    <svg {...common}>
      <path d="M4.034 18.79c-1.072-.578-1.522-1.92-1.024-3.04l5.43-9.42 5.34 3.04-5.43 9.42c-.498 1.12-1.84 1.57-2.96 0.972a2.18 2.18 0 0 1-.36-.32l-.996-1.65zM21.99 15.83l-5.4-9.36c-.62-1.08-2.01-1.41-3.06-.78l-2.74 1.58 5.34 9.25c.04.07.08.13.13.2l1 1.74c.62 1.08 2.01 1.41 3.06.78 1.05-.63 1.39-2.01.76-3.09l-.09-.32zM5.84 21.95c1.247 0 2.26-1.012 2.26-2.26 0-1.247-1.013-2.26-2.26-2.26-1.248 0-2.26 1.013-2.26 2.26 0 1.248 1.012 2.26 2.26 2.26z"/>
    </svg>
  );
}
