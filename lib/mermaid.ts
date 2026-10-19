// Mermaid diagrams in the docs. Mermaid is large, so it is loaded the first
// time a page has a diagram, and never on pages without one.

let drawn = 0;

// drawDiagram draws a diagram's source and returns it as an image address.
// Mermaid's strict level escapes labels and drops click handlers; the image
// is the second wall: an SVG shown by <img> runs no script and loads
// nothing, whatever a repo puts in its source.
export async function drawDiagram(source: string, dark: boolean): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    // Plain SVG text: an image cannot show HTML labels reliably.
    htmlLabels: false,
    theme: dark ? "dark" : "neutral",
  });
  drawn += 1;
  const { svg } = await mermaid.render(`doc-diagram-${drawn}`, source);
  const image = svgImage(svg);
  if (!image) throw new Error("Mermaid drew something that is not an SVG image");
  return image;
}

// svgImage turns an SVG document into a data: address for an <img>, sized by
// its viewBox so the image keeps the diagram's own size and shape.
export function svgImage(svg: string): string | null {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root.localName !== "svg" || doc.getElementsByTagName("parsererror").length > 0) return null;
  const box = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (box.length === 4 && box[2] > 0 && box[3] > 0) {
    root.setAttribute("width", String(Math.ceil(box[2])));
    root.setAttribute("height", String(Math.ceil(box[3])));
    root.removeAttribute("style");
  }
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
}

// isDark says whether the dashboard shows its dark theme right now.
export function isDark(): boolean {
  const picked = document.documentElement.dataset.theme;
  if (picked === "dark" || picked === "light") return picked === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}
