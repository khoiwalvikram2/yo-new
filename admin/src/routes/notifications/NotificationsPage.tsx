import { useState, useEffect, useRef, useId, type MouseEvent } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import {
	IconAlertCircle,
	IconBell,
	IconCheck,
	IconChevronRight,
	IconCircleCheck,
	IconCreditCard,
	IconCurrencyDollar,
	IconRefresh,
	IconSettings,
	IconUser,
	IconWallet,
	type TablerIcon,
} from '@tabler/icons-react';
import { MY_NOTIFICATIONS_QUERY, MARK_NOTIFICATION_READ_MUTATION, MARK_ALL_NOTIFICATIONS_READ_MUTATION } from '@/lib/graphql/notifications';
import { useNotificationStore } from '@/state/notificationStore';
import { useNotificationSubscription } from '@/components/topbar/useNotificationSubscription';
import { useAuthStore } from '@/shared/core/authStore';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { isToday, isYesterday } from '@/shared/utils/date';
import { usePageEyebrow } from '@/shell/PageEyebrowContext';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { EmptyState } from '@/ui/components/EmptyState';
import { LoadingState } from '@/ui/components/LoadingState';
import { Notice } from '@/ui/components/Notice';
import { Page } from '@/ui/components/Page';
import { PageHeader } from '@/ui/components/PageHeader';
import { Tabs, type TabItem } from '@/ui/components/Tabs';
import { tabId, tabPanelId } from '@/ui/components/tabIds';
import { strokeFor } from '@/ui/components/icons';
import {
	groupNotificationsByDate,
	hasUnreadNotifications,
	isPlainPrimaryClick,
	mergeNotifications,
	notificationAmount,
	notificationDateGroup,
	notificationDetailPath,
	notificationIconKey,
	notificationsErrorText,
	notificationTabLabel,
	notificationTimeAgo,
	notificationUserName,
	unreadForTab,
	type NotificationCategory,
	type NotificationIconKey,
	type NotificationItem,
} from './notificationsModel';
import styles from './NotificationsPage.module.css';

/* The legacy getIcon, on Tabler glyphs: Wallet, CreditCard, User, ExclamationCircle, Dollar, Setting,
   and Bell for any other type. */
const TYPE_ICONS: Record<NotificationIconKey, TablerIcon> = {
	wallet: IconWallet,
	card: IconCreditCard,
	user: IconUser,
	alert: IconAlertCircle,
	currency: IconCurrencyDollar,
	settings: IconSettings,
	bell: IconBell,
};

const TABS_ID = 'notifications';

/* No RBACGuard: this is the caller's own inbox, which the server scopes to its recipient (notificationReadScope),
   the same rows the Alerts and Tasks bells list. It was gated on notifications.list:view ("Manage system
   notifications"), which no Whitelabel Admin or agent holds, so the bells' View all led them to Access denied. */
export function NotificationsPage() {
	return <NotificationsPageContent />;
}

