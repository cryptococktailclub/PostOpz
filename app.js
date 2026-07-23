(function () {
  'use strict';

  var header = document.getElementById('site-header');
  var hamburger = document.getElementById('hamburger');
  var overlay = document.getElementById('mobile-nav-overlay');
  var mobileLinks = overlay ? overlay.querySelectorAll('a') : [];

  function onScroll() {
    if (!header) return;

    if (window.scrollY > 40) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  function toggleMenu() {
    if (!hamburger || !overlay) return;

    var open = hamburger.classList.toggle('active');
    overlay.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  }

  function closeMenu() {
    if (!hamburger || !overlay) return;

    hamburger.classList.remove('active');
    overlay.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  if (hamburger) {
    hamburger.addEventListener('click', toggleMenu);
  }

  mobileLinks.forEach(function (link) {
    link.addEventListener('click', closeMenu);
  });

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

  var metricValues = document.querySelectorAll('.metric-value[data-count]');

  if (metricValues.length && 'IntersectionObserver' in window) {
    var metricObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;

        var el = entry.target;
        var target = parseInt(el.getAttribute('data-count'), 10);
        var suffix = el.getAttribute('data-suffix') || '+';
        var duration = 1800;
        var startTime = null;

        function animate(timestamp) {
          if (!startTime) startTime = timestamp;

          var progress = Math.min((timestamp - startTime) / duration, 1);
          var value = Math.floor(progress * target);

          el.textContent = value + suffix;

          if (progress < 1) {
            requestAnimationFrame(animate);
          } else {
            el.textContent = target + suffix;
          }
        }

        requestAnimationFrame(animate);
        metricObserver.unobserve(el);
      });
    }, { threshold: 0.4 });

    metricValues.forEach(function (metric) {
      metricObserver.observe(metric);
    });
  }

  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var href = this.getAttribute('href');
      var target = document.querySelector(href);

      if (target) {
        e.preventDefault();

        var offset = header ? header.offsetHeight + 20 : 20;
        var top = target.getBoundingClientRect().top + window.pageYOffset - offset;

        window.scrollTo({
          top: top,
          behavior: 'smooth'
        });

        closeMenu();
      }
    });
  });

  var sections = document.querySelectorAll('section[id]');
  var navLinks = document.querySelectorAll('.nav a[href^="#"]');

  if (sections.length && navLinks.length && 'IntersectionObserver' in window) {
    var navObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;

        var id = entry.target.id;

        navLinks.forEach(function (link) {
          link.classList.remove('active');

          if (link.getAttribute('href') === '#' + id) {
            link.classList.add('active');
          }
        });
      });
    }, { threshold: 0.35 });

    sections.forEach(function (section) {
      navObserver.observe(section);
    });
  }

  document.querySelectorAll('.glow-card').forEach(function (card) {
    if (card.querySelector('.card-glow')) return;

    var glow = document.createElement('div');
    glow.classList.add('card-glow');
    card.appendChild(glow);

    card.addEventListener('mousemove', function (e) {
      var rect = card.getBoundingClientRect();

      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;

      glow.style.left = x + 'px';
      glow.style.top = y + 'px';
    });
  });

  var pipelineDots = document.querySelectorAll('.pipeline-track .track-icon');

  if (pipelineDots.length) {
    var activeIndex = 0;

    function animatePipeline() {
      pipelineDots.forEach(function (dot) {
        dot.classList.remove('pipeline-active');
      });

      pipelineDots[activeIndex].classList.add('pipeline-active');

      activeIndex++;

      if (activeIndex >= pipelineDots.length) {
        activeIndex = 0;
      }
    }
/* ==========================================
   HERO QUEUE COUNTERS
========================================== */

const queueMetrics = document.querySelectorAll(
  ".queue-metric[data-count]"
);

if (queueMetrics.length) {
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  const setFinalValue = (el) => {
    const target = Number(el.dataset.count);
    const prefix = el.dataset.prefix || "";
    const suffix = el.dataset.suffix || "";

    if (!Number.isFinite(target)) return;

    el.textContent =
      `${prefix}${target.toLocaleString()}${suffix}`;
  };

  const animateMetric = (el) => {
    if (el.dataset.animated === "true") return;

    const target = Number(el.dataset.count);
    const duration = Number(el.dataset.duration) || 1400;
    const prefix = el.dataset.prefix || "";
    const suffix = el.dataset.suffix || "";

    if (!Number.isFinite(target)) return;

    el.dataset.animated = "true";

    if (prefersReducedMotion) {
      setFinalValue(el);
      return;
    }

    let startTime = null;

    const animate = (timestamp) => {
      if (startTime === null) {
        startTime = timestamp;
      }

      const progress = Math.min(
        (timestamp - startTime) / duration,
        1
      );

      const easedProgress =
        1 - Math.pow(1 - progress, 3);

      const value = Math.floor(
        easedProgress * target
      );

      el.textContent =
        `${prefix}${value.toLocaleString()}${suffix}`;

      if (progress < 1) {
        window.requestAnimationFrame(animate);
      } else {
        setFinalValue(el);
      }
    };

    /*
     * The final value remains in the HTML for
     * crawlers until the element becomes visible.
     */
    el.textContent = `${prefix}0${suffix}`;

    window.requestAnimationFrame(animate);
  };

  if ("IntersectionObserver" in window) {
    const queueObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          animateMetric(entry.target);
          observer.unobserve(entry.target);
        });
      },
      {
        threshold: 0.4
      }
    );

    queueMetrics.forEach((metric) => {
      queueObserver.observe(metric);
    });
  } else {
    queueMetrics.forEach(animateMetric);
  }
}

}
    animatePipeline();
    setInterval(animatePipeline, 1200);
  }

document.querySelectorAll("[data-hero-video]").forEach((shell) => {
  const video = shell.querySelector("video");
  const playButton = shell.querySelector(".hero-video-play");

  if (!video || !playButton) return;

  playButton.addEventListener("click", async () => {
    try {
      await video.play();
    } catch (error) {
      console.warn("The hero video could not begin playing.", error);
    }
  });

  video.addEventListener("play", () => {
    shell.classList.add("is-playing");
  });

  video.addEventListener("pause", () => {
    if (!video.ended) {
      shell.classList.remove("is-playing");
    }
  });

  video.addEventListener("ended", () => {
    shell.classList.remove("is-playing");
    video.currentTime = 0;
  });
});
  
})();
