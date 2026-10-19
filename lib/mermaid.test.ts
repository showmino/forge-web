import { describe, expect, it } from "vitest";
import { svgImage } from "./mermaid";

describe("a drawn diagram as an image", () => {
  it("is sized by its viewBox and keeps nothing else of its outer style", () => {
    const url = svgImage('<svg id="d1" width="100%" style="max-width: 412.5px;" viewBox="0 0 412.5 90"><g><text>a</text></g></svg>')!;
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    const svg = decodeURIComponent(url.slice(url.indexOf(",") + 1));
    expect(svg).toContain('width="413"');
    expect(svg).toContain('height="90"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).not.toContain("max-width");
    expect(svg).toContain("<text>a</text>");
  });

  it("is refused when it is not an SVG", () => {
    expect(svgImage("<html><body/></html>")).toBeNull();
    expect(svgImage("<svg><unclosed></svg>")).toBeNull();
  });
});
