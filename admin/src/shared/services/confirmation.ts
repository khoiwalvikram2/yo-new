import { confirm } from '@/ui/components/confirm'

/* The public signatures are intentionally unchanged; the implementation now reaches the kit's single
 * mounted ConfirmHost instead of opening an antd modal. */
export const confirmationService = {
  confirm: (title: string, content: string): Promise<boolean> => {
    return confirm({
      title,
      description: content,
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
    })
  },

  delete: (itemName: string = 'item'): Promise<boolean> => {
    return confirm({
      title: 'Delete Confirmation',
      description: `Are you sure you want to delete this ${itemName}? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
    })
  },

  save: (): Promise<boolean> => {
    return confirmationService.confirm(
      'Save Changes',
      'You have unsaved changes. Do you want to save them before leaving?'
    )
  },
}
