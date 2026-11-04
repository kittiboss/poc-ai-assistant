export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const ascii = (buffer: Buffer, start: number, end: number) =>
  buffer.toString("latin1", start, end);

/** The image type from a file's first bytes, never its name; null when it is not JPEG, PNG or WebP. */
export function imageType(buffer: Buffer): ImageType | null {
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "image/jpeg";
  if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 12) === "WEBP")
    // An animated WebP is not a supported image; the document checks then refuse its type.
    return ascii(buffer, 12, 16) === "VP8X" && buffer[20] & 0x02
      ? null
      : "image/webp";
  return null;
}

/** Width and height from the image's header, or null when they cannot be read. */
export function imageSize(buffer: Buffer, type: ImageType) {
  const size =
    type === "image/png"
      ? pngSize(buffer)
      : type === "image/jpeg"
        ? jpegSize(buffer)
        : webpSize(buffer);
  return size && size.width > 0 && size.height > 0 ? size : null;
}

function pngSize(buffer: Buffer) {
  if (buffer.length < 24 || ascii(buffer, 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Walks the segments to the frame header (SOFn), which holds the size. */
function jpegSize(buffer: Buffer) {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    // Fill bytes, then markers without a length: TEM and RST0-7.
    if (marker === 0xff) offset += 1;
    else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) offset += 2;
    // The image data or its end, with no frame header before it.
    else if (marker === 0xd9 || marker === 0xda) return null;
    else {
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) return null;
      // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      )
        return offset + 9 <= buffer.length
          ? {
              height: buffer.readUInt16BE(offset + 5),
              width: buffer.readUInt16BE(offset + 7),
            }
          : null;
      offset += 2 + length;
    }
  }
  return null;
}

function webpSize(buffer: Buffer) {
  if (buffer.length < 30) return null;
  switch (ascii(buffer, 12, 16)) {
    // Lossy: a key frame's start code, then 14-bit sizes.
    case "VP8 ":
      return buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a
        ? {
            width: buffer.readUInt16LE(26) & 0x3fff,
            height: buffer.readUInt16LE(28) & 0x3fff,
          }
        : null;
    // Lossless: a signature byte, then 14-bit sizes minus one.
    case "VP8L": {
      if (buffer[20] !== 0x2f) return null;
      const bits = buffer.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    // Extended: the canvas size, 24 bits minus one.
    case "VP8X":
      return {
        width: buffer.readUIntLE(24, 3) + 1,
        height: buffer.readUIntLE(27, 3) + 1,
      };
    default:
      return null;
  }
}
