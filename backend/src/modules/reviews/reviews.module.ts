import { Module } from '@nestjs/common';
import { OutboxModule } from '../../infrastructure/outbox/outbox.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { ReviewsRepository } from './domain/reviews.repository';
import { PrismaReviewsRepository } from './infrastructure/prisma-reviews.repository';

// Deliberately imports neither OrdersModule nor ProductsModule. It reads
// the purchase chain through its own repository instead, which keeps the
// dependency graph acyclic: ProductsModule imports this one to enrich the
// catalogue with ratings, and OrdersModule already imports ProductsModule
// — so a dependency in the other direction would close a cycle.
//
// The cost is that "is this caller the buyer" is checked here rather than
// reused from OrdersService. That is a different question from the one
// OrdersService answers ("do you own this SellerOrder"), and it is a
// single equality on a value read in the same query, so the duplication
// is nominal.
@Module({
  imports: [OutboxModule],
  controllers: [ReviewsController],
  providers: [
    ReviewsService,
    { provide: ReviewsRepository, useClass: PrismaReviewsRepository },
  ],
  exports: [ReviewsService],
})
export class ReviewsModule {}
