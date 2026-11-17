// admin/src/routes/config/AppConfigurationTheme.tsx
import type { CSSProperties } from 'react'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Notice } from '@/ui/components/Notice'
import { RadioGroup } from '@/ui/components/RadioGroup'
import { StoredImage } from '@/ui/components/StoredImage'
import { Tabs } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import type { FormApi } from '@/ui/form/useForm'
import { notify } from '@/shared/services/notification'
import { normalizeHex } from '../../../../shared/src/theme/color'
import {
  CUSTOM_PRESET_ID, MATCHBOOK_COLORS, MATCHBOOK_PRESET_ID, PLAYER_THEME_PRESETS, matchingPresetId, playerThemeTokens,
  type PlayerThemeColors, type PlayerThemeToken, type ThemeMode,
} from '../../../../shared/src/theme/playerTheme'
import { SPORTS_ICON_STYLE_OPTIONS, type SportsIconStyle } from '../../../../shared/src/theme/sportsIcons'
import { ConfigColorField } from './AppConfigurationSection'
import { brandingColorValues, brandingColors, type BrandingValues } from './appConfigurationModel'
import styles from './AppConfigurationPage.module.css'

type ColorPatch = Partial<Pick<BrandingValues, 'action' | 'link' | 'chrome' | 'light' | 'dark'>>

const SHARED_FIELDS = [['action', 'Action'], ['link', 'Link'], ['chrome', 'Chrome']] as const
const MODE_FIELDS = [['page', 'Page'], ['panel', 'Panel'], ['text', 'Text'], ['line', 'Line']] as const
const PREVIEW_ICONS = import.meta.glob('../../assets/sport-icons/*/*.png', { eager: true, import: 'default' }) as Record<string, string>
const PREVIEW_SPORTS = ['cricket', 'football', 'tennis'] as const

function complete(colors: PlayerThemeColors): boolean {
  return [colors.action, colors.link, colors.chrome, ...Object.values(colors.light), ...Object.values(colors.dark)]
    .every((color) => normalizeHex(color) !== null)
}

/** A small mock of the player panel painted with the tokens the player app derives (user-site colours, not admin
 * paint, so they are inline). Incomplete colours preview as Matchbook. */
function ThemePreview({ mode, colors, logo, appName }: { mode: ThemeMode; colors: PlayerThemeColors; logo: string | null; appName: string }) {
  const tokens = playerThemeTokens(complete(colors) ? colors : MATCHBOOK_COLORS, mode)
  const token = (name: PlayerThemeToken) => tokens[name]
  const onAction: CSSProperties = { background: token('--mb-red'), color: token('--mb-on-red') }
  const muted: CSSProperties = { color: token('--mb-muted') }
  return (
    <figure className={styles.preview}>
      <div className={styles.previewFrame} style={{ background: token('--mb-page'), color: token('--mb-text'), borderColor: token('--mb-line') }} role="img" aria-label={`User panel preview in the ${mode} theme`}>
        <div className={styles.previewBar} style={{ background: token('--mb-chrome'), color: '#FFFFFF', borderColor: token('--mb-chrome-line') }}>
          {/* A logo that will not load shows the brand's name, as no logo does (SYS-18). */}
          <StoredImage src={logo} alt="" className={styles.previewLogo} fallback={<b>{appName || 'Your brand'}</b>} />
          <span className={styles.previewButton} style={onAction}>Deposit</span>
        </div>
        <div className={styles.previewBody} style={{ background: token('--mb-panel') }}>
          <span className={styles.previewCaption} style={muted}>Main balance</span>
          <b className={styles.previewAmount}>₹12,500.00</b>
          <div className={styles.previewMarket} style={{ borderColor: token('--mb-line') }}>
            <span><b>India v Australia</b><span style={muted}>Today · 19:30</span></span>
            <span className={styles.previewOdds} style={onAction}>1.85</span>
          </div>
          <span className={styles.previewLink} style={{ color: token('--mb-link') }}>View all markets</span>
        </div>
      </div>
      <figcaption className={styles.previewNote}>Live preview · {mode === 'dark' ? 'Dark' : 'Light'} theme</figcaption>
    </figure>
  )
}

