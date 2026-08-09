import { deflateSync } from 'node:zlib';

// A minimal PNG writer. Discord renders an attached image the same way in every
// client, which a code block does not — and it buys rounded, spaced cells that
// no monospace glyph can give us. Only what an RGBA bitmap needs is here:
// three chunks and a CRC.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([head, body, crc]);
}

/** A blank RGBA canvas, fully transparent so it sits on any Discord theme. */
export function canvas(width, height) {
  return { width, height, pixels: Buffer.alloc(width * height * 4) };
}

/** Paint one pixel, ignoring anything that lands off the canvas. */
export function dot({ width, height, pixels }, x, y, [r, g, b, a = 255]) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;

  const offset = (y * width + x) * 4;
  pixels[offset] = r;
  pixels[offset + 1] = g;
  pixels[offset + 2] = b;
  pixels[offset + 3] = a;
}

/** A filled rectangle with the corner pixels shaved off, GitHub-cell style. */
export function roundedRect(image, x, y, size, radius, colour) {
  for (let dy = 0; dy < size; dy += 1) {
    for (let dx = 0; dx < size; dx += 1) {
      // Distance from the nearest corner centre, so only the corners round off.
      const cx = Math.min(dx, size - 1 - dx);
      const cy = Math.min(dy, size - 1 - dy);
      if (cx < radius && cy < radius && (radius - cx) ** 2 + (radius - cy) ** 2 > radius * radius) continue;

      dot(image, x + dx, y + dy, colour);
    }
  }
}

/** The canvas as a PNG file. */
export function encode({ width, height, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // Bit depth.
  header[9] = 6; // Truecolour with alpha.

  // Every scanline carries a leading filter byte; 0 means "stored as is".
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
