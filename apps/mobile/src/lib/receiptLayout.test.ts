import { describe, expect, it } from "vitest";
import { receiptTextFromLines, reconstructRows } from "./receiptLayout";

const L = (text: string, x: number, y: number, w = 0.3, h = 0.02) => ({ text, confidence: 1, box: { x, y, width: w, height: h } });

describe("receipt row reconstruction", () => {
  it("pairs each price with the item on the same row even when OCR read the columns separately", () => {
    const lines = [
      L("JIF CRMY PNT BTR 16Z", 0.05, 0.10),
      L("BOARS HEAD LVRWRST", 0.05, 0.14),
      L("BNNA ORG", 0.05, 0.18),
      L("3.49 F", 0.80, 0.101, 0.12),
      L("6.99 F", 0.80, 0.142, 0.12),
      L("2.58 F", 0.80, 0.179, 0.12),
    ];
    expect(receiptTextFromLines(lines)).toBe("JIF CRMY PNT BTR 16Z  3.49 F\nBOARS HEAD LVRWRST  6.99 F\nBNNA ORG  2.58 F");
  });
  it("keeps the price last and tolerates slight skew", () => {
    const rows = reconstructRows([L("4.49", 0.8, 0.300, 0.1), L("SUNNY VALLEY GRN JCE", 0.05, 0.308)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe("SUNNY VALLEY GRN JCE  4.49");
  });
  it("does not merge distinct rows", () => {
    const rows = reconstructRows([L("A", 0.05, 0.10), L("B", 0.05, 0.16), L("C", 0.05, 0.22)]);
    expect(rows.map((r) => r.text)).toEqual(["A", "B", "C"]);
  });
});
