import { useState } from 'react'
import { Button, Card, Form, Input, Alert, Typography, App } from 'antd'
import { useMutation, useApolloClient } from '@apollo/client'
import { CHANGE_OWN_PASSWORD } from '@/lib/gql'
import { useAuth } from '@/state/auth'

/**
 * `forced` is the state a user is in when an administrator handed them a
 * password. They cannot navigate away until they have chosen their own.
 */
export function PasswordPage({ forced = false }: { forced?: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const [change, { loading }] = useMutation(CHANGE_OWN_PASSWORD)
  const setMe = useAuth((s) => s.setMe)
  const signOut = useAuth((s) => s.signOut)
  const client = useApolloClient()
  const { message } = App.useApp()

  const onFinish = async (values: { currentPassword: string; newPassword: string; confirm: string }) => {
    setError(null)
    if (values.newPassword !== values.confirm) {
      setError('The two new passwords do not match')
      return
    }
    const { data } = await change({
      variables: { currentPassword: values.currentPassword, newPassword: values.newPassword },
    })
    if (!data?.crmChangeOwnPassword?.ok) {
      setError(data?.crmChangeOwnPassword?.error ?? 'Could not change the password')
      return
    }
    message.success('Password changed')
    // Changing a password bumps the token version, which ends this session too.
    // Signing out is the honest thing to do rather than leaving a token that
    // will fail on its next use.
    await client.clearStore().catch(() => {})
    setMe(null)
    signOut()
  }

  const body = (
    <>
      {forced && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Choose your own password"
          description="This account was created with a password someone else chose. Set your own before continuing."
        />
      )}
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <Form layout="vertical" onFinish={onFinish} requiredMark={false} disabled={loading}>
        <Form.Item name="currentPassword" label="Current password" rules={[{ required: true }]}>
          <Input.Password size="large" autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="New password"
          rules={[{ required: true }, { min: 10, message: 'At least 10 characters' }]}
        >
          <Input.Password size="large" autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="confirm" label="Confirm new password" rules={[{ required: true }]}>
          <Input.Password size="large" autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" size="large" loading={loading}>
          Change password
        </Button>
      </Form>
    </>
  )

  if (forced) {
    return (
      <div className="crm-login">
        <div className="crm-login-card">
          <Typography.Title level={4} style={{ marginTop: 0 }}>
            Set your password
          </Typography.Title>
          {body}
        </div>
      </div>
    )
  }

  return (
    <Card title="Change password" style={{ maxWidth: 480 }}>
      {body}
    </Card>
  )
}
