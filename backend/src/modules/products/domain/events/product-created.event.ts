export const PRODUCT_CREATED_EVENT = 'ProductCreated';

export interface ProductCreatedEvent {
  productId: string;
  sellerId: string;
  categoryId: string;
  name: string;
}
