export interface NewsInsert {
  title: string;
  link: string;
  pubDate?: string;
  tokens: string[];
  domain: string;
  simhash: string;
}

export interface NewsEntry {
  title: string;
  link: string;
  pubDate: string | null;
  domain: string | null;
}
