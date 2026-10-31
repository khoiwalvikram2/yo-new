import { and, asc, eq, inArray, notInArray } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { casinoCategories, casinoCategoryGames, casinoGames } from '@shared/db/schema.js'
import { loungeNumericId, normalizeLoungeSave, type CasinoLoungeImageInput } from '@src/domains/casino/loungeImages.js'

export async function getCasinoLoungeGameImagesDb(tenant: string, rawCategoryId: unknown, database: Pick<typeof db, 'select'> = db) {
  const categoryId = loungeNumericId(rawCategoryId)
  const [category] = await database.select({ id: casinoCategories.id, type: casinoCategories.type }).from(casinoCategories)
    .where(and(eq(casinoCategories.id, categoryId), eq(casinoCategories.tenantId, tenant))).limit(1)
  if (!category) throw new Error('Category not found')
  if (category.type !== 'lounge') throw new Error('Custom game images are only available for Casino lounge')
  const rows = await database.select({ gameId: casinoCategoryGames.gameId, imageData: casinoCategoryGames.imageData })
    .from(casinoCategoryGames).where(eq(casinoCategoryGames.categoryId, categoryId))
    .orderBy(asc(casinoCategoryGames.order), asc(casinoCategoryGames.id))
  return rows.map(row => ({ gameId: String(row.gameId), imageData: row.imageData }))
}

/** Membership changes and custom images commit together, including an empty selection. */
export async function saveCasinoLoungeGamesDb(tenant: string, rawCategoryId: unknown, rawGameIds: unknown[], rawImages: CasinoLoungeImageInput[] = [], database: Pick<typeof db, 'transaction'> = db) {
  const input = normalizeLoungeSave(rawCategoryId, rawGameIds, rawImages)
  return database.transaction(async tx => {
    const [category] = await tx.select({ id: casinoCategories.id, type: casinoCategories.type, mainCategory: casinoCategories.mainCategory }).from(casinoCategories)
      .where(and(eq(casinoCategories.id, input.categoryId), eq(casinoCategories.tenantId, tenant))).for('update').limit(1)
    if (!category) throw new Error('Category not found')
    if (category.type !== 'lounge') throw new Error('Custom game images are only available for Casino lounge')
    if (input.gameIds.length) {
      const games = await tx.select({ id: casinoGames.id }).from(casinoGames)
        .where(and(inArray(casinoGames.id, input.gameIds), eq(casinoGames.mainCategory, category.mainCategory)))
      if (games.length !== input.gameIds.length) throw new Error('Every selected game must exist in this category game type')
    }
    const current = await tx.select({ gameId: casinoCategoryGames.gameId, order: casinoCategoryGames.order }).from(casinoCategoryGames)
      .where(eq(casinoCategoryGames.categoryId, category.id))
    const currentIds = new Set(current.map(row => row.gameId))
    let nextOrder = current.reduce((order, row) => Math.max(order, row.order), -1) + 1
    const newGames = input.gameIds.filter(id => !currentIds.has(id))
    for (let offset = 0; offset < newGames.length; offset += 200) {
      await tx.insert(casinoCategoryGames).values(newGames.slice(offset, offset + 200).map(gameId => ({
        categoryId: category.id, gameId, order: nextOrder++,
      }))).onConflictDoNothing()
    }
    await tx.delete(casinoCategoryGames).where(input.gameIds.length
      ? and(eq(casinoCategoryGames.categoryId, category.id), notInArray(casinoCategoryGames.gameId, input.gameIds))
      : eq(casinoCategoryGames.categoryId, category.id))
    for (const image of input.images) {
      await tx.update(casinoCategoryGames).set({ imageData: image.imageData })
        .where(and(eq(casinoCategoryGames.categoryId, category.id), eq(casinoCategoryGames.gameId, image.gameId)))
    }
    return { success: true, message: `Saved ${input.gameIds.length} Casino lounge games` }
  })
}
