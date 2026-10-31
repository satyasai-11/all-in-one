import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
import './warning.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(error => console.error('Offline app setup failed:', error));
  });
}
