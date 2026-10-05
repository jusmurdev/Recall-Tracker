import { describe, expect, it } from "vitest";
import { homeStatus, shouldPersistQuery } from "./home";

describe("Home hero status", () => {
  it("never says all clear without data", () => {
    // Cold start, server unreachable, nothing cached.
    expect(homeStatus({ data: undefined, isError: true, isFetching: false }, 0)).toBe("unknown");
    // Fetch paused (no network) without an error yet.
    expect(homeStatus({ data: undefined, isError: false, isFetching: false }, 0)).toBe("unknown");
    expect(homeStatus({ data: undefined, isError: false, isFetching: true }, 0)).toBe("loading");
  });
  it("uses cached data when the refresh failed", () => {
    const cached = { items: [], unread: 0 };
    expect(homeStatus({ data: cached, isError: true, isFetching: false }, 0)).toBe("all_clear");
    expect(homeStatus({ data: cached, isError: true, isFetching: false }, 2)).toBe("needs_look");
  });
});

describe("offline cache", () => {
  it("keeps queries that have data even after a failed refresh", () => {
    expect(shouldPersistQuery({ state: { data: { items: [] }, status: "error" } })).toBe(true);
    expect(shouldPersistQuery({ state: { data: { items: [] }, status: "success" } })).toBe(true);
    expect(shouldPersistQuery({ state: { data: undefined, status: "error" } })).toBe(false);
    expect(shouldPersistQuery({ state: { data: undefined, status: "pending" } })).toBe(false);
  });
});
