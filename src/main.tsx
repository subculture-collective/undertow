import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/app.css';
import './styles/glitch.css';
import { builtinFontsReady } from './fonts';

// The stage draws text in these; start loading them before the first frame.
void builtinFontsReady();

createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
