import { Module } from '@nestjs/common';
import { ValidationController } from '../validation/validation.controller';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { SingleUploadInterceptor } from './upload.interceptor';

@Module({
  controllers: [UploadsController, ValidationController],
  providers: [UploadsService, SingleUploadInterceptor],
  exports: [UploadsService],
})
export class UploadsModule {}
