import { Module } from '@nestjs/common';
import { Rs485Service } from './rs485.service';
import { Rs485Controller } from './rs485.controller';

@Module({
  controllers: [Rs485Controller],
  providers: [Rs485Service],
  exports: [Rs485Service],
})
export class Rs485Module {}
