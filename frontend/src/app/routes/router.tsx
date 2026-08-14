import { createBrowserRouter } from 'react-router-dom';
import {
  AdminDisputesPage,
  AdminOrdersPage,
  AdminLayout,
  AdminOverviewPage,
  AdminProductsPage,
  AdminSellersPage,
} from '../../pages/admin';
import { AccountPage } from '../../pages/account';
import { AuctionDetailPage } from '../../pages/auction-detail';
import { CartPage } from '../../pages/cart';
import { CheckoutPage } from '../../pages/checkout';
import { ForbiddenPage } from '../../pages/forbidden';
import { HomePage } from '../../pages/home';
import { LoginPage } from '../../pages/login';
import { MyAuctionsPage } from '../../pages/my-auctions';
import { NotFoundPage } from '../../pages/not-found';
import { NotificationsPage } from '../../pages/notifications';
import { OrderDetailPage } from '../../pages/order-detail';
import { OrdersPage } from '../../pages/orders';
import { DisputesPage, DisputeDetailPage } from '../../pages/disputes';
import { ProductDetailPage } from '../../pages/product-detail';
import { RegisterPage } from '../../pages/register';
import {
  SellerAuctionsPage,
  SellerLayout,
  SellerOrdersPage,
  SellerOverviewPage,
  SellerProductEditPage,
  SellerProductNewPage,
  SellerProductsPage,
} from '../../pages/seller';
import { AppLayout } from '../../widgets/app-layout';
import { paths } from './paths';
import { ProtectedRoute } from './protected-route';

// Pages are imported eagerly — see the note this replaced: the app has
// grown past "six small routes," but route-level code splitting is a
// bundle-size optimization, not a correctness concern, and is worth
// revisiting against real bundle numbers rather than doing preemptively.
//
// Everything requires a session except login/register. This is stricter
// than the backend, which still serves GET /products/:id and GET
// /auctions/:id without auth (@Public()) — that's unchanged and correct,
// browsing a single product by direct link/API call still works
// unauthenticated. What's gated here is the SPA experience: an
// anonymous visitor is sent to sign in before seeing any page, catalog
// included. That's a product decision this route table encodes, not a
// security boundary — see ProtectedRoute's own comment: the backend is
// still what actually enforces access to every request these pages make.
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: paths.login, element: <LoginPage /> },
      { path: paths.register, element: <RegisterPage /> },

      {
        // Nesting under a pathless route is what lets one guard cover a
        // whole group: routes added as children are protected by
        // construction, rather than by remembering to wrap each one.
        element: <ProtectedRoute />,
        children: [
          { path: paths.home, element: <HomePage /> },
          { path: paths.forbidden, element: <ForbiddenPage /> },
          { path: '/products/:id', element: <ProductDetailPage /> },
          { path: '/auctions/:id', element: <AuctionDetailPage /> },
          { path: paths.account, element: <AccountPage /> },
          { path: paths.cart, element: <CartPage /> },
          { path: paths.checkout, element: <CheckoutPage /> },
          { path: paths.orders, element: <OrdersPage /> },
          { path: '/orders/:id', element: <OrderDetailPage /> },
          { path: paths.disputes, element: <DisputesPage /> },
          { path: '/disputes/:id', element: <DisputeDetailPage /> },
          { path: paths.myAuctions, element: <MyAuctionsPage /> },
          { path: paths.notifications, element: <NotificationsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },

      {
        element: <ProtectedRoute roles={['SELLER']} />,
        children: [
          {
            element: <SellerLayout />,
            children: [
              { path: paths.seller.root, element: <SellerOverviewPage /> },
              { path: paths.seller.products, element: <SellerProductsPage /> },
              {
                path: paths.seller.newProduct,
                element: <SellerProductNewPage />,
              },
              {
                path: '/seller/products/:id',
                element: <SellerProductEditPage />,
              },
              { path: paths.seller.auctions, element: <SellerAuctionsPage /> },
              { path: paths.seller.orders, element: <SellerOrdersPage /> },
            ],
          },
        ],
      },

      {
        element: <ProtectedRoute roles={['ADMIN']} />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { path: paths.admin.root, element: <AdminOverviewPage /> },
              { path: paths.admin.sellers, element: <AdminSellersPage /> },
              { path: paths.admin.products, element: <AdminProductsPage /> },
              { path: paths.admin.orders, element: <AdminOrdersPage /> },
              { path: paths.admin.disputes, element: <AdminDisputesPage /> },
            ],
          },
        ],
      },
    ],
  },
]);
