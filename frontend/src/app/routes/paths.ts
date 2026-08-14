// Route paths in one place so links and redirects can't drift apart as
// routes are added.
export const paths = {
  home: '/',
  login: '/login',
  register: '/register',
  account: '/account',
  forbidden: '/forbidden',

  product: (id: string) => `/products/${id}`,
  auction: (id: string) => `/auctions/${id}`,
  cart: '/cart',
  checkout: '/checkout',
  orders: '/orders',
  disputes: '/disputes',
  dispute: (id: string) => `/disputes/${id}`,
  order: (id: string) => `/orders/${id}`,
  notifications: '/notifications',
  myAuctions: '/my-auctions',

  seller: {
    root: '/seller',
    products: '/seller/products',
    newProduct: '/seller/products/new',
    product: (id: string) => `/seller/products/${id}`,
    auctions: '/seller/auctions',
    orders: '/seller/orders',
    disputes: '/seller/disputes',
    dispute: (id: string) => `/seller/disputes/${id}`,
  },

  admin: {
    root: '/admin',
    sellers: '/admin/sellers',
    products: '/admin/products',
    orders: '/admin/orders',
    disputes: '/admin/disputes',
  },
} as const;
