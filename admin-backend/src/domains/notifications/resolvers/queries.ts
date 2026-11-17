import { NotificationsRepo } from '../../../repos/notifications/notificationsRepo';
import { NotificationService } from '../services/NotificationService';

import { notificationReadScope, notificationStatsScope } from '../services/notificationReadScope.js';

export function buildNotificationsQueryResolvers() {
	const notificationsRepo = new NotificationsRepo();
	const notificationService = new NotificationService(notificationsRepo);

	const myNotificationsResolver = async (
		parent: any,
		args: { category?: string; limit?: number; offset?: number; unreadOnly?: boolean | null } | undefined,
		ctx: any
	) => {
		// Outside the try: a caller without a session is refused, not handed an empty inbox.
		const scope = notificationReadScope(ctx, args?.category);
		try {
			// Both went straight into the SQL query with no ceiling, so one call could
			// pull the tenant's whole notifications table.
			const limit = Math.min(200, Math.max(1, args?.limit ?? 50));
			const offset = Math.min(100_000, Math.max(0, args?.offset ?? 0));

			// The bells list unread rows only. Reading the newest rows and keeping the unread ones hid
			// any unread notification older than the window, while the badge (notificationStats) counted it.
			const filters = { ...scope, ...(args?.unreadOnly ? { isRead: false } : {}), limit, offset };

			const notifications = await notificationService.getNotificationsForUser(filters);

			return notifications.map((n) => ({
				id: n.id,
				type: n.type,
				category: n.category,
				title: n.title,
				message: n.message,
				metadata: n.metadata,
				isRead: n.isRead,
				actionUrl: n.actionUrl,
				createdAt: n.createdAt?.toISOString() || new Date().toISOString(),
			}));
		} catch (error: any) {
			return [];
		}
	};

	const notificationStatsResolver = async (parent: any, args: any, ctx: any) => {
		// The same recipient scope as the list, so the counts and the rows agree. Outside the try:
		// a caller without a session is refused rather than answered with zero counts.
		const filters = notificationStatsScope(ctx);
		try {
			const stats = await notificationService.getNotificationStats(filters);

			return {
				totalUnread: stats.totalUnread,
				generalUnread: stats.generalUnread,
				taskUnread: stats.taskUnread,
			};
		} catch (error: any) {
			return {
				totalUnread: 0,
				generalUnread: 0,
				taskUnread: 0,
			};
		}
	};

	return {
    myNotification: async (_: any, args: { id: string; category?: string }, ctx: any) => {
      // The caller's own inbox, scoped exactly as myNotifications is, so a session is all it takes (the scope
      // refuses a caller without one). It also required notifications.list:view, "Manage system notifications",
      // which no Whitelabel Admin or agent holds: the bell listed their notifications and every detail refused them.
      const scope = notificationReadScope(ctx, args.category);
      if (args.category != null && args.category !== 'general' && args.category !== 'task') throw new Error('Invalid notification category');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.id)) return null;
      const rows = await notificationService.getNotificationsForUser({ ...scope, id: args.id, limit: 1, offset: 0 });
      const notification = rows[0];
      return notification ? { ...notification, createdAt: notification.createdAt?.toISOString() || new Date().toISOString() } : null;
    },
		myNotifications: myNotificationsResolver,
		notificationStats: notificationStatsResolver,
	};
}
