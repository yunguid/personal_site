export const books = [
    { title: "The Fountainhead", author: "Ayn Rand", isRead: true },
    { title: "Atlas Shrugged", author: "Ayn Rand", isRead: true },
    { title: "For the New Intellectual", author: "Ayn Rand", isRead: false },
    { title: "The Lessons of History", author: "Will and Ariel Durant", isRead: true },
    { title: "Intelligent Machines", author: "Ray Kurzweil", isRead: false },
    { title: "Man and His Symbols", author: "Carl Jung", isRead: true },
    { title: "Benjamin Franklin", author: "Carl Van Doren", isRead: false },
    { title: "The Difference between God and Larry Ellison", author: "Mike Wilson", isRead: false },
    { title: "Napoleon", author: "Vincent Cronin", isRead: true },
    { title: "Metals and How To Weld Them", author: "T. B. Jefferson & Gorham Woods", isRead: false },
    { title: "Astro Boy, Vol. 1", author: "Osamu Tezuka", isRead: false },
    { title: "Focus: The ASML way", author: "Marc Hijink", isRead: false },
    { title: "Crime and Punishment", author: "Fyodor Dostoevsky", isRead: true },
    { title: "Cherry Orchard", author: "Anton Chekhov", isRead: true },
    { title: "Uncle Vanya", author: "Anton Chekhov", isRead: true },
    { title: "Journey to the Center of the Earth", author: "Jules Verne", isRead: true },
];

export function renderBooks() {
    const booksList = document.getElementById('books-list');
    if (booksList) {
        // Clear any existing content
        booksList.innerHTML = '';
        
        books.forEach(book => {
            const bookElement = document.createElement('div');
            bookElement.className = 'book-card';
            bookElement.innerHTML = `
                <h3 class="font-medium mb-2">${book.title}</h3>
                <p class="text-sm">${book.author}</p>
                <div class="mt-4 text-xs uppercase tracking-wide ${book.isRead ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-gray-400'}">
                    ${book.isRead ? 'READ' : 'TO READ'}
                </div>
            `;
            booksList.appendChild(bookElement);
        });
    }
} 