/**
 * Helper function to publish notifications via pubsub for real-time updates
 */
export async function publishNotification(
	pubsub: any,
	notification: {
		id: string;
		tenant: string;
		userId?: number | null;
		agentId?: string | null;
		whitelabelId?: string | null;
		type: string;
		category: 'general' | 'task';
		title: string;
		message: string;
		metadata?: any;
		actionUrl?: string | null;
		isRead: boolean;
		createdAt: Date;
	}
) {
	if (!pubsub || typeof pubsub.publish !== 'function') {
		return; // Pubsub not available, skip publishing
	}

	const payload = {
		notificationReceived: {
			id: notification.id,
			type: notification.type,
			category: notification.category,
			title: notification.title,
			message: notification.message,
			metadata: notification.metadata,
			isRead: notification.isRead,
			actionUrl: notification.actionUrl,
			createdAt: notification.createdAt.toISOString(),
		},
	};

	// Publish to multiple topics to ensure all relevant subscribers receive the notification
	// This allows both agents and whitelabel admins to see notifications
	const topics: string[] = [];
	
	if (notification.userId) {
		topics.push(`NOTIFICATION_USER_${notification.userId}_${notification.tenant}`);
	}
	
	if (notification.agentId) {
		topics.push(`NOTIFICATION_AGENT_${notification.agentId}_${notification.tenant}`);
	}
	
	if (notification.whitelabelId) {
		topics.push(`NOTIFICATION_WHITELABEL_${notification.whitelabelId}_${notification.tenant}`);
	}
	
	// If no specific recipient, publish to default topic
	if (topics.length === 0) {
		topics.push(`NOTIFICATION_DEFAULT_${notification.tenant}`);
	}

	// Publish to all relevant topics
	const publishPromises = topics.map(topic => {
		try {
			const publishResult = pubsub.publish({ topic, payload });
			if (publishResult && typeof publishResult.catch === 'function') {
				return publishResult.catch((err: Error) => {
					// Ignore EOF errors (stream already closed)
					if (err?.message?.includes('EOF') || err?.message?.includes('stream.push')) {
						return;
					}
				});
			}
			return publishResult;
		} catch (err: any) {
			// Ignore EOF errors (stream already closed)
			if (err?.message?.includes('EOF') || err?.message?.includes('stream.push')) {
				return Promise.resolve();
			}
			return Promise.resolve();
		}
	});

	// Wait for all publishes (non-blocking)
	Promise.all(publishPromises).catch((err) => {
	});
}
