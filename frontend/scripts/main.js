/* ==========================================================================
   NDST — общий интерфейс: шапка, меню, появление блоков, FAQ
   ========================================================================== */

(function () {
  'use strict';

  /* ---- Шапка: граница при скролле ---------------------------------- */
  const header = document.getElementById('header');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---- Мобильное меню ---------------------------------------------- */
  const burger = document.getElementById('burger');
  const menu = document.getElementById('mobileMenu');

  if (burger && menu) {
    const setMenu = (open) => {
      menu.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
      const icon = burger.querySelector('svg');
      if (icon) {
        icon.innerHTML = open ? window.NdstIcons.ICONS['x'] : window.NdstIcons.ICONS['menu'];
      }
    };

    burger.addEventListener('click', () => setMenu(!menu.classList.contains('is-open')));
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
    window.addEventListener('resize', () => { if (window.innerWidth > 900) setMenu(false); });
  }

  /* ---- Появление блоков при скролле --------------------------------- */
  const revealables = document.querySelectorAll('.reveal');

  if (revealables.length) {
    if (!('IntersectionObserver' in window)) {
      revealables.forEach((el) => el.classList.add('is-visible'));
    } else {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry, i) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          const delay = Number(el.dataset.delay || 0) + i * 60;
          setTimeout(() => el.classList.add('is-visible'), delay);
          io.unobserve(el);
        });
      }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });

      revealables.forEach((el) => io.observe(el));
    }
  }

  /* ---- FAQ ---------------------------------------------------------- */
  document.querySelectorAll('.faq__item').forEach((item) => {
    const q = item.querySelector('.faq__q');
    if (!q) return;
    q.addEventListener('click', () => {
      const open = item.classList.toggle('is-open');
      q.setAttribute('aria-expanded', String(open));
    });
  });

  /* ---- Активный пункт навигации по секциям --------------------------- */
  const sectionLinks = Array.from(document.querySelectorAll('.nav a[href^="#"]'));
  const sections = sectionLinks
    .map((a) => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);

  if (sections.length && 'IntersectionObserver' in window) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        sectionLinks.forEach((a) => {
          a.classList.toggle('is-active', a.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    sections.forEach((s) => spy.observe(s));
  }
})();
