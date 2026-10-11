import { describe, expect, it } from "vitest";
import { displayName } from "./display-name";

describe("displayName", () => {
  it.each([
    ["web", "Web"],
    ["billing-web", "Billing Web"],
    ["a--b_c", "A B C"],
    ["", ""],
  ])("%s → %s", (service, want) => {
    expect(displayName(service)).toBe(want);
  });
});
