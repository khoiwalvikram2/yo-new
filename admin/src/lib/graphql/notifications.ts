import { gql } from '@apollo/client';

export const NOTIFICATION_STATS_QUERY = gql`
  query NotificationStats {
    notificationStats {
      totalUnread
      generalUnread
      taskUnread
    }
  }
`;

export const MY_NOTIFICATIONS_QUERY = gql`
  query MyNotifications($category: String, $limit: Int, $offset: Int, $unreadOnly: Boolean) {
    myNotifications(category: $category, limit: $limit, offset: $offset, unreadOnly: $unreadOnly) {
      id
      type
      category
      title
      message
      metadata
      isRead
      actionUrl
      createdAt
    }
  }
`;

export const MARK_NOTIFICATION_READ_MUTATION = gql`
  mutation MarkNotificationRead($id: ID!) {
    markNotificationRead(id: $id) {
      id
      isRead
    }
  }
`;

export const MARK_ALL_NOTIFICATIONS_READ_MUTATION = gql`
  mutation MarkAllNotificationsRead($category: String) {
    markAllNotificationsRead(category: $category)
  }
`;

export const NOTIFICATION_SUBSCRIPTION = gql`
  subscription NotificationReceived {
    notificationReceived {
      id
      type
      category
      title
      message
      metadata
      isRead
      actionUrl
      createdAt
    }
  }
`;

export const MY_NOTIFICATION_QUERY = gql`
  query MyNotification($id: ID!, $category: String) {
    myNotification(id: $id, category: $category) {
      id type category title message metadata isRead actionUrl createdAt
    }
  }
`
