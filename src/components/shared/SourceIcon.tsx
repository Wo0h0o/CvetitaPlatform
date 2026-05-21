/**
 * SourceIcon — official brand glyphs for the three data sources we
 * visualise on the home dashboard: Shopify, Meta, Google Ads.
 *
 * Wraps `@icons-pack/react-simple-icons` so the rest of the codebase
 * stays decoupled from that library (one call site to swap if we ever
 * change packages, plus we get to define our own size scale + БГ labels).
 *
 * Why official brand colours, not monochrome silhouettes:
 *   The earlier v1 (monochrome `currentColor` shapes) was palette-pure
 *   but a usability regression — users couldn't quickly tell which icon
 *   was which, especially at 13-16px. Brand recognition is carried by
 *   colour AND shape together; stripping the colour broke the anchor we
 *   were trying to add. So we accept the palette break: brand colours
 *   are sparingly used (only at section/column headers), the rest of
 *   the UI stays greyscale + accent-green.
 *
 * Sizes follow the MarketFlag scale:
 *   - 12-13: mobile stacked-card label, desktop table header cell
 *   - 16-18: section header (KpiStrip)
 *   - 20-24: hero contexts (unused for now)
 */

// Root barrel import — the package declares `sideEffects: false`, so
// Next.js's bundler tree-shakes everything except these three glyphs.
import { SiShopify, SiMeta, SiGoogleads } from "@icons-pack/react-simple-icons";

export type DataSource = "shopify" | "meta" | "google_ads";

interface SourceIconProps {
  source: DataSource;
  /** Rendered pixel size. Defaults to 16 — column-header scale. */
  size?: number;
  /** Optional className for spacing / layout. */
  className?: string;
  /** Custom aria title; defaults to a БГ source name. */
  title?: string;
}

const TITLES: Record<DataSource, string> = {
  shopify: "Shopify",
  meta: "Meta",
  google_ads: "Google Ads",
};

export function SourceIcon({
  source,
  size = 16,
  className,
  title,
}: SourceIconProps) {
  const props = {
    size,
    color: "default" as const,
    title: title ?? TITLES[source],
    className,
  };

  // Each glyph is the official simple-icons brand mark rendered in the
  // brand's primary hex (`color="default"`). The hex comes from the
  // library's per-icon manifest — maintained in sync with the official
  // brand guidelines so we don't drift if a brand refreshes.
  if (source === "shopify") return <SiShopify {...props} />;
  if (source === "meta") return <SiMeta {...props} />;
  return <SiGoogleads {...props} />;
}
