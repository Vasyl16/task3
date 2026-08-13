import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  ProductStatus,
  ProductType,
  SellerProfileStatus,
  UserRole,
} from '@prisma/client';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

export interface RegisteredUser {
  id: string;
  email: string;
  accessToken: string;
}

interface AuthResponseBody {
  accessToken: string;
  refreshToken: string;
}

// Real registration through the HTTP API (not a Prisma shortcut) — this
// is exactly the path a real client goes through, and it's what these
// integration tests are meant to exercise end-to-end.
export async function registerUser(
  app: INestApplication<App>,
  prisma: PrismaService,
  email: string,
  name = 'Test User',
): Promise<RegisteredUser> {
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'Password123!', name })
    .expect(201);
  const body = res.body as AuthResponseBody;
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: user.id, email, accessToken: body.accessToken };
}

// Bypasses the apply/approve HTTP flow (already covered by
// sellers.service.spec.ts) — direct Prisma writes here keep these
// checkout-focused tests from re-testing seller onboarding.
export async function makeApprovedSeller(
  prisma: PrismaService,
  userId: string,
  businessName: string,
) {
  await prisma.user.update({
    where: { id: userId },
    data: { role: UserRole.SELLER },
  });
  return prisma.sellerProfile.create({
    data: { userId, businessName, status: SellerProfileStatus.APPROVED },
  });
}

export async function createCategory(
  prisma: PrismaService,
  name: string,
  slug: string,
) {
  return prisma.category.create({ data: { name, slug } });
}

export async function createActiveProduct(
  prisma: PrismaService,
  opts: {
    sellerId: string;
    categoryId: string;
    name: string;
    slug: string;
    basePrice: number;
    stock: number;
    type?: ProductType;
  },
) {
  const product = await prisma.product.create({
    data: {
      sellerId: opts.sellerId,
      categoryId: opts.categoryId,
      name: opts.name,
      slug: opts.slug,
      basePrice: opts.basePrice,
      status: ProductStatus.ACTIVE,
      type: opts.type ?? ProductType.FIXED_PRICE,
    },
  });
  await prisma.inventory.create({
    data: { productId: product.id, quantityAvailable: opts.stock },
  });
  return product;
}

// Re-issues a token reflecting the CURRENT DB role — needed after
// promoting a user to SELLER via makeApprovedSeller, since the token
// from registerUser() was minted before that promotion and still
// carries the stale role claim (RolesGuard reads the role from the JWT,
// not a fresh DB read — see the role-sync trade-off documented on
// UserRole in schema.prisma).
export async function loginUser(
  app: INestApplication<App>,
  email: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: 'Password123!' })
    .expect(200);
  return (res.body as AuthResponseBody).accessToken;
}

export function authHeader(user: RegisteredUser): [string, string] {
  return ['Authorization', `Bearer ${user.accessToken}`];
}

// Unique-enough per test run so repeated runs against the shared remote
// database never collide on unique constraints (email, slug, ...).
export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
