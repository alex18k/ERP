export const BASE_LOCATIONS = [
  { code: 'A01', name: '材料仓' },
  { code: 'B01', name: '创信贴片' },
  { code: 'C01', name: '客户仓' },
  { code: 'D01', name: '中宇仓' },
  { code: 'WH-01', name: '原料仓库' },
  { code: 'WH-02', name: '成品仓库' },
]

export function locationLabel(code?: string | null) {
  if (!code) return ''
  const found = BASE_LOCATIONS.find((l) => l.code === code)
  return found ? `${found.code} - ${found.name}` : code
}

export function warehouseIdByLocation(warehouses: { id: number; code: string }[], location?: string | null) {
  if (!location) return null
  return warehouses.find((w) => w.code === location)?.id ?? null
}
