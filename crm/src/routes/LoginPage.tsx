import { useState } from 'react'
import { Button, Form, Input, Alert, Typography } from 'antd'
import { useMutation } from '@apollo/client'
import { LOGIN } from '@/lib/gql'
import { useAuth } from '@/state/auth'

export function LoginPage() {
  const signIn = useAuth((s) => s.signIn)
  const [error, setError] = useState<string | null>(null)
  const [login, { loading }] = useMutation(LOGIN)

  const onFinish = async (values: { username: string; password: string }) => {
    setError(null)
    try {
      const { data } = await login({ variables: values })
      const res = data?.crmLogin
      if (res?.ok && res.token && res.me) {
        signIn(res.token, res.me)
        return
      }
      // The server sends one message for every failure. Repeating it verbatim
      // keeps the screen from inventing a more specific one.
      setError(res?.error ?? 'Sign-in failed')
    } catch {
      setError('Could not reach the server. Try again.')
    }
  }

  return (
    <div className="crm-login">
      <div className="crm-login-card">
        <div style={{ marginBottom: 22 }}>
          <div className="crm-brand" style={{ fontSize: 24 }}>
            CRM
          </div>
          <Typography.Text className="crm-muted">Sign in to your desk</Typography.Text>
        </div>

        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

        <Form layout="vertical" onFinish={onFinish} requiredMark={false} disabled={loading}>
          <Form.Item
            name="username"
            label="Username"
            rules={[{ required: true, message: 'Enter your username' }]}
          >
            <Input size="large" autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: 'Enter your password' }]}
          >
            <Input.Password size="large" autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            Sign in
          </Button>
        </Form>

        <Typography.Paragraph className="crm-muted" style={{ fontSize: 12, marginTop: 18, marginBottom: 0 }}>
          Your whitelabel issues these credentials. Sign-in attempts are recorded.
        </Typography.Paragraph>
      </div>
    </div>
  )
}
