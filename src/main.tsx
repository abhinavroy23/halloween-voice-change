import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Dev-only handle for automated audio tests (stripped from production builds).
if (import.meta.env.DEV) {
  void import('./audio/AudioEngine').then(({ engine }) => {
    (window as unknown as { __engine: unknown }).__engine = engine;
  });
}
