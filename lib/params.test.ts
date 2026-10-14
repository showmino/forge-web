import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { TemplateParameter_Type, TemplateParameterSchema } from "@/gen/forge/v1/template_pb";
import { paramProblem } from "./params";

const p = (init: MessageInitShape<typeof TemplateParameterSchema>) => create(TemplateParameterSchema, init);

describe("paramProblem", () => {
  const bucket = p({ name: "state_bucket", type: TemplateParameter_Type.STRING, required: true, pattern: "^[a-z0-9-]+$" });
  const size = p({ name: "size", type: TemplateParameter_Type.INT, required: true });
  const port = p({ name: "port", type: TemplateParameter_Type.INT, defaultValue: "3000" });

  it.each([
    [bucket, undefined, "Fill in state_bucket."],
    [bucket, "Bad Bucket", "Use a value that matches ^[a-z0-9-]+$."],
    [bucket, "forge-state", undefined],
    [size, undefined, "Fill in size."],
    [size, "ten", "Use a whole number."],
    [size, "1.5", "Use a whole number."],
    [size, "-3", undefined],
    [size, "+10", undefined],
    [port, undefined, undefined],
    [port, "x", "Use a whole number."],
  ])("%#: %s %s", (param, value, want) => {
    expect(paramProblem(param, value)).toBe(want);
  });

  it("leaves a pattern JavaScript cannot read to the API", () => {
    const re2 = p({ name: "x", type: TemplateParameter_Type.STRING, pattern: "(?i)^abc$" });
    expect(paramProblem(re2, "ABC")).toBeUndefined();
  });
});
