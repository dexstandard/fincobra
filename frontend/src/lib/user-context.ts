import { createContext } from 'react';

export type User = {
  id: string;
  email?: string;
  openaiKey?: string;
  binanceKey?: string;
  binanceSecret?: string;
  role?: 'user' | 'admin';
} | null;

export const UserContext = createContext<{
  user: User;
  setUser: (u: User) => void;
}>({
  user: null,
  setUser: () => {},
});
