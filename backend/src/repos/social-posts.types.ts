export interface SocialPostInsert {
  tweetId: string;
  username: string;
  displayName?: string | null;
  profileImageUrl?: string | null;
  text: string;
  permalink?: string | null;
  postedAt: string;
  tokens: string[];
  weight: number;
}

export interface SocialPost extends SocialPostInsert {
  id: number;
  collectedAt: string;
}
