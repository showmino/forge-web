import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { TemplateParameter_Type, TemplateParameterSchema } from "@/gen/forge/v1/template_pb";
import { paramProblem, paramSummary } from "./params";

const p = (init: MessageInitShape<typeof TemplateParameterSchema>) => create(TemplateParameterSchema, init);

describe("paramSummary", () => {
  it.each([
    [[], "No inputs"],
    [[{ name: "port", type: TemplateParameter_Type.INT, defaultValue: "3000" }], "No required inputs"],
    [[{ name: "region", type: TemplateParameter_Type.ENUM, required: true }], "1 required input"],
    [
      [
        { name: "state_bucket", type: TemplateParameter_Type.STRING, required: true },
        { name: "size", type: TemplateParameter_Type.INT, required: true },
        { name: "port", type: TemplateParameter_Type.INT, defaultValue: "1" },
      ],
      "2 required inputs",
    ],
  ])("%#: %s", (params, want) => {
    expect(paramSummary(params.map((x) => p(x)))).toBe(want);
  });
});

describe("paramProblem", () => {
  const bucket = p({ name: "state_bucket", type: TemplateParameter_Type.STRING, required: true, pattern: "^[a-z0-9-]+$" });
  const size = p({ name: "size", type: TemplateParameter_Type.INT, required: true });
  const port = p({ name: "port", type: TemplateParameter_Type.INT, defaultValue: "3000" });
  const ips = p({ name: "ipAddresses", label: "IP addresses needed", type: TemplateParameter_Type.INT, required: true, min: BigInt(1), max: BigInt(1024) });

  it.each([
    [bucket, undefined, "state_bucket is required."],
    [bucket, "Bad Bucket", "That doesn't look right: it must match ^[a-z0-9-]+$."],
    [bucket, "forge-state", undefined],
    [size, undefined, "size is required."],
    [size, "ten", "Enter a whole number."],
    [size, "1.5", "Enter a whole number."],
    [size, "-3", undefined],
    [size, "+10", undefined],
    [port, undefined, undefined],
    [port, "x", "Enter a whole number."],
    [ips, "0", "Enter a whole number from 1 to 1024."],
    [ips, "1025", "Enter a whole number from 1 to 1024."],
    [ips, "1024", undefined],
    [ips, undefined, "IP addresses needed is required."],
  ])("%#: %s %s", (param, value, want) => {
    expect(paramProblem(param, value)).toBe(want);
  });

  it("leaves a pattern JavaScript cannot read to the API", () => {
    const re2 = p({ name: "x", type: TemplateParameter_Type.STRING, pattern: "(?i)^abc$" });
    expect(paramProblem(re2, "ABC")).toBeUndefined();
  });
});
