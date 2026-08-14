import { Outlet } from 'react-router-dom';
import { useMySellerProfile } from '../../../entities/seller';
import { paths } from '../../../app/routes/paths';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  Tabs,
} from '../../../shared/ui';

// Resolves the seller's own profile ONCE, here, rather than letting each
// tab (overview/products/auctions/orders) fetch it independently. That
// used to be a real bug: a page like `useProducts(profile ? {sellerId:
// profile.id} : undefined)` has no `enabled` guard, so while `profile`
// was still loading it fired an UNFILTERED `GET /products` — briefly (or
// indefinitely, if the profile request was slow) showing every seller's
// products as if they were "yours". Loading it once here and only
// rendering children once it's resolved makes that class of bug
// structurally impossible instead of something to remember per page.
export function SellerLayout() {
  const {
    data: sellerProfile,
    error,
    isPending,
    refetch,
  } = useMySellerProfile();

  return (
    <div>
      <PageHeader title="Seller dashboard" />
      <Tabs
        items={[
          { to: paths.seller.root, label: 'Overview', end: true },
          { to: paths.seller.products, label: 'Products' },
          { to: paths.seller.auctions, label: 'Auctions' },
          { to: paths.seller.orders, label: 'Orders' },
        ]}
      />

      {isPending && <PageSpinner label="Loading your seller account" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {!isPending && !error && !sellerProfile && (
        <EmptyState
          title="No seller profile found"
          description="Your account has seller access but no seller profile could be found. Contact an admin."
        />
      )}
      {!isPending &&
        !error &&
        sellerProfile &&
        sellerProfile.status !== 'APPROVED' && (
          <EmptyState
            title="Seller profile not approved"
            description={`Your seller profile is currently ${sellerProfile.status.toLowerCase()}. An admin needs to approve it before you can manage products, auctions, or orders.`}
          />
        )}
      {!isPending &&
        !error &&
        sellerProfile &&
        sellerProfile.status === 'APPROVED' && (
          <Outlet context={sellerProfile} />
        )}
    </div>
  );
}
