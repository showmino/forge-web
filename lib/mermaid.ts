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
    // Keys a diagram's %%{init}%% or front matter may not change: Mermaid's
    // own, and ours that keep labels plain and the styles the dashboard's.
    secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "htmlLabels", "themeCSS", "fontFamily", "altFontFamily"],
  });
  drawn += 1;
  const { svg } = await mermaid.render(`doc-diagram-${drawn}`, source);
  const image = svgImage(svg);
  if (!image) throw new Error("Mermaid drew something that is not an SVG image");
  return image;
}

// svgImage turns an SVG document into a data: address for an <img>, sized by
// its viewBox so the image keeps the diagram's own size and shape.
// It is parsed as HTML, which also takes what XML would refuse (an &nbsp;
// in a label), and written out as XML.
export function svgImage(svg: string): string | null {
  const root = new DOMParser().parseFromString(svg, "text/html").body.firstElementChild;
  if (!root || root.localName !== "svg" || root.namespaceURI !== "http://www.w3.org/2000/svg") return null;
  const box = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (box.length === 4 && box[2] > 0 && box[3] > 0) {
    root.setAttribute("width", String(Math.ceil(box[2])));
    root.setAttribute("height", String(Math.ceil(box[3])));
    root.removeAttribute("style");
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
}

// isDark says whether the dashboard shows its dark theme right now.
export function isDark(): boolean {
  const picked = document.documentElement.dataset.theme;
  if (picked === "dark" || picked === "light") return picked === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

// subscribeTheme calls back when the dashboard's theme may have changed: the
// reader picked one (data-theme) or the system's changed.
export function subscribeTheme(changed: () => void): () => void {
  const watch = new MutationObserver(changed);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const system = window.matchMedia?.("(prefers-color-scheme: dark)");
  system?.addEventListener?.("change", changed);
  return () => {
    watch.disconnect();
    system?.removeEventListener?.("change", changed);
  };
}