function NotificationsPageContent() {
	const navigate = useNavigate();
	const location = useLocation();
	const pageEyebrow = usePageEyebrow();
	const groupIdPrefix = useId();
	const { formatAmount } = useCurrency();
	const { formatDate } = useFormatDate();
	const isAgent = useAuthStore((s) => s.isAgent());
	const [activeTab, setActiveTab] = useState<'general' | 'task'>('general');
	const [page, setPage] = useState(0);
	const pageSize = 20;

	const { markAsRead: markAsReadStore, markAllAsRead: markAllAsReadStore, notifications: storeNotifications, generalUnread, taskUnread } = useNotificationStore();

	const subscriptionResult = useNotificationSubscription();
	const subscriptionError = subscriptionResult?.error;

	useEffect(() => {
		if (isAgent) {
			setActiveTab('general');
			return;
		}
		if (location.state?.category && (location.state.category === 'general' || location.state.category === 'task')) {
			setActiveTab(location.state.category);
		}
	}, [location.state, isAgent]);

	const { data, loading, error, refetch } = useQuery(MY_NOTIFICATIONS_QUERY, {
		variables: { category: isAgent ? 'general' : activeTab, limit: pageSize, offset: page * pageSize },
		pollInterval: subscriptionError ? 30000 : 0,
		errorPolicy: 'all',
		fetchPolicy: 'cache-and-network',
	});

	// Keep refetch in a ref so effects don't re-run when Apollo's refetch identity changes (avoids request flood)
	const refetchRef = useRef(refetch);
	refetchRef.current = refetch;

	useEffect(() => {
		if (storeNotifications.length > 0) {
			const t = setTimeout(() => refetchRef.current(), 100);
			return () => clearTimeout(t);
		}
	}, [storeNotifications.length]);

	useEffect(() => {
		const handler = () => refetchRef.current();
		window.addEventListener('notificationReceived', handler);
		return () => window.removeEventListener('notificationReceived', handler);
	}, []);

	const [markAsReadMutation] = useMutation(MARK_NOTIFICATION_READ_MUTATION, { refetchQueries: [MY_NOTIFICATIONS_QUERY] });
	const [markAllAsReadMutation] = useMutation(MARK_ALL_NOTIFICATIONS_READ_MUTATION, { refetchQueries: [MY_NOTIFICATIONS_QUERY] });

	const queryNotifications: NotificationItem[] = data?.myNotifications || [];
	const notifications: NotificationItem[] = mergeNotifications<NotificationItem>(storeNotifications, queryNotifications, isAgent, activeTab);

	const handleClick = async (notification: NotificationItem) => {
		const path = notificationDetailPath(notification);
		if (!path) return;
		const id = String(notification.id);
		if (!notification.isRead) {
			try {
				await markAsReadMutation({ variables: { id } });
				markAsReadStore(id);
			} catch {
				// As before: a failed mark-read still opens the notification, which marks it read on view.
			}
		}
		navigate(path);
	};

	/* A plain click keeps the legacy order (mark read, then navigate); a modified or middle click is the
	   browser's, so a row can open in a new tab. */
	const handleRowClick = (event: MouseEvent<HTMLAnchorElement>, notification: NotificationItem) => {
		if (!isPlainPrimaryClick(event)) return;
		event.preventDefault();
		void handleClick(notification);
	};

	const handleMarkAllAsRead = async () => {
		try {
			await markAllAsReadMutation({ variables: { category: activeTab } });
			markAllAsReadStore(activeTab);
			refetch();
		} catch {
			// As before: the list and the counts stay as they were.
		}
	};

	const groups = groupNotificationsByDate(notifications, (createdAt) =>
		notificationDateGroup(createdAt, { isToday, isYesterday, formatDate }),
	);

	const hasUnread = hasUnreadNotifications(notifications);
	const currentUnread = unreadForTab(activeTab, generalUnread, taskUnread);

	const tabItems: TabItem<NotificationCategory>[] = isAgent
		? [{ value: 'general', label: notificationTabLabel('General', generalUnread), icon: <IconBell size={15} stroke={strokeFor(15)} /> }]
		: [
			{ value: 'general', label: notificationTabLabel('General', generalUnread), icon: <IconBell size={15} stroke={strokeFor(15)} /> },
			{ value: 'task', label: notificationTabLabel('Tasks', taskUnread), icon: <IconCircleCheck size={15} stroke={strokeFor(15)} /> },
		];

	let body;
	if (loading && notifications.length === 0) {
		body = <LoadingState label="Loading notifications" />;
	} else if (error && notifications.length === 0) {
		body = (
			<div className={styles.state}>
				<Notice
					tone="error"
					live="polite"
					action={<Button size="sm" onClick={() => void refetch()}>Retry</Button>}
				>
					{notificationsErrorText(error)}
				</Notice>
			</div>
		);
	} else if (notifications.length === 0) {
		body = (
			<EmptyState
				title={activeTab === 'task' ? 'No pending tasks' : 'No notifications'}
				icon={activeTab === 'task' ? <IconCircleCheck size={20} stroke={strokeFor(20)} /> : <IconBell size={20} stroke={strokeFor(20)} />}
			/>
		);
	} else {
		body = (
			<div className={styles.feed}>
				{groups.map((group, groupIndex) => {
					const headingId = `${groupIdPrefix}-day-${groupIndex}`;
					return (
						<section key={group.label} className={styles.group} aria-labelledby={headingId}>
							<h3 className={styles.groupTitle} id={headingId}>{group.label}</h3>
							<ul className={styles.list}>
								{group.items.map((n) => {
									const Icon = TYPE_ICONS[notificationIconKey(n.type)];
									const amount = notificationAmount(n, formatAmount);
									const userName = notificationUserName(n);
									const timeAgo = notificationTimeAgo(n.createdAt);
									const path = notificationDetailPath(n);
									const unread = !n.isRead;
									const content = (
										<>
											<span className={styles.tile} aria-hidden="true">
												<Icon size={16} stroke={strokeFor(16)} />
											</span>
											<span className={styles.body}>
												<span className={styles.top}>
													<span className={styles.title}>{n.title}</span>
													{amount && <span className={styles.amount}>{amount}</span>}
												</span>
												<span className={styles.message}>{n.message}</span>
												<span className={styles.meta}>
													<span>{timeAgo}</span>
													{userName && <><span aria-hidden="true">·</span><span>{userName}</span></>}
												</span>
											</span>
											{unread && (
												<>
													<span className={styles.dot} aria-hidden="true" />
													<span className={styles.visuallyHidden}>Unread</span>
												</>
											)}
										</>
									);
									return (
										<li key={n.id} className={clsx(styles.item, unread && styles.unread)}>
											{path ? (
												<Link to={path} className={styles.row} onClick={(event) => handleRowClick(event, n)}>
													{content}
													<span className={styles.chevron} aria-hidden="true">
														<IconChevronRight size={14} stroke={strokeFor(14)} />
													</span>
												</Link>
											) : (
												<div className={styles.static}>{content}</div>
											)}
										</li>
									);
								})}
							</ul>
						</section>
					);
				})}
			</div>
		);
	}

	return (
		<Page>
			<PageHeader
				eyebrow={pageEyebrow}
				title="Notifications"
				sub="View and manage your notifications and pending tasks"
				actions={(
					<>
						<Button icon={<IconRefresh size={16} stroke={strokeFor(16)} />} onClick={() => refetch()}>
							Refresh
						</Button>
						{hasUnread && (
							<Button variant="primary" icon={<IconCheck size={16} stroke={strokeFor(16)} />} onClick={handleMarkAllAsRead}>
								Mark all read
							</Button>
						)}
					</>
				)}
			/>

			<Card
				title="Notifications"
				sub={currentUnread > 0 ? `${currentUnread} unread` : undefined}
				tools={(
					<Tabs
						value={activeTab}
						items={tabItems}
						onChange={(v) => { setActiveTab(v); setPage(0); }}
						label="Notification categories"
						idPrefix={TABS_ID}
						size="sm"
					/>
				)}
				body="flush"
			>
				<div
					role="tabpanel"
					id={tabPanelId(TABS_ID, activeTab)}
					aria-labelledby={tabId(TABS_ID, activeTab)}
					className={styles.panel}
				>
					{body}
				</div>
			</Card>
		</Page>
	);
}

export default NotificationsPage;
