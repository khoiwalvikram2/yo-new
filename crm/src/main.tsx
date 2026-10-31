import { createRoot } from 'react-dom/client'
import { ApolloProvider } from '@apollo/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider, App as AntApp } from 'antd'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import './index.css'
import { apolloClient } from '@/lib/apollo'
import { AppRouter } from '@/app/router'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault('Asia/Kolkata')

const theme = {
  token: {
    colorPrimary: '#2563eb',
    borderRadius: 8,
    fontSize: 14,
    colorBgLayout: '#f4f6fa',
  },
}

const root = document.getElementById('root')
if (!root) {
  console.error('[CRM] #root not found')
} else {
  createRoot(root).render(
    <ApolloProvider client={apolloClient}>
      <ConfigProvider theme={theme}>
        <AntApp>
          <BrowserRouter>
            <AppRouter />
          </BrowserRouter>
        </AntApp>
      </ConfigProvider>
    </ApolloProvider>
  )
}
