import { GEO_ELGUJA_FONT_BASE64 } from "./geoElgujaBase64";

const cleanBase64 = GEO_ELGUJA_FONT_BASE64.replace(/[\r\n\s]/g, '');

const convertToAscii = (text: string): string => {
  const map: Record<string, string> = {
    'ა': 'a', 'ბ': 'b', 'გ': 'g', 'დ': 'd', 'ე': 'e', 'ვ': 'v', 'ზ': 'z',
    'თ': 'T', 'ი': 'i', 'კ': 'k', 'ლ': 'l', 'მ': 'm', 'ნ': 'n', 'ო': 'o',
    'პ': 'p', 'ჟ': 'J', 'რ': 'r', 'ს': 's', 'ტ': 't', 'უ': 'u', 'ფ': 'f',
    'ქ': 'q', 'ღ': 'R', 'ყ': 'y', 'შ': 'S', 'ჩ': 'C', 'ც': 'c', 'ძ': 'Z',
    'წ': 'W', 'ჭ': 'w', 'ხ': 'x', 'ჯ': 'j', 'ჰ': 'h'
  };
  return text.split('').map(ch => map[ch] || ch).join('');
};

/**
 * Ensures the GeoElguja font face is injected into the document head.
 */
function ensureGeoElgujaFontInjected(): void {
  let style = document.getElementById('geo-elguja-base64-font');
  if (!style) {
    style = document.createElement('style');
    style.id = 'geo-elguja-base64-font';
    style.innerHTML = `@font-face { font-family: 'GeoElgujaBase64'; src: url('data:font/truetype;charset=utf-8;base64,${cleanBase64}') format('truetype'); }`;
    document.head.appendChild(style);
  }
}

/**
 * Generates a signature PNG data URL from firstName and lastName.
 * Uses an offscreen canvas and the GeoElguja font.
 * Returns empty string if names are not provided.
 */
export async function generateSignatureBase64(firstName?: string, lastName?: string): Promise<string> {
  const fn = (firstName ?? "").trim();
  const ln = (lastName ?? "").trim();
  if (!fn || !ln) return "";

  const firstInitial = fn.charAt(0);
  const signatureText = `${firstInitial}.  ${ln}`;

  ensureGeoElgujaFontInjected();

  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 80;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  try {
    await document.fonts.load('48px "GeoElgujaBase64"');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '48px "GeoElgujaBase64"';
    (ctx as any).letterSpacing = "0px";
    (ctx as any).wordSpacing = "0px";
    ctx.fillStyle = '#0038A8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(convertToAscii(signatureText), canvas.width / 2, canvas.height / 2);
  } catch (err) {
    console.error('Font load failed, using fallback:', err);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'italic normal 48px sans-serif';
    ctx.fillStyle = '#0038A8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(signatureText, canvas.width / 2, canvas.height / 2);
  }

  return canvas.toDataURL('image/png');
}
