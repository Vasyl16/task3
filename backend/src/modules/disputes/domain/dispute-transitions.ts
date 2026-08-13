import { DisputeStatus } from '@prisma/client';

// A dispute moves forward only. RESOLVED and REJECTED are terminal: once
// an admin has ruled, reopening would erase the audit trail of what was
// decided and by whom — a new dispute is raised instead.
const ALLOWED_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  [DisputeStatus.OPEN]: [
    DisputeStatus.UNDER_REVIEW,
    DisputeStatus.RESOLVED,
    DisputeStatus.REJECTED,
  ],
  [DisputeStatus.UNDER_REVIEW]: [
    DisputeStatus.RESOLVED,
    DisputeStatus.REJECTED,
  ],
  [DisputeStatus.RESOLVED]: [],
  [DisputeStatus.REJECTED]: [],
};

export function isValidDisputeTransition(
  from: DisputeStatus,
  to: DisputeStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// A ruling has to say what was decided; moving to UNDER_REVIEW is just an
// acknowledgement and doesn't.
export function requiresResolutionText(to: DisputeStatus): boolean {
  return to === DisputeStatus.RESOLVED || to === DisputeStatus.REJECTED;
}

export function isTerminalDisputeStatus(status: DisputeStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}
