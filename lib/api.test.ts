import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import { errorText } from "./api";

describe("errorText", () => {
  it("says the API is older than the dashboard when it lacks the call", () => {
    expect(errorText(new ConnectError("HTTP 404", Code.Unimplemented))).toBe(
      "The Forge API does not have this yet: it is older than the dashboard. Try again after forge-api is updated.",
    );
  });
});
