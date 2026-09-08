(function () {
  'use strict';

  var header = document.getElementById('site-header');
  var hamburger = document.getElementById('hamburger');
  var overlay = document.getElementById('mobile-nav-overlay');
  var mobileLinks = overlay ? overlay.querySelectorAll('a') : [];

  function onScroll() {
    if (!header) return;
    header.classList.toggle('scrolled', window.scrollY > 40);
  }

  function closeMenu() {
    if (!hamburger || !overlay) return;
    hamburger.classList.remove('active');
    overlay.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  function toggleMenu() {
    if (!hamburger || !overlay) return;
    var open = hamburger.classList.toggle('active');
    overlay.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  if (hamburger) hamburger.addEventListener('click', toggleMenu);
  Array.prototype.forEach.call(mobileLinks, function (link) {
    link.addEventListener('click', closeMenu);
  });

  function installReveals() {
    var reveals = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(reveals, function (el) { el.classList.add('visible'); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var delay = parseInt(entry.target.getAttribute('data-delay') || '0', 10);
        window.setTimeout(function () { entry.target.classList.add('visible'); }, delay);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    Array.prototype.forEach.call(reveals, function (el) { observer.observe(el); });
  }

  function installProgressBars() {
    var bars = document.querySelectorAll('.progress-fill[data-width]');
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(bars, function (bar) { bar.style.width = bar.getAttribute('data-width') + '%'; });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.style.width = entry.target.getAttribute('data-width') + '%';
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.3 });
    Array.prototype.forEach.call(bars, function (bar) { observer.observe(bar); });
  }

  function installMetricCounters() {
    var values = document.querySelectorAll('.metric-value[data-count]');
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function suffixFor(el) {
      var specified = el.getAttribute('data-suffix');
      if (specified !== null) return specified;
      var match = el.textContent.trim().match(/[^\d,.]+$/);
      return match ? match[0] : '+';
    }

    function animate(el) {
      if (el.getAttribute('data-animated') === 'true') return;
      var target = parseInt(el.getAttribute('data-count'), 10);
      if (!Number.isFinite(target)) return;
      var suffix = suffixFor(el);
      el.setAttribute('data-animated', 'true');
      if (reduced) {
        el.textContent = target.toLocaleString() + suffix;
        return;
      }
      var duration = parseInt(el.getAttribute('data-duration') || '1800', 10);
      var start = null;
      function tick(ts) {
        if (start === null) start = ts;
        var progress = Math.min((ts - start) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.floor(eased * target).toLocaleString() + suffix;
        if (progress < 1) window.requestAnimationFrame(tick);
      }
      window.requestAnimationFrame(tick);
    }

    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(values, animate);
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        animate(entry.target);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.4 });
    Array.prototype.forEach.call(values, function (el) { observer.observe(el); });
  }

  function installSmoothAnchors() {
    var links = document.querySelectorAll('a[href^="#"]');
    Array.prototype.forEach.call(links, function (link) {
      link.addEventListener('click', function (event) {
        var href = this.getAttribute('href');
        if (!href || href === '#') return;
        var target;
        try { target = document.querySelector(href); } catch (error) { return; }
        if (!target) return;
        event.preventDefault();
        var offset = header ? header.offsetHeight + 20 : 20;
        var top = target.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top: top, behavior: 'smooth' });
        closeMenu();
      });
    });
  }

  function installActiveNav() {
    var sections = document.querySelectorAll('section[id]');
    var navLinks = document.querySelectorAll('.nav a[href^="#"]');
    if (!sections.length || !navLinks.length || !('IntersectionObserver' in window)) return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = entry.target.id;
        Array.prototype.forEach.call(navLinks, function (link) {
          link.classList.toggle('active', link.getAttribute('href') === '#' + id);
        });
      });
    }, { threshold: 0.35 });
    Array.prototype.forEach.call(sections, function (section) { observer.observe(section); });
  }

  function installCardGlow() {
    var cards = document.querySelectorAll('.glow-card');
    Array.prototype.forEach.call(cards, function (card) {
      if (card.querySelector('.card-glow')) return;
      var glow = document.createElement('div');
      glow.className = 'card-glow';
      card.appendChild(glow);
      card.addEventListener('mousemove', function (event) {
        var rect = card.getBoundingClientRect();
        glow.style.left = (event.clientX - rect.left) + 'px';
        glow.style.top = (event.clientY - rect.top) + 'px';
      });
    });
  }

  function installPipelineAnimation() {
    var dots = document.querySelectorAll('.pipeline-track .track-icon');
    if (!dots.length) return;
    var activeIndex = 0;
    function cycle() {
      Array.prototype.forEach.call(dots, function (dot) { dot.classList.remove('pipeline-active'); });
      dots[activeIndex].classList.add('pipeline-active');
      activeIndex = (activeIndex + 1) % dots.length;
    }
    cycle();
    window.setInterval(cycle, 1200);
  }

  function installHeroVideo() {
    var shells = document.querySelectorAll('[data-hero-video]');
    Array.prototype.forEach.call(shells, function (shell) {
      var video = shell.querySelector('video');
      var playButton = shell.querySelector('.hero-video-play');
      if (!video || !playButton) return;
      playButton.addEventListener('click', function () {
        var promise = video.play();
        if (promise && typeof promise.catch === 'function') {
          promise.catch(function (error) { console.warn('The hero video could not begin playing.', error); });
        }
      });
      video.addEventListener('play', function () { shell.classList.add('is-playing'); });
      video.addEventListener('pause', function () { if (!video.ended) shell.classList.remove('is-playing'); });
      video.addEventListener('ended', function () { shell.classList.remove('is-playing'); video.currentTime = 0; });
    });
  }

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
      if (description) description.textContent = 'A start-to-finish assistant editing operations system for professional Avid Media Composer pipelines, combining the Framework manual, implementation toolkit, and the interactive PostOpz Guide.';
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
      launch.innerHTML = '<div class="postopz-guide-launch-copy"><span class="postopz-guide-launch-kicker">NOW INCLUDED WITH FRAMEWORK VOL. 1</span><h3>Meet the PostOpz Guide.</h3><p>Move through the Avid Framework chapter by chapter, track progress, and use the AI Workflow Assistant for Framework-grounded guidance, verification, and troubleshooting.</p><div class="postopz-guide-launch-features"><span>Guide Me</span><span>AI Workflow Assistant</span><span>Track Progress</span></div></div><div class="postopz-guide-launch-actions"><a class="postopz-guide-primary" href="/framework/#guide">Explore Framework + Guide</a><a class="postopz-guide-secondary" href="https://guide.postopz.com" target="_blank" rel="noopener">Framework owners: Open Guide</a></div>';
      var volumeGrid = frameworkSection.querySelector('.framework-volume-grid');
      if (volumeGrid) volumeGrid.insertAdjacentElement('afterend', launch);
    }

    if (!document.getElementById('postopzGuideLaunchStyles')) {
      var guideStyle = document.createElement('style');
      guideStyle.id = 'postopzGuideLaunchStyles';
      guideStyle.textContent = '.postopz-guide-launch{width:min(1380px,calc(100% - 80px));margin:0 auto 34px;padding:34px 38px;display:grid;grid-template-columns:minmax(0,1.45fr) minmax(260px,.55fr);gap:34px;align-items:center;border:1px solid rgba(255,255,255,.12);border-radius:28px;background:radial-gradient(circle at 12% 0%,rgba(56,156,255,.11),transparent 32%),radial-gradient(circle at 92% 100%,rgba(239,43,189,.09),transparent 30%),linear-gradient(180deg,rgba(15,22,34,.96),rgba(7,11,18,.98));box-shadow:0 26px 80px rgba(0,0,0,.28)}.postopz-guide-launch-kicker{display:block;margin-bottom:10px;color:#389cff;font-size:10px;font-weight:900;letter-spacing:.15em;text-transform:uppercase}.postopz-guide-launch h3{margin:0 0 10px;color:#f5f7fb;font-size:clamp(28px,3vw,42px);line-height:1;letter-spacing:-.045em}.postopz-guide-launch p{max-width:760px;margin:0;color:#a5b0bf;font-size:15px;line-height:1.65}.postopz-guide-launch-features{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.postopz-guide-launch-features span{padding:8px 10px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.035);color:#c5ceda;font-size:10px;font-weight:800;letter-spacing:.04em}.postopz-guide-launch-actions{display:grid;gap:10px}.postopz-guide-launch-actions a{min-height:48px;padding:0 16px;display:flex;align-items:center;justify-content:center;border-radius:13px;font-size:12px;font-weight:800;text-align:center;transition:transform .18s ease}.postopz-guide-launch-actions a:hover{transform:translateY(-1px)}.postopz-guide-primary{color:#fff;background:linear-gradient(90deg,#ff7a18,#ef2bbd,#793cff)}.postopz-guide-secondary{color:#d4dbe5;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.035)}@media(max-width:1180px){.postopz-guide-launch{width:calc(100% - 64px);grid-template-columns:1fr}}@media(max-width:768px){.postopz-guide-launch{width:100%;padding:26px 22px;border-radius:22px}.postopz-guide-launch-features{display:grid}.postopz-guide-launch-actions{grid-template-columns:1fr}}';
      document.head.appendChild(guideStyle);
    }
  }

  function installAgentCommerceSection() {
    var frameworkSection = document.getElementById('workflow-kits');
    if (!frameworkSection || document.getElementById('agent-commerce')) return;

    var section = document.createElement('section');
    section.id = 'agent-commerce';
    section.className = 'agent-commerce-section';
    section.innerHTML = [
      '<div class="agent-commerce-shell">',
        '<div class="agent-commerce-heading">',
          '<div class="agent-commerce-eyebrow"><span></span>PostOpz for AI Agents</div>',
          '<h2>Professional editorial knowledge.<br><em class="agent-commerce-gradient">Ready for <span class="agent-no-break">AI agents.</span></em></h2>',
          '<div class="agent-commerce-signal" aria-hidden="true">',
            '<span class="agent-signal-label">AI AGENT</span>',
            '<span class="agent-signal-track"><i class="agent-signal-node agent-signal-node-1"></i><i class="agent-signal-node agent-signal-node-2"></i><i class="agent-signal-node agent-signal-node-3"></i><b class="agent-signal-pulse"></b></span>',
            '<span class="agent-signal-label agent-signal-label-right">WORKFLOW INTELLIGENCE</span>',
          '</div>',
          '<p>PostOpz turns real Avid Media Composer workflow experience into structured intelligence that AI agents, developer teams, and editorial software can license and use. Give your system production-tested workflow guidance instead of generic software documentation.</p>',
        '</div>',
        '<div class="agent-commerce-proof">',
          '<span class="agent-commerce-live"><i></i>LIVE AGENT COMMERCE</span>',
          '<strong>Framework Vol. 1</strong>',
          '<small>Avid Media Composer Edition</small>',
        '</div>',
        '<div class="agent-commerce-grid">',
          '<article><span class="agent-card-index">01</span><h3>Agent-Ready Knowledge</h3><p>Project architecture, AE workflows, handoffs, QC, turnovers, and operational reasoning grounded in <span class="agent-no-break">real post pipelines.</span></p></article>',
          '<article><span class="agent-card-index">02</span><h3>Flexible Commercial Access</h3><p>License persistent access for internal agents and production systems, or let compatible autonomous agents purchase task-scoped guidance <span class="agent-no-break">through x402.</span></p></article>',
          '<article><span class="agent-card-index">03</span><h3>Enterprise Rights</h3><p>Need model training, OEM use, or broader integration rights? PostOpz licenses those separately so teams can build on the knowledge without blurring ownership.</p></article>',
        '</div>',
        '<div class="agent-commerce-actions">',
          '<a class="agent-commerce-primary" href="/framework/agent/">License Agent Access <span>→</span></a>',
          '<a class="agent-commerce-secondary" href="mailto:hello@postopz.com?subject=PostOpz%20Enterprise%20AI%20Licensing">Enterprise / Model Licensing <span>→</span></a>',
        '</div>',
        '<div class="agent-commerce-footnote">Structured professional workflow intelligence · Retrieval licensing · Autonomous purchase support <span class="agent-no-break">via x402</span></div>',
      '</div>'
    ].join('');

    frameworkSection.insertAdjacentElement('afterend', section);

    var nav = document.getElementById('main-nav');
    if (nav && !nav.querySelector('a[href="#agent-commerce"]')) {
      var sessionsLink = nav.querySelector('a[href="#open-sessions"]');
      var agentLink = document.createElement('a');
      agentLink.href = '#agent-commerce';
      agentLink.textContent = 'AI Agents';
      if (sessionsLink) nav.insertBefore(agentLink, sessionsLink); else nav.appendChild(agentLink);
    }

    var mobileNav = document.querySelector('.mobile-nav');
    if (mobileNav && !mobileNav.querySelector('a[href="#agent-commerce"]')) {
      var mobileSessions = mobileNav.querySelector('a[href="#open-sessions"]');
      var mobileAgent = document.createElement('a');
      mobileAgent.href = '#agent-commerce';
      mobileAgent.textContent = 'AI Agents';
      if (mobileSessions) mobileNav.insertBefore(mobileAgent, mobileSessions); else mobileNav.appendChild(mobileAgent);
      mobileAgent.addEventListener('click', closeMenu);
    }

    if (!document.getElementById('agentCommerceStyles')) {
      var style = document.createElement('style');
      style.id = 'agentCommerceStyles';
      style.textContent = [
        '.agent-commerce-section{position:relative;padding:108px 0 112px;border-top:1px solid rgba(255,255,255,.08);border-bottom:1px solid rgba(255,255,255,.08);overflow:hidden;background:radial-gradient(circle at 82% 12%,rgba(124,60,255,.18),transparent 30%),radial-gradient(circle at 10% 90%,rgba(0,217,255,.08),transparent 28%),linear-gradient(180deg,#070a11,#0b0d15 55%,#07090f)}',
        '.agent-commerce-shell{width:min(1220px,calc(100% - 140px));margin:0 auto;display:grid;grid-template-columns:minmax(0,1.28fr) minmax(225px,.42fr);gap:32px 46px;align-items:end}',
        '.agent-commerce-eyebrow{display:flex;align-items:center;gap:9px;margin-bottom:18px;color:#8ccfff;font-size:11px;font-weight:900;letter-spacing:.09em;text-transform:none}.agent-commerce-eyebrow span{width:8px;height:8px;border-radius:50%;background:#59ffb2;box-shadow:0 0 18px rgba(89,255,178,.65)}',
        '.agent-commerce-heading h2{max-width:840px;margin:0;padding:.05em 0 .10em;color:#fff;font-size:clamp(42px,4.35vw,68px);font-weight:900;line-height:1.045;letter-spacing:-.055em}.agent-commerce-heading h2 em{display:inline-block;padding-bottom:.07em;font-style:normal}.agent-commerce-gradient{background:linear-gradient(105deg,#ff8735 0%,#ff3f7f 26%,#bd3cff 50%,#4b9fff 70%,#d9f4ff 78%,#4b9fff 85%,#ff8735 100%);background-size:240% 100%;background-position:0% 50%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:agentHeadlineSweep 6.8s ease-in-out infinite alternate}',
        '.agent-no-break{white-space:nowrap}',
        '.agent-commerce-signal{width:min(520px,100%);margin:8px 0 18px;display:grid;grid-template-columns:auto minmax(120px,1fr) auto;gap:12px;align-items:center}.agent-signal-label{color:#718197;font-size:9px;font-weight:900;letter-spacing:.14em;white-space:nowrap}.agent-signal-label-right{text-align:right}.agent-signal-track{position:relative;height:18px;display:block}.agent-signal-track:before{content:"";position:absolute;left:0;right:0;top:8px;height:1px;background:linear-gradient(90deg,rgba(89,255,178,.18),rgba(82,139,255,.45),rgba(189,60,255,.25))}.agent-signal-node{position:absolute;top:5px;width:7px;height:7px;border-radius:50%;border:1px solid rgba(156,204,255,.8);background:#0b1018;box-shadow:0 0 0 3px rgba(56,156,255,.03)}.agent-signal-node-1{left:0}.agent-signal-node-2{left:50%;transform:translateX(-50%)}.agent-signal-node-3{right:0}.agent-signal-pulse{position:absolute;top:3px;left:0;width:11px;height:11px;border-radius:50%;background:#59ffb2;box-shadow:0 0 18px rgba(89,255,178,.8),0 0 34px rgba(56,156,255,.35);animation:agentSignalPulse 4.8s cubic-bezier(.4,0,.2,1) infinite}.agent-signal-node-1{animation:agentNodeBlink 4.8s ease-in-out infinite}.agent-signal-node-2{animation:agentNodeBlink 4.8s ease-in-out 1.2s infinite}.agent-signal-node-3{animation:agentNodeBlink 4.8s ease-in-out 2.4s infinite}',
        '.agent-commerce-heading p{max-width:760px;margin:0;color:#b4bfce;font-size:17px;line-height:1.72}',
        '.agent-commerce-proof{justify-self:end;align-self:end;min-width:230px;padding:20px 22px;border:1px solid rgba(255,255,255,.11);border-radius:20px;background:rgba(255,255,255,.035);box-shadow:0 20px 60px rgba(0,0,0,.22)}.agent-commerce-live{display:flex;align-items:center;gap:8px;margin-bottom:14px;color:#9de9c4;font-size:10px;font-weight:900;letter-spacing:.12em}.agent-commerce-live i{width:7px;height:7px;border-radius:50%;background:#59ffb2}.agent-commerce-proof strong{display:block;color:#fff;font-size:21px}.agent-commerce-proof small{display:block;margin-top:5px;color:#8391a4;font-size:12px}',
        '.agent-commerce-grid{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:14px}.agent-commerce-grid article{position:relative;min-height:220px;padding:26px;border:1px solid rgba(255,255,255,.09);border-radius:22px;background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.018));overflow:hidden}.agent-commerce-grid article:after{content:"";position:absolute;inset:auto -30% -65% 30%;height:160px;background:radial-gradient(circle,rgba(89,146,255,.12),transparent 64%);pointer-events:none}.agent-card-index{display:block;margin-bottom:34px;color:#65748a;font-size:11px;font-weight:900;letter-spacing:.14em}.agent-commerce-grid h3{margin:0 0 10px;color:#fff;font-size:21px;letter-spacing:-.025em}.agent-commerce-grid p{margin:0;color:#9ca9ba;font-size:14px;line-height:1.65}',
        '.agent-commerce-actions{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:12px;margin-top:6px}.agent-commerce-actions a{min-height:56px;padding:0 22px;display:inline-flex;align-items:center;justify-content:center;gap:16px;border-radius:15px;font-size:13px;font-weight:900;transition:transform .2s ease,box-shadow .2s ease}.agent-commerce-actions a:hover{transform:translateY(-2px)}.agent-commerce-primary{color:#fff;background:linear-gradient(100deg,#ff7a18,#ef2bbd,#793cff);box-shadow:0 15px 42px rgba(121,60,255,.22)}.agent-commerce-secondary{color:#e1e7ef;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.035)}',
        '.agent-commerce-footnote{grid-column:1/-1;margin-top:2px;color:#65748a;font-size:11px;font-weight:700;letter-spacing:.035em}',
        '@keyframes agentHeadlineSweep{0%,18%{background-position:0% 50%}82%,100%{background-position:100% 50%}}@keyframes agentSignalPulse{0%,10%{left:0;opacity:0}18%{opacity:1}76%{opacity:1}88%,100%{left:calc(100% - 11px);opacity:0}}@keyframes agentNodeBlink{0%,72%,100%{border-color:rgba(156,204,255,.45);box-shadow:0 0 0 3px rgba(56,156,255,.02)}12%,28%{border-color:#9de9c4;box-shadow:0 0 14px rgba(89,255,178,.45)}}',
        '@media(max-width:1080px){.agent-commerce-shell{width:min(900px,calc(100% - 64px));grid-template-columns:1fr}.agent-commerce-proof{justify-self:start}.agent-commerce-grid{grid-template-columns:1fr}.agent-commerce-grid article{min-height:auto}.agent-card-index{margin-bottom:22px}}',
        '@media(max-width:680px){.agent-commerce-section{padding:82px 0}.agent-commerce-shell{width:calc(100% - 36px);gap:26px}.agent-commerce-heading h2{max-width:none;padding:.04em 0 .09em;font-size:clamp(38px,11.5vw,54px);line-height:1.06;letter-spacing:-.05em}.agent-commerce-signal{grid-template-columns:auto minmax(82px,1fr);gap:10px}.agent-signal-label-right{display:none}.agent-commerce-heading p{font-size:16px}.agent-commerce-proof{width:100%;min-width:0}.agent-commerce-actions{display:grid}.agent-commerce-actions a{width:100%;text-align:center}.agent-commerce-footnote{line-height:1.6}}',
        '@media(prefers-reduced-motion:reduce){.agent-commerce-gradient,.agent-signal-pulse,.agent-signal-node{animation:none!important}.agent-commerce-gradient{background-position:45% 50%}.agent-signal-pulse{display:none}}'
      ].join('');
      document.head.appendChild(style);
    }

    var descriptionMeta = document.querySelector('meta[name="description"]');
    if (descriptionMeta) {
      descriptionMeta.setAttribute('content', 'Managed cloud editorial infrastructure and The PostOpz Framework: professional post-production workflow systems for editors, teams, and AI agents.');
    }
  }

  function installFounderFooterLink() {
    var footerLinks = document.querySelector('.footer-links');
    if (!footerLinks || footerLinks.querySelector('a[href="/founder/"]')) return;
    var founderLink = document.createElement('a');
    founderLink.href = '/founder/';
    founderLink.textContent = 'Founder';
    founderLink.className = 'footer-email footer-founder-link';
    var emailLink = footerLinks.querySelector('.footer-email');
    if (emailLink) footerLinks.insertBefore(founderLink, emailLink);
    else footerLinks.insertBefore(founderLink, footerLinks.firstChild);
  }

  installFrameworkGuideLaunch();
  installAgentCommerceSection();
  installFounderFooterLink();
  installReveals();
  installProgressBars();
  installMetricCounters();
  installSmoothAnchors();
  installActiveNav();
  installCardGlow();
  installPipelineAnimation();
  installHeroVideo();
})();