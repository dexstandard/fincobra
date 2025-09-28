import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { UserContext, type User } from './user-context';
import api from './axios';

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User>(() => {
    const raw = localStorage.getItem('user');
    return raw ? (JSON.parse(raw) as User) : null;
  });

  useEffect(() => {
    if (user) localStorage.setItem('user', JSON.stringify(user));
    else localStorage.removeItem('user');
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api
      .get('/login/session')
      .then((res) => setUser(res.data))
      .catch(() => setUser(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = api.interceptors.response.use(
      (res) => res,
      (err) => {
        if ([401, 403].includes(err.response?.status)) setUser(null);
        return Promise.reject(err);
      },
    );
    return () => {
      api.interceptors.response.eject(id);
    };
  }, [setUser]);

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  );
}
