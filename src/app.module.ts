import { Module } from '@nestjs/common';
import { Rs485Module } from './rs485/rs485.module';

@Module({
  imports: [Rs485Module],
})
export class AppModule {}
