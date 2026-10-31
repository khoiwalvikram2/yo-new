import { NotificationsRepo } from '../../../repos/notifications/notificationsRepo';
import { NotificationService } from '../services/NotificationService';
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js';

import { notificationReadScope } from '../services/notificationReadScope.js';
import { hasPermission } from '@src/domains/common/auth.js';

export function buildNotificationsQueryResolvers() {
	const notificationsRepo = new NotificationsRepo();
	const notificationService = new NotificationService(notificationsRepo);

	const myNotificationsResolver = async (
		parent: any,
		args: { category?: string; limit?: number; offset?: number } | undefined,
		ctx: any
	) => {
		try {
			const { category } = args || {};
			// Both went straight into the SQL query with no ceiling, so one call could
			// pull the tenant's whole notifications table.
			const limit = Math.min(200, Math.max(1, args?.limit ?? 50));
			const offset = Math.min(100_000, Math.max(0, args?.offset ?? 0));

			const filters = { ...notificationReadScope(ctx, category), limit, offset };

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
		try {
			// CRITICAL: For Director Admin, use effective tenant based on mode
			// For Whitelabel Admin and Agents, use existing logic (UNCHANGED)
			const directorTenant = getEffectiveTenantForDirector(ctx)
			let tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
			if (typeof tenant !== 'string' || tenant.trim() === '') {
				tenant = 'default';
			} else {
				tenant = tenant.trim();
			}

			const filters: any = {
				tenant,
			};

			// Filter by user type
			if (ctx?.user?.type === 'user' && ctx?.user?.userId) {
				filters.userId = ctx.user.userId;
			} else if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				filters.agentId = ctx.user.agentId;
			} else if (directorTenant || ctx?.whitelabel?.id) {
				filters.whitelabelId = directorTenant ?? ctx?.whitelabel?.id;
				// Whitelabel admins should only count DEPOSIT/WITHDRAWAL as tasks
				filters.allowedTypes = ['DEPOSIT', 'WITHDRAWAL'];
			}

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
      if (!ctx?.user) throw new Error('Unauthorized: authentication required');
      if (!hasPermission(ctx?.permissions ?? [], 'notifications.list', 'view')) throw new Error('Forbidden: insufficient permissions for notifications');
      if ((ctx.user.type === 'agent' && !ctx.user.agentId) || (ctx.user.type === 'user' && !ctx.user.userId)) throw new Error('Forbidden: recipient identity required');
      if (args.category != null && args.category !== 'general' && args.category !== 'task') throw new Error('Invalid notification category');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.id)) return null;
      const rows = await notificationService.getNotificationsForUser({ ...notificationReadScope(ctx, args.category), id: args.id, limit: 1, offset: 0 });
      const notification = rows[0];
      return notification ? { ...notification, createdAt: notification.createdAt?.toISOString() || new Date().toISOString() } : null;
    },
		myNotifications: myNotificationsResolver,
		notificationStats: notificationStatsResolver,
	};
}
