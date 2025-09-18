export interface UserIdentityDetails {
  id: string;
  role: string;
  isEnabled: boolean;
  totpSecret?: string;
  isTotpEnabled?: boolean;
}
