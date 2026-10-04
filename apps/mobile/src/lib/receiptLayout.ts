/**
 * Rebuild receipt rows from positioned OCR lines, on the phone. OCR engines read a receipt as
 * two columns (descriptions, then prices) or interleave them unpredictably; with bounding boxes
 * we can put each price back next to its item before the text goes anywhere.
 */
import type { OcrLine } from "../../modules/vision-ocr";

const PRICE = /^-?\$?\d{1,4}\.\d{2}\s*[A-Z*]{0,2}$/;

export interface Row {
  text: string;
  y: number;
}

/** Group lines whose vertical centers fall within `tolerance` (fraction of image height). */
export function reconstructRows(lines: OcrLine[], tolerance = 0.012): Row[] {
  const sorted = [...lines]
    .filter((l) => l.text.trim())
    .map((l) => ({ ...l, cy: l.box.y + l.box.height / 2 }))
    .sort((a, b) => a.cy - b.cy || a.box.x - b.box.x);
  const rows: Array<{ cy: number; parts: typeof sorted }> = [];
  for (const line of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.cy - line.cy) <= Math.max(tolerance, line.box.height * 0.6)) {
      row.parts.push(line);
      row.cy = (row.cy * (row.parts.length - 1) + line.cy) / row.parts.length;
    } else rows.push({ cy: line.cy, parts: [line] });
  }
  return rows.map((r) => {
    const parts = r.parts.sort((a, b) => a.box.x - b.box.x).map((p) => p.text.trim());
    // Keep the price last so the server's parser sees "DESC  3.49 F".
    const priceIdx = parts.findIndex((p) => PRICE.test(p));
    if (priceIdx >= 0 && priceIdx !== parts.length - 1) parts.push(...parts.splice(priceIdx, 1));
    return { text: parts.join("  "), y: r.cy };
  });
}

/** Rows joined with newlines: the text the server's receipt parser expects. */
export function receiptTextFromLines(lines: OcrLine[]): string {
  return reconstructRows(lines)
    .map((r) => r.text)
    .join("\n");
}
