import { JuliaSetGenerator } from './julia-set.js';
import { renderBooks } from './books.js';

// Device detection
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// Prevent transitions on page load
document.body.classList.add('preload');
window.addEventListener('load', () => {
    setTimeout(() => {
        document.body.classList.remove('preload');
    }, 100);
});

// Initialize Julia Set animation
function initJuliaSet() {
    const asciiContainer = document.getElementById('asciiArt');
    const generator = new JuliaSetGenerator(isMobile ? 40 : 80, isMobile ? 20 : 40);

    function animate() {
        asciiContainer.textContent = generator.generateFrame(0, 0);
        requestAnimationFrame(animate);
    }

    animate();
}

// Dark mode toggle with optimized performance
function initDarkMode() {
    const darkModeToggle = document.getElementById('darkModeToggle');
    
    // Check for saved dark mode preference
    const savedDarkMode = localStorage.getItem('darkMode');
    if (savedDarkMode === 'true') {
        document.body.classList.add('dark-mode');
    }
    
    darkModeToggle.addEventListener('click', () => {
        // Add will-change to optimize the transition
        document.body.style.willChange = 'background-color, color';
        
        document.body.classList.toggle('dark-mode');
        
        // Save preference
        localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
        
        // Remove will-change after transition
        setTimeout(() => {
            document.body.style.willChange = 'auto';
        }, 300);
    });
}

// Navigation
function initNavigation() {
    const navIcons = document.querySelectorAll('.nav-icon[data-section]');
    
    navIcons.forEach(icon => {
        icon.addEventListener('click', () => {
            navIcons.forEach(i => i.classList.remove('active'));
            icon.classList.add('active');
            const sectionId = icon.getAttribute('data-section');
            document.getElementById(sectionId).scrollIntoView({ 
                behavior: 'smooth',
                block: isMobile ? 'start' : 'center'
            });
        });
    });

    // Handle bottom navigation clicks
    document.querySelectorAll('.bottom-nav a').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Update active state
            document.querySelectorAll('.bottom-nav a').forEach(a => a.classList.remove('active'));
            this.classList.add('active');
            
            // Scroll to section
            const targetId = this.getAttribute('href').substring(1);
            document.getElementById(targetId).scrollIntoView({
                behavior: 'smooth', 
                block: 'start'
            });
        });
    });
}

// Section visibility observer
function initSectionObserver() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                // Update navigation on scroll
                const sectionId = entry.target.id;
                const navIcons = document.querySelectorAll('.nav-icon[data-section]');
                navIcons.forEach(icon => {
                    if (icon.getAttribute('data-section') === sectionId) {
                        icon.classList.add('active');
                    } else {
                        icon.classList.remove('active');
                    }
                });
            }
        });
    }, { 
        threshold: isMobile ? 0.1 : 0.3,
        rootMargin: isMobile ? '0px 0px -50px 0px' : '0px'
    });

    document.querySelectorAll('.section').forEach(section => {
        observer.observe(section);
    });
}

// Force books section to be visible
function initBooksSection() {
    const booksSection = document.getElementById('books');
    if (booksSection) {
        booksSection.style.opacity = '1';
        booksSection.style.transform = 'translateY(0)';
        booksSection.style.visibility = 'visible';
        
        const booksList = document.getElementById('books-list');
        if (booksList) {
            booksList.style.opacity = '1';
            booksList.style.visibility = 'visible';
        }
    }
}

// Initialize everything
document.addEventListener('DOMContentLoaded', () => {
    initJuliaSet();
    initDarkMode();
    initNavigation();
    initSectionObserver();
    initBooksSection();
    renderBooks();
}); 