import { Link } from 'react-router-dom';
import type { SearchResultItem } from '../../../entities/product';
import { paths } from '../../../app/routes/paths';
import { RatingStars } from '../../../entities/review';
import { Badge, Card } from '../../../shared/ui';
import { formatMoney } from '../../../shared/lib';
import './product-card.css';

// A curated set of gradient pairs, not a random hue — there are no
// product photos in this dataset, so the banner is decoration, not
// information. Picking deterministically by category (rather than
// productId) means every item in the same category reads as a group at
// a glance, which a random-per-card color would work against.
const BANNER_GRADIENTS = [
  ['#6366f1', '#a855f7'],
  ['#0ea5e9', '#22d3ee'],
  ['#f97316', '#facc15'],
  ['#10b981', '#84cc16'],
  ['#ec4899', '#f472b6'],
  ['#8b5cf6', '#6366f1'],
] as const;

function bannerGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const [from, to] = BANNER_GRADIENTS[hash % BANNER_GRADIENTS.length];
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
}

export function ProductCard({ item }: { item: SearchResultItem }) {
  // An AUCTION product can sit between listings — its last auction
  // ended and no new one has been created yet — while still being
  // ACTIVE/in-stock in every other sense. Without this, the card looks
  // identical to a live auction right up until the buyer clicks through
  // and finds nothing to bid on (see ProductDetailPage's identical
  // ACTIVE/SCHEDULED check). Takes priority over "Out of stock" for
  // auction items — it's the more specific, more useful signal.
  const isEndedAuction = item.type === 'AUCTION' && !item.hasActiveAuction;

  return (
    <Link to={paths.product(item.productId)} className="product-card-link">
      <Card interactive className="product-card">
        <div
          className="product-card__banner"
          style={{ background: bannerGradient(item.categoryId) }}
        >
          <span className="product-card__banner-initial">
            {item.name.charAt(0).toUpperCase()}
          </span>
          {isEndedAuction ? (
            <Badge variant="danger">
              <span className="product-card__out-of-stock-dot" />
              Auction ended
            </Badge>
          ) : (
            !item.inStock && (
              <Badge variant="danger">
                <span className="product-card__out-of-stock-dot" />
                Out of stock
              </Badge>
            )
          )}
        </div>

        <div className="product-card__body">
          <div className="product-card__badges">
            <span className="product-card__category">{item.categoryName}</span>
            {item.type === 'AUCTION' && <Badge variant="accent">Auction</Badge>}
          </div>
          <h3 className="product-card__name">{item.name}</h3>
          <p className="product-card__seller">by {item.sellerName}</p>
          <div className="product-card__bottom">
            <span className="product-card__price">
              {formatMoney(item.basePrice)}
            </span>
            {item.productRating != null && (
              <span className="product-card__rating">
                <RatingStars value={item.productRating} />
              </span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
