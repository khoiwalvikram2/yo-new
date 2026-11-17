import { NotificationsRepo } from '../../../repos/notifications/notificationsRepo';

export class NotificationService {
	constructor(private notificationsRepo: NotificationsRepo) {}

	async createNotification(
		input: {
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
		},
		pubsub?: any
	) {
		return this.notificationsRepo.createNotification(input, pubsub);
	}

	async getNotificationsForUser(filters: {
		id?: string;
		tenant: string;
		userId?: number;
		agentId?: string;
		whitelabelId?: string;
		category?: 'general' | 'task';
		allowedTypes?: Array<'DEPOSIT' | 'WITHDRAWAL' | 'KYC' | 'SYSTEM' | 'AGENT' | 'PLAYER' | 'SETTLEMENT' | 'COMMISSION'>;
		isRead?: boolean;
		limit?: number;
		offset?: number;
	}) {
		return this.notificationsRepo.getNotifications(filters);
	}

	async getNotificationStats(filters: {
		tenant: string;
		userId?: number;
		agentId?: string;
		whitelabelId?: string;
		allowedTypes?: Array<'DEPOSIT' | 'WITHDRAWAL' | 'KYC' | 'SYSTEM' | 'AGENT' | 'PLAYER' | 'SETTLEMENT' | 'COMMISSION'>;
	}) {
		return this.notificationsRepo.getNotificationStats(filters);
	}

	async markNotificationAsRead(
		notificationId: string,
		filters: {
			tenant: string;
			userId?: number;
			agentId?: string;
			whitelabelId?: string;
		}
	) {
		const notification = await this.notificationsRepo.markAsRead(notificationId, filters);
		if (!notification) {
			throw new Error('Notification not found or access denied');
		}
		return notification;
	}

	async markAllNotificationsAsRead(
		category: 'general' | 'task' | null,
		filters: {
			tenant: string;
			userId?: number;
			agentId?: string;
			whitelabelId?: string;
		}
	) {
		return this.notificationsRepo.markAllAsRead(category, filters);
	}

	async markNotificationsReadForDepositRequest(
		depositRequestId: number,
		filters: { tenant: string }
	): Promise<number> {
		return this.notificationsRepo.markAsReadByDepositRequestId(depositRequestId, filters);
	}

	async markNotificationsReadForWithdrawalRequest(
		withdrawalRequestId: number,
		filters: { tenant: string }
	): Promise<number> {
		return this.notificationsRepo.markAsReadByWithdrawalRequestId(withdrawalRequestId, filters);
	}
}
