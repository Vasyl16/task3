import type { SellerProfile } from '../../../entities/seller';
import { Button, ErrorAlert } from '../../../shared/ui';
import { useReviewSellerApplication } from '../model/use-review-seller-application';

export function ReviewSellerApplicationControl({
  profile,
}: {
  profile: SellerProfile;
}) {
  const review = useReviewSellerApplication();

  return (
    <div>
      <ErrorAlert error={review.error} />
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        {profile.status === 'PENDING' && (
          <>
            <Button
              isLoading={review.isPending}
              onClick={() =>
                review.mutate({ sellerId: profile.id, status: 'APPROVED' })
              }
            >
              Approve
            </Button>
            <Button
              variant="danger"
              isLoading={review.isPending}
              onClick={() =>
                review.mutate({ sellerId: profile.id, status: 'REJECTED' })
              }
            >
              Reject
            </Button>
          </>
        )}
        {profile.status === 'APPROVED' && (
          <Button
            variant="danger"
            isLoading={review.isPending}
            onClick={() =>
              review.mutate({ sellerId: profile.id, status: 'SUSPENDED' })
            }
          >
            Suspend
          </Button>
        )}
        {profile.status === 'SUSPENDED' && (
          <Button
            isLoading={review.isPending}
            onClick={() =>
              review.mutate({ sellerId: profile.id, status: 'APPROVED' })
            }
          >
            Reinstate
          </Button>
        )}
      </div>
    </div>
  );
}
