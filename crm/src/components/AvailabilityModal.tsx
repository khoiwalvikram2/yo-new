import { Modal, Form, DatePicker, Select, Typography, App, Alert } from 'antd'
import { useQuery, useMutation } from '@apollo/client'
import dayjs from 'dayjs'
import { SET_AVAILABILITY, USERS, ME } from '@/lib/gql'
import { useAuth } from '@/state/auth'

/**
 * Going out of office.
 *
 * Only your own record. Covering for someone is a thing you arrange with them,
 * not a thing you can be volunteered for — and letting one user redirect
 * another's escalations would be a way to make work quietly disappear.
 *
 * The delegate is followed exactly one hop by the escalation ladder, so naming
 * someone who is themselves away does not chain onward. That is deliberate: a
 * chain ends somewhere nobody is looking, and a cycle ends nowhere at all.
 */
export function AvailabilityModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useAuth((s) => s.me)
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [save, { loading }] = useMutation(SET_AVAILABILITY, { refetchQueries: [ME] })

  // Colleagues who could cover. Only shown to someone who can already see the
  // user list; otherwise they can still set an away date without a delegate.
  const { data } = useQuery(USERS, { skip: !open })
  const colleagues = (data?.crmUsers ?? []).filter(
    (u: { id: string; status: string }) => u.id !== me?.id && u.status === 'ACTIVE'
  )

  return (
    <Modal
      title="Set availability"
      open={open}
      onCancel={() => {
        onClose()
        form.resetFields()
      }}
      onOk={() => form.submit()}
      confirmLoading={loading}
      okText="Save"
      destroyOnHidden
    >
      <Typography.Paragraph className="crm-muted">
        While you are away, escalations skip you and go to whoever you name. Leave the date empty
        to come back.
      </Typography.Paragraph>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="This does not stop tasks being assigned to you"
        description="It only affects who gets told when one of your book's tasks breaches its deadline."
      />
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{
          outOfOfficeUntil: me?.outOfOfficeUntil ? dayjs(me.outOfOfficeUntil) : null,
        }}
        onFinish={async (v) => {
          const res = await save({
            variables: {
              outOfOfficeUntil: v.outOfOfficeUntil ? v.outOfOfficeUntil.toISOString() : null,
              delegateTo: v.delegateTo ?? null,
            },
          })
          if (res.data?.crmSetMyAvailability?.ok) {
            message.success(v.outOfOfficeUntil ? 'Marked away' : 'Marked available')
            onClose()
            form.resetFields()
          } else {
            message.error(res.data?.crmSetMyAvailability?.error ?? 'Could not save')
          }
        }}
      >
        <Form.Item name="outOfOfficeUntil" label="Away until">
          <DatePicker showTime style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="delegateTo"
          label="Escalate to instead"
          help="They must hold the escalation permission in the same book to actually receive it."
        >
          <Select
            allowClear
            placeholder="Nobody in particular"
            options={colleagues.map((u: { id: string; name: string }) => ({
              value: u.id,
              label: u.name,
            }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
