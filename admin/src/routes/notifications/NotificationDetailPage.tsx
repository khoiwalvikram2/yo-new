import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@apollo/client';
import clsx from 'clsx';
import { IconBell, IconCalendar } from '@tabler/icons-react';
import { MY_NOTIFICATIONS_QUERY, MY_NOTIFICATION_QUERY, MARK_NOTIFICATION_READ_MUTATION } from '@/lib/graphql/notifications';
import { useNotificationStore } from '@/state/notificationStore';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { resolveNotificationActionUrl } from '@/shared/core/notificationUtils';
import { usePageEyebrow } from '@/shell/PageEyebrowContext';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { CodeBlock } from '@/ui/components/CodeBlock';
import { DescriptionList, type DescriptionListItem } from '@/ui/components/DescriptionList';
import { EmptyState } from '@/ui/components/EmptyState';
import { LoadingState } from '@/ui/components/LoadingState';
import { Notice } from '@/ui/components/Notice';
import { Page } from '@/ui/components/Page';
import { PageHeader } from '@/ui/components/PageHeader';
import { StatusPill } from '@/ui/components/StatusPill';
import { strokeFor } from '@/ui/components/icons';
import {
	createdAtLabel,
	createdAtRelative,
	findNotificationById,
	hasExtraMetadata,
	isMetadataObject,
	metadataJson,
	notificationCategoryTag,
	notificationCreatedAt,
	notificationDetailErrorText,
	notificationMetadataLines,
	notificationTypeHue,
	type NotificationDetailItem,
	type TagHue,
} from './notificationDetailModel';
import styles from './NotificationDetailPage.module.css';

const HUE_CLASS: Record<TagHue, string> = {
	grn: styles.hueGrn,
	amb: styles.hueAmb,
	blu: styles.hueBlu,
	vio: styles.hueVio,
	ind: styles.hueInd,
	red: styles.hueRed,
	neutral: styles.hueNeutral,
};

const BACK_LINK = { to: '/notifications', label: 'Back' };

/* No RBACGuard: one notification of the caller's own inbox, scoped to its recipient on the server, like the list
   (see NotificationsPage). notifications.list:view was required here too, and no Whitelabel Admin or agent holds it. */
export function NotificationDetailPage() {
	return <NotificationDetailPageContent />;
}

function NotificationDetailPageContent() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const pageEyebrow = usePageEyebrow();
	const { formatDateTime } = useFormatDate();
	const { formatAmount } = useCurrency();
	const { markAsRead: markAsReadStore } = useNotificationStore();

	const { data, loading, error, refetch } = useQuery(MY_NOTIFICATION_QUERY, {
    variables: { id }, skip: !id, errorPolicy: 'all', fetchPolicy: 'cache-and-network',
  });

	const [markAsReadMutation] = useMutation(MARK_NOTIFICATION_READ_MUTATION, {
		refetchQueries: [MY_NOTIFICATION_QUERY, MY_NOTIFICATIONS_QUERY],
	});

	const notification = findNotificationById<NotificationDetailItem>(data?.myNotification ? [data.myNotification] : [], id);

	// Mark as read when viewing
	useEffect(() => {
		if (notification && !notification.isRead && id) {
			markAsReadMutation({
				variables: { id },
			}).then(() => {
				markAsReadStore(id);
			}).catch(() => {
				// As before: a failed mark-read leaves the notification unread and the page as it is.
			});
		}
	}, [notification, id, markAsReadMutation, markAsReadStore]);

	if (loading) {
		return (
			<Page>
				<LoadingState label="Loading notification" />
			</Page>
		);
	}

	if (!notification) {
		return (
			<Page>
				<PageHeader back={BACK_LINK} eyebrow={pageEyebrow} title="Notification Details" />
				<Card as="div" body="flush">
					{error ? (
						<div className={styles.state}>
							<Notice
								tone="error"
								live="polite"
								action={<Button size="sm" onClick={() => void refetch()}>Retry</Button>}
							>
								{notificationDetailErrorText(error)}
							</Notice>
						</div>
					) : (
						<EmptyState title="Notification not found" icon={<IconBell size={20} stroke={strokeFor(20)} />} />
					)}
				</Card>
			</Page>
		);
	}

	const createdAt = notificationCreatedAt(notification.createdAt);
	const relative = createdAtRelative(createdAt);
	const metadata = isMetadataObject(notification.metadata) ? notification.metadata : null;
	const categoryTag = notificationCategoryTag(notification.category);
	const actionUrl = notification.actionUrl;

	const items: DescriptionListItem[] = [
		{ key: 'message', term: 'Message', value: notification.message || 'No message' },
		{
			key: 'created',
			term: 'Created',
			value: (
				<span className={styles.created}>
					<span className={styles.createdIcon} aria-hidden="true">
						<IconCalendar size={14} stroke={strokeFor(14)} />
					</span>
					<span>{createdAtLabel(createdAt, formatDateTime)}</span>
					{relative && <span className={styles.relative}>{relative}</span>}
				</span>
			),
		},
	];
	if (metadata) {
		items.push({
			key: 'details',
			term: 'Details',
			value: (
				<div className={styles.metaList}>
					{notificationMetadataLines(metadata, formatAmount).map((line) => (
						<p key={line.key} className={styles.metaLine}>
							<span className={styles.metaTerm}>{line.label}</span>
							<span>{line.value}</span>
						</p>
					))}
					{hasExtraMetadata(metadata) && (
						<details className={styles.disclosure}>
							<summary className={styles.summary}>Show all metadata</summary>
							<CodeBlock className={styles.code} label="Metadata" code={metadataJson(metadata)} />
						</details>
					)}
				</div>
			),
		});
	}

	return (
		<Page>
			<PageHeader
				back={BACK_LINK}
				eyebrow={pageEyebrow}
				title={notification.title}
				meta={(
					<span className={styles.tags}>
						<span className={clsx(styles.tag, HUE_CLASS[notificationTypeHue(notification.type)])}>
							{notification.type}
						</span>
						<span className={clsx(styles.tag, HUE_CLASS[categoryTag.hue])}>{categoryTag.label}</span>
						{!notification.isRead && <StatusPill tone="info">Unread</StatusPill>}
					</span>
				)}
			/>

			<Card as="div" body="flush">
				<div className={styles.details}>
					<DescriptionList items={items} />
					{actionUrl && (
						<div className={styles.actions}>
							<Button variant="primary" size="lg" onClick={() => navigate(resolveNotificationActionUrl(actionUrl))}>
								Go to Action
							</Button>
						</div>
					)}
				</div>
			</Card>
		</Page>
	);
}

export default NotificationDetailPage;
