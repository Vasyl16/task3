import { Avatar } from '../../../shared/ui';
import { useSellerProfile } from '../model/use-seller';
import './seller-owner.css';

// The "sold by" line a product/auction detail page shows — name plus a
// placeholder avatar (there's no seller photo in this dataset). A
// component of its own rather than inlined per page, since both
// product-detail and auction-detail need the identical thing.
export function SellerOwner({ sellerId }: { sellerId: string }) {
  const { data: seller, isPending } = useSellerProfile(sellerId);

  if (isPending) {
    return (
      <div className="seller-owner seller-owner--loading">Loading seller…</div>
    );
  }
  if (!seller) return null;

  return (
    <div className="seller-owner">
      <Avatar name={seller.businessName} />
      <div>
        <p className="seller-owner__label">Sold by</p>
        <p className="seller-owner__name">{seller.businessName}</p>
      </div>
    </div>
  );
}
