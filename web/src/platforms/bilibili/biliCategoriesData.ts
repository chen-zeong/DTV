import biliCategories from '../../data/categories/bilibili_categories.json'

// 过滤掉包含“帮我玩”的一级分类（及其子分类）
export const biliCategoriesData = (biliCategories as any[]).filter((c1) => {
  const title: string = c1?.title ?? ''
  return !title.includes('帮我玩')
})