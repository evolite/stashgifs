// StashGifs Plugin – Always-on Navigation Button
const PLUGIN_NAME = "stashgifs";
const BUTTON_ID = "StashGifsButton";
const PLUGIN_PATH = `/plugin/${PLUGIN_NAME}/assets/app/`;

const HEART_ICON_SVG = `<svg class="svg-inline--fa fa-icon nav-menu-icon d-block d-xl-inline mb-2 mb-xl-0" aria-hidden="true" focusable="false" data-prefix="fas" data-icon="heart" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M47.6 300.4L228.3 469.1c7.5 7 17.4 10.9 27.7 10.9s20.2-3.9 27.7-10.9L464.4 300.4c30.4-28.3 47.6-68 47.6-109.5v-5.8c0-69.9-50.5-129.5-119.4-141C347 36.5 300.6 51.4 268 84L256 96 244 84c-32.6-32.6-79-47.5-124.6-39.9C50.5 55.6 0 115.2 0 185.1v5.8c0 41.5 17.2 81.2 47.6 109.5z"></path></svg>`;

function addButton() {
  if (document.getElementById(BUTTON_ID)) return;

  const navLinks = document.querySelectorAll('.nav-link');
  if (navLinks.length === 0) return;

  const container = navLinks[0].parentElement;
  if (!container) return;

  const button = document.createElement('div');
  button.id = BUTTON_ID;
  button.setAttribute('data-rb-event-key', PLUGIN_PATH);
  button.className = 'col-4 col-sm-3 col-md-2 col-lg-auto nav-link';
  button.innerHTML = `
    <a href="${PLUGIN_PATH}" class="minimal p-4 p-xl-2 d-flex d-xl-inline-block flex-column justify-content-between align-items-center btn btn-primary" target="_blank">
      ${HEART_ICON_SVG}
      <span>GIFs</span>
    </a>
  `;

  container.appendChild(button);
}

function init() {
  addButton();

  const observer = new MutationObserver(() => {
    if (!document.getElementById(BUTTON_ID)) {
      addButton();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
