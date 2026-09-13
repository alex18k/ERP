export const BASE_LOCATIONS = [
  { code: 'A01', name: '材料仓' },
  { code: 'B01', name: '创信贴片' },
  { code: 'C01', name: '客户仓' },
  { code: 'D01', name: '中宇仓' },
]

export function locationLabel(code?: string | null) {
  if (!code) return ''
  const found = BASE_LOCATIONS.find((l) => l.code === code)
  return found ? `${found.code} - ${found.name}` : code
}
