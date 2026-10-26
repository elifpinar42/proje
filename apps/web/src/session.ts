import { createContext, useContext } from 'react';
import type { Child, User } from './api';

export interface Session {
  user: User | null;
  setUser(u: User | null): void;
  logout(): Promise<void>;
  children: Child[];
  reloadChildren(): Promise<void>;
  childId: string | null;
  setChildId(id: string): void;
}

export const SessionContext = createContext<Session>(null as unknown as Session);
export const useSession = () => useContext(SessionContext);
