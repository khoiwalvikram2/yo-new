import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface Notification {
	id: string
	type: string
	category: 'general' | 'task'
	title: string
	message: string
	metadata?: Record<string, unknown>
	isRead: boolean
	actionUrl?: string | null
	createdAt: string
}

export interface NotificationStats {
	totalUnread: number
	generalUnread: number
	taskUnread: number
}

interface NotificationState {
	// Stats
	generalUnread: number
	taskUnread: number
	totalUnread: number

	// Notifications cache
	notifications: Notification[]
	lastFetched: number | null

	// Actions
	setStats: (stats: NotificationStats) => void
	addNotification: (notification: Notification) => void
	markAsRead: (id: string) => void
	markAllAsRead: (category?: 'general' | 'task') => void
	setNotifications: (notifications: Notification[]) => void
	clearNotifications: () => void
}

const initialState = {
	generalUnread: 0,
	taskUnread: 0,
	totalUnread: 0,
	notifications: [],
	lastFetched: null,
}

export const useNotificationStore = create<NotificationState>()(
	persist(
		(set) => ({
			...initialState,

			setStats: (stats: NotificationStats) => {
				set({
					generalUnread: stats.generalUnread,
					taskUnread: stats.taskUnread,
					totalUnread: stats.totalUnread,
				})
			},

			addNotification: (notification: Notification) => {
				set((state) => {
					// Ensure notification has valid id
					if (!notification || !notification.id) {
						return state;
					}
					
					const notificationId = String(notification.id);
					
					// Check if notification already exists (compare as strings)
					const exists = state.notifications.some((n) => String(n.id) === notificationId);
					if (exists) {
						return state;
					}

					// Ensure notification has all required fields
					const safeNotification: Notification = {
						...notification,
						id: notificationId,
						title: String(notification.title || ''),
						message: String(notification.message || ''),
						type: String(notification.type || ''),
						category: notification.category === 'general' || notification.category === 'task' 
							? notification.category 
							: 'general',
						isRead: Boolean(notification.isRead),
						createdAt: notification.createdAt || new Date().toISOString(),
					};

					// Add to front of array
					const updated = [safeNotification, ...state.notifications].slice(0, 50); // Keep last 50

					// Update unread counts
					let generalUnread = state.generalUnread;
					let taskUnread = state.taskUnread;

					if (!safeNotification.isRead) {
						if (safeNotification.category === 'general') {
							generalUnread += 1;
						} else if (safeNotification.category === 'task') {
							taskUnread += 1;
						}
					}

					return {
						notifications: updated,
						generalUnread,
						taskUnread,
						totalUnread: generalUnread + taskUnread,
					};
				});
			},

			markAsRead: (id: string) => {
				set((state) => {
					const notificationId = String(id || '');
					if (!notificationId) {
						return state;
					}
					
					const notification = state.notifications.find((n) => String(n.id) === notificationId);
					if (!notification || notification.isRead) {
						return state;
					}

					const updated = state.notifications.map((n) =>
						String(n.id) === notificationId ? { ...n, isRead: true } : n
					);

					// Update unread counts
					let generalUnread = state.generalUnread;
					let taskUnread = state.taskUnread;

					if (notification.category === 'general' && generalUnread > 0) {
						generalUnread -= 1;
					} else if (notification.category === 'task' && taskUnread > 0) {
						taskUnread -= 1;
					}

					return {
						notifications: updated,
						generalUnread,
						taskUnread,
						totalUnread: generalUnread + taskUnread,
					};
				});
			},

			markAllAsRead: (category?: 'general' | 'task') => {
				set((state) => {
					const updated = state.notifications.map((n) => {
						if (category) {
							return n.category === category && !n.isRead ? { ...n, isRead: true } : n
						}
						return !n.isRead ? { ...n, isRead: true } : n
					})

					let generalUnread = state.generalUnread
					let taskUnread = state.taskUnread

					if (category === 'general') {
						generalUnread = 0
					} else if (category === 'task') {
						taskUnread = 0
					} else {
						generalUnread = 0
						taskUnread = 0
					}

					return {
						notifications: updated,
						generalUnread,
						taskUnread,
						totalUnread: 0,
					}
				})
			},

			setNotifications: (notifications: Notification[]) => {
				set({
					notifications,
					lastFetched: Date.now(),
				})
			},

			clearNotifications: () => {
				set(initialState)
			},
		}),
		{
			name: 'notification-storage',
			storage: createJSONStorage(() => localStorage),
			partialize: (state) => ({
				// Don't persist notifications array (too large)
				// Only persist stats and last fetched time
				generalUnread: state.generalUnread,
				taskUnread: state.taskUnread,
				totalUnread: state.totalUnread,
				lastFetched: state.lastFetched,
			}),
		}
	)
)
