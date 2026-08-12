import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global: every module can inject PrismaService without importing this
// module itself. Only the Prisma-backed repository adapters should use
// it directly — everything else goes through a module's own repository.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
