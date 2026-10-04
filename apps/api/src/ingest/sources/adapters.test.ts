import { describe, expect, it } from "vitest";
import { fixtureFetcher } from "../fixtureLoader.js";
import { CpscAdapter, cpscSeverity } from "./cpsc.js";
import { FdaAdapter, categorize, classifySeverity, openFdaUrl } from "./fda.js";
import { FsisAdapter, companyFromTitle } from "./fsis.js";

const window = { since: new Date("2026-09-01T00:00:00Z"), until: new Date("2026-10-04T00:00:00Z") };

describe("FDA adapter", () => {
  it("builds a windowed, paged openFDA URL", () => {
    const url = openFdaUrl("food", window, 200, "KEY");
    expect(url).toContain("https://api.fda.gov/food/enforcement.json?");
    expect(url).toContain("search=report_date:[20260901+TO+20261004]");
    expect(url).toContain("skip=200");
    expect(url).toContain("api_key=KEY");
  });
  it("maps classification to severity", () => {
    expect(classifySeverity("Class I")).toBe("critical");
    expect(classifySeverity("Class II")).toBe("high");
    expect(classifySeverity("Class III")).toBe("low");
    expect(classifySeverity(undefined)).toBe("unknown");
  });
  it("categorises food subtypes", () => {
    expect(categorize({ recall_number: "x", product_type: "Food", product_description: "Freeze-dried raw chicken dog food" }, "food")).toBe("veterinary");
    expect(categorize({ recall_number: "x", product_type: "Food", product_description: "Vitamin D3 softgels dietary supplement" }, "food")).toBe("dietary_supplement");
    expect(categorize({ recall_number: "x", product_type: "Food", product_description: "Peanut butter" }, "food")).toBe("food");
    expect(categorize({ recall_number: "x", product_type: "Drugs", product_description: "Metformin tablets" }, "drug")).toBe("drug");
  });
  it("normalises fixture records across endpoints, tolerating NOT_FOUND", async () => {
    const items = await new FdaAdapter(["food", "drug", "device"], fixtureFetcher).fetch(window);
    expect(items.map((i) => i.sourceId).sort()).toEqual(["D-0211-2026", "F-1399-2026", "F-1456-2026", "F-1460-2026", "F-1471-2026"]);
    const jif = items.find((i) => i.sourceId === "F-1456-2026")!;
    expect(jif.severity).toBe("critical");
    expect(jif.upcs).toEqual(["00051500241281"]);
    expect(jif.distributionStates).toEqual(["US"]);
    expect(jif.company).toBe("J.M. Smucker Co.");
    expect(jif.title).toMatch(/^J\.M\. Smucker Co\.: Jif Creamy Peanut Butter/);
    expect(jif.publishedAt.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(jif.recallDate?.toISOString()).toBe("2026-09-18T00:00:00.000Z");
    const juice = items.find((i) => i.sourceId === "F-1460-2026")!;
    expect(juice.distributionStates).toEqual(["AZ", "CA", "NV", "OR"]);
    expect(juice.brands).toContain("Sunny Valley");
    expect(juice.upcs).toEqual(["00851234007011"]);
    const pet = items.find((i) => i.sourceId === "F-1471-2026")!;
    expect(pet.category).toBe("veterinary");
    expect(items.find((i) => i.sourceId === "F-1399-2026")!.status).toBe("completed");
    expect(jif.codeInfo).toContain("Lot codes 1274425");
    expect(jif.remedy).toMatch(/return it to the place of purchase|do not use/i);
  });
});

describe("FSIS adapter", () => {
  it("extracts company from the headline", () => {
    expect(companyFromTitle("Boar's Head Provisions Co. Recalls Ready-To-Eat Liverwurst Products")).toBe("Boar's Head Provisions Co.");
    expect(companyFromTitle("FSIS Issues Public Health Alert for Frozen Chicken")).toBe("FSIS");
  });
  it("filters by window, drops Spanish duplicates, flags alerts", async () => {
    const items = await new FsisAdapter(fixtureFetcher).fetch(window);
    expect(items.map((i) => i.sourceId).sort()).toEqual(["031-2026", "PHA-10022026-01"]);
    const bh = items.find((i) => i.sourceId === "031-2026")!;
    expect(bh.severity).toBe("critical");
    expect(bh.category).toBe("meat_poultry");
    expect(bh.status).toBe("ongoing");
    expect(bh.upcs).toEqual(["00042421055051"]);
    expect(bh.url).toBe("https://www.fsis.usda.gov/recalls-alerts/boars-head-provisions-co-recalls-ready-eat-liverwurst-products-due-possible-listeria");
    expect(bh.summary).not.toContain("<p>");
    expect(bh.codeInfo).toMatch(/sell-by dates 10\/15\/2026/i);
    expect(bh.remedy).toMatch(/urged not to consume/i);
    const pha = items.find((i) => i.sourceId === "PHA-10022026-01")!;
    expect(pha.title).toMatch(/Public Health Alert/);
    expect(pha.severity).toBe("high");
    expect(pha.distributionStates).toEqual(["AL", "FL", "GA"]);
  });
});

describe("CPSC adapter", () => {
  it("derives severity from injuries/hazards", () => {
    expect(cpscSeverity({ RecallID: 1, Injuries: [{ Name: "One death reported" }] })).toBe("critical");
    expect(cpscSeverity({ RecallID: 1, Hazards: [{ Name: "Burn" }] })).toBe("high");
    expect(cpscSeverity({ RecallID: 1, Hazards: [{ Name: "Violation of federal standard" }] })).toBe("low");
    expect(cpscSeverity({ RecallID: 1 })).toBe("unknown");
  });
  it("normalises fixture records", async () => {
    const items = await new CpscAdapter(fixtureFetcher).fetch(window);
    expect(items).toHaveLength(2);
    const mug = items.find((i) => i.sourceId === "27-001")!;
    expect(mug.upcs.sort()).toEqual(["00041604302046", "00041604302211"]);
    expect(mug.company).toBe("Pacific Market International (Stanley)");
    expect(mug.category).toBe("consumer_product");
    expect(mug.imageUrls).toHaveLength(1);
    expect(mug.summary).toContain("Sold at: Amazon.com, Target");
    expect(mug.reason).toMatch(/^Burn/);
    expect(mug.codeInfo).toBe("Model: 20-01437, 20-02211");
    expect(mug.remedy).toContain("Remedy: Replace.");
    expect(mug.remedy).toContain("Contact: Stanley toll-free");
  });
});
