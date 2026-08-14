import { Link } from 'react-router-dom';
import {
  SellerStatusBadge,
  useMySellerProfile,
} from '../../../entities/seller';
import { useMyProfile } from '../../../entities/user';
import { paths } from '../../../app/routes/paths';
import { useAuth } from '../../../features/auth';
import { ApplySellerForm } from '../../../features/become-seller';
import { EditProfileNameForm } from '../../../features/update-profile';
import {
  Avatar,
  Card,
  ErrorState,
  PageHeader,
  PageSpinner,
} from '../../../shared/ui';

// The one authenticated route the foundation shipped with, since grown
// into the account/become-a-seller hub — the customer marketplace UI
// task didn't specify a dedicated screen for applying to sell, and this
// avoids adding a route whose only content would be one form.
export function AccountPage() {
  const { user } = useAuth();
  const {
    data: sellerProfile,
    error: sellerProfileError,
    isPending: isSellerProfilePending,
    refetch: refetchSellerProfile,
  } = useMySellerProfile();
  const { data: profile, error, isPending, refetch } = useMyProfile(user?.id);

  // ProtectedRoute guarantees a user here; this satisfies the type
  // without pretending the null case is reachable.
  if (!user) return null;

  return (
    <div>
      <PageHeader title="Account" />

      <Card style={{ marginBottom: 'var(--space-5)' }}>
        {isPending && <PageSpinner label="Loading your profile" />}
        {error && <ErrorState error={error} onRetry={() => void refetch()} />}
        {profile && (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                marginBottom: 'var(--space-4)',
              }}
            >
              <Avatar name={profile.name} size={48} />
              <div>
                <p style={{ margin: 0, fontWeight: 600 }}>{profile.name}</p>
                <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                  {profile.email} · {profile.role}
                </p>
              </div>
            </div>
            <EditProfileNameForm
              userId={profile.id}
              currentName={profile.name}
            />
          </>
        )}
      </Card>

      {user.role === 'SELLER' && (
        <Card>
          <p>
            You have an approved seller account.{' '}
            <Link to={paths.seller.root}>Go to your seller dashboard</Link>
          </p>
        </Card>
      )}

      {user.role === 'ADMIN' && (
        <Card>
          <p>
            <Link to={paths.admin.root}>Go to the admin dashboard</Link>
          </p>
        </Card>
      )}

      {user.role === 'CUSTOMER' && (
        <Card>
          <h2 className="ui-section__title">Sell on the marketplace</h2>
          {isSellerProfilePending && (
            <PageSpinner label="Checking your seller status" />
          )}
          {sellerProfileError && (
            <ErrorState
              error={sellerProfileError}
              onRetry={() => void refetchSellerProfile()}
            />
          )}
          {!isSellerProfilePending &&
            !sellerProfileError &&
            (sellerProfile ? (
              <p>
                Your seller application is{' '}
                <SellerStatusBadge status={sellerProfile.status} />.
                {sellerProfile.status === 'PENDING' &&
                  ' An admin will review it shortly.'}
                {sellerProfile.status === 'REJECTED' &&
                  ' Contact support if you believe this was a mistake.'}
              </p>
            ) : (
              <ApplySellerForm />
            ))}
        </Card>
      )}
    </div>
  );
}
