import { Pagination } from '../components/Pagination.js';
import { AudioPlayer } from '../components/AudioPlayer.js';
import productionsData from '../../data/productions.json';

let currentPlayers = [];

export function initProductionsSection() {
  const container = document.getElementById('production-list');
  const prevBtn = document.getElementById('prod-prev-btn');
  const nextBtn = document.getElementById('prod-next-btn');
  const pageInfo = document.getElementById('prod-page-info');

  if (!container) return;

  const { s3BaseUrl, tracks } = productionsData;

  new Pagination({
    data: tracks,
    itemsPerPage: 2,
    container,
    prevBtn,
    nextBtn,
    pageInfo,
    renderItem: (track, index) => {
      const playerContainer = document.createElement('div');
      const player = new AudioPlayer(playerContainer, {
        title: track.title,
        duration: track.duration,
        url: `${s3BaseUrl}/${track.fileName}`
      }, index);
      currentPlayers.push(player);
      return playerContainer;
    },
    onPageChange: () => {
      // Clean up old players when page changes
      currentPlayers.forEach(player => player.destroy());
      currentPlayers = [];
    }
  });
}
