import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth';
import { PricingProvider } from './pricing';
import { ToastProvider } from './components/Toast';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <AuthProvider>
        <PricingProvider>
          <App />
        </PricingProvider>
      </AuthProvider>
    </ToastProvider>
  </React.StrictMode>
);
