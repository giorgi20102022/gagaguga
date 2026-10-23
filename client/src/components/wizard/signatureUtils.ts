import { GEO_ELGUJA_FONT_BASE64 } from "./geoElgujaBase64";
const FONT = "IronSignatureGeoElguja";
let fontReady: Promise<void> | undefined;

// Preserve confirmed fields verbatim. The only added character is the separator.
export function signatureText(firstName = "", lastName = ""): string {
  return firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName;
}

// Legacy ASCII font encoding, used ONLY for drawing, never stored in name fields.
// Visual glyph inspection confirms w = U+10EC, W = U+10ED.
export function encodeSignatureGlyphs(text: string): string {
  const map: Record<string, string> = {
    'ა': 'a', 'ბ': 'b', 'გ': 'g', 'დ': 'd', 'ე': 'e', 'ვ': 'v', 'ზ': 'z',
    'თ': 'T', 'ი': 'i', 'კ': 'k', 'ლ': 'l', 'მ': 'm', 'ნ': 'n', 'ო': 'o',
    'პ': 'p', 'ჟ': 'J', 'რ': 'r', 'ს': 's', 'ტ': 't', 'უ': 'u', 'ფ': 'f',
    'ქ': 'q', 'ღ': 'R', 'ყ': 'y', 'შ': 'S', 'ჩ': 'C', 'ც': 'c', 'ძ': 'Z',
    'წ': 'w', 'ჭ': 'W', 'ხ': 'x', 'ჯ': 'j', 'ჰ': 'h'
  };
  return Array.from(text, ch => map[ch] || ch).join('');
}
async function loadFont(): Promise<void> {
  if (!fontReady) {
    fontReady = (async () => {
      const face = new FontFace(FONT, `url(data:font/ttf;base64,${GEO_ELGUJA_FONT_BASE64.replace(/\s/g, '')})`);
      await face.load();
      document.fonts.add(face);
    })().catch(error => { fontReady = undefined; throw error; });
  }
  await fontReady;
}
export async function drawSignature(canvas: HTMLCanvasElement, firstName?: string, lastName?: string): Promise<string> {
  const text = signatureText(firstName, lastName);
  if (!text) return "";
  await loadFont(); // Do not silently render ASCII with a fallback font.
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Signature canvas unavailable");
  // Keep non-Georgian characters out of this font's Georgian-encoded Latin slots.
  const runs = Array.from(text, ch => ({ text: encodeSignatureGlyphs(ch),
    font: /[\u10d0-\u10f0]/.test(ch) ? `48px "${FONT}"` : '48px sans-serif' }));
  let width = 0, ascent = 0, descent = 0;
  for (const run of runs) {
    ctx.font = run.font;
    const m = ctx.measureText(run.text);
    width += Math.max(m.width, m.actualBoundingBoxRight) + Math.max(0, m.actualBoundingBoxLeft);
    ascent = Math.max(ascent, m.actualBoundingBoxAscent);
    descent = Math.max(descent, m.actualBoundingBoxDescent);
  }
  canvas.width = Math.ceil(width + 40);
  canvas.height = Math.ceil(ascent + descent + 40);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0038A8";
  ctx.textBaseline = "alphabetic";
  let x = 20;
  for (const run of runs) {
    ctx.font = run.font;
    const m = ctx.measureText(run.text);
    x += Math.max(0, m.actualBoundingBoxLeft);
    ctx.fillText(run.text, x, 20 + ascent);
    x += Math.max(m.width, m.actualBoundingBoxRight);
  }
  return canvas.toDataURL("image/jpeg", 0.95);
}
export async function generateSignatureBase64(firstName?: string, lastName?: string): Promise<string> {
  return drawSignature(document.createElement("canvas"), firstName, lastName);
}
