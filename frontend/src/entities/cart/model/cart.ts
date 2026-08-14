export interface CartItem {
  id: string;
  cartId: string;
  productId: string;
  quantity: number;
  addedAt: string;
}

export interface Cart {
  id: string;
  buyerId: string;
  createdAt: string;
  updatedAt: string;
  items: CartItem[];
}
