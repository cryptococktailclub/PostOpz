import fs from 'node:fs/promises';

const file = new URL('../framework/index.html', import.meta.url);
const spriteFile = new URL('../framework/assets/guide-gallery-sprite.webp', import.meta.url);
let html = await fs.readFile(file, 'utf8');

// Fail the Netlify build instead of shipping another silent/broken preview asset.
const spriteData = await fs.readFile(spriteFile);
const riff = spriteData.subarray(0, 4).toString('ascii');
const webp = spriteData.subarray(8, 12).toString('ascii');
if (spriteData.length < 10000 || riff !== 'RIFF' || webp !== 'WEBP') {
  throw new Error(`Guide gallery sprite is invalid (${spriteData.length} bytes, ${riff}/${webp}).`);
}
const spriteSrc = '/framework/assets/guide-gallery-sprite.webp?v=20260830d';
const coverSrc = '/framework/assets/postopz-framework-cover.png';

const cssMarker = '    /* Keep customer-facing copy visually intentional: balanced display text and prettier body wraps prevent one-word last lines. */';
const galleryCss = `    /* Larger selectable PostOpz Guide gallery with Framework cover. */
    .guide-launch{width:min(1360px,calc(100% - 40px));grid-template-columns:minmax(0,.78fr) minmax(0,1.22fr);gap:56px}
    .guide-gallery-shell{display:grid;gap:12px;min-width:0}
    .guide-gallery-frame{position:relative;aspect-ratio:16/9;overflow:hidden;border:1px solid #223047;border-radius:22px;background:#05070d;box-shadow:0 28px 90px rgba(0,0,0,.48)}
    .guide-gallery-cover,.guide-gallery-sprite{position:absolute;display:block;transition:opacity .24s ease,top .32s cubic-bezier(.2,.7,.2,1);will-change:opacity,top}
    .guide-gallery-cover{inset:0;width:100%;height:100%;padding:16px;object-fit:contain;background:radial-gradient(circle at 50% 42%,rgba(56,156,255,.08),transparent 58%);opacity:0}
    .guide-gallery-sprite{left:-17%;top:-17%;width:134%;height:auto;max-width:none;opacity:0}
    .guide-gallery-frame[data-panel="0"] .guide-gallery-cover{opacity:1}
    .guide-gallery-frame[data-panel="1"] .guide-gallery-sprite{opacity:1;top:-17%}
    .guide-gallery-frame[data-panel="2"] .guide-gallery-sprite{opacity:1;top:-151%}
    .guide-gallery-frame[data-panel="3"] .guide-gallery-sprite{opacity:1;top:-285%}
    .guide-gallery-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
    .guide-gallery-tab{appearance:none;min-height:43px;padding:9px 10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;background:rgba(255,255,255,.03);color:#8996a8;font:inherit;font-size:11px;font-weight:780;line-height:1.2;text-wrap:balance;cursor:pointer;transition:color .18s ease,border-color .18s ease,background .18s ease,transform .18s ease}
    .guide-gallery-tab:hover{color:#fff;border-color:rgba(255,255,255,.20);transform:translateY(-1px)}
    .guide-gallery-tab.is-active{color:#fff;border-color:transparent;background:linear-gradient(#0a111b,#0a111b) padding-box,linear-gradient(90deg,var(--orange),var(--pink),var(--purple)) border-box;border:1px solid transparent}
    .guide-gallery-caption{margin:0;color:#738196;font-size:10px;line-height:1.45;text-align:center;text-wrap:pretty}
    @media(max-width:980px){.guide-launch{width:min(var(--max),calc(100% - 40px));grid-template-columns:1fr;gap:38px}}
    @media(max-width:650px){.guide-gallery-tabs{display:flex;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}.guide-gallery-tabs::-webkit-scrollbar{display:none}.guide-gallery-tab{flex:1 0 122px}.guide-gallery-frame{border-radius:16px}.guide-gallery-sprite{left:-22%;width:144%}.guide-gallery-frame[data-panel="1"] .guide-gallery-sprite{top:-22%}.guide-gallery-frame[data-panel="2"] .guide-gallery-sprite{top:-166%}.guide-gallery-frame[data-panel="3"] .guide-gallery-sprite{top:-310%}}

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

const galleryHtml = `      <div class="guide-gallery-shell" aria-label="PostOpz Framework and Guide screenshots">
        <div class="guide-gallery-frame" data-panel="1">
          <img class="guide-gallery-cover" src="${coverSrc}" alt="The PostOpz Framework Vol. 1 front cover" loading="eager" decoding="async" />
          <img class="guide-gallery-sprite" src="${spriteSrc}" alt="PostOpz Guide screens showing Guide Me, Workflow Assistant, and Methodology" loading="eager" decoding="async" fetchpriority="high" />
        </div>
        <div class="guide-gallery-tabs" role="tablist" aria-label="PostOpz Framework and Guide screenshots">
          <button class="guide-gallery-tab" type="button" role="tab" aria-selected="false" data-guide-panel="0" data-caption="Framework Cover · The PostOpz Framework Vol. 1 — Avid Media Composer Edition.">Framework Cover</button>
          <button class="guide-gallery-tab is-active" type="button" role="tab" aria-selected="true" data-guide-panel="1" data-caption="Guide Me · Chapter-by-chapter workflow guidance with active step context.">Guide Me</button>
          <button class="guide-gallery-tab" type="button" role="tab" aria-selected="false" data-guide-panel="2" data-caption="Workflow Assistant · Framework-grounded guidance, verification, and troubleshooting.">Workflow Assistant</button>
          <button class="guide-gallery-tab" type="button" role="tab" aria-selected="false" data-guide-panel="3" data-caption="Methodology · The full production-ready workflow mapped from project creation through final turnover.">Methodology</button>
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
        const panel = tab.dataset.guidePanel || '1';
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
console.log(`Prepared enlarged PostOpz Guide gallery with Framework cover and validated ${spriteData.length}-byte WebP asset.`);
