// The API's image limits (docs/CHAT_ATTACHMENTS.md): the browser makes every image fit them before upload.
export const MAX_IMAGE_SIDE = 1600;
export const MAX_IMAGE_BYTES = 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];
/** A photo larger than this is not decoded at all; phone cameras write well under it. */
export const MAX_SOURCE_IMAGE_BYTES = 40 * 1024 * 1024;
/** Lower qualities are tried in turn until the image fits, then smaller sizes. */
const QUALITIES = [0.85, 0.75, 0.6, 0.45];
const SCALES = [1, 0.75, 0.5];

export const isImage = (file: { type?: string; name: string }) =>
  IMAGE_TYPES.includes(file.type ?? '') ||
  (!file.type && IMAGE_EXTENSIONS.includes(file.name.split('.').pop()?.toLowerCase() ?? ''));

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Resizes an image so its longer side is at most 1,600 px and re-encodes it as WebP (JPEG where the
 * browser cannot write WebP), lowering the quality until it is at most 1 MB; an image that still does
 * not fit, such as a very detailed photo, is made smaller. Re-encoding drops metadata such as GPS
 * location, and a photo is turned upright by its orientation tag. `unreadable` when the browser
 * cannot decode the file, `tooLarge` when nothing fits.
 */
export async function prepareImage(file: File): Promise<File | 'unreadable' | 'tooLarge'> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return 'unreadable';
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return 'unreadable';
  const fit = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  // JPEG has no transparency, which would otherwise turn black.
  const draw = (scale: number, background?: string) => {
    canvas.width = Math.max(1, Math.round(bitmap.width * fit * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * fit * scale));
    context.imageSmoothingQuality = 'high';
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  };
  // A browser that cannot write WebP gives PNG instead.
  let type = 'image/webp';
  try {
    for (const scale of SCALES) {
      draw(scale, type === 'image/jpeg' ? '#ffffff' : undefined);
      for (const quality of QUALITIES) {
        let blob = await encode(canvas, type, quality);
        if (blob && blob.type !== type) {
          type = 'image/jpeg';
          draw(scale, '#ffffff');
          blob = await encode(canvas, type, quality);
        }
        if (blob && blob.size <= MAX_IMAGE_BYTES) {
          const name = `${file.name.replace(/\.[^.]*$/, '') || 'image'}.${type === 'image/webp' ? 'webp' : 'jpg'}`;
          return new File([blob], name, { type });
        }
      }
    }
    return 'tooLarge';
  } finally {
    bitmap.close();
  }
}
