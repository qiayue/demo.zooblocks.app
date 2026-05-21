// Game / video iframe splash → click-to-load.
//
// Looks for elements with [data-game-frame] or [data-video-frame] attributes
// and lazy-loads the iframe on click. The iframe URL is present in the
// rendered HTML (as data-src and in the <noscript> fallback) so crawlers see
// the association even before clicks.

(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function mountFrame(container, opts) {
    var src = container.getAttribute('data-src');
    if (!src) return;
    var title = container.getAttribute('data-title') || '';
    var splash = container.querySelector('[data-splash]');
    var loadingLabel = container.getAttribute('data-loading-label') || 'Loading…';

    if (splash) {
      splash.innerHTML =
        '<div class="absolute inset-0 flex items-center justify-center bg-black text-white text-sm">' +
        loadingLabel +
        '</div>';
    }

    var iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.title = title;
    iframe.className = 'absolute inset-0 h-full w-full border-0';
    iframe.setAttribute('allow', opts.allow);
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.setAttribute('loading', 'eager');
    iframe.addEventListener('load', function () {
      if (splash && splash.parentNode === container) container.removeChild(splash);
    });
    container.appendChild(iframe);

    var fsBtn = container.querySelector('[data-fullscreen]');
    if (fsBtn) {
      fsBtn.classList.remove('hidden');
      fsBtn.addEventListener('click', function () {
        var el = iframe;
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      });
    }
  }

  ready(function () {
    var gameFrames = document.querySelectorAll('[data-game-frame]');
    gameFrames.forEach(function (c) {
      var btn = c.querySelector('[data-play]');
      if (!btn) return;
      btn.addEventListener('click', function () {
        mountFrame(c, { allow: 'autoplay; fullscreen; gamepad *; clipboard-write' });
      });
    });

    var videoFrames = document.querySelectorAll('[data-video-frame]');
    videoFrames.forEach(function (c) {
      var btn = c.querySelector('[data-play]');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var src = c.getAttribute('data-src');
        // YouTube embed: autoplay on user click.
        if (src && /youtube\.com\/embed\//.test(src) && src.indexOf('autoplay=') < 0) {
          c.setAttribute('data-src', src + (src.indexOf('?') >= 0 ? '&' : '?') + 'autoplay=1');
        }
        mountFrame(c, {
          allow:
            'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
        });
      });
    });
  });
})();
