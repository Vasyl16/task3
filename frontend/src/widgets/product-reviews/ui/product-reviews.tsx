import {
  RatingStars,
  useProductReviews,
  useReviewablePurchases,
} from '../../../entities/review';
import { useAuth } from '../../../features/auth';
import { LeaveReviewForm } from '../../../features/leave-review';
import { Card, EmptyState, ErrorState, Spinner } from '../../../shared/ui';

interface ProductReviewsProps {
  productId: string;
}

export function ProductReviews({ productId }: ProductReviewsProps) {
  const { status } = useAuth();
  const signedIn = status === 'authenticated';

  const reviews = useProductReviews(productId);
  // Only asked for when signed in — anonymous visitors have nothing to
  // review and the endpoint would 401.
  const reviewable = useReviewablePurchases(signedIn);

  // The server is the authority on who may review; this only decides
  // whether to render the form. A stale list means a rejected submit,
  // never an unauthorised review.
  const purchase = reviewable.data?.find(
    (item) => item.productId === productId,
  );

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Reviews</h2>

      {purchase && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>
            You bought this — how was it?
          </p>
          <LeaveReviewForm
            productId={productId}
            orderItemId={purchase.orderItemId}
          />
        </div>
      )}

      {reviews.isPending ? (
        <Spinner />
      ) : reviews.error ? (
        <ErrorState
          error={reviews.error}
          onRetry={() => void reviews.refetch()}
        />
      ) : reviews.data.length === 0 ? (
        <EmptyState
          title="No reviews yet"
          description="Only customers who bought this product can review it."
        />
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            display: 'grid',
            gap: 'var(--space-3)',
          }}
        >
          {reviews.data.map((review) => (
            <li
              key={review.id}
              style={{
                borderTop: '1px solid var(--color-border)',
                paddingTop: 'var(--space-3)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  flexWrap: 'wrap',
                }}
              >
                <RatingStars value={review.rating} />
                {/* Every row here is a verified purchase by construction
                    — the backend cannot create one otherwise — so this
                    label is a fact, not a claim about this row alone. */}
                <span
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--color-success, #157347)',
                  }}
                >
                  Verified purchase
                </span>
                <span
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {new Date(review.createdAt).toLocaleDateString()}
                </span>
              </div>
              {review.comment && (
                <p style={{ margin: 'var(--space-2) 0 0' }}>{review.comment}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
