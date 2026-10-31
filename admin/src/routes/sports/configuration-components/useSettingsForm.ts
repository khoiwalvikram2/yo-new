import { useMemo, useRef } from 'react'
import { useForm } from '@/ui/form/useForm'
import { configSchema, type ConfigValues } from './settingsModel'
export function useSettingsForm(initialValues: ConfigValues = {}) {
  const form = useForm<ConfigValues>({ schema: configSchema, initialValues, onSubmit: () => {} })
  const ref = useRef(form); ref.current = form
  const methods = useMemo(() => ({
    hydrate: (values: ConfigValues) => ref.current.setValues(values),
    clear: (keys: string[]) => { for (const key of keys) ref.current.setValue(key, undefined) },
    reset: () => ref.current.reset(),
    values: () => ref.current.values,
  }), [])
  return { form, methods }
}
