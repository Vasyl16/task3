import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { DisputesModule } from '../disputes/disputes.module';
import { ProductsModule } from '../products/products.module';
import { SellersModule } from '../sellers/sellers.module';
import { AdminController } from './admin.controller';

// A presentation layer, not a domain: one controller, no service, no
// repository. It sits at the very end of the module dependency order —
// it imports four modules and nothing imports it, so it can't create a
// cycle or become a hub other modules route through.
@Module({
  imports: [SellersModule, ProductsModule, DisputesModule, AnalyticsModule],
  controllers: [AdminController],
})
export class AdminModule {}
