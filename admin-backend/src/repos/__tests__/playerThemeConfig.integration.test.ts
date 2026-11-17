// admin-backend/src/repos/__tests__/playerThemeConfig.integration.test.ts
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { appConfigs, whitelabels } from '@shared/db/schema.js'
import { PLAYER_THEME_PRESETS } from '@shared/theme/playerTheme.js'
import { upsertAppConfigDb } from '../app-config/appConfigRepo.js'
import { parsePlayerThemeInput } from '../../domains/app-config/playerThemeInput.js'
import { getAppSettings } from '../../../../user-backend/src/repos/userAppRepo.js'

// An admin theme save on an isolated UUID tenant, read back from the table and from the player app settings.
const tenant = `player-theme-${randomUUID().slice(0, 12)}`
const blue = PLAYER_THEME_PRESETS.find((preset) => preset.id === 'royal-blue')!.colors

before(async () => {
  await db.insert(whitelabels).values({ id: tenant, name: 'Player Theme Test', domain: `${tenant}.invalid`,
    creditLimit: '0', creditAvailable: '0', creditUsed: '0' })
  await db.insert(appConfigs).values({ whitelabelId: tenant, theme: { primary: '#2952E3' } as never })
})

after(async () => {
  await db.delete(appConfigs).where(eq(appConfigs.whitelabelId, tenant))
  await db.delete(whitelabels).where(eq(whitelabels.id, tenant))
})

const stored = async () => (await db.query.appConfigs.findFirst({ where: eq(appConfigs.whitelabelId, tenant) }))!
const setting = async (key: string) => {
  const entries = (await getAppSettings(tenant)) as Array<{ key: string; value: string | null }>
  return entries.find((entry) => entry.key === key)?.value
}

test('a saved theme replaces the stored one, leaves the legacy theme alone, and reaches the player app', async () => {
  await upsertAppConfigDb(tenant, { playerTheme: parsePlayerThemeInput({ presetId: 'royal-blue', sportsIconStyle: 'flat', colors: blue }) })
  assert.deepEqual((await stored()).playerTheme, { presetId: 'royal-blue', sportsIconStyle: 'flat', colors: blue })
  await upsertAppConfigDb(tenant, { playerTheme: parsePlayerThemeInput({ sportsIconStyle: '3d' }) })
  assert.deepEqual((await stored()).playerTheme, { sportsIconStyle: '3d' }, 'replaced, not merged')
  assert.deepEqual((await stored()).theme, { primary: '#2952E3' }, 'legacy theme untouched')
  assert.deepEqual(JSON.parse((await setting('playerTheme')) ?? 'null'), { sportsIconStyle: '3d' })
})

test('a save without playerTheme keeps it; null clears it and the player app gets no entry', async () => {
  await upsertAppConfigDb(tenant, { supportEmail: 'help@example.invalid' })
  assert.deepEqual((await stored()).playerTheme, { sportsIconStyle: '3d' })
  await upsertAppConfigDb(tenant, { playerTheme: parsePlayerThemeInput(null) })
  assert.equal((await stored()).playerTheme, null)
  assert.equal(await setting('playerTheme'), undefined)
})
