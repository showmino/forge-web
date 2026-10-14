import { TemplateParameter_Type, type TemplateParameter } from "@/gen/forge/v1/template_pb";

// strconv.Atoi, which the API parses an int with, takes an optional sign.
const INT = /^[+-]?\d+$/;

// paramProblem says what is wrong with the value the create would send for p
// (undefined: none), in the words the form shows. The API checks again.
export function paramProblem(p: TemplateParameter, value: string | undefined): string | undefined {
  if (value === undefined) return p.required ? `Fill in ${p.name}.` : undefined;
  if (p.type === TemplateParameter_Type.INT && !INT.test(value)) return "Use a whole number.";
  if (p.type === TemplateParameter_Type.STRING && p.pattern) {
    let re: RegExp;
    try {
      re = new RegExp(p.pattern, "u");
    } catch {
      // RE2 syntax JavaScript does not read, such as (?i): the API decides.
      return undefined;
    }
    if (!re.test(value)) return `Use a value that matches ${p.pattern}.`;
  }
  return undefined;
}
