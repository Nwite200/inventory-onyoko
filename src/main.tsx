import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { initConfig } from './config';
import { startSync } from './sync';
import './styles.css';

registerSW({ immediate: true });

void initConfig().then(() => {
  startSync();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
