/**
 * Audit script for src/lib/phone.ts
 * Exercises normalizePhone() against real-world BG and edge-case inputs.
 * Run: node scripts/test-phone.mjs
 *
 * Mirrors the logic in phone.ts (thin wrapper over libphonenumber-js)
 * so we can validate without a TS runtime.
 */
import { parsePhoneNumberFromString } from "libphonenumber-js";

function normalizePhone(input, defaultCountry = "BG") {
  if (!input || typeof input !== "string") {
    return { e164: null, raw: "", isValid: false, country: null };
  }
  const raw = input.trim();
  if (!raw) return { e164: null, raw: input, isValid: false, country: null };
  const cleaned = raw.replace(/^00/, "+");
  try {
    const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
    if (!parsed) return { e164: null, raw, isValid: false, country: null };
    const valid = parsed.isValid();
    return {
      e164: valid ? parsed.number : null,
      raw,
      isValid: valid,
      country: valid ? (parsed.country ?? null) : null,
    };
  } catch {
    return { e164: null, raw, isValid: false, country: null };
  }
}

const cases = [
  // BG mobile — various formats
  ["0888123456",                "+359888123456", true,  "BG"],
  ["0888 12 34 56",             "+359888123456", true,  "BG"],
  ["+359888123456",             "+359888123456", true,  "BG"],
  ["+359 88 8123 456",          "+359888123456", true,  "BG"],
  ["00359888123456",            "+359888123456", true,  "BG"],
  ["359888123456",              "+359888123456", true,  "BG"],
  ["+359 (88) 812-3456",        "+359888123456", true,  "BG"],
  ["087 7654 321",              "+359877654321", true,  "BG"],
  ["089-555-1234",              "+359895551234", true,  "BG"],

  // BG landline (Sofia)
  ["02 9876543",                "+35929876543",  true,  "BG"],
  ["+359 2 987 6543",           "+35929876543",  true,  "BG"],

  // Foreign customers — should still parse if international format
  // 07911 prefix is actually allocated to Guernsey (shared +44 code) — libphonenumber correctly disambiguates
  ["+44 7911 123456",           "+447911123456", true,  "GG"],
  ["+49 30 12345678",           "+493012345678", true,  "DE"],

  // Invalid / edge cases — should not validate
  ["",                          null,            false, null],
  ["   ",                       null,            false, null],
  [null,                        null,            false, null],
  [undefined,                   null,            false, null],
  ["abc",                       null,            false, null],
  ["12345",                     null,            false, null],            // too short
  ["0888",                      null,            false, null],            // too short BG
];

let pass = 0;
let fail = 0;
const failures = [];

for (const [input, expectedE164, expectedValid, expectedCountry] of cases) {
  const got = normalizePhone(input);
  const ok =
    got.e164 === expectedE164 &&
    got.isValid === expectedValid &&
    (expectedCountry === null ? got.country === null : got.country === expectedCountry);
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push({ input, expected: { e164: expectedE164, isValid: expectedValid, country: expectedCountry }, got });
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  ", JSON.stringify(f));
  process.exit(1);
}
