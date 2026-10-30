import "reflect-metadata";
import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { FileUpload } from "./file-upload";

@Controller()
class EchoController {
  @Post()
  @UseInterceptors(FileUpload({ files: 1 }))
  echo(@UploadedFile() file: { originalname: string }) {
    return { filename: file.originalname };
  }
}

describe("file uploads", () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [EchoController],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, "127.0.0.1");
  });
  afterAll(() => app.close());

  it("keeps a Thai filename as the browser sent it (UTF-8)", async () => {
    const form = new FormData();
    form.append("file", new Blob(["text"]), "บันทึกประชุม.txt");
    const response = await fetch(await app.getUrl(), {
      method: "POST",
      body: form,
    });
    expect(await response.json()).toEqual({ filename: "บันทึกประชุม.txt" });
  });
});
