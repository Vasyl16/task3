import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { CoreModule } from './core/core.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { HealthModule } from './infrastructure/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SellersModule } from './modules/sellers/sellers.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductsModule } from './modules/products/products.module';
import { SearchModule } from './modules/search/search.module';
import { CartModule } from './modules/cart/cart.module';
import { OrdersModule } from './modules/orders/orders.module';
import { BiddingModule } from './modules/bidding/bidding.module';
import { PaymentsLedgerModule } from './modules/payments-ledger/payments-ledger.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    CoreModule,
    PrismaModule,
    HealthModule,
    // Business modules — see the backend-architecture skill for the
    // dependency-direction rule (a module may only import ones that come
    // before it here; no module may import one that imports it back).
    UsersModule,
    AuthModule,
    SellersModule,
    CategoriesModule,
    ProductsModule,
    CartModule,
    BiddingModule,
    OrdersModule,
    PaymentsLedgerModule,
    SearchModule,
    AnalyticsModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
