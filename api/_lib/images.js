import sharp from "sharp";
import { parseDataImage } from "./utils.js";

const SUPPORTED_FORMATS = new Set(["jpeg", "png", "webp"]);
const MIN_DIMENSION = 300;
const MAX_DIMENSION = 10000;
const MAX_PIXELS = 40_000_000;
const PHASH_SIZE = 32;
const LOW_INFORMATION_VARIANCE = 12;

export class ImageValidationError extends Error {}

function dctMatrix(size) {
  const matrix = Array.from({ length: size }, () => new Float64Array(size));
  for (let x = 0; x < size; x += 1) {
    for (let u = 0; u < size; u += 1) {
      matrix[x][u] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size));
    }
  }
  return matrix;
}

const DCT = dctMatrix(PHASH_SIZE);

function computePHash(pixels, size) {
  const rows = Array.from({ length: size }, () => new Float64Array(size));
  for (let y = 0; y < size; y += 1) {
    for (let u = 0; u < size; u += 1) {
      let sum = 0;
      for (let x = 0; x < size; x += 1) {
        sum += pixels[y * size + x] * DCT[x][u];
      }
      rows[y][u] = sum;
    }
  }

  const coefficients = [];
  for (let v = 0; v < 8; v += 1) {
    for (let u = 0; u < 8; u += 1) {
      if (u === 0 && v === 0) continue;
      let sum = 0;
      for (let y = 0; y < size; y += 1) {
        sum += rows[y][u] * DCT[y][v];
      }
      coefficients.push(sum);
    }
  }

  const sorted = [...coefficients].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  let bits = 0n;
  for (const coefficient of coefficients) {
    bits = (bits << 1n) | (coefficient > median ? 1n : 0n);
  }
  bits <<= 1n;

  return bits.toString(16).padStart(16, "0");
}

function pixelVariance(pixels) {
  const mean = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
  const variance =
    pixels.reduce((sum, value) => sum + (value - mean) ** 2, 0) / pixels.length;
  return variance;
}

export async function analyzeImagePayload(raw) {
  const parsed = parseDataImage(raw);
  if (parsed.error) {
    throw new ImageValidationError(`The screenshot ${parsed.error}.`);
  }

  const buffer = Buffer.from(parsed.data, "base64");

  let metadata;
  try {
    metadata = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_PIXELS,
      animated: false
    }).metadata();
  } catch {
    throw new ImageValidationError("The uploaded file is not a readable image.");
  }

  if (!SUPPORTED_FORMATS.has(metadata.format)) {
    throw new ImageValidationError("Only JPEG, PNG, or WebP screenshots are accepted.");
  }

  const width = Number(metadata.width) || 0;
  const height = Number(metadata.height) || 0;

  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    throw new ImageValidationError(
      `The screenshot is too small (${width}x${height}). Please upload an image at least ${MIN_DIMENSION}px wide and tall.`
    );
  }

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new ImageValidationError("The screenshot dimensions are too large. Please upload a normal screenshot.");
  }

  const { data } = await sharp(buffer)
    .resize(PHASH_SIZE, PHASH_SIZE, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const sample = await sharp(buffer)
    .resize(16, 16, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();

  const variance = pixelVariance(sample);

  return {
    mimeType: parsed.mimeType,
    data: parsed.data,
    bytes: buffer.length,
    width,
    height,
    pHash: computePHash(data, PHASH_SIZE),
    variance,
    lowInformation: variance < LOW_INFORMATION_VARIANCE
  };
}

function hexToBits(hex) {
  return BigInt(`0x${hex}`);
}

export function hammingDistance(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  let value = hexToBits(left) ^ hexToBits(right);
  let distance = 0;
  while (value > 0n) {
    distance += Number(value & 1n);
    value >>= 1n;
  }
  return distance;
}

export function isSimilarPHash(left, right, threshold = 8) {
  return hammingDistance(left, right) <= threshold;
}
