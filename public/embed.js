/* === Obiimy Chat Embed loader ===
   Single <script> the merchant pastes on their site.
   <script src="https://obiimy-chat.eon.plus/embed.js" data-position="bottom-right"></script>
*/
(function () {
  if (window.__obiimyChatEmbedLoaded) return;
  window.__obiimyChatEmbedLoaded = true;
  const me = document.currentScript || document.querySelector('script[src*="embed.js"]');
  const base = me ? new URL(me.src).origin : '';
  const pos = (me && me.getAttribute('data-position')) || 'bottom-right';
  window.__OBIIMY_API_BASE__ = base;
  window.__OBIIMY_POSITION__ = /left/i.test(pos) ? 'left' : 'right';

  // Inject Montserrat (light) only if not already present
  if (!document.querySelector('link[href*="fonts.googleapis.com/css2?family=Montserrat"]')) {
    const f1 = document.createElement('link'); f1.rel = 'preconnect'; f1.href = 'https://fonts.gstatic.com'; f1.crossOrigin = '';
    document.head.appendChild(f1);
    const f2 = document.createElement('link'); f2.rel = 'stylesheet';
    f2.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&display=swap';
    document.head.appendChild(f2);
  }

  // CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = base + '/widget.css';
  document.head.appendChild(link);

  // Widget JS
  const s = document.createElement('script');
  s.src = base + '/widget.js';
  s.async = true;
  s.defer = true;
  document.head.appendChild(s);
})();
