import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@apollo/client';
import clsx from 'clsx';
import { IconCalendar, IconCircleCheck, IconClock } from '@tabler/icons-react';
import { MY_NOTIFICATIONS_QUERY, MY_NOTIFICATION_QUERY, MARK_NOTIFICATION_READ_MUTATION } from '@/lib/graphql/notifications';
import { useNotificationStore } from '@/state/notificationStore';
import { useEffect } from 'react';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { RBACGuard } from '@/shared/core/RBACGuard';
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
	findTaskById,
	hasExtraTaskMetadata,
	isMetadataObject,
	taskCreatedAt,
	taskCreatedAtLabel,
	taskCreatedAtRelative,
	taskDetailErrorText,
	taskMetadataJson,
	taskMetadataLines,
	taskStatus,
	taskStatusTag,
	taskSteps,
	taskTypeHue,
	type TaskDetailItem,
	type TaskTagHue,
} from './taskDetailModel';
import styles from './TaskDetailPage.module.css';

const HUE_CLASS: Record<TaskTagHue, string> = {
	grn: styles.hueGrn,
	amb: styles.hueAmb,
	blu: styles.hueBlu,
	vio: styles.hueVio,
	ind: styles.hueInd,
	red: styles.hueRed,
	neutral: styles.hueNeutral,
};

const STEP_CLASS = {
	finish: styles.finish,
	process: styles.process,
};

const BACK_LINK = { to: '/notifications', label: 'Back' };

export function TaskDetailPage() {
	return (
		<RBACGuard required={[{ domain: 'notifications.list', actions: ['view'] }]}>
			<TaskDetailPageContent />
		</RBACGuard>
	);
}

function TaskDetailPageContent() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const pageEyebrow = usePageEyebrow();
	const { formatDateTime } = useFormatDate();
	const { formatAmount } = useCurrency();
	const { markAsRead: markAsReadStore } = useNotificationStore();

	const { data, loading, error, refetch } = useQuery(MY_NOTIFICATION_QUERY, {
    variables: { id, category: 'task' }, skip: !id, errorPolicy: 'all', fetchPolicy: 'cache-and-network',
  });

	const [markAsReadMutation] = useMutation(MARK_NOTIFICATION_READ_MUTATION, {
		refetchQueries: [MY_NOTIFICATION_QUERY, MY_NOTIFICATIONS_QUERY],
	});

	const task = findTaskById<TaskDetailItem>(data?.myNotification ? [data.myNotification] : [], id);

	// Mark as read when viewing
	useEffect(() => {
		if (task && !task.isRead && id) {
			markAsReadMutation({
				variables: { id },
			}).then(() => {
				markAsReadStore(id);
			}).catch(() => {
				// As before: a failed mark-read leaves the task unread and the page as it is.
			});
		}
	}, [task, id, markAsReadMutation, markAsReadStore]);

	if (loading) {
		return (
			<Page>
				<LoadingState label="Loading task" />
			</Page>
		);
	}

	if (!task) {
		return (
			<Page>
				<PageHeader back={BACK_LINK} eyebrow={pageEyebrow} title="Task Details" />
				<Card as="div" body="flush">
					{error ? (
						<div className={styles.state}>
							<Notice
								tone="error"
								live="polite"
								action={<Button size="sm" onClick={() => void refetch()}>Retry</Button>}
							>
								{taskDetailErrorText(error)}
							</Notice>
						</div>
					) : (
						<EmptyState title="Task not found" icon={<IconCircleCheck size={20} stroke={strokeFor(20)} />} />
					)}
				</Card>
			</Page>
		);
	}

	const createdAt = taskCreatedAt(task.createdAt);
	const relative = taskCreatedAtRelative(createdAt);
	const metadata = isMetadataObject(task.metadata) ? task.metadata : null;
	const actionUrl = task.actionUrl;

	// Determine task status from metadata or isRead
	const status = taskStatus(task);
	const statusTag = taskStatusTag(status);
	const steps = taskSteps(createdAt, status, formatDateTime);

	const items: DescriptionListItem[] = [
		{ key: 'description', term: 'Description', value: task.message || 'No description' },
		{
			key: 'created',
			term: 'Created',
			value: (
				<span className={styles.created}>
					<span className={styles.createdIcon} aria-hidden="true">
						<IconCalendar size={14} stroke={strokeFor(14)} />
					</span>
					<span>{taskCreatedAtLabel(createdAt, formatDateTime)}</span>
					{relative && <span className={styles.relative}>{relative}</span>}
				</span>
			),
		},
	];
	if (metadata) {
		items.push({
			key: 'details',
			term: 'Task Details',
			value: (
				<div className={styles.metaList}>
					{taskMetadataLines(metadata, formatAmount).map((line) => (
						<p key={line.key} className={styles.metaLine}>
							<span className={styles.metaTerm}>{line.label}</span>
							<span>{line.value}</span>
						</p>
					))}
					{hasExtraTaskMetadata(metadata) && (
						<details className={styles.disclosure}>
							<summary className={styles.summary}>Show all metadata</summary>
							<CodeBlock className={styles.code} label="Metadata" code={taskMetadataJson(metadata)} />
						</details>
					)}
				</div>
			),
		});
	}
	if (actionUrl) {
		items.push({ key: 'action', term: 'Action URL', value: <code className={styles.inlineCode}>{actionUrl}</code> });
	}

	return (
		<Page>
			<PageHeader
				back={BACK_LINK}
				eyebrow={pageEyebrow}
				title={task.title}
				meta={(
					<span className={styles.tags}>
						<span className={clsx(styles.tag, HUE_CLASS[taskTypeHue(task.type)])}>{task.type}</span>
						<span className={clsx(styles.tag, styles.hueAmb)}>Task</span>
						<StatusPill tone={statusTag.tone}>{statusTag.label}</StatusPill>
					</span>
				)}
			/>

			<div className={styles.content}>
				<Card title="Task Status">
					<div className={styles.stepsFrame}>
						<ol className={styles.steps}>
							{steps.map((step) => {
								const Icon = step.key === 'progress' && step.state === 'finish' ? IconCircleCheck : IconClock;
								return (
									<li
										key={step.key}
										className={clsx(styles.step, STEP_CLASS[step.state])}
										aria-current={step.state === 'process' ? 'step' : undefined}
									>
										<span className={styles.stepIcon} aria-hidden="true">
											<Icon size={16} stroke={strokeFor(16)} />
										</span>
										<div className={styles.stepBody}>
											<p className={styles.stepTitle}>{step.title}</p>
											<p className={styles.stepDescription}>{step.description}</p>
										</div>
									</li>
								);
							})}
						</ol>
					</div>
				</Card>

				<Card as="div" body="flush">
					<div className={styles.details}>
						<DescriptionList items={items} />
						{actionUrl && (
							<div className={styles.actions}>
								<Button variant="primary" size="lg" onClick={() => navigate(resolveNotificationActionUrl(actionUrl))}>
									Go to Task Action
								</Button>
							</div>
						)}
					</div>
				</Card>
			</div>
		</Page>
	);
}

export default TaskDetailPage;
