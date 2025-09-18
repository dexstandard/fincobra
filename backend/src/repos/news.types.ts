export interface NewsInsert {
  title: string;
  link: string;
  pubDate?: string;
  tokens: string[];
}

export interface NewsEntry {
  title: string;
  link: string;
  pubDate: string | null;
}
