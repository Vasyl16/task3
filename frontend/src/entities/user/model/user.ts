import type { UserRole } from '../../session';

// The real User resource (GET/PATCH /users/:id) — distinct from
// entities/session's SessionUser, which is only the {id, email, role}
// decoded client-side from the access token for display purposes. Name
// isn't a JWT claim, so showing or editing it means actually fetching
// this.
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateUserInput {
  name?: string;
  avatarUrl?: string;
}
