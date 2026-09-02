/*
 * Sidepanel Application Entry Point.
 *
 * This mounts our main React application into the Chrome Extension side panel.
 * When the student clicks the ONEE action icon in their Chrome toolbar,
 * the browser loads sidepanel.html, which in turn evaluates this file.
 *
 * We import global.css here so design system variables (color tokens, font stacks,
 * layout constants, and dark mode defaults) are applied before any child components render.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import '../styles/global.css';

/*
 * Find the root mount node defined in sidepanel.html.
 * We wrap the application in React.StrictMode during development to catch
 * accidental state mutations and lifecycle issues early.
 */
const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
