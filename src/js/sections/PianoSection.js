import { Pagination } from '../components/Pagination.js';
import pianoTracks from '../../data/piano-tracks.json';

export function initPianoSection() {
  const container = document.getElementById('piano-grid');
  const prevBtn = document.getElementById('piano-prev-btn');
  const nextBtn = document.getElementById('piano-next-btn');
  const pageInfo = document.getElementById('piano-page-info');

  if (!container) return;

  new Pagination({
    data: pianoTracks,
    itemsPerPage: 2,
    container,
    prevBtn,
    nextBtn,
    pageInfo,
    renderItem: (track) => {
      const item = document.createElement('a');
      item.href = track.url;
      item.target = '_blank';
      item.className = 'music-item';
      item.innerHTML = `
        <div class="font-medium" style="font-weight: 500;">${track.title}</div>
        ${track.subtitle ? `<div style="font-size: 0.875rem; opacity: 0.6; margin-top: 0.25rem;">${track.subtitle}</div>` : ''}
      `;
      return item;
    }
  });
}
