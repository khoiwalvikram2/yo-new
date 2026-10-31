import { db } from '../../db/client';
import { notifications } from '@shared/db/schema';
import { and, eq, desc, or, sql, inArray } from 'drizzle-orm';

export interface CreateNotificationInput {
	tenant: string;
	userId?: number | null;
	agentId?: string | null;
	whitelabelId?: string | null;
	type: 'DEPOSIT' | 'WITHDRAWAL' | 'KYC' | 'SYSTEM' | 'AGENT' | 'PLAYER' | 'SETTLEMENT' | 'COMMISSION';
	category: 'general' | 'task';
	title: string;
	message: string;
	metadata?: any;
	actionUrl?: string | null;
}

export interface NotificationFilters {
	tenant: string;
	userId?: number;
	agentId?: string;
	whitelabelId?: string;
	category?: 'general' | 'task';
	allowedTypes?: Array<CreateNotificationInput['type']>;
	isRead?: boolean;
	limit?: number;
	offset?: number;
}

export class NotificationsRepo {
	async createNotification(input: CreateNotificationInput, pubsub?: any) {
		const [notification] = await db
			.insert(notifications)
			.values({
				tenant: input.tenant,
				userId: input.userId ?? null,
				agentId: input.agentId ?? null,
				whitelabelId: input.whitelabelId ?? null,
				type: input.type,
				category: input.category,
				title: input.title,
				message: input.message,
				metadata: input.metadata ?? null,
				actionUrl: input.actionUrl ?? null,
				isRead: false,
			})
			.returning();

		// Publish notification for real-time updates (non-blocking)
		if (pubsub && notification) {
			const { publishNotification } = await import('../../domains/notifications/services/NotificationPublisher.js');
			publishNotification(pubsub, notification).catch((err) => {
			});
		}

		return notification;
	}

	async getNotifications(filters: NotificationFilters & { id?: string }) {
		const conditions = [eq(notifications.tenant, filters.tenant)];
		if (filters.id !== undefined) conditions.push(eq(notifications.id, filters.id));

		if (filters.userId !== undefined) {
			conditions.push(eq(notifications.userId, filters.userId));
		}

		if (filters.agentId !== undefined) {
			conditions.push(eq(notifications.agentId, filters.agentId));
		}

		if (filters.whitelabelId !== undefined) {
			conditions.push(eq(notifications.whitelabelId, filters.whitelabelId));
		}

		if (filters.category) {
			conditions.push(eq(notifications.category, filters.category));
		}

		if (filters.allowedTypes && filters.allowedTypes.length > 0) {
			conditions.push(inArray(notifications.type, filters.allowedTypes));
		}

		if (filters.isRead !== undefined) {
			conditions.push(eq(notifications.isRead, filters.isRead));
		}

		const limit = filters.limit ?? 50;
		const offset = filters.offset ?? 0;

		const results = await db
			.select()
			.from(notifications)
			.where(and(...conditions))
			.orderBy(desc(notifications.createdAt))
			.limit(limit)
			.offset(offset);

		return results;
	}

	async getNotificationStats(filters: Omit<NotificationFilters, 'limit' | 'offset' | 'isRead' | 'category'>) {
		const conditions = [eq(notifications.tenant, filters.tenant)];

		if (filters.userId !== undefined) {
			conditions.push(eq(notifications.userId, filters.userId));
		}

		if (filters.agentId !== undefined) {
			conditions.push(eq(notifications.agentId, filters.agentId));
		}

		if (filters.whitelabelId !== undefined) {
			conditions.push(eq(notifications.whitelabelId, filters.whitelabelId));
		}

		// For task count, only count allowed types (e.g. whitelabel admins should only see DEPOSIT/WITHDRAWAL tasks)
		const taskTypeFilter = filters.allowedTypes && filters.allowedTypes.length > 0
			? sql` AND ${notifications.type} IN (${sql.join(filters.allowedTypes.map(t => sql`${t}`), sql`, `)})`
			: sql``;

		const [stats] = await db
			.select({
				totalUnread: sql<number>`COUNT(*) FILTER (WHERE ${notifications.isRead} = false)`,
				generalUnread: sql<number>`COUNT(*) FILTER (WHERE ${notifications.isRead} = false AND ${notifications.category} = 'general')`,
				taskUnread: sql<number>`COUNT(*) FILTER (WHERE ${notifications.isRead} = false AND ${notifications.category} = 'task'${taskTypeFilter})`,
			})
			.from(notifications)
			.where(and(...conditions));

		return {
			totalUnread: Number(stats.totalUnread) || 0,
			generalUnread: Number(stats.generalUnread) || 0,
			taskUnread: Number(stats.taskUnread) || 0,
		};
	}

	async markAsRead(notificationId: string, filters: Omit<NotificationFilters, 'limit' | 'offset' | 'isRead' | 'category'>) {
		const conditions = [
			eq(notifications.id, notificationId),
			eq(notifications.tenant, filters.tenant),
		];

		if (filters.userId !== undefined) {
			conditions.push(eq(notifications.userId, filters.userId));
		}

		if (filters.agentId !== undefined) {
			conditions.push(eq(notifications.agentId, filters.agentId));
		}

		if (filters.whitelabelId !== undefined) {
			conditions.push(eq(notifications.whitelabelId, filters.whitelabelId));
		}

		const [updated] = await db
			.update(notifications)
			.set({ isRead: true })
			.where(and(...conditions))
			.returning();

		return updated;
	}

	async markAsReadByDepositRequestId(
		depositRequestId: number,
		filters: { tenant: string }
	): Promise<number> {
		const depositIdStr = String(depositRequestId);
		const updated = await db
			.update(notifications)
			.set({ isRead: true })
			.where(
				and(
					eq(notifications.tenant, filters.tenant),
					sql`${notifications.metadata}->>'depositRequestId' = ${depositIdStr}`
				)
			)
			.returning({ id: notifications.id });
		return updated.length;
	}

	async markAsReadByWithdrawalRequestId(
		withdrawalRequestId: number,
		filters: { tenant: string }
	): Promise<number> {
		const withdrawalIdStr = String(withdrawalRequestId);
		const updated = await db
			.update(notifications)
			.set({ isRead: true })
			.where(
				and(
					eq(notifications.tenant, filters.tenant),
					sql`${notifications.metadata}->>'withdrawalRequestId' = ${withdrawalIdStr}`
				)
			)
			.returning({ id: notifications.id });
		return updated.length;
	}

	async markAllAsRead(
		category: 'general' | 'task' | null,
		filters: Omit<NotificationFilters, 'limit' | 'offset' | 'isRead' | 'category'>
	) {
		const conditions = [
			eq(notifications.tenant, filters.tenant),
			eq(notifications.isRead, false),
		];

		if (filters.userId !== undefined) {
			conditions.push(eq(notifications.userId, filters.userId));
		}

		if (filters.agentId !== undefined) {
			conditions.push(eq(notifications.agentId, filters.agentId));
		}

		if (filters.whitelabelId !== undefined) {
			conditions.push(eq(notifications.whitelabelId, filters.whitelabelId));
		}

		if (category) {
			conditions.push(eq(notifications.category, category));
		}

		const result = await db
			.update(notifications)
			.set({ isRead: true })
			.where(and(...conditions))
			.returning();

		return result.length;
	}
}
