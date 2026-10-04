/**
 * Barcodes come in several lengths that mean the same product: UPC-A (12), EAN-13 (13, often a
 * UPC-A with a leading zero), EAN-8 and GTIN-14. Everything is compared as GTIN-14 (left-padded
 * with zeros) so "087654321098" and "0087654321098" are the same code.
 */
export function normalizeGtin(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 14) return digits;
  return digits.padStart(14, "0");
}

/** Strip spaces and dashes from a typed or scanned code; null when it is not a plausible GTIN. */
export function cleanGtinInput(input: string | undefined | null): string | null {
  if (!input) return null;
  const digits = input.replace(/[\s-]/g, "");
  if (!/^\d{8,14}$/.test(digits)) return null;
  return normalizeGtin(digits);
}

/** Display form: UPC-A as 12 digits, EAN-13 as 13, otherwise the stored code. */
export function displayGtin(stored: string): string {
  const d = stored.replace(/\D/g, "");
  if (d.length === 14 && d.startsWith("00")) return d.slice(2);
  if (d.length === 14 && d.startsWith("0")) return d.slice(1);
  return d;
}
