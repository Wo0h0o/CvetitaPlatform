// City lat/lng lookup for the world-map pulsing dots overlay.
//
// Coverage philosophy:
//   * **Bulgaria** — top ~60 cities by population (covers ~95% of БГ
//     orders by volume). Both Cyrillic and Latin aliases for each
//     because Shopify orders ship with whatever the customer typed.
//   * **EU markets we ship to** (GR, RO, DE, IT, HU, SK, UK) — top
//     5-10 cities per country + capitals.
//   * **Anything else** falls back to the country choropleth — no
//     marker, no missing-data error. Add to this file as we expand.
//
// Why client-side and not a Postgres table:
//   * Iteration speed — adding a city alias is a one-line PR, not a
//     migration.
//   * No DB round-trip in the match path.
//   * The full table is ~6kb gzipped — trivial bundle cost.
//
// Matching is alias-based on lowercased input. Two cities in different
// countries with the same name (e.g. multiple "Стара Загора" doesn't
// happen but "Велико Търново" vs Polish "Velikiy Turnov" might) are
// disambiguated by countryCode + alias.

export interface CityEntry {
  /** Canonical display name (БГ Cyrillic for БГ cities, local script otherwise). */
  name: string;
  /** Alternative spellings used in Shopify shipping_address.city. Lowercased on insert. */
  aliases: readonly string[];
  /** ISO 3166-1 alpha-2 country code. */
  country: string;
  lat: number;
  lng: number;
}

// ============================================================
// Bulgaria — top 60 cities (~95% of БГ order volume)
// ============================================================

