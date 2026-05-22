import workExperience from '../../data/work-experience.json';

export function initWorkSection() {
  const container = document.getElementById('work-container');
  if (!container) return;

  workExperience.forEach(job => {
    const item = document.createElement('div');
    item.className = 'resume-item';

    const roleHTML = job.url
      ? `<h3 class="resume-role">${job.role} - <a href="${job.url}" target="_blank" class="link">${job.company}</a></h3>`
      : `<h3 class="resume-role">${job.role} - ${job.company}</h3>`;

    item.innerHTML = `
      ${roleHTML}
      <div class="resume-date">${job.dates}</div>
      <p class="resume-desc">${job.description}</p>
    `;

    container.appendChild(item);
  });
}
