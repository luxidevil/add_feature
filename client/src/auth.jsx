import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const u = await api('/auth/me');
      setUser(u);
    } catch {
      setUser(null);
      localStorage.removeItem('token');
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      refreshUser().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [refreshUser]);

  const login = async (username, password) => {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    localStorage.setItem('token', data.token);
    setUser(data.user);
    return data;
  };

  const register = async (username, password, promoCode) => {
    const data = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, promoCode: promoCode || undefined }),
    });
    localStorage.setItem('token', data.token);
    setUser(data.user);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
