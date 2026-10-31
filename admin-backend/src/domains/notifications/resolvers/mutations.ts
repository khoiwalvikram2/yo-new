import { NotificationsRepo } from '../../../repos/notifications/notificationsRepo';
import { NotificationService } from '../services/NotificationService';
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js';

export function buildNotificationsMutationResolvers() {
	const notificationsRepo = new NotificationsRepo();
	const notificationService = new NotificationService(notificationsRepo);

	const markNotificationReadResolver = async (
		parent: any,
		args: { id: string } | undefined,
		ctx: any
	) => {
		try {
			if (!args?.id) {
				throw new Error('Notification ID is required');
			}

			// CRITICAL: For Director Admin, use effective tenant based on mode
			const directorTenant = getEffectiveTenantForDirector(ctx)
			let tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
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
				filters.whitelabelId = directorTenant ?? ctx.whitelabel.id;
			}

			const notification = await notificationService.markNotificationAsRead(args.id, filters);

			return {
				id: notification.id,
				type: notification.type,
				category: notification.category,
				title: notification.title,
				message: notification.message,
				metadata: notification.metadata,
				isRead: notification.isRead,
				actionUrl: notification.actionUrl,
				createdAt: notification.createdAt?.toISOString() || new Date().toISOString(),
			};
		} catch (error: any) {
			throw new Error(error.message || 'Failed to mark notification as read');
		}
	};

	const markAllNotificationsReadResolver = async (
		parent: any,
		args: { category?: string } | undefined,
		ctx: any
	) => {
		try {
			// CRITICAL: For Director Admin, use effective tenant based on mode
			const directorTenant = getEffectiveTenantForDirector(ctx)
			let tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
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
				filters.whitelabelId = directorTenant ?? ctx.whitelabel.id;
			}

			const category = args?.category && (args.category === 'general' || args.category === 'task') 
				? args.category 
				: null;

			const count = await notificationService.markAllNotificationsAsRead(category, filters);

			return count > 0;
		} catch (error: any) {
			throw new Error(error.message || 'Failed to mark all notifications as read');
		}
	};

	return {
		markNotificationRead: markNotificationReadResolver,
		markAllNotificationsRead: markAllNotificationsReadResolver,
	};
}
