import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { SingleUploadInterceptor } from './upload.interceptor';

@Module({
  controllers: [UploadsController],
  providers: [UploadsService, SingleUploadInterceptor],
  exports: [UploadsService],
})
export class UploadsModule {}
