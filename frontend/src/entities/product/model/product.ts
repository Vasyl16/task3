// Mirrors backend/src/modules/products (Prisma ProductStatus/ProductType
// enums — string-literal unions here because tsconfig's
// erasableSyntaxOnly bans TS enums).
export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type ProductType = 'FIXED_PRICE' | 'AUCTION';

// The raw Prisma model as GET /products and GET /products/:id return it.
// basePrice arrives as a STRING — every Decimal column serializes with
// Decimal#toJSON = toString, never a JS number (see the frontend
// architecture notes on this). Stock (quantityAvailable/Reserved) is
// deliberately absent: the products endpoints don't join Inventory, so
// it's only ever known via the realtime product:{id} snapshot — see
// use-product-stock.ts.
export interface Product {
  id: string;
  sellerId: string;
  categoryId: string;
  name: string;
  slug: string;
  description: string | null;
  // A public path served by the backend's ServeStaticModule (e.g.
  // "/uploads/products/<uuid>.jpg") — resolve it against VITE_API_URL's
  // origin, not use it as-is, since it's host-relative. Null until a
  // seller uploads one.
  imageUrl: string | null;
  basePrice: string;
  type: ProductType;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
  // Aggregated live from confirmed reviews by the backend — never stored
  // on the product row. A product nobody has reviewed reports 0/0, so
  // there is one shape to render rather than two.
  ratingAverage: number;
  ratingCount: number;
  // Optional: the moderation audit trail is an internal field set, only
  // present on admin responses. The public catalog endpoints strip it —
  // see the backend's ProductsService.findAllForCatalog.
  moderatedByUserId?: string | null;
  moderatedAt?: string | null;
  moderationNote?: string | null;
}

// 'rating' is the only non-default ordering the backend accepts; it
// validates the value rather than passing it through to the database.
export type ProductSort = 'newest' | 'rating';

export interface ListProductsParams {
  categoryId?: string;
  sellerId?: string;
  sort?: ProductSort;
}

export interface CreateProductInput {
  categoryId: string;
  name: string;
  slug: string;
  description?: string;
  // An alternative to POST /products/:id/image (which needs an existing
  // product id, so it can't be used before creation) — a seller can
  // point at an image they already host elsewhere instead of uploading
  // a file at creation time.
  imageUrl?: string;
  basePrice: number;
  type?: ProductType;
  initialQuantity: number;
}

export interface UpdateProductInput {
  name?: string;
  description?: string;
  basePrice?: number;
  // Sets Inventory.quantityAvailable to this absolute value — see
  // entities/product/model/use-product-stock.ts for where the current
  // value to prefill an edit form comes from (there's no REST field for
  // it; Product itself never carries stock).
  quantityAvailable?: number;
}

export type ProductModerationAction = 'TAKE_DOWN' | 'REINSTATE';

export interface ModerateProductInput {
  action: ProductModerationAction;
  note: string;
}

export interface AdminListProductsParams {
  status?: ProductStatus;
  sellerId?: string;
}
