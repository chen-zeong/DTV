export interface Category1 {
  cate1Id: number
  cate1Name: string
}

export interface Category2 {
  cate2Id: number
  cate2Name: string
  cate1Id: number
  icon: string
  count: number
  shortName: string
}

export interface Category3 {
  id: string
  name: string
}

export interface CategorySelectedEvent {
  type: 'cate2' | 'cate3'
  cate2Id: number | string
  shortName: string
  cate2Name?: string
  cate3Id?: string | null
  cate3Name?: string | null
}