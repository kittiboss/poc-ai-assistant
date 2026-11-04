import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from "@nestjs/common";

export type StoredObject = {
  body: Readable;
  contentType?: string;
  byteSize?: number;
};

/**
 * Object storage for chat images: Amazon S3 or any S3-compatible service (SeaweedFS in Compose).
 * Only plain object calls are used and callers keep only the key, so moving storage is a change
 * of S3_ENDPOINT (unset for Amazon S3), S3_REGION, S3_BUCKET and S3_FORCE_PATH_STYLE. Credentials
 * come from the SDK's default chain: AWS_* variables in Compose, the IAM role on AWS.
 */
@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket = process.env.S3_BUCKET?.trim() || "";
  private readonly client = this.bucket
    ? new S3Client({
        endpoint: process.env.S3_ENDPOINT || undefined,
        region: process.env.S3_REGION || undefined,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
        // An outage fails the request instead of holding it open.
        requestHandler: { connectionTimeout: 3_000, requestTimeout: 15_000 },
      })
    : null;

  /** Without a bucket there is nowhere to keep images; documents keep only their text. */
  get configured() {
    return this.client !== null;
  }

  onModuleDestroy() {
    this.client?.destroy();
  }

  put(key: string, body: Buffer, contentType: string) {
    return this.call("put", (s3) =>
      s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      ),
    );
  }

  /** The object as a stream, or null when it does not exist. */
  async stream(key: string): Promise<StoredObject | null> {
    const object = await this.fetch(key);
    return object?.Body
      ? {
          body: object.Body as Readable,
          contentType: object.ContentType,
          byteSize: object.ContentLength,
        }
      : null;
  }

  /** The whole object, or null when it does not exist. */
  async read(key: string) {
    const object = await this.fetch(key);
    return object?.Body
      ? Buffer.from(
          await this.call("read", () => object.Body!.transformToByteArray()),
        )
      : null;
  }

  /** Succeeds when the object is already gone. */
  remove(key: string) {
    return this.call("delete", (s3) =>
      s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })),
    );
  }

  /** Every key under the prefix, page by page, with when it was written. */
  async *list(prefix: string) {
    let token: string | undefined;
    do {
      const page = await this.call("list", (s3) =>
        s3.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
        ),
      );
      // Without a date an object counts as new, so a sweep by age leaves it alone.
      for (const item of page.Contents ?? [])
        if (item.Key)
          yield {
            key: item.Key,
            lastModified: item.LastModified ?? new Date(),
          };
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  private async fetch(key: string) {
    try {
      return await this.call("get", (s3) =>
        s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })),
      );
    } catch (error) {
      if ((error as Error).name === "NoSuchKey") return null;
      throw error;
    }
  }

  /** Storage failures reach clients as a 503 without detail; the cause is logged. */
  private async call<T>(action: string, run: (s3: S3Client) => Promise<T>) {
    if (!this.client)
      throw new ServiceUnavailableException("Image storage is not configured");
    try {
      return await run(this.client);
    } catch (error) {
      if ((error as Error).name === "NoSuchKey") throw error;
      this.logger.error(
        `Storage ${action} failed: ${(error as Error).name} ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        "Image storage is unavailable; try again shortly",
      );
    }
  }
}
