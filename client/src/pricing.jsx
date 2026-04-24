import { createContext, useContext, useState, useEffect } from 'react';
import { api } from './api';
import { useAuth } from './auth';

const PricingContext = createContext({});

export function PricingProvider({ children }) {
  const { user } = useAuth();
  const [pricing, setPricing] = useState({});

  useEffect(() => {
    if (!user) {
      setPricing({});
      return;
    }
    api('/user/pricing')
      .then(data => {
        const map = {};
        data.forEach(s => { map[s.key] = s.value; });
        setPricing(map);
      })
      .catch(() => {});
  }, [user]);

  return (
    <PricingContext.Provider value={pricing}>
      {children}
    </PricingContext.Provider>
  );
}

export function usePricing() {
  return useContext(PricingContext);
}
