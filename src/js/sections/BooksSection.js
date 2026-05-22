import { Pagination } from '../components/Pagination.js';
import booksData from '../../data/books.json';

// Shuffle function
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function initBooksSection() {
  const container = document.getElementById('books-grid');
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const pageInfo = document.getElementById('page-info');

  if (!container) return;

  // Shuffle books on load
  const books = shuffle(booksData);

  new Pagination({
    data: books,
    itemsPerPage: 3,
    container,
    prevBtn,
    nextBtn,
    pageInfo,
    renderItem: (book) => {
      const card = document.createElement('div');
      card.className = 'book-card';
      card.innerHTML = `
        <div class="book-title">${book.title}</div>
        <div class="book-author">${book.author}</div>
        <div class="book-status ${book.isRead ? 'status-read' : 'status-toread'}">
          ${book.isRead ? 'Read' : 'To Read'}
        </div>
      `;
      return card;
    }
  });
}
