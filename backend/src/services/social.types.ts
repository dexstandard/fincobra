export interface SocialSource {
  username: string;
  displayName?: string;
  tokens: string[];
  weight: number;
}
