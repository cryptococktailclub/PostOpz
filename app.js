(function () {
  'use strict';

  var header = document.getElementById('site-header');
  var hamburger = document.getElementById('hamburger');
  var overlay = document.getElementById('mobile-nav-overlay');
  var mobileLinks = overlay ? overlay.querySelectorAll('a') : [];

  // Scroll-aware header
  function onScroll() {
    if (window.scrollY > 40) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Mobile nav toggle
  function toggleMenu() {
    var open = hamburger.classList.toggle('active');
    overlay.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  }

  function closeMenu() {
    hamburger.classList.remove('active');
    overlay.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  hamburger.addEventListener('click', toggleMenu);
  for (var i = 0; i < mobileLinks.length; i++) {
    mobileLinks[i].addEventListener('click', closeMenu);
  }

  // Scroll reveal with IntersectionObserver
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var delay = parseInt(entry.target.getAttribute('data-delay') || '0', 10);
          setTimeout(function () {
            entry.target.classList.add('visible');
          }, delay);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    reveals.forEach(function (el) {
      observer.observe(el);
    });
  } else {
    reveals.forEach(function (el) {
      el.classList.add('visible');
    });
  }

  // Animated progress bars
  var progressBars = document.querySelectorAll('.progress-fill[data-width]');
  if ('IntersectionObserver' in window) {
    var barObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var w = entry.target.getAttribute('data-width');
          entry.target.style.width = w + '%';
          barObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });

    progressBars.forEach(function (bar) {
      barObserver.observe(bar);
    });
  } else {
    progressBars.forEach(function (bar) {
      bar.style.width = bar.getAttribute('data-width') + '%';
    });
  }
const progressBars = document.querySelectorAll(".progress-fill");

const progressObserver = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;

      const bar = entry.target;
      const width = bar.dataset.width;

      requestAnimationFrame(() => {
        bar.style.width = width + "%";
      });

      progressObserver.unobserve(bar);
    });
  },
  { threshold: 0.4 }
);

progressBars.forEach(bar => {
  bar.style.width = "0%";
  progressObserver.observe(bar);
});

  /* ==========================================
   METRIC COUNTER ANIMATION
========================================== */

const metricValues = document.querySelectorAll(
  ".metric-value[data-count]"
);

const metricObserver = new IntersectionObserver(
  (entries) => {

    entries.forEach((entry) => {

      if (!entry.isIntersecting) return;

      const el = entry.target;

      const target = parseInt(
        el.dataset.count,
        10
      );

      const suffix =
        el.dataset.suffix || "+";

      const duration = 1800;

      const startTime = performance.now();

      const animate = (currentTime) => {

        const progress = Math.min(
          (currentTime - startTime) / duration,
          1
        );

        const value = Math.floor(
          progress * target
        );

        el.textContent =
          value + suffix;

        if (progress < 1) {
          requestAnimationFrame(
            animate
          );
        } else {
          el.textContent =
            target + suffix;
        }
      };

      requestAnimationFrame(
        animate
      );

      metricObserver.unobserve(el);

    });

  },
  {
    threshold: 0.4
  }
);

metricValues.forEach((metric) => {
  metricObserver.observe(metric);
});
  // Smooth scroll for anchor links (enhanced)
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        var offset = header.offsetHeight + 20;
        var top = target.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top: top, behavior: 'smooth' });
      }
    });
  });
})();
