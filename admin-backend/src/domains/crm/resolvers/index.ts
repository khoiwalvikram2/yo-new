import { crmQueries } from './queries.js'
import { crmMutations } from './mutations.js'
import { crmNotesQueries, crmNotesMutations } from './notes.js'
import { crmTagsQueries, crmTagsMutations } from './tags.js'
import { crmRgQueries, crmRgMutations } from './responsibleGambling.js'
import { crmTaskQueries, crmTaskMutations } from './tasks.js'
import { crmSettingsQueries, crmSettingsMutations } from './deskCalendar.js'
import { crmSegmentQueries, crmSegmentMutations } from './segments.js'
import { crmReportQueries } from './reports.js'
import { crmDsarQueries, crmDsarMutations } from './dsar.js'
import { adminCrmUserQueries, adminCrmUserMutations } from './adminCrmUsers.js'

/**
 * The `whitelabelCrm*` fields are admin-panel operations, not CRM ones. They
 * live in this folder because they work on CRM data, but their names sit
 * outside the `crm` prefix so `guardAdminSurface` refuses CRM sessions on them
 * the same way it does for every other admin field.
 */
export const crmResolvers = {
  Query: {
    ...crmQueries,
    ...crmNotesQueries,
    ...crmTagsQueries,
    ...crmRgQueries,
    ...crmTaskQueries,
    ...crmSettingsQueries,
    ...crmSegmentQueries,
    ...crmReportQueries,
    ...crmDsarQueries,
    ...adminCrmUserQueries,
  },
  Mutation: {
    ...crmMutations,
    ...crmNotesMutations,
    ...crmTagsMutations,
    ...crmRgMutations,
    ...crmTaskMutations,
    ...crmSettingsMutations,
    ...crmSegmentMutations,
    ...crmDsarMutations,
    ...adminCrmUserMutations,
  },
}
