import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export interface NormalizedPhone {
  e164: string | null;
  raw: string;
  isValid: boolean;
  country: string | null;
}

const EMPTY: NormalizedPhone = { e164: null, raw: "", isValid: false, country: null };

export function normalizePhone(
  input: string | null | undefined,
  defaultCountry: CountryCode = "BG"
): NormalizedPhone {
  if (!input || typeof input !== "string") return EMPTY;
  const raw = input.trim();
  if (!raw) return { ...EMPTY, raw: input };

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

export function pickPhoneFromShopifyOrder(payload: {
  customer?: { phone?: string | null } | null;
  shipping_address?: { phone?: string | null } | null;
  billing_address?: { phone?: string | null } | null;
  phone?: string | null;
}): NormalizedPhone {
  const candidates = [
    payload.customer?.phone,
    payload.shipping_address?.phone,
    payload.billing_address?.phone,
    payload.phone,
  ];
  for (const c of candidates) {
    const n = normalizePhone(c);
    if (n.isValid) return n;
  }
  for (const c of candidates) {
    if (c) return { e164: null, raw: c, isValid: false, country: null };
  }
  return EMPTY;
}
