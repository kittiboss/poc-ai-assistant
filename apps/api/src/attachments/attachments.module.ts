import { Module } from "@nestjs/common";
import { StorageModule } from "../common/storage/storage.module";
import { UsersModule } from "../users/users.module";
import { AttachmentsController } from "./attachments.controller";
import { AttachmentsService } from "./attachments.service";

@Module({
  imports: [UsersModule, StorageModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
