/* The ids a tab strip and its panels agree on. They live outside Tabs.tsx because a component file may
   export only components (react-refresh/only-export-components), and a page needs them to label its
   own panels:

     <Tabs value={tab} items={items} idPrefix="ov-dash" … />
     <div role="tabpanel" id={tabPanelId('ov-dash', tab)} aria-labelledby={tabId('ov-dash', tab)}> */

export function tabId(idPrefix: string, value: string): string {
  return `${idPrefix}-tab-${value}`
}

export function tabPanelId(idPrefix: string, value: string): string {
  return `${idPrefix}-panel-${value}`
}
