/**
 * Reusable Pagination Component
 * Eliminates duplicate pagination logic across piano, books, and productions
 */
export class Pagination {
  constructor(options) {
    this.data = options.data;
    this.itemsPerPage = options.itemsPerPage || 3;
    this.currentPage = 1;
    this.container = options.container;
    this.renderItem = options.renderItem;
    this.prevBtn = options.prevBtn;
    this.nextBtn = options.nextBtn;
    this.pageInfo = options.pageInfo;
    this.onPageChange = options.onPageChange || null;

    this.init();
  }

  get totalPages() {
    return Math.ceil(this.data.length / this.itemsPerPage);
  }

  get pageData() {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.data.slice(start, start + this.itemsPerPage);
  }

  get startIndex() {
    return (this.currentPage - 1) * this.itemsPerPage;
  }

  init() {
    if (this.prevBtn) {
      this.prevBtn.addEventListener('click', () => this.prev());
    }
    if (this.nextBtn) {
      this.nextBtn.addEventListener('click', () => this.next());
    }
    this.render();
  }

  prev() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.render();
    }
  }

  next() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.render();
    }
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = '';
    this.pageData.forEach((item, index) => {
      const element = this.renderItem(item, this.startIndex + index);
      if (element) {
        this.container.appendChild(element);
      }
    });
    this.updateControls();

    if (this.onPageChange) {
      this.onPageChange(this.pageData, this.startIndex);
    }
  }

  updateControls() {
    if (this.pageInfo) {
      this.pageInfo.textContent = `${this.currentPage} / ${this.totalPages}`;
    }
    if (this.prevBtn) {
      this.prevBtn.disabled = this.currentPage === 1;
    }
    if (this.nextBtn) {
      this.nextBtn.disabled = this.currentPage === this.totalPages;
    }
  }

  setData(newData) {
    this.data = newData;
    this.currentPage = 1;
    this.render();
  }
}
