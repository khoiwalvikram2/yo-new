import { useNavigate } from 'react-router-dom'
import { IconFileText, IconChartBar, IconUsers, IconCoin } from '@tabler/icons-react'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import styles from '../AgentHome.module.css'

interface ReportingQuickAccessProps {
  agentId: string
}

export default function ReportingQuickAccess({ agentId }: ReportingQuickAccessProps) {
  const navigate = useNavigate()

  const handleDownloadReport = (reportType: string) => {
    // TODO: Implement actual report download logic
    navigate(`/reporting/agents/performance?report=${reportType}&agentId=${agentId}`)
  }

  const reportCards = [
    {
      icon: <IconFileText size={20} />,
      title: 'Detailed Overview Report',
      subtitle: 'Complete performance analysis',
      color: 'blue',
      onClick: () => navigate(`/reporting/agents/performance?agentId=${agentId}`),
    },
    {
      icon: <IconUsers size={20} />,
      title: 'Player Activity Report',
      subtitle: 'Player registrations and bets',
      color: 'green',
      onClick: () => navigate('/players'),
    },
    {
      icon: <IconChartBar size={20} />,
      title: 'Sub-Agent Performance',
      subtitle: 'Hierarchy performance metrics',
      color: 'yellow',
      onClick: () => navigate('/reporting/agents/performance'),
    },
    {
      icon: <IconFileText size={20} />,
      title: 'Daily GGR Report',
      subtitle: "Open today's GGR report",
      color: 'purple',
      onClick: () => handleDownloadReport('Daily GGR'),
    },
    {
      icon: <IconCoin size={20} />,
      title: 'Commission Statement',
      subtitle: 'Open commission history',
      color: 'cyan',
      onClick: () => handleDownloadReport('Commission Statement'),
    },
    {
      icon: <IconFileText size={20} />,
      title: 'Settlement Report',
      subtitle: 'Open P&L settlement',
      color: 'pink',
      onClick: () => handleDownloadReport('Settlement Report'),
    },
  ]

  return <div className={styles.three}>
    {reportCards.map(card => <Card key={card.title}><div className={styles.report}>
      <span className={styles.reportIcon} aria-hidden="true">{card.icon}</span>
      <strong>{card.title}</strong><p className={styles.muted}>{card.subtitle}</p>
      <Button onClick={card.onClick}>Open report</Button>
    </div></Card>)}
  </div>
}

