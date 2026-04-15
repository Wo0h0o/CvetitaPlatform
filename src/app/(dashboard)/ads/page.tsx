import { redirect } from "next/navigation";

// Owner Home cards link to `/ads/[market]` per-market. The bare `/ads`
// URL is kept alive as a redirect to BG (the historical default) so
// existing bookmarks and any deep links created before Day 3 keep
// working. Server-side redirect — no client hydration, no flash.
export default function AdsRedirect() {
  redirect("/ads/bg");
}
