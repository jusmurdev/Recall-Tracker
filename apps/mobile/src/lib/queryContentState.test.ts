import { describe, expect, it } from "vitest";
import { queryContentState } from "./queryContentState";

describe("query content state", () => {
  it("shows an error, not an empty result, when no response was cached", () => {
    expect(queryContentState({ isError: true }, 0)).toBe("error");
  });

  it("waits for the initial response before showing empty copy", () => {
    expect(queryContentState({ isError: false }, 0)).toBe("loading");
  });

  it.each([0, 2])("keeps cached responses with %i items after a failed refresh", (count) => {
    expect(queryContentState({ data: { items: Array(count) }, isError: true }, count)).toBe("stale");
  });

  it("only shows a genuine empty result once data has loaded", () => {
    expect(queryContentState({ data: { items: [] }, isError: false }, 0)).toBe("empty");
  });

  it("shows successful nonempty data", () => {
    expect(queryContentState({ data: { items: [1] }, isError: false }, 1)).toBe("data");
  });

  it("recovers from a cold-start failure when retry succeeds", () => {
    expect(queryContentState({ isError: true }, 0)).toBe("error");
    expect(queryContentState({ isError: false }, 0)).toBe("loading");
    expect(queryContentState({ data: { items: [1] }, isError: false }, 1)).toBe("data");
  });

  it("distinguishes a saved empty response from a failed request with no cache", () => {
    const saved = { items: [] };
    expect(queryContentState({ data: saved, isError: true }, 0)).toBe("stale");
    expect(queryContentState({ data: saved, isError: false }, 0)).toBe("empty");
    expect(queryContentState({ data: undefined, isError: true }, 0)).toBe("error");
  });
});