export function ThemeColorsCard({ form, mode, onModeChange, appName, legacy, storedUnreadable }: {
  form: FormApi<BrandingValues>
  mode: ThemeMode
  onModeChange: (mode: ThemeMode) => void
  appName: string
  legacy: PlayerThemeColors | null
  storedUnreadable: boolean
}) {
  const values = form.values
  const applyColors = (patch: ColorPatch, presetId?: string) => {
    form.setValues({ ...patch, presetId: presetId ?? matchingPresetId(brandingColors({ ...values, ...patch })) })
  }
  const choosePreset = (id: string) => {
    const preset = PLAYER_THEME_PRESETS.find((item) => item.id === id)
    if (preset) applyColors(brandingColorValues(preset.colors), preset.id)
  }
  const presetOptions = PLAYER_THEME_PRESETS.map((preset) => ({
    value: preset.id,
    label: preset.name,
    description: (
      <span className={styles.presetSwatches} aria-hidden="true">
        {[preset.colors.action, preset.colors.chrome, preset.colors.light.page, preset.colors.dark.panel].map((color, index) => <i key={`${preset.id}-${index}`} style={{ background: color }} />)}
      </span>
    ),
  }))
  const custom = values.presetId === CUSTOM_PRESET_ID
  const modeColors = values[mode]
  return (
    <Card
      title="Theme Colors"
      sub="The user panel's colors. Pick a preset, then adjust the key colors; the rest of the palette follows them."
      headingLevel={3}
      tools={<Button size="sm" onClick={() => { choosePreset(MATCHBOOK_PRESET_ID); notify.success('Theme colors reset to default values') }}>Reset to Default</Button>}
    >
      {storedUnreadable ? <Notice tone="warn" title="Saved theme could not be fully read">Players see the parts that could be read; anything else shows the default Matchbook look. Saving replaces the stored theme.</Notice> : null}
      {legacy && values.presetId === MATCHBOOK_PRESET_ID ? (
        <Notice tone="info" title="Colors from the old editor" action={<Button size="sm" onClick={() => applyColors(brandingColorValues(legacy))}>Use colors from the old editor</Button>}>
          These were saved before this editor and are not live. Loading them fills the fields below; players see them only after you save.
        </Notice>
      ) : null}
      <div className={styles.themeLayout}>
        <div className={styles.themeControls}>
          <RadioGroup label="Preset" options={presetOptions} value={custom ? null : values.presetId} onChange={choosePreset} help={custom ? 'Custom colors. Choose a preset to start again from it.' : undefined} />
          <section className={styles.colorGroup} aria-labelledby="config-key-colors">
            <h4 className={styles.colorGroupTitle} id="config-key-colors">Key colors <span>Both themes</span></h4>
            <div className={styles.colorGrid}>
              {SHARED_FIELDS.map(([name, label]) => (
                <ConfigColorField key={name} label={label} name={name} value={values[name]} onChange={(value) => applyColors({ [name]: value } as ColorPatch)} error={form.errors[name]} required />
              ))}
            </div>
          </section>
          <section className={styles.colorGroup} aria-labelledby="config-surface-colors">
            <div className={styles.colorGroupHead}>
              <h4 className={styles.colorGroupTitle} id="config-surface-colors">Surface & text</h4>
              <Tabs size="sm" label="User panel theme colors" idPrefix="config-theme" value={mode} items={[{ value: 'dark', label: 'Dark Theme' }, { value: 'light', label: 'Light Theme' }]} onChange={onModeChange} />
            </div>
            <div role="tabpanel" id={tabPanelId('config-theme', mode)} aria-labelledby={tabId('config-theme', mode)} className={styles.colorGrid}>
              {MODE_FIELDS.map(([name, label]) => (
                <ConfigColorField key={name} label={label} name={`${mode}.${name}`} value={modeColors[name]} onChange={(value) => applyColors({ [mode]: { ...modeColors, [name]: value } } as ColorPatch)} error={form.errors[`${mode}.${name}`]} required />
              ))}
            </div>
          </section>
        </div>
        <ThemePreview mode={mode} colors={brandingColors(values)} logo={values.logoUrl} appName={appName} />
      </div>
    </Card>
  )
}

export function SportsIconsCard({ value, onChange }: { value: SportsIconStyle; onChange: (style: SportsIconStyle) => void }) {
  const options = SPORTS_ICON_STYLE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    description: (
      <span className={styles.iconStyleOption}>
        <span>{option.description}</span>
        <span className={styles.iconPreview} aria-hidden="true">
          {PREVIEW_SPORTS.map((sport) => <img key={sport} src={PREVIEW_ICONS[`../../assets/sport-icons/${option.value}/${sport}.png`]} alt="" />)}
        </span>
      </span>
    ),
  }))
  return (
    <Card title="Sports Icons" sub="The sport icons players see on desktop and mobile." headingLevel={3}>
      <RadioGroup label="Sports icon style" hideLabel options={options} value={value} onChange={onChange} />
    </Card>
  )
}
