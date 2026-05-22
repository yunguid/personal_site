import { initWorkSection } from './sections/WorkSection.js';
import { initPianoSection } from './sections/PianoSection.js';
import { initProductionsSection } from './sections/ProductionsSection.js';
import { initBooksSection } from './sections/BooksSection.js';

export function initApp() {
  // Force scroll to top on load/refresh
  if (history.scrollRestoration) {
    history.scrollRestoration = 'manual';
  }
  window.scrollTo(0, 0);

  // Initialize all sections
  initWorkSection();
  initPianoSection();
  initProductionsSection();
  initBooksSection();
}
