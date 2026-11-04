import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageService } from "./storage.service";

type Sent = { constructor: { name: string }; input: Record<string, unknown> };

function setup(env: Record<string, string> = {}) {
  vi.stubEnv("S3_BUCKET", "attachments");
  vi.stubEnv("S3_ENDPOINT", "http://seaweedfs:8333");
  vi.stubEnv("S3_REGION", "us-east-1");
  vi.stubEnv("S3_FORCE_PATH_STYLE", "true");
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const send = vi.spyOn(S3Client.prototype, "send");
  const sent = () =>
    send.mock.calls.map(([command]) => {
      const { constructor, input } = command as unknown as Sent;
      return [constructor.name, input] as const;
    });
  return { storage: new StorageService(), send, sent };
}

const named = (name: string) => Object.assign(new Error(name), { name });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("StorageService", () => {
  it("is not configured without a bucket and refuses every call", async () => {
    const { storage, send } = setup({ S3_BUCKET: "" });
    expect(storage.configured).toBe(false);
    await expect(
      storage.put("attachments/a", Buffer.from("x"), "image/png"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(send).not.toHaveBeenCalled();
  });

  it("uses the configured endpoint and path-style addressing", async () => {
    const { storage } = setup();
    const client = (storage as unknown as { client: S3Client }).client;
    const endpoint = await client.config.endpoint?.();
    expect(endpoint?.hostname).toBe("seaweedfs");
    expect(client.config.forcePathStyle).toBe(true);
    expect(await client.config.region()).toBe("us-east-1");
  });

  it("puts, reads and removes objects in the bucket by key", async () => {
    const { storage, send, sent } = setup();
    send.mockResolvedValueOnce({} as never).mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    } as never);
    send.mockResolvedValueOnce({} as never);
    await storage.put("attachments/a", Buffer.from([1, 2, 3]), "image/png");
    expect(await storage.read("attachments/a")).toEqual(Buffer.from([1, 2, 3]));
    await storage.remove("attachments/a");
    expect(sent()).toEqual([
      [
        "PutObjectCommand",
        expect.objectContaining({
          Bucket: "attachments",
          Key: "attachments/a",
          ContentType: "image/png",
        }),
      ],
      ["GetObjectCommand", { Bucket: "attachments", Key: "attachments/a" }],
      ["DeleteObjectCommand", { Bucket: "attachments", Key: "attachments/a" }],
    ]);
  });

  it("streams an object with its type and size", async () => {
    const { storage, send } = setup();
    const body = Readable.from(["png"]);
    send.mockResolvedValueOnce({
      Body: body,
      ContentType: "image/png",
      ContentLength: 3,
    } as never);
    expect(await storage.stream("attachments/a")).toEqual({
      body,
      contentType: "image/png",
      byteSize: 3,
    });
  });

  it("returns null for a missing object", async () => {
    const { storage, send } = setup();
    send.mockRejectedValue(named("NoSuchKey"));
    expect(await storage.read("attachments/gone")).toBeNull();
    expect(await storage.stream("attachments/gone")).toBeNull();
  });

  it("turns storage failures into a 503 without their detail", async () => {
    const { storage, send } = setup();
    send.mockRejectedValue(named("TimeoutError"));
    const failure = storage.put("attachments/a", Buffer.from("x"), "image/png");
    await expect(failure).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(failure).rejects.not.toThrow(/TimeoutError/);
  });

  it("lists every page under a prefix", async () => {
    const { storage, send, sent } = setup();
    const written = new Date("2026-11-01T00:00:00Z");
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: "attachments/a", LastModified: written }],
        IsTruncated: true,
        NextContinuationToken: "next",
      } as never)
      .mockResolvedValueOnce({
        Contents: [{ Key: "attachments/b" }],
        IsTruncated: false,
      } as never);
    const keys = [];
    for await (const item of storage.list("attachments/")) keys.push(item);
    expect(keys[0]).toEqual({ key: "attachments/a", lastModified: written });
    // An object without a date counts as new.
    expect(keys[1].key).toBe("attachments/b");
    expect(Date.now() - keys[1].lastModified.getTime()).toBeLessThan(5_000);
    expect(sent().map(([, input]) => input.ContinuationToken)).toEqual([
      undefined,
      "next",
    ]);
  });
});
