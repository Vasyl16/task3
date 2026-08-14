import { NotFoundException } from '@nestjs/common';
import type { NotificationsRepository } from './domain/notifications.repository';
import { NotificationsService } from './notifications.service';

// markRead used to take only an id. Because it RETURNS the notification
// it marked — title, body, and the data payload with order ids in it —
// a valid token from any account was enough to read another user's
// notification content. These are the regression tests for that.
describe('NotificationsService.markRead (ownership)', () => {
  const OWNER = 'user-owner';
  const STRANGER = 'user-stranger';

  let repository: jest.Mocked<
    Pick<NotificationsRepository, 'findById' | 'markRead' | 'findForUser'>
  >;
  let service: NotificationsService;

  beforeEach(() => {
    repository = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'notif-1', userId: OWNER, readAt: null }),
      markRead: jest.fn().mockResolvedValue({
        id: 'notif-1',
        userId: OWNER,
        readAt: new Date(),
      }),
      findForUser: jest.fn().mockResolvedValue([]),
    };
    service = new NotificationsService(
      repository as unknown as NotificationsRepository,
    );
  });

  it('marks the caller’s own notification read', async () => {
    await expect(service.markRead('notif-1', OWNER)).resolves.toMatchObject({
      id: 'notif-1',
    });
    expect(repository.markRead).toHaveBeenCalledWith('notif-1');
  });

  it('refuses another user’s notification, and does not write to it', async () => {
    await expect(service.markRead('notif-1', STRANGER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.markRead).not.toHaveBeenCalled();
  });

  // 404, not 403: a 403 would confirm this notification id exists, which
  // is itself information a stranger has no business having.
  it('reports someone else’s notification as not found, not forbidden', async () => {
    await expect(service.markRead('notif-1', STRANGER)).rejects.toThrow(
      'Notification notif-1 not found',
    );
  });

  it('404s for a notification that does not exist', async () => {
    repository.findById.mockResolvedValue(null);
    await expect(service.markRead('gone', OWNER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
