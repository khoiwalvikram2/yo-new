import { useState } from 'react'
import { useSetMatkaStatus, useUpdateMatka, useUpdateMatkaSettings } from '@/modules/matka'
import { matkaStatus, patchLimits, patchRisk, recordChanged, settingsPayload, statusMutationTarget, tierPatch, type DrawerStatus, type MatkaRecord, type SettingsValues } from './matkaManagementModel'

export function useSaveMatkaSettings() {
  const [setMatkaStatus] = useSetMatkaStatus()
  const [updateMatka] = useUpdateMatka()
  const [updateSettings] = useUpdateMatkaSettings()
  const [saving, setSaving] = useState(false)
  const save = async (matkas: MatkaRecord[], active: DrawerStatus, values: SettingsValues) => {
    if (!matkas.length) return
    const matkaIds = matkas.map(matka => matka.id)
    const tierValue = values.tier && values.tier !== 'default' ? values.tier : null
    setSaving(true)
    try {
      const targetStatus = statusMutationTarget(active)
      await Promise.all(matkaIds.map(async (id) => {
        const matka = matkas.find((item) => item.id === id)
        if (!matka || matkaStatus(matka.status) === targetStatus) return
        await setMatkaStatus({
          variables: { id, toStatus: targetStatus as never },
          context: { uiToast: 'notification' },
        })
      }))

      const applyMode = values.mode ?? 'overwrite'
      const payload = settingsPayload(values)
      const hasLimits = ['minBet', 'maxBet', 'exposureDaily', 'exposureWeekly', 'exposureCap']
        .some((key) => key in payload)
      const hasRisk = ['riskLevel', 'riskThreshold'].some((key) => key in payload)

      if (hasLimits) {
        for (const id of matkaIds) {
          const matka = matkas.find((item) => item.id === id)
          if (!matka) continue
          const currentLimits = (matka.limits ?? {}) as Record<string, unknown>
          if (tierValue) {
            const limits = tierPatch(payload, 'limits')
            if (Object.keys(limits).length) {
              await updateSettings({
                variables: { id, settings: { limits }, tierId: tierValue },
                context: { uiToast: 'notification' },
              })
            }
          } else {
            const nextLimits = patchLimits(currentLimits, payload, applyMode)
            if (recordChanged(currentLimits, nextLimits)) {
              await updateMatka({
                variables: { input: { id, limits: nextLimits } },
                context: { uiToast: 'notification' },
              })
            }
          }
        }
      }

      if (hasRisk) {
        for (const id of matkaIds) {
          const matka = matkas.find((item) => item.id === id)
          if (!matka) continue
          const currentSettings = (matka.settings ?? {}) as Record<string, unknown>
          if (tierValue) {
            const risk = tierPatch(payload, 'risk')
            if (Object.keys(risk).length) {
              await updateSettings({
                variables: { id, settings: risk, tierId: tierValue },
                context: { uiToast: 'notification' },
              })
            }
          } else {
            const nextSettings = patchRisk(currentSettings, payload, applyMode)
            if (recordChanged(currentSettings, nextSettings)) {
              await updateSettings({
                variables: { id, settings: nextSettings },
                context: { uiToast: 'notification' },
              })
            }
          }
        }
      }

    } finally {
      setSaving(false)
    }
  }
  return { save, saving }
}