const CITIES_BG: CityEntry[] = [
  { name: "София", aliases: ["софия", "sofia", "sofiya"], country: "BG", lat: 42.6977, lng: 23.3219 },
  { name: "Пловдив", aliases: ["пловдив", "plovdiv"], country: "BG", lat: 42.1354, lng: 24.7453 },
  { name: "Варна", aliases: ["варна", "varna"], country: "BG", lat: 43.2141, lng: 27.9147 },
  { name: "Бургас", aliases: ["бургас", "burgas", "bourgas"], country: "BG", lat: 42.5048, lng: 27.4626 },
  { name: "Русе", aliases: ["русе", "ruse", "rousse"], country: "BG", lat: 43.8564, lng: 25.9707 },
  { name: "Стара Загора", aliases: ["стара загора", "stara zagora"], country: "BG", lat: 42.4258, lng: 25.6259 },
  { name: "Плевен", aliases: ["плевен", "pleven"], country: "BG", lat: 43.4170, lng: 24.6166 },
  { name: "Сливен", aliases: ["сливен", "sliven"], country: "BG", lat: 42.6816, lng: 26.3155 },
  { name: "Добрич", aliases: ["добрич", "dobrich"], country: "BG", lat: 43.5675, lng: 27.8273 },
  { name: "Шумен", aliases: ["шумен", "shumen", "schumen"], country: "BG", lat: 43.2706, lng: 26.9229 },
  { name: "Перник", aliases: ["перник", "pernik"], country: "BG", lat: 42.6048, lng: 23.0356 },
  { name: "Хасково", aliases: ["хасково", "haskovo", "khaskovo"], country: "BG", lat: 41.9344, lng: 25.5556 },
  { name: "Ямбол", aliases: ["ямбол", "yambol", "iambol"], country: "BG", lat: 42.4837, lng: 26.5034 },
  { name: "Пазарджик", aliases: ["пазарджик", "pazardzhik", "pazardjik"], country: "BG", lat: 42.1937, lng: 24.3324 },
  { name: "Благоевград", aliases: ["благоевград", "blagoevgrad"], country: "BG", lat: 42.0118, lng: 23.0938 },
  { name: "Велико Търново", aliases: ["велико търново", "veliko tarnovo", "veliko turnovo", "v. tarnovo"], country: "BG", lat: 43.0757, lng: 25.6172 },
  { name: "Враца", aliases: ["враца", "vratsa", "vraca"], country: "BG", lat: 43.2102, lng: 23.5527 },
  { name: "Габрово", aliases: ["габрово", "gabrovo"], country: "BG", lat: 42.8740, lng: 25.3174 },
  { name: "Асеновград", aliases: ["асеновград", "asenovgrad"], country: "BG", lat: 42.0188, lng: 24.8757 },
  { name: "Видин", aliases: ["видин", "vidin"], country: "BG", lat: 43.9928, lng: 22.8722 },
  { name: "Казанлък", aliases: ["казанлък", "kazanlak", "kazanluk"], country: "BG", lat: 42.6178, lng: 25.4067 },
  { name: "Кърджали", aliases: ["кърджали", "kardzhali", "kardjali"], country: "BG", lat: 41.6464, lng: 25.3737 },
  { name: "Кюстендил", aliases: ["кюстендил", "kyustendil", "kjustendil"], country: "BG", lat: 42.2832, lng: 22.6911 },
  { name: "Монтана", aliases: ["монтана", "montana"], country: "BG", lat: 43.4123, lng: 23.2256 },
  { name: "Търговище", aliases: ["търговище", "targovishte", "turgovishte"], country: "BG", lat: 43.2486, lng: 26.5722 },
  { name: "Ловеч", aliases: ["ловеч", "lovech"], country: "BG", lat: 43.1417, lng: 24.7156 },
  { name: "Силистра", aliases: ["силистра", "silistra"], country: "BG", lat: 44.1166, lng: 27.2603 },
  { name: "Разград", aliases: ["разград", "razgrad"], country: "BG", lat: 43.5333, lng: 26.5167 },
  { name: "Дупница", aliases: ["дупница", "dupnitsa", "dupnica"], country: "BG", lat: 42.2667, lng: 23.1167 },
  { name: "Свищов", aliases: ["свищов", "svishtov", "svishtoff"], country: "BG", lat: 43.6178, lng: 25.3450 },
  { name: "Смолян", aliases: ["смолян", "smolyan", "smoljan"], country: "BG", lat: 41.5803, lng: 24.6976 },
  { name: "Гоце Делчев", aliases: ["гоце делчев", "gotse delchev", "goce delchev"], country: "BG", lat: 41.5667, lng: 23.7333 },
  { name: "Сандански", aliases: ["сандански", "sandanski"], country: "BG", lat: 41.5667, lng: 23.2833 },
  { name: "Петрич", aliases: ["петрич", "petrich"], country: "BG", lat: 41.4000, lng: 23.2167 },
  { name: "Самоков", aliases: ["самоков", "samokov"], country: "BG", lat: 42.3367, lng: 23.5550 },
  { name: "Лом", aliases: ["лом", "lom"], country: "BG", lat: 43.8222, lng: 23.2375 },
  { name: "Карлово", aliases: ["карлово", "karlovo"], country: "BG", lat: 42.6386, lng: 24.8025 },
  { name: "Велинград", aliases: ["велинград", "velingrad"], country: "BG", lat: 42.0307, lng: 23.9928 },
  { name: "Нова Загора", aliases: ["нова загора", "nova zagora"], country: "BG", lat: 42.4886, lng: 26.0150 },
  { name: "Свиленград", aliases: ["свиленград", "svilengrad"], country: "BG", lat: 41.7647, lng: 26.2056 },
  { name: "Айтос", aliases: ["айтос", "aytos", "aitos"], country: "BG", lat: 42.6987, lng: 27.2484 },
  { name: "Поморие", aliases: ["поморие", "pomorie"], country: "BG", lat: 42.5640, lng: 27.6388 },
  { name: "Несебър", aliases: ["несебър", "nesebar", "nessebar"], country: "BG", lat: 42.6595, lng: 27.7281 },
  { name: "Балчик", aliases: ["балчик", "balchik"], country: "BG", lat: 43.4225, lng: 28.1583 },
  { name: "Каварна", aliases: ["каварна", "kavarna"], country: "BG", lat: 43.4321, lng: 28.3398 },
  { name: "Берковица", aliases: ["берковица", "berkovitsa", "berkovica"], country: "BG", lat: 43.2333, lng: 23.1167 },
  { name: "Ботевград", aliases: ["ботевград", "botevgrad"], country: "BG", lat: 42.9100, lng: 23.7900 },
  { name: "Червен бряг", aliases: ["червен бряг", "cherven bryag", "cherven briag"], country: "BG", lat: 43.2750, lng: 24.0944 },
  { name: "Костинброд", aliases: ["костинброд", "kostinbrod"], country: "BG", lat: 42.8167, lng: 23.2167 },
  { name: "Своге", aliases: ["своге", "svoge"], country: "BG", lat: 42.9683, lng: 23.3500 },
  { name: "Първомай", aliases: ["първомай", "parvomay", "purvomay"], country: "BG", lat: 42.0986, lng: 25.2200 },
  { name: "Карнобат", aliases: ["карнобат", "karnobat"], country: "BG", lat: 42.6500, lng: 26.9833 },
  { name: "Девин", aliases: ["девин", "devin"], country: "BG", lat: 41.7456, lng: 24.4053 },
  { name: "Чепеларе", aliases: ["чепеларе", "chepelare"], country: "BG", lat: 41.7269, lng: 24.6878 },
  { name: "Тетевен", aliases: ["тетевен", "teteven"], country: "BG", lat: 42.9167, lng: 24.2667 },
  { name: "Тутракан", aliases: ["тутракан", "tutrakan"], country: "BG", lat: 44.0500, lng: 26.6000 },
  { name: "Сопот", aliases: ["сопот", "sopot"], country: "BG", lat: 42.6500, lng: 24.7500 },
  { name: "Раднево", aliases: ["раднево", "radnevo"], country: "BG", lat: 42.3000, lng: 25.9333 },
  { name: "Гълъбово", aliases: ["гълъбово", "galabovo", "gulabovo"], country: "BG", lat: 42.1383, lng: 25.8567 },
  { name: "Етрополе", aliases: ["етрополе", "etropole"], country: "BG", lat: 42.8333, lng: 24.0000 },
];

