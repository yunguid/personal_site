// Montana Gallery entry point

// Image data
const bucketUrl = 'https://lukeyoung-montana-gallery.s3.amazonaws.com/';
const thumbnailBaseUrl = '/assets/img/montana_thumbnails';
const imageNames = [
  'FullSizeRender (1).jpg',
  'FullSizeRender (2).jpg',
  'FullSizeRender.jpg',
  'IMG_0812.jpg',
  'IMG_1848.jpg',
  'IMG_1905.jpg',
  'IMG_2033.jpg',
  'IMG_2051.jpg',
  'IMG_4325.jpg',
  'IMG_5392.jpg',
  'IMG_5399.jpg',
  'IMG_5401.jpg',
  'IMG_5404.jpg',
  'IMG_5417.jpg',
  'IMG_5424.jpg',
  'IMG_5425.jpg',
  'IMG_5426.jpg',
  'IMG_5429.jpg'
];

// Lightbox state
let currentIndex = 0;
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');

function thumbnailSources(imageName) {
  const webpName = encodeURIComponent(imageName.replace(/\.jpe?g$/i, '.webp'));
  return {
    src: `${thumbnailBaseUrl}/400/${webpName}`,
    srcset: [320, 400, 640]
      .map(width => `${thumbnailBaseUrl}/${width}/${webpName} ${width}w`)
      .join(', '),
  };
}

function loadThumbnail(img) {
  img.src = img.dataset.src;
  img.srcset = img.dataset.srcset;
  img.removeAttribute('data-src');
  img.removeAttribute('data-srcset');
}

// Initialize gallery
function initGallery() {
  const gallery = document.getElementById('gallery');
  if (!gallery) return;

  const deferredImages = [];
  const eagerImageCount = window.innerWidth <= 768 ? 4 : 8;

  imageNames.forEach((imageName, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'gallery-item';
    item.dataset.index = index;
    item.setAttribute('aria-label', `Open Montana wilderness photo ${index + 1}`);

    const img = document.createElement('img');
    const sources = thumbnailSources(imageName);
    img.alt = `Montana wilderness photo ${index + 1}`;
    img.width = 400;
    img.height = 300;
    img.decoding = index === 0 ? 'sync' : 'async';
    img.sizes = '(max-width: 768px) calc(50vw - 1.25rem), min(25vw, 340px)';

    if (index < eagerImageCount) {
      img.src = sources.src;
      img.srcset = sources.srcset;
      img.loading = 'eager';
      if (index === 0) img.fetchPriority = 'high';
    } else {
      img.dataset.src = sources.src;
      img.dataset.srcset = sources.srcset;
      deferredImages.push(img);
    }

    item.appendChild(img);
    gallery.appendChild(item);
  });

  gallery.addEventListener('click', (event) => {
    const item = event.target.closest('.gallery-item');
    if (item) openLightbox(Number(item.dataset.index));
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        loadThumbnail(img);
        observer.unobserve(img);
      });
    }, { rootMargin: '120px 0px' });
    deferredImages.forEach(img => observer.observe(img));
  } else {
    deferredImages.forEach((img) => {
      loadThumbnail(img);
    });
  }
}

// Lightbox functions
function openLightbox(index) {
  currentIndex = index;
  updateLightboxImage();
  lightbox.showModal();
}

function closeLightbox() {
  lightbox.close();
}

function updateLightboxImage() {
  const imageName = imageNames[currentIndex];
  lightboxImg.src = bucketUrl + encodeURIComponent(imageName);
  lightboxImg.alt = `Montana wilderness photo ${currentIndex + 1}`;
  lightboxImg.fetchPriority = 'high';

  for (const offset of [-1, 1]) {
    const neighborIndex = (currentIndex + offset + imageNames.length) % imageNames.length;
    const preload = new Image();
    preload.src = bucketUrl + encodeURIComponent(imageNames[neighborIndex]);
  }
}

function nextImage() {
  currentIndex = (currentIndex + 1) % imageNames.length;
  updateLightboxImage();
}

function prevImage() {
  currentIndex = (currentIndex - 1 + imageNames.length) % imageNames.length;
  updateLightboxImage();
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Init gallery
  initGallery();

  // Lightbox controls
  document.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
  document.querySelector('.lightbox-prev').addEventListener('click', prevImage);
  document.querySelector('.lightbox-next').addEventListener('click', nextImage);

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (!lightbox.open) return;

    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight') nextImage();
    if (e.key === 'ArrowLeft') prevImage();
  });

  // Click outside image to close
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
});
