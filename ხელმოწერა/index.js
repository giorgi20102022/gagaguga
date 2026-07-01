const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCanvas, registerFont } = require('canvas');

const firstName = process.argv[2] || 'სახელი';
const lastName = process.argv[3] || 'გვარი';
const firstLetter = [...firstName][0];
const text = `${firstLetter}.${lastName}`;
const fontSizePx = 72;
const padding = 24;

const fontsDir = path.join(__dirname, 'fonts');
const ttfFiles = fs
  .readdirSync(fontsDir)
  .filter((f) => f.toLowerCase().endsWith('.ttf'))
  .sort((a, b) => a.localeCompare(b));

if (ttfFiles.length === 0) {
  throw new Error(`No .ttf files found in: ${fontsDir}`);
}

const preferred = 'DM-Ambrosi-UNI-93891068126.ttf';
if (!ttfFiles.includes(preferred)) {
  throw new Error(`Missing required font file: ${path.join(fontsDir, preferred)}`);
}

const fontPath = path.join(fontsDir, preferred);
const fontFamily = 'DM Ambrosi UNI';

const tempFontPath = path.join(os.tmpdir(), `canvas-font-${Date.now()}.ttf`);
fs.copyFileSync(fontPath, tempFontPath);

registerFont(tempFontPath, { family: fontFamily, weight: 'normal', style: 'normal' });

// Measure text using a temporary canvas
const measureCanvas = createCanvas(1, 1);
const measureCtx = measureCanvas.getContext('2d');
measureCtx.font = `normal ${fontSizePx}px "${fontFamily}"`;
measureCtx.textBaseline = 'alphabetic';

const metrics = measureCtx.measureText(text);

// Prefer precise bounding boxes if available; fall back to fontSize-based estimates.
const ascent = Number.isFinite(metrics.actualBoundingBoxAscent)
  ? metrics.actualBoundingBoxAscent
  : fontSizePx * 0.8;
const descent = Number.isFinite(metrics.actualBoundingBoxDescent)
  ? metrics.actualBoundingBoxDescent
  : fontSizePx * 0.2;

const textWidth = Math.ceil(metrics.width);
const textHeight = Math.ceil(ascent + descent);

const canvasWidth = textWidth + padding * 2;
const canvasHeight = textHeight + padding * 2;

// Create final canvas sized to fit text + padding
const canvas = createCanvas(canvasWidth, canvasHeight);
const ctx = canvas.getContext('2d');

// IMPORTANT: Do NOT fill the background; leaving it untouched preserves transparency.
ctx.clearRect(0, 0, canvasWidth, canvasHeight);
ctx.font = `normal ${fontSizePx}px "${fontFamily}"`;
ctx.textBaseline = 'alphabetic';
ctx.fillStyle = '#000000';

// Draw text so its bounding box sits within padding
const x = padding;
const y = padding + ascent;
ctx.fillText(text, x, y);

const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(path.join(__dirname, 'output.png'), buffer);

console.log(
  `Wrote output.png (${canvasWidth}x${canvasHeight}) using font: ${path.basename(fontPath)} (family: ${fontFamily})`
);
