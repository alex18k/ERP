export const MATERIAL_CATEGORIES = [
  { label: '采购', value: 'purchase' },
  { label: '制造', value: 'manufacture' },
]

const labelMap: Record<string, string> = {
  purchase: '采购',
  manufacture: '制造',
}

export function materialCategoryLabel(value?: string | null) {
  if (!value) return ''
  return labelMap[value] || value
}
