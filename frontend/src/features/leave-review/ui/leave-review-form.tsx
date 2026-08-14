import { useState } from 'react';
import { RatingStars } from '../../../entities/review';
import { Alert, Button, Textarea } from '../../../shared/ui';
import { useLeaveReview } from '../model/use-leave-review';

interface LeaveReviewFormProps {
  productId: string;
  // The purchased line item this review is attached to. The parent knows
  // it because it found a delivered, not-yet-reviewed purchase — see
  // useReviewablePurchase.
  orderItemId: string;
}

export function LeaveReviewForm({
  productId,
  orderItemId,
}: LeaveReviewFormProps) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const leaveReview = useLeaveReview(productId);

  if (leaveReview.isSuccess) {
    return <Alert variant="info">Thanks — your review is published.</Alert>;
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        leaveReview.mutate({
          orderItemId,
          rating,
          // Empty string would fail the backend's MinLength(3); a rating
          // on its own is a valid review, so send nothing instead.
          comment: comment.trim() ? comment.trim() : undefined,
        });
      }}
      style={{ display: 'grid', gap: '0.75rem' }}
    >
      <div style={{ display: 'grid', gap: '0.35rem' }}>
        <span style={{ fontWeight: 600 }}>Your rating</span>
        <RatingStars value={rating} size="md" onChange={setRating} />
      </div>

      <Textarea
        label="Comment (optional)"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="How did it work out?"
        rows={3}
      />

      {leaveReview.isError && (
        <Alert variant="error">
          {leaveReview.error instanceof Error
            ? leaveReview.error.message
            : 'Could not publish your review.'}
        </Alert>
      )}

      <Button
        type="submit"
        // Guarded here as well as on the server: rating is required and
        // must be 1..5, and a zero would be rejected with a 400 that
        // reads like a bug rather than a prompt.
        disabled={rating < 1 || leaveReview.isPending}
      >
        {leaveReview.isPending ? 'Publishing…' : 'Publish review'}
      </Button>
    </form>
  );
}
