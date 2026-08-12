import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { SellersController } from './sellers.controller';
import { SellersService } from './sellers.service';
import { SellersRepository } from './domain/sellers.repository';
import { PrismaSellersRepository } from './infrastructure/prisma-sellers.repository';

@Module({
  imports: [UsersModule],
  controllers: [SellersController],
  providers: [
    SellersService,
    { provide: SellersRepository, useClass: PrismaSellersRepository },
  ],
  exports: [SellersService],
})
export class SellersModule {}