// ============================================================
// Other EU markets we ship to — top cities per country
// ============================================================

const CITIES_OTHER: CityEntry[] = [
  // Greece — Shopify often returns Greek-script city names from native
  // checkout (Αθήνα, Θεσσαλονίκη...) AND Latinised forms from the
  // English storefront. Both must resolve, hence the dual-script alias
  // lists. Also added province-suffixed variants ("athens, attica")
  // that Shopify sometimes emits when the user pastes a full address.
  { name: "Атина", aliases: ["athens", "athina", "athenes", "athènes", "αθήνα", "αθηνα", "athens, attica"], country: "GR", lat: 37.9838, lng: 23.7275 },
  { name: "Солун", aliases: ["thessaloniki", "salonika", "saloniki", "thessalonique", "θεσσαλονίκη", "θεσσαλονικη"], country: "GR", lat: 40.6401, lng: 22.9444 },
  { name: "Патра", aliases: ["patra", "patras", "patrai", "πάτρα", "πατρα"], country: "GR", lat: 38.2466, lng: 21.7346 },
  { name: "Ираклион", aliases: ["heraklion", "iraklion", "heraklio", "ηράκλειο", "ηρακλειο"], country: "GR", lat: 35.3387, lng: 25.1442 },
  { name: "Лариса", aliases: ["larissa", "larisa", "λάρισα", "λαρισα"], country: "GR", lat: 39.6390, lng: 22.4192 },
  { name: "Волос", aliases: ["volos", "βόλος", "βολος"], country: "GR", lat: 39.3666, lng: 22.9420 },
  { name: "Йоанина", aliases: ["ioannina", "yannina", "janina", "ιωάννινα", "ιωαννινα"], country: "GR", lat: 39.6650, lng: 20.8537 },
  { name: "Кавала", aliases: ["kavala", "kavalla", "καβάλα", "καβαλα"], country: "GR", lat: 40.9396, lng: 24.4019 },
  { name: "Халкида", aliases: ["chalcis", "chalkida", "halkida", "χαλκίδα", "χαλκιδα"], country: "GR", lat: 38.4636, lng: 23.5933 },
  { name: "Серес", aliases: ["serres", "σέρρες", "σερρες"], country: "GR", lat: 41.0853, lng: 23.5483 },
  { name: "Александруполи", aliases: ["alexandroupoli", "alexandroupolis", "αλεξανδρούπολη", "αλεξανδρουπολη"], country: "GR", lat: 40.8458, lng: 25.8742 },
  // Romania
  { name: "Букурещ", aliases: ["bucharest", "bucuresti", "bucurești", "bucuresti, sector 1", "bucuresti, sector 2", "bucuresti, sector 3", "bucuresti, sector 4", "bucuresti, sector 5", "bucuresti, sector 6"], country: "RO", lat: 44.4268, lng: 26.1025 },
  { name: "Клуж-Напока", aliases: ["cluj-napoca", "cluj napoca", "cluj"], country: "RO", lat: 46.7712, lng: 23.6236 },
  { name: "Тимишоара", aliases: ["timisoara", "timișoara"], country: "RO", lat: 45.7489, lng: 21.2087 },
  { name: "Яш", aliases: ["iasi", "iași"], country: "RO", lat: 47.1585, lng: 27.6014 },
  { name: "Констанца", aliases: ["constanta", "constanța"], country: "RO", lat: 44.1598, lng: 28.6348 },
  { name: "Брашов", aliases: ["brasov", "brașov", "kronstadt"], country: "RO", lat: 45.6427, lng: 25.5887 },
  { name: "Крайова", aliases: ["craiova"], country: "RO", lat: 44.3302, lng: 23.7949 },
  { name: "Галац", aliases: ["galati", "galați"], country: "RO", lat: 45.4353, lng: 28.0080 },
  { name: "Плоещ", aliases: ["ploiesti", "ploiești"], country: "RO", lat: 44.9469, lng: 26.0274 },
  { name: "Орадя", aliases: ["oradea"], country: "RO", lat: 47.0722, lng: 21.9217 },
  { name: "Сибиу", aliases: ["sibiu", "hermannstadt"], country: "RO", lat: 45.7983, lng: 24.1256 },
  { name: "Арад", aliases: ["arad"], country: "RO", lat: 46.1866, lng: 21.3123 },
  // Germany
  { name: "Berlin", aliases: ["berlin", "берлин"], country: "DE", lat: 52.5200, lng: 13.4050 },
  { name: "Hamburg", aliases: ["hamburg", "хамбург"], country: "DE", lat: 53.5511, lng: 9.9937 },
  { name: "München", aliases: ["munich", "munchen", "münchen", "мюнхен"], country: "DE", lat: 48.1351, lng: 11.5820 },
  { name: "Köln", aliases: ["cologne", "koln", "köln", "кьолн"], country: "DE", lat: 50.9375, lng: 6.9603 },
  { name: "Frankfurt", aliases: ["frankfurt", "frankfurt am main", "франкфурт"], country: "DE", lat: 50.1109, lng: 8.6821 },
  { name: "Stuttgart", aliases: ["stuttgart", "щутгарт"], country: "DE", lat: 48.7758, lng: 9.1829 },
  { name: "Düsseldorf", aliases: ["dusseldorf", "düsseldorf", "дюселдорф"], country: "DE", lat: 51.2277, lng: 6.7735 },
  { name: "Leipzig", aliases: ["leipzig", "лайпциг"], country: "DE", lat: 51.3397, lng: 12.3731 },
  // Italy
  { name: "Roma", aliases: ["rome", "roma", "рим"], country: "IT", lat: 41.9028, lng: 12.4964 },
  { name: "Milano", aliases: ["milan", "milano", "милано"], country: "IT", lat: 45.4642, lng: 9.1900 },
  { name: "Napoli", aliases: ["naples", "napoli", "неапол"], country: "IT", lat: 40.8518, lng: 14.2681 },
  { name: "Torino", aliases: ["turin", "torino", "торино"], country: "IT", lat: 45.0703, lng: 7.6869 },
  { name: "Firenze", aliases: ["florence", "firenze", "флоренция"], country: "IT", lat: 43.7696, lng: 11.2558 },
  { name: "Bologna", aliases: ["bologna", "болоня"], country: "IT", lat: 44.4949, lng: 11.3426 },
  { name: "Venezia", aliases: ["venice", "venezia", "венеция"], country: "IT", lat: 45.4408, lng: 12.3155 },
  { name: "Bari", aliases: ["bari", "бари"], country: "IT", lat: 41.1171, lng: 16.8719 },
  // Hungary
  { name: "Budapest", aliases: ["budapest", "будапеща"], country: "HU", lat: 47.4979, lng: 19.0402 },
  { name: "Debrecen", aliases: ["debrecen", "дебрецен"], country: "HU", lat: 47.5316, lng: 21.6273 },
  { name: "Szeged", aliases: ["szeged", "сегед"], country: "HU", lat: 46.2530, lng: 20.1414 },
  { name: "Pécs", aliases: ["pecs", "pécs", "печ"], country: "HU", lat: 46.0727, lng: 18.2323 },
  { name: "Miskolc", aliases: ["miskolc", "мишколц"], country: "HU", lat: 48.1035, lng: 20.7784 },
  // Slovakia
  { name: "Bratislava", aliases: ["bratislava", "братислава"], country: "SK", lat: 48.1486, lng: 17.1077 },
  { name: "Košice", aliases: ["kosice", "košice", "кошице"], country: "SK", lat: 48.7164, lng: 21.2611 },
  { name: "Žilina", aliases: ["zilina", "žilina"], country: "SK", lat: 49.2231, lng: 18.7394 },
  // UK
  { name: "London", aliases: ["london", "лондон"], country: "GB", lat: 51.5074, lng: -0.1278 },
  { name: "Manchester", aliases: ["manchester", "манчестър"], country: "GB", lat: 53.4808, lng: -2.2426 },
  { name: "Birmingham", aliases: ["birmingham", "бирмингам"], country: "GB", lat: 52.4862, lng: -1.8904 },
  { name: "Glasgow", aliases: ["glasgow", "глазгоу"], country: "GB", lat: 55.8642, lng: -4.2518 },
  { name: "Liverpool", aliases: ["liverpool", "ливърпул"], country: "GB", lat: 53.4084, lng: -2.9916 },
  { name: "Edinburgh", aliases: ["edinburgh", "единбург"], country: "GB", lat: 55.9533, lng: -3.1883 },
  { name: "Bristol", aliases: ["bristol", "бристол"], country: "GB", lat: 51.4545, lng: -2.5879 },
  // Other commonly shipped EU
  { name: "Wien", aliases: ["vienna", "wien", "виена"], country: "AT", lat: 48.2082, lng: 16.3738 },
  { name: "Warszawa", aliases: ["warsaw", "warszawa", "варшава"], country: "PL", lat: 52.2297, lng: 21.0122 },
  { name: "Praha", aliases: ["prague", "praha", "прага"], country: "CZ", lat: 50.0755, lng: 14.4378 },
  { name: "Madrid", aliases: ["madrid", "мадрид"], country: "ES", lat: 40.4168, lng: -3.7038 },
  { name: "Barcelona", aliases: ["barcelona", "барселона"], country: "ES", lat: 41.3851, lng: 2.1734 },
  { name: "Paris", aliases: ["paris", "париж"], country: "FR", lat: 48.8566, lng: 2.3522 },
  { name: "Amsterdam", aliases: ["amsterdam", "амстердам"], country: "NL", lat: 52.3676, lng: 4.9041 },
  { name: "Brussels", aliases: ["brussels", "bruxelles", "брюксел"], country: "BE", lat: 50.8503, lng: 4.3517 },
  { name: "Lisbon", aliases: ["lisbon", "lisboa", "лисабон"], country: "PT", lat: 38.7223, lng: -9.1393 },
  { name: "Dublin", aliases: ["dublin", "дъблин"], country: "IE", lat: 53.3498, lng: -6.2603 },
  { name: "Stockholm", aliases: ["stockholm", "стокхолм"], country: "SE", lat: 59.3293, lng: 18.0686 },
  { name: "København", aliases: ["copenhagen", "kobenhavn", "københavn", "копенхаген"], country: "DK", lat: 55.6761, lng: 12.5683 },
  // Cyprus — served from store_gr today; capital first so
  // lookupCountryAnchor("CY") resolves to Nicosia.
  { name: "Никозия", aliases: ["nicosia", "lefkosia", "λευκωσία", "λευκωσια", "никозия"], country: "CY", lat: 35.1856, lng: 33.3823 },
  { name: "Лимасол", aliases: ["limassol", "lemesos", "λεμεσός", "лимасол"], country: "CY", lat: 34.6786, lng: 33.0413 },
  { name: "Larnaca", aliases: ["larnaca", "larnaka", "λάρνακα", "ларнака"], country: "CY", lat: 34.9229, lng: 33.6233 },
  { name: "Beograd", aliases: ["belgrade", "beograd", "белград"], country: "RS", lat: 44.7866, lng: 20.4489 },
  { name: "Zagreb", aliases: ["zagreb", "загреб"], country: "HR", lat: 45.8150, lng: 15.9819 },
  { name: "Skopje", aliases: ["skopje", "скопие"], country: "MK", lat: 41.9981, lng: 21.4254 },
  { name: "Tirana", aliases: ["tirana", "тирана"], country: "AL", lat: 41.3275, lng: 19.8189 },
  { name: "Istanbul", aliases: ["istanbul", "истанбул", "константинопол"], country: "TR", lat: 41.0082, lng: 28.9784 },
];

