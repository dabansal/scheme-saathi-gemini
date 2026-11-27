/**
 * Defense-in-depth PII masking utilities.
 * Aadhaar numbers are always masked to the last 4 digits (XXXX-XXXX-1234).
 * Bank account numbers are masked to the last 4 digits (XXXX1234).
 * No raw identifiers are ever logged or persisted.
 */

const AADHAAR_REGEX = /\b(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})\b/g;
const LONG_ACCOUNT_REGEX = /\b\d{9,18}\b/g;

export function maskAadhaarInText(text: string): string {
  if (!text) return "";
  return text.replace(AADHAAR_REGEX, (_match, _g1, _g2, last4: string) => `XXXX-XXXX-${last4}`);
}

export function maskBankAccountInText(text: string): string {
  if (!text) return "";
  // Run Aadhaar masking first so 12-digit Aadhaar stays formatted as XXXX-XXXX-1234
  const aadhaarMasked = maskAadhaarInText(text);
  return aadhaarMasked.replace(LONG_ACCOUNT_REGEX, (digits: string) => {
    const last4 = digits.slice(-4);
    return `XXXX${last4}`;
  });
}

export function maskSensitiveText(text: string): string {
  return maskBankAccountInText(text);
}

export function maskIdentifierValue(raw: string | undefined, isAadhaar: boolean): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return undefined;
  const last4 = digits.slice(-4);
  if (isAadhaar) {
    return `XXXX-XXXX-${last4}`;
  }
  return `XXXX${last4}`;
}

export function sanitizeStringArray(items: string[] | undefined): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => maskSensitiveText(item.trim()));
}
