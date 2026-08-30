import fs from 'node:fs/promises';

const file = new URL('../framework/index.html', import.meta.url);
let html = await fs.readFile(file, 'utf8');

const cssMarker = '    /* Keep customer-facing copy visually intentional: balanced display text and prettier body wraps prevent one-word last lines. */';
const galleryCss = `    /* Compact selectable PostOpz Guide screenshot gallery. */
    .guide-gallery-shell{display:grid;gap:12px;min-width:0}
    .guide-gallery-frame{position:relative;aspect-ratio:16/9;overflow:hidden;border:1px solid #223047;border-radius:22px;background:#05070d;box-shadow:0 28px 90px rgba(0,0,0,.48)}
    .guide-gallery-sprite{position:absolute;left:0;top:0;width:100%;height:auto;max-width:none;transition:transform .32s cubic-bezier(.2,.7,.2,1);will-change:transform}
    .guide-gallery-frame[data-panel="0"] .guide-gallery-sprite{transform:translateY(0)}
    .guide-gallery-frame[data-panel="1"] .guide-gallery-sprite{transform:translateY(-33.333333%)}
    .guide-gallery-frame[data-panel="2"] .guide-gallery-sprite{transform:translateY(-66.666667%)}
    .guide-gallery-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
    .guide-gallery-tab{appearance:none;min-height:43px;padding:9px 10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;background:rgba(255,255,255,.03);color:#8996a8;font:inherit;font-size:11px;font-weight:780;line-height:1.2;text-wrap:balance;cursor:pointer;transition:color .18s ease,border-color .18s ease,background .18s ease,transform .18s ease}
    .guide-gallery-tab:hover{color:#fff;border-color:rgba(255,255,255,.20);transform:translateY(-1px)}
    .guide-gallery-tab.is-active{color:#fff;border-color:transparent;background:linear-gradient(#0a111b,#0a111b) padding-box,linear-gradient(90deg,var(--orange),var(--pink),var(--purple)) border-box;border:1px solid transparent}
    .guide-gallery-caption{margin:0;color:#738196;font-size:10px;line-height:1.45;text-align:center;text-wrap:pretty}
    @media(max-width:650px){.guide-gallery-tabs{display:flex;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}.guide-gallery-tabs::-webkit-scrollbar{display:none}.guide-gallery-tab{flex:1 0 132px}.guide-gallery-frame{border-radius:16px}}

`;

if (!html.includes('.guide-gallery-shell{')) {
  if (!html.includes(cssMarker)) throw new Error('Framework gallery CSS marker not found.');
  html = html.replace(cssMarker, galleryCss + cssMarker);
}

const previewStart = '      <div class="guide-preview" aria-label="PostOpz Guide interface preview">';
const sectionEndMarker = '\n    </section>\n\n    <section class="section">';
const start = html.indexOf(previewStart);
const end = html.indexOf(sectionEndMarker, start);
if (start < 0 || end < 0) throw new Error('Framework Guide preview block not found.');

const galleryHtml = `      <div class="guide-gallery-shell" aria-label="PostOpz Guide interface screenshots">
        <div class="guide-gallery-frame" data-panel="0">
          <img class="guide-gallery-sprite" src="assets/guide-gallery-sprite.webp" alt="PostOpz Guide screens showing Guide Me, Workflow Assistant, and Methodology" loading="lazy" decoding="async" />
        </div>
        <div class="guide-gallery-tabs" role="tablist" aria-label="PostOpz Guide screenshots">
          <button class="guide-gallery-tab is-active" type="button" role="tab" aria-selected="true" data-guide-panel="0" data-caption="Guide Me · Chapter-by-chapter workflow guidance with active step context.">Guide Me</button>
          <button class="guide-gallery-tab" type="button" role="tab" aria-selected="false" data-guide-panel="1" data-caption="Workflow Assistant · Framework-grounded guidance, verification, and troubleshooting.">Workflow Assistant</button>
          <button class="guide-gallery-tab" type="button" role="tab" aria-selected="false" data-guide-panel="2" data-caption="Methodology · The full production-ready workflow mapped from project creation through final turnover.">Methodology</button>
        </div>
        <p class="guide-gallery-caption" aria-live="polite">Guide Me · Chapter-by-chapter workflow guidance with active step context.</p>
      </div>`;

html = html.slice(0, start) + galleryHtml + html.slice(end);

const closeScript = '  </script>\n</body>';
const scriptIndex = html.lastIndexOf(closeScript);
if (scriptIndex < 0) throw new Error('Framework closing script marker not found.');

const galleryJs = `

    const guideGalleryFrame = document.querySelector('.guide-gallery-frame');
    const guideGalleryCaption = document.querySelector('.guide-gallery-caption');
    const guideGalleryTabs = document.querySelectorAll('.guide-gallery-tab');
    guideGalleryTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const panel = tab.dataset.guidePanel || '0';
        if (guideGalleryFrame) guideGalleryFrame.dataset.panel = panel;
        if (guideGalleryCaption) guideGalleryCaption.textContent = tab.dataset.caption || '';
        guideGalleryTabs.forEach(item => {
          const active = item === tab;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-selected', active ? 'true' : 'false');
        });
      });
    });
`;

html = html.slice(0, scriptIndex) + galleryJs + html.slice(scriptIndex);
await fs.writeFile(file, html);
console.log('Prepared compact PostOpz Guide screenshot gallery for Netlify publish.');
