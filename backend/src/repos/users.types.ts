export interface UserDetails {
  totpSecret?: string;
  isTotpEnabled?: boolean;
  role: string;
  isEnabled: boolean;
}

export interface UserDetailsWithId extends UserDetails {
  id: string;
}

export interface UserAuthInfo {
  email?: string;
  role: string;
  isEnabled: boolean;
}

export interface UserListEntry {
  id: string;
  role: string;
  isEnabled: boolean;
  emailEnc?: string;
  createdAt: string;
  hasAiKey: boolean;
  hasBinanceKey: boolean;
  hasBybitKey: boolean;
}
