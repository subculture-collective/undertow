import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/app.css';
import './styles/themes.css';
import { builtinFontsReady } from './fonts';
import { initTheme } from './theme';

initTheme();
// The stage draws text in these; start loading them before the first frame.
void builtinFontsReady();

createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
