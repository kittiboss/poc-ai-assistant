/** Headers of small but well-formed image files, enough for the API's type and size checks. */
export const bytes = (...parts: (string | number[] | Buffer)[]) =>
  Buffer.concat(
    parts.map((part) =>
      typeof part === "string"
        ? Buffer.from(part, "latin1")
        : Buffer.from(part),
    ),
  );
const u16be = (value: number) => [value >> 8, value & 0xff];
const u16le = (value: number) => [value & 0xff, value >> 8];
const u24le = (value: number) => [
  value & 0xff,
  (value >> 8) & 0xff,
  value >> 16,
];
const u32 = (value: number, endian: "BE" | "LE") => {
  const buffer = Buffer.alloc(4);
  buffer[`writeUInt32${endian}`](value);
  return buffer;
};

export const png = (width: number, height: number) =>
  bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    u32(13, "BE"),
    "IHDR",
    u32(width, "BE"),
    u32(height, "BE"),
    [8, 6, 0, 0, 0],
  );

/** An APP0 segment and a fill byte before the frame header, as encoders write them. */
export const jpeg = (width: number, height: number, frame = 0xc0) =>
  bytes(
    [0xff, 0xd8, 0xff, 0xe0, ...u16be(16)],
    "JFIF\0",
    Buffer.alloc(9),
    [0xff, 0xff, frame, ...u16be(17), 8, ...u16be(height), ...u16be(width)],
    Buffer.alloc(12),
  );

export const riff = (chunk: string, data: Buffer) =>
  bytes(
    "RIFF",
    u32(12 + data.length, "LE"),
    "WEBP",
    chunk,
    u32(data.length, "LE"),
    data,
  );

/** Lossy: a key frame tag and start code, then the sizes. */
export const webp = (width: number, height: number) =>
  riff(
    "VP8 ",
    bytes(
      [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a],
      u16le(width),
      u16le(height),
      Buffer.alloc(4),
    ),
  );

export const losslessWebp = (width: number, height: number) =>
  riff(
    "VP8L",
    bytes(
      [0x2f],
      u32((width - 1) | ((height - 1) << 14), "LE"),
      Buffer.alloc(8),
    ),
  );

/** Extended format; flag 0x02 marks an animation. */
export const extendedWebp = (width: number, height: number, flags = 0x10) =>
  riff(
    "VP8X",
    bytes(
      [flags, 0, 0, 0],
      u24le(width - 1),
      u24le(height - 1),
      Buffer.alloc(4),
    ),
  );
