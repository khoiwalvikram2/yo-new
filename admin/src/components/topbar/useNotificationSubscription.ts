import { useEffect, useRef, useState } from 'react';
import { useSubscription, useQuery } from '@apollo/client';
import { NOTIFICATION_SUBSCRIPTION, NOTIFICATION_STATS_QUERY } from '@/lib/graphql/notifications';
import { useNotificationStore } from '@/state/notificationStore';

const NOTIFICATION_SUB_DEFER_MS = 400;

/**
 * Hook to subscribe to real-time notifications via WebSocket
 * Deferred briefly so dashboard KPI and layout can load first.
 */
export function useNotificationSubscription() {
	const { addNotification, setStats } = useNotificationStore();
	const [ready, setReady] = useState(false);

	useEffect(() => {
		const t = setTimeout(() => setReady(true), NOTIFICATION_SUB_DEFER_MS);
		return () => clearTimeout(t);
	}, []);

	const { data, error } = useSubscription(NOTIFICATION_SUBSCRIPTION, {
		skip: typeof window === 'undefined' || !ready,
		onError: () => {},
	});

	// Refetch stats when a new notification is received
	const { refetch: refetchStats } = useQuery(NOTIFICATION_STATS_QUERY, {
		skip: true, // Only refetch manually
		errorPolicy: 'all',
	});

	const refetchStatsRef = useRef(refetchStats);
	refetchStatsRef.current = refetchStats;

	useEffect(() => {
		if (!data?.notificationReceived) return;
		try {
			const notification = data.notificationReceived;

			if (!notification || typeof notification !== 'object') {
				return;
			}
			if (!notification.id) {
				return;
			}

			const safeNotification = {
				...notification,
				id: String(notification.id),
				title: String(notification.title || ''),
				message: String(notification.message || ''),
				type: String(notification.type || ''),
				category: notification.category === 'general' || notification.category === 'task'
					? notification.category
					: 'general',
				isRead: Boolean(notification.isRead),
				createdAt: notification.createdAt || new Date().toISOString(),
			};

			addNotification(safeNotification);

			refetchStatsRef.current().then((result) => {
				if (result.data?.notificationStats) {
					setStats(result.data.notificationStats);
				}
			}).catch(() => {});

			if (typeof window !== 'undefined') {
				window.dispatchEvent(new CustomEvent('notificationReceived', { detail: safeNotification }));
			}
		} catch {
			// ignore
		}
	}, [data, addNotification, setStats]);

	// Return error for debugging (subscription may not be configured)
	if (error) {
		// error is returned to caller
	}

	return { error };
}
