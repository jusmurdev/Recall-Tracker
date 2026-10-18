import { describe, expect, it } from "vitest";
import { detailQueryState } from "./detailQueryState";

describe("detailQueryState", () => {
  it("shows a spinner only while an uncached request is pending", () => {
    expect(detailQueryState(undefined, null)).toBe("loading");
  });

  it("classifies missing details separately from retryable server failures", () => {
    expect(detailQueryState(undefined, { status: 404 })).toBe("notFound");
    expect(detailQueryState(undefined, { status: 500 })).toBe("error");
    expect(detailQueryState(undefined, { status: 0 })).toBe("error");
  });

  it("keeps cached details visible if a background refresh fails", () => {
    expect(detailQueryState({ id: "cached" }, { status: 500 })).toBe("success");
  });
});
