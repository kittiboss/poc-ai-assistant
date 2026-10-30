import { FileInterceptor } from "@nestjs/platform-express";

type Limits = NonNullable<Parameters<typeof FileInterceptor>[1]>["limits"];

/**
 * One uploaded file in the multipart field "file". Browsers send its name as UTF-8, while Multer
 * reads names as Latin-1 unless told otherwise, which garbles Thai filenames.
 */
export const FileUpload = (limits: Limits) =>
  FileInterceptor("file", { limits, defParamCharset: "utf8" });
