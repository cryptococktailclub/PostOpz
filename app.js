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
    element.textContent = '0' + suffix;

    function animate(timestamp) {
      if (startTime === null) {
        startTime = timestamp;
      }

      var progress = Math.min(
        (timestamp - startTime) / duration,
        1
      );

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


  /* ==========================================
     POSTOPZ GUIDE — PUBLIC LAUNCH
  ========================================== */

  function installFrameworkGuideLaunch() {
    var frameworkSection = document.getElementById('workflow-kits');
    if (!frameworkSection) return;

    var sectionIntro = frameworkSection.querySelector('.section-heading p');
    if (sectionIntro) {
      sectionIntro.textContent = 'Professional-grade post-production operations systems for working assistant editors and post teams. Vol. 1 now includes the 75-page Avid manual, implementation toolkit, and the interactive PostOpz Guide with a Framework-grounded AI Workflow Assistant.';
    }

    var firstVolume = frameworkSection.querySelector('.framework-volume-card');
    if (firstVolume) {
      var label = firstVolume.querySelector('.product-label');
      if (label) label.textContent = 'Vol. 1 · Guide Included';

      var description = firstVolume.querySelector('p');
      if (description) {
        description.textContent = 'A start-to-finish assistant editing operations system for professional Avid Media Composer pipelines, combining the Framework manual, implementation toolkit, and the interactive PostOpz Guide.';
      }

      var list = firstVolume.querySelector('ul');
      if (list && !list.querySelector('[data-guide-included]')) {
        var item = document.createElement('li');
        item.dataset.guideIncluded = 'true';
        item.textContent = 'PostOpz Guide + Framework-grounded AI Workflow Assistant';
        list.appendChild(item);
      }

      var button = firstVolume.querySelector('.product-button');
      if (button) {
        button.href = '/framework/';
        button.removeAttribute('target');
        button.removeAttribute('rel');
        button.textContent = 'Explore Vol. 1 + Guide';
      }

      var note = firstVolume.querySelector('.stripe-note');
      if (note) note.textContent = 'Includes manual · implementation toolkit · PostOpz Guide';
    }

    if (!document.getElementById('postopzGuideLaunch')) {
      var launch = document.createElement('article');
      launch.id = 'postopzGuideLaunch';
      launch.className = 'postopz-guide-launch';
      launch.innerHTML = [
        '<div class="postopz-guide-launch-copy">',
          '<span class="postopz-guide-launch-kicker">NOW INCLUDED WITH FRAMEWORK VOL. 1</span>',
          '<h3>Meet the PostOpz Guide.</h3>',
          '<p>Move through the Avid Framework chapter by chapter, track progress, and use the AI Workflow Assistant for Framework-grounded guidance, verification, and troubleshooting.</p>',
          '<div class="postopz-guide-launch-features">',
            '<span>Guide Me</span>',
            '<span>AI Workflow Assistant</span>',
            '<span>Track Progress</span>',
          '</div>',
        '</div>',
        '<div class="postopz-guide-launch-actions">',
          '<a class="postopz-guide-primary" href="/framework/#guide">Explore Framework + Guide</a>',
          '<a class="postopz-guide-secondary" href="https://guide.postopz.com" target="_blank" rel="noopener">Framework owners: Open Guide</a>',
        '</div>'
      ].join('');

      var volumeGrid = frameworkSection.querySelector('.framework-volume-grid');
      if (volumeGrid) volumeGrid.insertAdjacentElement('afterend', launch);
    }

    if (!document.getElementById('postopzGuideLaunchStyles')) {
      var style = document.createElement('style');
      style.id = 'postopzGuideLaunchStyles';
      style.textContent = [
        '.postopz-guide-launch{width:min(1380px,calc(100% - 80px));margin:0 auto 34px;padding:34px 38px;display:grid;grid-template-columns:minmax(0,1.45fr) minmax(260px,.55fr);gap:34px;align-items:center;border:1px solid rgba(255,255,255,.12);border-radius:28px;background:radial-gradient(circle at 12% 0%,rgba(56,156,255,.11),transparent 32%),radial-gradient(circle at 92% 100%,rgba(239,43,189,.09),transparent 30%),linear-gradient(180deg,rgba(15,22,34,.96),rgba(7,11,18,.98));box-shadow:0 26px 80px rgba(0,0,0,.28)}',
        '.postopz-guide-launch-kicker{display:block;margin-bottom:10px;color:#389cff;font-size:10px;font-weight:900;letter-spacing:.15em;text-transform:uppercase}',
        '.postopz-guide-launch h3{margin:0 0 10px;color:#f5f7fb;font-size:clamp(28px,3vw,42px);line-height:1;letter-spacing:-.045em}',
        '.postopz-guide-launch p{max-width:760px;margin:0;color:#a5b0bf;font-size:15px;line-height:1.65}',
        '.postopz-guide-launch-features{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}',
        '.postopz-guide-launch-features span{padding:8px 10px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.035);color:#c5ceda;font-size:10px;font-weight:800;letter-spacing:.04em}',
        '.postopz-guide-launch-actions{display:grid;gap:10px}',
        '.postopz-guide-launch-actions a{min-height:48px;padding:0 16px;display:flex;align-items:center;justify-content:center;border-radius:13px;font-size:12px;font-weight:800;text-align:center;transition:transform .18s ease,border-color .18s ease}',
        '.postopz-guide-launch-actions a:hover{transform:translateY(-1px)}',
        '.postopz-guide-primary{color:#fff;background:linear-gradient(90deg,#ff7a18,#ef2bbd,#793cff)}',
        '.postopz-guide-secondary{color:#d4dbe5;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.035)}',
        '@media(max-width:1180px){.postopz-guide-launch{width:calc(100% - 64px);grid-template-columns:1fr}}',
        '@media(max-width:768px){.postopz-guide-launch{width:100%;padding:26px 22px;border-radius:22px}.postopz-guide-launch-features{display:grid}.postopz-guide-launch-actions{grid-template-columns:1fr}}'
      ].join('');
      document.head.appendChild(style);
    }

    var descriptionMeta = document.querySelector('meta[name="description"]');
    if (descriptionMeta) {
      descriptionMeta.setAttribute('content', 'Managed cloud editorial infrastructure, post operations support, and The PostOpz Framework with the interactive PostOpz Guide for professional assistant editor workflows.');
    }
  }

  installFrameworkGuideLaunch();

})();
