export interface Category1 {
  title: string;
  href: string;
  subcategories: Category2[];
}

export interface Category2 {
  title: string;
  href: string;
}

export interface CategorySelectedEvent {
  type: 'cate2';
  cate1Href: string;
  cate2Href: string;
  cate1Name: string;
  cate2Name: string;
}