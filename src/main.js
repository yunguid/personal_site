// Main entry point
import './styles/main.css';
import { initFluidSimulation } from './js/webgl/FluidSimulation.js';
import { initApp } from './js/app.js';

// Unregister old service workers to prevent caching issues
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(registration => registration.unregister());
  });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  requestAnimationFrame(() => {
    requestAnimationFrame(initFluidSimulation);
  });
});
