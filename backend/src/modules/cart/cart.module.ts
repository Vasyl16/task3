import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartRepository } from './domain/cart.repository';
import { PrismaCartRepository } from './infrastructure/prisma-cart.repository';

@Module({
  imports: [ProductsModule],
  controllers: [CartController],
  providers: [
    CartService,
    { provide: CartRepository, useClass: PrismaCartRepository },
  ],
  exports: [CartService],
})
export class CartModule {}