const ALL_CITIES = [...CITIES_BG, ...CITIES_OTHER];

// ============================================================
// Match lookup — alias → CityEntry. Built once at module load.
//
// Keys are `${countryCode}|${lowercaseAlias}` so same-name cities in
// different countries don't collide (rare but exists — "Tripoli" in
// Greece vs Libya, etc.).
// ============================================================

// NFD-fold + strip combining marks. Turns "Iași" → "iasi", "Köln" →
// "koln", "Αθήνα" → "αθηνα". Cheaper than maintaining a per-alias
// pre/post pair, and the false-positive risk is minimal — combining
// marks only collapse cases that already share a Latin/Greek base
// letter.
function normalise(s: string): string {
  return s
    .normalize("NFD")
    // U+0300..U+036F is the Unicode "Combining Diacritical Marks" block.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const CITY_INDEX = new Map<string, CityEntry>();
for (const city of ALL_CITIES) {
  for (const alias of city.aliases) {
    CITY_INDEX.set(`${city.country}|${normalise(alias)}`, city);
  }
  // Also index the canonical name normalised — in case Shopify returns
  // the canonical form directly.
  CITY_INDEX.set(`${city.country}|${normalise(city.name)}`, city);
}

/**
 * Resolve a (countryCode, raw city string) to a CityEntry with lat/lng,
 * or null if the city isn't in our lookup table.
 *
 * Normalisation: lowercase + trim + NFD fold (strips combining marks
 * so "Iași" and "Iasi", "Köln" and "Koln", "Αθήνα" and "αθηνα" collapse
 * to the same key). We do NOT attempt fuzzy substring matching —
 * false positives like "Plovdiv" matching "Plovdivsko" would put
 * markers in the wrong place. Miss-then-fall-back-to-choropleth is the
 * safer failure mode.
 */
export function lookupCity(
  countryCode: string,
  rawCity: string
): CityEntry | null {
  if (!countryCode || !rawCity) return null;
  const key = `${countryCode.toUpperCase()}|${normalise(rawCity)}`;
  return CITY_INDEX.get(key) ?? null;
}

// First-listed city per country — used as the geographic anchor when
// we have country-level sales (CountrySales) but no city-level rows
// (foreign-store schemas whose PII-redacted webhooks strip even the
// city field, not just emails). The data file deliberately lists each
// country's capital first; this map captures that convention so the
// "Italy aggregate" fallback dot lands in Rome instead of Bari.
const COUNTRY_ANCHOR = new Map<string, CityEntry>();
for (const city of ALL_CITIES) {
  if (!COUNTRY_ANCHOR.has(city.country)) {
    COUNTRY_ANCHOR.set(city.country, city);
  }
}

/**
 * Geographic anchor for a country — its capital (or first-listed city
 * in cities.ts). Returns null for countries we have no entry for,
 * which the caller should treat as "this country can't be drawn on
 * the map at all".
 */
export function lookupCountryAnchor(countryCode: string): CityEntry | null {
  if (!countryCode) return null;
  return COUNTRY_ANCHOR.get(countryCode.toUpperCase()) ?? null;
}

/**
 * Stats — exposed for diagnostics. How many city aliases are indexed,
 * across how many countries. Logged on the geography page once for
 * debug.
 */
export const CITY_INDEX_STATS = {
  cityCount: ALL_CITIES.length,
  aliasCount: CITY_INDEX.size,
  countries: Array.from(new Set(ALL_CITIES.map((c) => c.country))).sort(),
};
