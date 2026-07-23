(function () {
  'use strict';

  /* ==========================================
     HEADER + MOBILE NAVIGATION
  ========================================== */

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

  window.addEventListener('scroll', onScroll, {
    passive: true
  });

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

  Array.prototype.forEach.call(mobileLinks, function (link) {
    link.addEventListener('click', closeMenu);
  });


  /* ==========================================
     SCROLL REVEALS
  ========================================== */

  var reveals = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window) {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;

          var delay = parseInt(
            entry.target.getAttribute('data-delay') || '0',
            10
          );

          window.setTimeout(function () {
            entry.target.classList.add('visible');
          }, delay);

          revealObserver.unobserve(entry.target);
        });
      },
      {
        threshold: 0.1,
        rootMargin: '0px 0px -40px 0px'
      }
    );

    Array.prototype.forEach.call(reveals, function (element) {
      revealObserver.observe(element);
    });
  } else {
    Array.prototype.forEach.call(reveals, function (element) {
      element.classList.add('visible');
    });
  }


  /* ==========================================
     PROGRESS BARS
  ========================================== */

  var progressBars = document.querySelectorAll(
    '.progress-fill[data-width]'
  );

  if ('IntersectionObserver' in window) {
    var barObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;

          var width = entry.target.getAttribute('data-width');

          entry.target.style.width = width + '%';
          barObserver.unobserve(entry.target);
        });
      },
      {
        threshold: 0.3
      }
    );

    Array.prototype.forEach.call(progressBars, function (bar) {
      barObserver.observe(bar);
    });
  } else {
    Array.prototype.forEach.call(progressBars, function (bar) {
      bar.style.width =
        bar.getAttribute('data-width') + '%';
    });
  }


  /* ==========================================
     EXPERIENCE METRIC COUNTERS
  ========================================== */

  var metricValues = document.querySelectorAll(
    '.metric-value[data-count]'
  );

  var prefersReducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function getMetricSuffix(element) {
    var specifiedSuffix =
      element.getAttribute('data-suffix');

    if (specifiedSuffix !== null) {
      return specifiedSuffix;
    }

    /*
     * Extract a suffix already present in the HTML.
     * Examples:
     * 10+     -> +
     * 800TB+  -> TB+
     */
    var originalText = element.textContent.trim();
    var suffixMatch = originalText.match(/[^\d,.]+$/);

    return suffixMatch ? suffixMatch[0] : '+';
  }

  function setMetricFinalValue(element) {
    var target = parseInt(
      element.getAttribute('data-count'),
      10
    );

    if (!Number.isFinite(target)) return;

    var suffix = getMetricSuffix(element);

    element.textContent =
      target.toLocaleString() + suffix;
  }

  function animateMetric(element) {
    if (element.getAttribute('data-animated') === 'true') {
      return;
    }

    var target = parseInt(
      element.getAttribute('data-count'),
      10
    );

    if (!Number.isFinite(target)) return;

    var suffix = getMetricSuffix(element);
    var duration = parseInt(
      element.getAttribute('data-duration') || '1800',
      10
    );

    element.setAttribute('data-animated', 'true');

    if (prefersReducedMotion) {
      setMetricFinalValue(element);
      return;
    }

    var startTime = null;

    /*
     * The final number should already be present in the HTML
     * so crawlers and AI readers can access it.
     * It changes to zero only when the browser begins animating.
     */
    element.textContent = '0' + suffix;

    function animate(timestamp) {
      if (startTime === null) {
        startTime = timestamp;
      }

      var progress = Math.min(
        (timestamp - startTime) / duration,
        1
      );

      /*
       * Ease-out animation.
       */
      var easedProgress =
        1 - Math.pow(1 - progress, 3);

      var value = Math.floor(
        easedProgress * target
      );

      element.textContent =
        value.toLocaleString() + suffix;

      if (progress < 1) {
        window.requestAnimationFrame(animate);
      } else {
        setMetricFinalValue(element);
      }
    }

    window.requestAnimationFrame(animate);
  }

  if (metricValues.length) {
    if ('IntersectionObserver' in window) {
      var metricObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;

            animateMetric(entry.target);
            metricObserver.unobserve(entry.target);
          });
        },
        {
          threshold: 0.4
        }
      );

      Array.prototype.forEach.call(
        metricValues,
        function (metric) {
          metricObserver.observe(metric);
        }
      );
    } else {
      Array.prototype.forEach.call(
        metricValues,
        function (metric) {
          setMetricFinalValue(metric);
        }
      );
    }
  }


  /* ==========================================
     SMOOTH ANCHOR SCROLLING
  ========================================== */

  var anchorLinks =
    document.querySelectorAll('a[href^="#"]');

  Array.prototype.forEach.call(
    anchorLinks,
    function (link) {
      link.addEventListener('click', function (event) {
        var href = this.getAttribute('href');

        if (!href || href === '#') return;

        var target;

        try {
          target = document.querySelector(href);
        } catch (error) {
          return;
        }

        if (!target) return;

        event.preventDefault();

        var offset = header
          ? header.offsetHeight + 20
          : 20;

        var top =
          target.getBoundingClientRect().top +
          window.pageYOffset -
          offset;

        window.scrollTo({
          top: top,
          behavior: 'smooth'
        });

        closeMenu();
      });
    }
  );


  /* ==========================================
     ACTIVE NAVIGATION STATE
  ========================================== */

  var sections =
    document.querySelectorAll('section[id]');

  var navLinks =
    document.querySelectorAll('.nav a[href^="#"]');

  if (
    sections.length &&
    navLinks.length &&
    'IntersectionObserver' in window
  ) {
    var navObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;

          var id = entry.target.id;

          Array.prototype.forEach.call(
            navLinks,
            function (link) {
              link.classList.remove('active');

              if (
                link.getAttribute('href') ===
                '#' + id
              ) {
                link.classList.add('active');
              }
            }
          );
        });
      },
      {
        threshold: 0.35
      }
    );

    Array.prototype.forEach.call(
      sections,
      function (section) {
        navObserver.observe(section);
      }
    );
  }


  /* ==========================================
     CARD GLOW EFFECT
  ========================================== */

  var glowCards =
    document.querySelectorAll('.glow-card');

  Array.prototype.forEach.call(
    glowCards,
    function (card) {
      if (card.querySelector('.card-glow')) return;

      var glow = document.createElement('div');

      glow.classList.add('card-glow');
      card.appendChild(glow);

      card.addEventListener(
        'mousemove',
        function (event) {
          var rect = card.getBoundingClientRect();

          var x = event.clientX - rect.left;
          var y = event.clientY - rect.top;

          glow.style.left = x + 'px';
          glow.style.top = y + 'px';
        }
      );
    }
  );


  /* ==========================================
     PIPELINE ANIMATION
  ========================================== */

  var pipelineDots = document.querySelectorAll(
    '.pipeline-track .track-icon'
  );

  if (pipelineDots.length) {
    var activeIndex = 0;

    function animatePipeline() {
      Array.prototype.forEach.call(
        pipelineDots,
        function (dot) {
          dot.classList.remove('pipeline-active');
        }
      );

      pipelineDots[activeIndex].classList.add(
        'pipeline-active'
      );

      activeIndex += 1;

      if (activeIndex >= pipelineDots.length) {
        activeIndex = 0;
      }
    }

    animatePipeline();

    window.setInterval(
      animatePipeline,
      1200
    );
  }


  /* ==========================================
     HERO VIDEO
  ========================================== */

  var heroVideoShells =
    document.querySelectorAll('[data-hero-video]');

  Array.prototype.forEach.call(
    heroVideoShells,
    function (shell) {
      var video = shell.querySelector('video');
      var playButton =
        shell.querySelector('.hero-video-play');

      if (!video || !playButton) return;

      playButton.addEventListener(
        'click',
        function () {
          var playPromise = video.play();

          if (
            playPromise &&
            typeof playPromise.catch === 'function'
          ) {
            playPromise.catch(function (error) {
              console.warn(
                'The hero video could not begin playing.',
                error
              );
            });
          }
        }
      );

      video.addEventListener('play', function () {
        shell.classList.add('is-playing');
      });

      video.addEventListener('pause', function () {
        if (!video.ended) {
          shell.classList.remove('is-playing');
        }
      });

      video.addEventListener('ended', function () {
        shell.classList.remove('is-playing');
        video.currentTime = 0;
      });
    }
  );

})();
