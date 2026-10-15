/* Static, offline-first presentation. Only Reveal owns pagination. */
(function () {
  'use strict';
  const slides = window.NEW_BABEL_SLIDES || [];
  const root = document.getElementById('slides');
  root.innerHTML = slides.map(slide => `<section id="${slide.id}" class="slide scene-${slide.scene}" data-chapter="${slide.chapter}" aria-label="${slide.title}"><div class="slide-content">${slide.html}</div><aside class="notes">${slide.notes}</aside></section>`).join('');
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const transitions = { team: 'fade', cover: 'zoom', promo: 'fade', story: 'fade', loss: 'convex', problem: 'slide', reveal: 'zoom', flow: 'slide', knowledge: 'convex', quest: 'slide', demo: 'zoom', now: 'fade', vision: 'zoom' };
  for (const section of root.children) section.dataset.transition = motionPreference.matches ? 'none' : transitions[section.id];
  const notesDialog = document.getElementById('speaker-dialog');
  const deck = new Reveal(document.querySelector('.reveal'), {
    width: '100%', height: '100%', disableLayout: true,
    controls: false, progress: true, center: false,
    hash: true, history: true, respondToHashChanges: true,
    transition: motionPreference.matches ? 'none' : 'slide',
    transitionSpeed: 'slow', backgroundTransition: 'fade',
    keyboard: true, touch: true, mouseWheel: false,
    // Native video controls own playback/seeking keys while focused.
    keyboardCondition: event => !notesDialog.open && (document.activeElement?.tagName !== 'VIDEO' || ['Escape', 'f', 'F'].includes(event.key)),
    scrollActivationWidth: 0,
    autoPlayMedia: false, autoSlide: 0,
    plugins: [RevealNotes],
  });
  window.newBabelDeck = deck;
  const canvas = document.createElement('canvas');
  canvas.className = 'particle-stage';
  canvas.setAttribute('aria-hidden', 'true');
  const particles = new window.NewBabelParticles(canvas);
  const effectsToggle = document.getElementById('effects-toggle');
  const beam = document.getElementById('transition-beam');
  // Follow the system by default; the visible switch lets a presenter opt in.
  let effectsRequested = null;
  let beamAnimation;
  function motionEnabled() { return effectsRequested ?? !motionPreference.matches; }
  function resumeParticles() {
    particles.setActive(motionEnabled() && !['team', 'promo'].includes(deck.getCurrentSlide()?.id) && !document.hidden && !deck.isOverview() && !deck.isPaused() && !notesDialog.open);
  }
  function updateMotion() {
    const enabled = motionEnabled();
    document.body.dataset.motion = enabled ? 'on' : 'off';
    effectsToggle.setAttribute('aria-pressed', String(enabled));
    const label = enabled ? '关闭动态特效' : motionPreference.matches ? '开启动态特效（系统默认关闭）' : '开启动态特效';
    effectsToggle.setAttribute('aria-label', label);
    effectsToggle.title = label;
    for (const section of root.children) section.dataset.transition = enabled ? transitions[section.id] : 'none';
    deck.configure({ transition: enabled ? 'slide' : 'none', backgroundTransition: enabled ? 'fade' : 'none' });
    if (!enabled) beamAnimation?.cancel();
    resumeParticles();
  }
  effectsToggle.addEventListener('click', () => { effectsRequested = !motionEnabled(); updateMotion(); });
  motionPreference.addEventListener('change', () => { effectsRequested = null; updateMotion(); });
  document.addEventListener('visibilitychange', resumeParticles);
  for (const event of ['overviewshown', 'overviewhidden', 'paused', 'resumed']) deck.on(event, resumeParticles);
  notesDialog.addEventListener('close', resumeParticles);
  const counter = document.getElementById('slide-counter');
  const chapter = document.getElementById('chapter-label');
  const previous = document.getElementById('previous');
  const next = document.getElementById('next');
  function pauseVideos(slide) {
    slide?.querySelectorAll('video').forEach(video => video.pause());
  }
  function sync(event) {
    const index = deck.getIndices().h;
    const current = deck.getCurrentSlide();
    if (event.previousSlide && event.previousSlide !== current) pauseVideos(event.previousSlide);
    current.dataset.beat = String(current.querySelectorAll('.fragment.visible').length);
    counter.textContent = `${String(index).padStart(2, '0')} / ${String(slides.length - 1).padStart(2, '0')}`;
    chapter.textContent = `${String(index).padStart(2, '0')} — ${slides[index].chapter}`;
    previous.disabled = deck.isFirstSlide() && !deck.availableFragments().prev;
    next.disabled = deck.isLastSlide() && !deck.availableFragments().next;
    document.body.dataset.scene = slides[index].scene;
    current.prepend(canvas);
    particles.setScene(slides[index].scene, Number(current.dataset.beat));
    if (event.type === 'ready') updateMotion();
    if (motionEnabled() && ['ready', 'slidechanged', 'fragmentshown'].includes(event.type)) {
      particles.burst(event.type === 'fragmentshown' ? 'fragment' : 'slide');
      if (event.type === 'slidechanged') {
        beamAnimation?.cancel();
        beamAnimation = beam.animate([
          { transform: 'translateX(-160%) skewX(-18deg)', opacity: 0 },
          { opacity: 0.48, offset: 0.42 },
          { transform: 'translateX(420%) skewX(-18deg)', opacity: 0 },
        ], { duration: 1000, easing: 'cubic-bezier(.22,.68,.2,1)' });
      }
    }
    resumeParticles();
  }
  for (const event of ['ready', 'slidechanged', 'fragmentshown', 'fragmenthidden']) deck.on(event, sync);
  previous.addEventListener('click', () => deck.prev());
  next.addEventListener('click', () => deck.next());
  document.querySelector('.skip-link').addEventListener('click', event => {
    event.preventDefault();
    document.getElementById('overview').focus();
  });
  document.getElementById('overview').addEventListener('click', () => deck.toggleOverview());
  document.getElementById('speaker').addEventListener('click', () => {
    document.getElementById('speaker-content').innerHTML = slides[deck.getIndices().h].notes;
    notesDialog.showModal();
    resumeParticles();
  });
  document.getElementById('close-speaker').addEventListener('click', () => notesDialog.close());
  document.getElementById('presenter-window').addEventListener('click', () => deck.getPlugin('notes').open());
  // Use an explicit ?demo= URL for another host. Never derive a new destination from page content.
  const requestedDemo = new URLSearchParams(window.location.search).get('demo');
  let demoURL = 'http://127.0.0.1:32149/';
  if (requestedDemo) {
    try {
      const candidate = new URL(requestedDemo);
      if (['http:', 'https:'].includes(candidate.protocol) && !candidate.username && !candidate.password) demoURL = candidate.href;
    } catch { /* Keep the known local demo when the optional URL is invalid. */ }
  }
  for (const link of document.querySelectorAll('[data-demo-link]')) {
    link.href = demoURL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  let lastWheel = 0;
  document.querySelector('.reveal').addEventListener('wheel', event => {
    if (event.ctrlKey || Math.abs(event.deltaY) < 18 || deck.isOverview() || notesDialog.open || event.target.closest('video')) return;
    const now = Date.now();
    if (now - lastWheel < 850) return;
    event.preventDefault();
    lastWheel = now;
    if (event.deltaY > 0) deck.next();
    else deck.prev();
  }, { passive: false });
  deck.initialize();
}());
