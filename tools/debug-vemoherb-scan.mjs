// Pure-JS reproduction of scanner harvest + relevance + dedup.
// Hits Vemoherb's seed URL and reports what *would* be scanned.

const SEED = "https://vemoherb.com/product-category/health/";
const UA = "Mozilla/5.0 (compatible; CvetitaBot/1.0)";

// ---- Replica of isProductUrl ----
function isProductUrl(url) {
  const lower = url.toLowerCase();
  if (/\.(jpg|jpeg|png|webp|gif|svg|css|js|pdf|xml|json)(?:\?|$)/i.test(lower)) return false;
  if (/\/(cart|checkout|account|login|register|signup|blog|news|article|about|contact|policy|terms|faq|search|wishlist|compare|sitemap|robots)\b/i.test(lower)) return false;
  if (/\/(category|categories|collection|collections|brand|brands|page|pages|tag|tags|author|categoria)s?\/?$/i.test(lower)) return false;
  if (/\/products?\/[a-z0-9]/i.test(lower)) return true;
  if (/\.html$/i.test(lower)) return true;
  if (/\/p\/[a-z0-9]/i.test(lower)) return true;
  try {
    const path = new URL(url).pathname;
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) return false;
    const last = segments[segments.length - 1];
    if (last.length < 4) return false;
    if (last.includes("-")) return true;
    if (/^[a-z0-9]+$/.test(last)) return last.length >= 8;
    return /[а-я]/.test(last);
  } catch { return false; }
}

// ---- Replica of relevance keyword baseline ----
const BASELINE = new Set([
  "магнезий","magnesium","цинк","zinc","tribulus","трибулус","leuzea","левзея",
  "rhodiola","родиола","ashwagandha","ашваганда","ginseng","женшен",
  "екдистерон","ecdysterone","екдистен","ecdystene","омега","omega",
  "creatine","креатин","bcaa","carnitine","карнитин","arginine","аргинин",
  "testosterone","тестостерон","collagen","колаген",
  "ginkgo","гинко","biloba","билоба",
  "vitamin","витамин","d3","k2","b6","b12",
  "тинктура","екстракт","extract","билка","herbal","herbs",
  "имунитет","immune","стрес","sleep","сън","енергия","energy",
]);
const STOP = new Set(["the","and","or","for","of","with","new","pack","kg","mg","ml","100","200","300","500"]);

function scoreUrl(url) {
  let corpus;
  try { const u = new URL(url); corpus = decodeURIComponent(u.pathname + u.search).toLowerCase(); }
  catch { corpus = url.toLowerCase(); }
  const tokens = corpus.replace(/®|™|©/g, "").split(/[\s,/\-_+|()[\]?=&]+/).map(t=>t.trim()).filter(t => t.length>=3 && !STOP.has(t) && !/^\d+$/.test(t));
  const hits = new Set();
  for (const t of tokens) if (BASELINE.has(t)) hits.add(t);
  return { score: hits.size === 0 ? 0 : Math.min(1, 0.4 + hits.size*0.2), hits: [...hits] };
}

// ---- Step 1: harvest from seed page ----
console.log(`=== Step 1: GET ${SEED} ===`);
const t0 = Date.now();
const res = await fetch(SEED, { headers: { "User-Agent": UA, "Accept": "text/html" } });
console.log(`HTTP ${res.status} in ${Date.now()-t0}ms`);
if (!res.ok) process.exit(1);
const html = await res.text();
console.log(`HTML size: ${html.length} bytes`);

const hrefs = new Set();
const anchorRegex = /<a[^>]+href=["']([^"'#]+)["']/gi;
const base = new URL(SEED);
let m;
while ((m = anchorRegex.exec(html))) {
  try {
    const abs = new URL(m[1], SEED).toString();
    const u = new URL(abs);
    if (u.host !== base.host) continue;
    if (!isProductUrl(abs)) continue;
    hrefs.add(abs.split(/[?#]/)[0]);
  } catch {}
}
const harvested = [...hrefs];
console.log(`\n=== Step 2: ${harvested.length} candidate URLs after isProductUrl filter ===`);
for (const u of harvested.slice(0, 30)) console.log("  ", u);
if (harvested.length > 30) console.log(`  ... and ${harvested.length-30} more`);

// ---- Step 3: relevance scoring ----
console.log(`\n=== Step 3: Relevance scores (baseline keywords only) ===`);
const scored = harvested.map(url => ({ url, ...scoreUrl(url) }));
const relevant = scored.filter(s => s.score > 0).sort((a,b)=>b.score-a.score);
console.log(`${relevant.length} pass score > 0`);
for (const s of relevant.slice(0, 20)) {
  console.log(`  score=${s.score.toFixed(2)}  hits=[${s.hits.join(",")}]  ${s.url}`);
}

// ---- Step 4: fetch + extract first 5 relevant ----
console.log(`\n=== Step 4: Fetch + JSON-LD extract first ${Math.min(5, relevant.length)} ===`);
for (const item of relevant.slice(0, 5)) {
  try {
    const r = await fetch(item.url, { headers: { "User-Agent": UA } });
    const h = await r.text();
    // JSON-LD parse
    const matches = h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || [];
    let product = null;
    for (const mt of matches) {
      try {
        const j = JSON.parse(mt.replace(/<script[^>]*>/i,"").replace(/<\/script>/i,"").trim());
        const items = j["@graph"] || [j];
        for (const it of items) {
          if (it["@type"] !== "Product") continue;
          const offers = it.offers || {};
          const price = Number(offers.lowPrice || offers.price || offers.offers?.[0]?.price);
          if (price) {
            product = { name: String(it.name||"").split("|")[0].trim(), price, currency: offers.priceCurrency || "EUR" };
            break;
          }
        }
        if (product) break;
      } catch {}
    }
    const ogTitle = h.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1];
    const ogPrice = h.match(/<meta[^>]+property="product:price:amount"[^>]+content="([^"]+)"/i)?.[1];
    console.log(`  ${item.url}`);
    console.log(`    HTTP ${r.status}, html=${h.length}b`);
    console.log(`    JSON-LD: ${product ? `[${product.price} ${product.currency}] ${product.name}` : "NONE"}`);
    console.log(`    og:title=${ogTitle ? ogTitle.slice(0,80) : "—"}, og:price=${ogPrice ?? "—"}`);
  } catch (e) {
    console.log(`  ${item.url}  ERROR: ${e.message}`);
  }
}
