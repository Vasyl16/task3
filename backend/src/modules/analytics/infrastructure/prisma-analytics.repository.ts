import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  AnalyticsRepository,
  ConversionRow,
  DailySalesRow,
  LedgerTotalsRow,
  OrderCountsRow,
  TopProductRow,
  TopSellerRow,
} from '../domain/analytics.repository';
import type { AnalyticsPeriod } from '../domain/period';

// Raw SQL rather than Prisma's groupBy: these are FILTER-ed conditional
// aggregates, multi-table joins, and a generate_series gap fill, none of
// which the query builder expresses. Every value is still parameterized
// (Prisma.sql tagged templates) — no string concatenation of user input.
//
// Money columns are cast to ::text so they arrive as exact decimal
// strings; counts to ::int so they don't arrive as BigInt.
@Injectable()
export class PrismaAnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async ledgerTotals(
    period: AnalyticsPeriod,
    sellerId?: string,
  ): Promise<LedgerTotalsRow> {
    const rows = await this.prisma.$queryRaw<LedgerTotalsRow[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE type = 'SALE'), 0)::text       AS "sale",
        COALESCE(SUM(amount) FILTER (WHERE type = 'COMMISSION'), 0)::text AS "commission",
        COALESCE(SUM(amount) FILTER (WHERE type = 'REFUND'), 0)::text     AS "refund",
        COALESCE(SUM(amount) FILTER (WHERE type = 'ADJUSTMENT'), 0)::text AS "adjustment",
        COALESCE(SUM(amount) FILTER (WHERE type = 'PAYOUT'), 0)::text     AS "payout"
      FROM "LedgerEntry"
      WHERE "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
      ${sellerId ? Prisma.sql`AND "sellerId" = ${sellerId}` : Prisma.empty}
    `);
    return rows[0];
  }

  // Counts orders PLACED within the period, grouped by their status
  // right now — not "orders that reached COMPLETED during the period".
  // An order placed on the last day and completed a week later counts as
  // placed-and-completed here, which is what makes `completed` a
  // fulfilment rate for the cohort rather than a throughput figure.
  async orderCounts(
    period: AnalyticsPeriod,
    sellerId?: string,
  ): Promise<OrderCountsRow> {
    if (sellerId) {
      const rows = await this.prisma.$queryRaw<OrderCountsRow[]>(Prisma.sql`
        SELECT
          COUNT(*)::int AS "placed",
          (COUNT(*) FILTER (WHERE status = 'COMPLETED'))::int AS "completed",
          (COUNT(*) FILTER (WHERE status = 'CANCELLED'))::int AS "cancelled"
        FROM "SellerOrder"
        WHERE "sellerId" = ${sellerId}
          AND "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
      `);
      return rows[0];
    }

    const rows = await this.prisma.$queryRaw<OrderCountsRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::int AS "placed",
        (COUNT(*) FILTER (WHERE status = 'COMPLETED'))::int AS "completed",
        (COUNT(*) FILTER (WHERE status IN ('CANCELLED', 'PARTIALLY_CANCELLED')))::int AS "cancelled"
      FROM "Order"
      WHERE "placedAt" >= ${period.from} AND "placedAt" < ${period.to}
    `);
    return rows[0];
  }

  // Ranked by revenue actually taken, so CANCELLED SellerOrders are
  // excluded — a cancelled line put its stock back and had its ledger
  // entries reversed, and leaving it in would let a seller top the chart
  // by placing and cancelling their own orders.
  //
  // unitPrice is the snapshot taken at purchase (see OrderItem), never
  // the product's current basePrice, so a later repricing can't
  // retroactively change history.
  topProducts(
    period: AnalyticsPeriod,
    limit: number,
    sellerId?: string,
  ): Promise<TopProductRow[]> {
    return this.prisma.$queryRaw<TopProductRow[]>(Prisma.sql`
      SELECT
        p.id                                     AS "productId",
        p.name                                   AS "productName",
        p."sellerId"                             AS "sellerId",
        SUM(oi.quantity)::int                    AS "unitsSold",
        SUM(oi.quantity * oi."unitPrice")::text  AS "revenue"
      FROM "OrderItem" oi
      JOIN "SellerOrder" so ON so.id = oi."sellerOrderId"
      JOIN "Product" p ON p.id = oi."productId"
      WHERE so."createdAt" >= ${period.from} AND so."createdAt" < ${period.to}
        AND so.status <> 'CANCELLED'
        ${sellerId ? Prisma.sql`AND so."sellerId" = ${sellerId}` : Prisma.empty}
      GROUP BY p.id, p.name, p."sellerId"
      -- Tie-broken on id so equal-revenue products don't reorder between
      -- two identical requests.
      ORDER BY SUM(oi.quantity * oi."unitPrice") DESC, p.id ASC
      LIMIT ${limit}
    `);
  }

  topSellers(period: AnalyticsPeriod, limit: number): Promise<TopSellerRow[]> {
    return this.prisma.$queryRaw<TopSellerRow[]>(Prisma.sql`
      SELECT
        sp.id                                                                  AS "sellerId",
        sp."businessName"                                                      AS "businessName",
        COALESCE(SUM(le.amount) FILTER (WHERE le.type = 'SALE'), 0)::text       AS "sale",
        COALESCE(SUM(le.amount) FILTER (WHERE le.type = 'COMMISSION'), 0)::text AS "commission",
        COALESCE(SUM(le.amount) FILTER (WHERE le.type = 'REFUND'), 0)::text     AS "refund",
        COALESCE(SUM(le.amount) FILTER (WHERE le.type = 'ADJUSTMENT'), 0)::text AS "adjustment",
        COUNT(DISTINCT le."sellerOrderId")::int                                AS "orderCount"
      FROM "LedgerEntry" le
      JOIN "SellerProfile" sp ON sp.id = le."sellerId"
      WHERE le."createdAt" >= ${period.from} AND le."createdAt" < ${period.to}
      GROUP BY sp.id, sp."businessName"
      -- Ordered by the numeric sum, not the ::text alias, which would
      -- sort lexically and put "9.00" above "10.00".
      ORDER BY COALESCE(SUM(le.amount) FILTER (WHERE le.type IN ('SALE', 'REFUND')), 0) DESC, sp.id ASC
      LIMIT ${limit}
    `);
  }

  // generate_series supplies the day spine so days with no activity come
  // back as explicit zero rows — a chart that silently omits them draws a
  // straight line across a dead week and misreports the trend.
  dailySales(
    period: AnalyticsPeriod,
    sellerId?: string,
  ): Promise<DailySalesRow[]> {
    return this.prisma.$queryRaw<DailySalesRow[]>(Prisma.sql`
      SELECT
        to_char(d.day, 'YYYY-MM-DD')                                           AS "date",
        COALESCE(SUM(le.amount) FILTER (WHERE le.type = 'SALE'), 0)::text       AS "sale",
        COALESCE(SUM(le.amount) FILTER (WHERE le.type = 'COMMISSION'), 0)::text AS "commission",
        COALESCE(SUM(le.amount) FILTER (WHERE le.type = 'REFUND'), 0)::text     AS "refund",
        COALESCE(SUM(le.amount) FILTER (WHERE le.type = 'ADJUSTMENT'), 0)::text AS "adjustment",
        COUNT(DISTINCT le."sellerOrderId") FILTER (WHERE le.type = 'SALE')::int AS "orders"
      FROM generate_series(
        ${period.from}::timestamp,
        ${period.to}::timestamp - interval '1 day',
        interval '1 day'
      ) AS d(day)
      LEFT JOIN "LedgerEntry" le
        ON le."createdAt" >= d.day
       AND le."createdAt" < d.day + interval '1 day'
       ${sellerId ? Prisma.sql`AND le."sellerId" = ${sellerId}` : Prisma.empty}
      GROUP BY d.day
      ORDER BY d.day ASC
    `);
  }

  // Cohort-based: of the cart sessions STARTED in this period, how many
  // ever converted. Deliberately not "conversions that happened in the
  // period" — pairing conversions with a different set of carts than the
  // ones counted in the denominator produces a ratio that can exceed 100%.
  //
  // Consequence worth knowing when reading the number: a session started
  // on the final day of the period may still convert tomorrow, so a
  // just-ended period always reads slightly low.
  async conversion(period: AnalyticsPeriod): Promise<ConversionRow> {
    const rows = await this.prisma.$queryRaw<ConversionRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::int AS "cartsStarted",
        (COUNT(*) FILTER (WHERE "convertedAt" IS NOT NULL))::int AS "cartsConverted"
      FROM "CartSession"
      WHERE "startedAt" >= ${period.from} AND "startedAt" < ${period.to}
    `);
    return rows[0];
  }
}
