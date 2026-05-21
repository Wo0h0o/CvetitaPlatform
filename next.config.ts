import type { NextConfig } from "next";

// MapLibre GL spins workers from blob: URLs (worker-src 'self' blob:) and
// fetches Stadia Maps style.json + vector tiles + glyphs + sprites
// (tiles.stadiamaps.com). Raster sprites/icons hit the same host, hence
// the img-src entry. Domain authentication is configured in the Stadia
// dashboard — no API key in client code.
const ContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://cdn.shopify.com https://*.shopify.com https://*.shopifycdn.com https://*.fbcdn.net https://*.facebook.com https://tiles.stadiamaps.com",
  "font-src 'self' data:",
  "connect-src 'self' https://qggrlwfphxyoslrqkajw.supabase.co https://tiles.stadiamaps.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
].join("; ");

const securityHeaders = [
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: ContentSecurityPolicy,
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
