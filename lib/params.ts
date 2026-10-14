import { TemplateParameter_Type, type TemplateParameter } from "@/gen/forge/v1/template_pb";

// strconv.Atoi, which the API parses an int with, takes an optional sign.
const INT = /^[+-]?\d+$/;

// paramProblem says what is wrong with the value the create would send for p
// (undefined: none), in the words the form shows. The API checks again.
export function paramProblem(p: TemplateParameter, value: string | undefined): string | undefined {
  if (value === undefined) return p.required ? `${p.name} is required.` : undefined;
  if (p.type === TemplateParameter_Type.INT && !INT.test(value)) return "Enter a whole number.";
  if (p.type === TemplateParameter_Type.STRING && p.pattern) {
    let re: RegExp;
    try {
      re = new RegExp(p.pattern, "u");
    } catch {
      // RE2 syntax JavaScript does not read, such as (?i): the API decides.
      return undefined;
    }
    if (!re.test(value)) return `That doesn't look right: it must match ${p.pattern}.`;
  }
  return undefined;
}

// paramSummary counts what a template requires: "2 required inputs".
export function paramSummary(params: TemplateParameter[]): string {
  const n = params.filter((p) => p.required).length;
  if (n > 0) return `${n} required ${n === 1 ? "input" : "inputs"}`;
  return params.length > 0 ? "No required inputs" : "No inputs";
}
