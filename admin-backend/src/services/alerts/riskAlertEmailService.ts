import nodemailer from 'nodemailer'
import { getAppConfigDb } from '@src/repos/app-config/appConfigRepo.js'

type RiskScope = {
  tenant: string
  whitelabelId: string
}

const RECENT_ALERT_SUPPRESS_MS = 5 * 60 * 1000 // 5 minutes
const recentAlertCache = new Map<string, number>()

export type RiskAlertEmailItem = {
  id: string
  title: string
  description: string
  entity: string
  severity: 'critical' | 'warning' | 'info'
  value: number
  threshold: number
  at: string
}

function shouldSendAlert(scope: RiskScope, alert: RiskAlertEmailItem) {
  const cacheKey = `${scope.whitelabelId}:${alert.id}:${alert.severity}`
  const now = Date.now()
  const lastSent = recentAlertCache.get(cacheKey)
  if (lastSent && now - lastSent < RECENT_ALERT_SUPPRESS_MS) {
    return false
  }
  recentAlertCache.set(cacheKey, now)
  return true
}

function buildHtmlBody(appName: string | undefined, alerts: RiskAlertEmailItem[]) {
  const title = appName ? `${appName} · Risk Alerts` : 'Risk Alerts'
  const rows = alerts.map(alert => `
    <tr>
      <td style="padding:8px 12px;font-weight:600;">${alert.title}</td>
      <td style="padding:8px 12px;text-transform:capitalize;">${alert.severity}</td>
      <td style="padding:8px 12px;">${alert.description}</td>
      <td style="padding:8px 12px;">${alert.entity}</td>
      <td style="padding:8px 12px;">${alert.value.toFixed(2)}</td>
      <td style="padding:8px 12px;">${alert.threshold.toFixed(2)}</td>
      <td style="padding:8px 12px;">${new Date(alert.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
    </tr>
  `).join('')

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
      <h2 style="margin-bottom:12px;">${title}</h2>
      <p style="margin-top:0;">The system detected ${alerts.length} risk alert${alerts.length > 1 ? 's' : ''} that require your attention.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead>
          <tr style="background:#f3f4f6;text-align:left;">
            <th style="padding:8px 12px;">Alert</th>
            <th style="padding:8px 12px;">Severity</th>
            <th style="padding:8px 12px;">Description</th>
            <th style="padding:8px 12px;">Entity</th>
            <th style="padding:8px 12px;">Value</th>
            <th style="padding:8px 12px;">Threshold</th>
            <th style="padding:8px 12px;">Detected</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:16px;color:#6b7280;font-size:12px;">You received this email because risk alerts are enabled for your admin workspace.</p>
    </div>
  `
}

function buildTextBody(alerts: RiskAlertEmailItem[]) {
  return alerts.map(alert => {
    return [
      `Alert: ${alert.title}`,
      `Severity: ${alert.severity}`,
      `Description: ${alert.description}`,
      `Entity: ${alert.entity}`,
      `Value vs Threshold: ${alert.value.toFixed(2)} / ${alert.threshold.toFixed(2)}`,
      `Detected: ${new Date(alert.at).toISOString()}`,
    ].join('\n')
  }).join('\n\n')
}

export async function dispatchRiskAlertEmails(params: { scope: RiskScope; alerts: RiskAlertEmailItem[] }) {
  const actionableAlerts = params.alerts.filter(alert => alert.severity === 'critical' || alert.severity === 'warning')
  if (!actionableAlerts.length) return

  const scope = params.scope
  const appConfig = await getAppConfigDb(scope.whitelabelId)
  const smtp = appConfig?.smtp
  if (!smtp || !smtp.host || !smtp.port || !smtp.username || !smtp.passwordEnc || !smtp.fromEmail) return

  const recipients = Array.isArray(smtp.alertRecipients) && smtp.alertRecipients.length > 0
    ? smtp.alertRecipients
    : (appConfig.supportEmail ? [appConfig.supportEmail] : [])
  if (!recipients.length) return

  const newAlerts = actionableAlerts.filter(alert => shouldSendAlert(scope, alert))
  if (!newAlerts.length) return

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: Number(smtp.port) === 465,
    auth: {
      user: smtp.username,
      pass: smtp.passwordEnc,
    },
  })

  const appName = scope.whitelabelId // Use tenant ID instead of appName
  await transporter.sendMail({
    from: smtp.fromEmail,
    to: recipients,
    subject: `[${appName}] ${newAlerts.length} Risk Alert${newAlerts.length > 1 ? 's' : ''}`,
    html: buildHtmlBody(appName, newAlerts),
    text: buildTextBody(newAlerts),
  })
}

