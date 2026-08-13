import { DisputeStatus } from '@prisma/client';
import {
  isTerminalDisputeStatus,
  isValidDisputeTransition,
  requiresResolutionText,
} from './dispute-transitions';

describe('dispute transitions', () => {
  it('allows an open dispute to be acknowledged or ruled on directly', () => {
    expect(
      isValidDisputeTransition(DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW),
    ).toBe(true);
    expect(
      isValidDisputeTransition(DisputeStatus.OPEN, DisputeStatus.RESOLVED),
    ).toBe(true);
    expect(
      isValidDisputeTransition(DisputeStatus.OPEN, DisputeStatus.REJECTED),
    ).toBe(true);
  });

  it('allows a dispute under review to be ruled on', () => {
    expect(
      isValidDisputeTransition(
        DisputeStatus.UNDER_REVIEW,
        DisputeStatus.RESOLVED,
      ),
    ).toBe(true);
    expect(
      isValidDisputeTransition(
        DisputeStatus.UNDER_REVIEW,
        DisputeStatus.REJECTED,
      ),
    ).toBe(true);
  });

  it('never moves a dispute backwards', () => {
    expect(
      isValidDisputeTransition(DisputeStatus.UNDER_REVIEW, DisputeStatus.OPEN),
    ).toBe(false);
    expect(
      isValidDisputeTransition(DisputeStatus.RESOLVED, DisputeStatus.OPEN),
    ).toBe(false);
  });

  // Reopening would overwrite resolution/resolvedBy/resolvedAt, erasing
  // the record of what was decided and by whom. A fresh complaint is a
  // new dispute.
  it('treats a ruling as final', () => {
    for (const terminal of [DisputeStatus.RESOLVED, DisputeStatus.REJECTED]) {
      expect(isTerminalDisputeStatus(terminal)).toBe(true);
      for (const target of Object.values(DisputeStatus)) {
        expect(isValidDisputeTransition(terminal, target)).toBe(false);
      }
    }
  });

  it('rejects a no-op transition to the same status', () => {
    for (const status of Object.values(DisputeStatus)) {
      expect(isValidDisputeTransition(status, status)).toBe(false);
    }
  });

  it('requires written reasoning for a ruling but not for an acknowledgement', () => {
    expect(requiresResolutionText(DisputeStatus.RESOLVED)).toBe(true);
    expect(requiresResolutionText(DisputeStatus.REJECTED)).toBe(true);
    expect(requiresResolutionText(DisputeStatus.UNDER_REVIEW)).toBe(false);
  });
});
