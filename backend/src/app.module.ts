import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { CoreModule } from './core/core.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { HealthModule } from './infrastructure/health/health.module';
import { MetricsModule } from './infrastructure/metrics/metrics.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { OutboxModule } from './infrastructure/outbox/outbox.module';
import { RealtimeModule } from './infrastructure/realtime/realtime.module';
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
import { ReviewsModule } from './modules/reviews/reviews.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { EmailModule } from './modules/email/email.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    // Serves whatever ProductsController's image-upload route writes to
    // disk (see infrastructure/product-image.multer-config.ts) back out
    // at a public URL — "uploads/products/<file>" on disk becomes
    // "/uploads/products/<file>" over HTTP. Local disk storage, not
    // object storage: proportionate to a dev/demo marketplace with no
    // multi-instance deployment where a shared filesystem would matter.
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    CoreModule,
    PrismaModule,
    HealthModule,
    // Global — exposes GET /metrics and the HTTP metrics interceptor.
    MetricsModule,
    QueueModule,
    // Registers OutboxPublisherService (the claim-and-publish worker) once,
    // app-wide — see infrastructure/outbox/outbox-publisher.service.ts.
    OutboxModule,
    // WebSocket fan-out. Listed with the infrastructure modules, not the
    // business ones, because nothing depends on it and it depends on no
    // business module — it only consumes outbox events.
    RealtimeModule,
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
    DisputesModule,
    ReviewsModule,
    SearchModule,
    AnalyticsModule,
    NotificationsModule,
    EmailModule,
    // Last: the admin surface composes the modules above and nothing
    // imports it back.
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
