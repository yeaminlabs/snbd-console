import { animate, createSpring, createTimeline, stagger, utils } from 'animejs';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const pressSpring = createSpring({ stiffness: 420, damping: 24 });
const modalSpring = createSpring({ stiffness: 320, damping: 26 });
const toggleSpring = createSpring({ stiffness: 340, damping: 24 });

const animatedOnce = new WeakSet<Element>();

function clearTransform(els: Iterable<Element>) {
  for (const el of els) {
    if (el instanceof HTMLElement) {
      el.style.transform = '';
      el.style.opacity = '';
      el.style.willChange = '';
    }
  }
}

export function animateShellMount(header: HTMLElement | null, sidebar: HTMLElement | null): () => void {
  if (prefersReducedMotion()) return () => {};
  const targets: Element[] = [];
  const tl = createTimeline({ defaults: { ease: 'outQuart' } });

  if (header) {
    targets.push(header);
    tl.add(header, {
      opacity: [0, 1],
      translateY: [-10, 0],
      duration: 320,
      onComplete: () => clearTransform([header]),
    }, 0);
  }

  if (sidebar) {
    const navItems = Array.from(sidebar.querySelectorAll('.nav-item, h6, .side-promo'));
    if (navItems.length) {
      targets.push(...navItems);
      tl.add(navItems, {
        opacity: [0, 1],
        translateX: [-12, 0],
        duration: 300,
        delay: stagger(28),
        onComplete: () => clearTransform(navItems),
      }, 60);
    }
  }

  return () => {
    tl.pause();
    if (targets.length) {
      utils.remove(targets);
      clearTransform(targets);
    }
  };
}

export function animateSidebarToggle(
  sidebar: HTMLElement | null,
  chevron: SVGSVGElement | null,
  collapsed: boolean,
): void {
  if (prefersReducedMotion()) return;
  if (chevron) {
    utils.remove(chevron);
    animate(chevron, {
      rotate: collapsed ? 180 : 0,
      ease: toggleSpring,
      duration: 360,
    });
  }
  if (!collapsed && sidebar) {
    const labels = Array.from(sidebar.querySelectorAll('.nav-label, .soon, h6, .side-promo'));
    if (labels.length) {
      utils.remove(labels);
      animate(labels, {
        opacity: [0, 1],
        translateX: [-8, 0],
        duration: 240,
        delay: stagger(18),
        ease: 'outQuart',
        onComplete: () => clearTransform(labels),
      });
    }
  }
}

export function animatePageEnter(container: HTMLElement | null): () => void {
  if (!container || prefersReducedMotion()) return () => {};

  const touched: Element[] = [];
  const tl = createTimeline({ defaults: { ease: 'outQuart' } });

  const headerEls = Array.from(container.querySelectorAll(':scope > .muted, :scope > .head-row, :scope > .srv-hero, :scope > .dash-top, :scope > .tabs, :scope > h1, :scope > .notice'));
  if (headerEls.length) {
    touched.push(...headerEls);
    headerEls.forEach((el) => animatedOnce.add(el));
    tl.add(headerEls, {
      opacity: [0, 1],
      translateY: [10, 0],
      duration: 280,
      delay: stagger(35),
      onComplete: () => clearTransform(headerEls),
    }, 0);
  }

  const cardEls = Array.from(container.querySelectorAll('.card, .mcp-hero, .mcp-cap, .dash-section, .dash-info, .dash-charts, .ov-strip, .srv-stats, .cols'));
  if (cardEls.length) {
    touched.push(...cardEls);
    cardEls.forEach((el) => animatedOnce.add(el));
    tl.add(cardEls, {
      opacity: [0, 1],
      translateY: [14, 0],
      duration: 340,
      delay: stagger(40, { start: 30 }),
      onComplete: () => clearTransform(cardEls),
    }, 20);
  }

  const rowEls = Array.from(
    container.querySelectorAll('.srow:not(.th), .srv-row, .srv-stat, .ov-stat, .srv-activity-item, .act-card, .act-row, .mcp-conn, .ov-action, .dash-row, .app-grid > .card, tbody tr'),
  ).slice(0, 32);
  if (rowEls.length) {
    touched.push(...rowEls);
    rowEls.forEach((el) => animatedOnce.add(el));
    tl.add(rowEls, {
      opacity: [0, 1],
      translateY: [8, 0],
      duration: 260,
      delay: stagger(24),
      onComplete: () => clearTransform(rowEls),
    }, 80);
  }

  // Give product/source tags a small pop after their row arrives. Keep this
  // deliberately subtle so the dashboard still feels calm and scannable.
  const tagEls = Array.from(container.querySelectorAll('.srv-row-tags .badge, .dash-row .badge')).slice(0, 48);
  if (tagEls.length) {
    touched.push(...tagEls);
    tagEls.forEach((el) => animatedOnce.add(el));
    tl.add(tagEls, {
      opacity: [0, 1],
      scale: [0.94, 1],
      duration: 220,
      delay: stagger(18, { start: 120 }),
      ease: 'outBack(1.5)',
      onComplete: () => clearTransform(tagEls),
    }, 150);
  }

  const chartBars = Array.from(container.querySelectorAll('.chart > div:not(.gap), .spark-bar'));
  if (chartBars.length) {
    touched.push(...chartBars);
    chartBars.forEach((el) => animatedOnce.add(el));
    tl.add(chartBars, {
      scaleY: [0, 1],
      opacity: [0, 1],
      duration: 420,
      delay: stagger(14),
      ease: 'outExpo',
      onComplete: () => clearTransform(chartBars),
    }, 100);
  }

  const meters = Array.from(container.querySelectorAll('.ov-meter-fill'));
  if (meters.length) {
    touched.push(...meters);
    meters.forEach((el) => animatedOnce.add(el));
    tl.add(meters, {
      scaleX: [0, 1],
      duration: 520,
      delay: stagger(60),
      ease: 'outExpo',
      onComplete: () => clearTransform(meters),
    }, 120);
  }

  return () => {
    tl.pause();
    if (touched.length) {
      utils.remove(touched);
      clearTransform(touched);
    }
  };
}

const DYNAMIC_SELECTOR = [
  '.srow:not(.th)',
  '.srv-row',
  '.srv-stat',
  '.srv-activity-item',
  '.ov-stat',
  '.act-card',
  '.act-row',
  '.mcp-conn',
  '.ov-action',
  '.dash-row',
  '.dash-activity-item',
  '.dash-container-row',
  '.app-grid > .card',
  '.chart > div:not(.gap)',
  '.ov-meter-fill',
  '.card',
  'tbody tr',
].join(', ');

/**
 * Animates async-loaded elements inside a page container exactly once per DOM node,
 * so background polling refreshes do not replay entrance animations.
 */
export function observeDynamicAdditions(container: HTMLElement | null): () => void {
  if (!container || prefersReducedMotion() || typeof MutationObserver === 'undefined') return () => {};

  let frame = 0;
  const pending = new Set<Element>();

  const flush = () => {
    frame = 0;
    const bars: Element[] = [];
    const meters: Element[] = [];
    const items: Element[] = [];

    for (const el of pending) {
      if (!el.isConnected || animatedOnce.has(el)) continue;
      animatedOnce.add(el);
      if (el.matches('.chart > div:not(.gap)')) bars.push(el);
      else if (el.matches('.ov-meter-fill')) meters.push(el);
      else items.push(el);
    }
    pending.clear();

    if (items.length) {
      const batch = items.slice(0, 24);
      animate(batch, {
        opacity: [0, 1],
        translateY: [10, 0],
        duration: 280,
        delay: stagger(22),
        ease: 'outQuart',
        onComplete: () => clearTransform(batch),
      });
    }
    if (bars.length) {
      animate(bars, {
        scaleY: [0, 1],
        opacity: [0, 1],
        duration: 420,
        delay: stagger(14),
        ease: 'outExpo',
        onComplete: () => clearTransform(bars),
      });
    }
    if (meters.length) {
      animate(meters, {
        scaleX: [0, 1],
        duration: 500,
        delay: stagger(50),
        ease: 'outExpo',
        onComplete: () => clearTransform(meters),
      });
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(DYNAMIC_SELECTOR) && !animatedOnce.has(node)) {
          pending.add(node);
        }
        node.querySelectorAll(DYNAMIC_SELECTOR).forEach((child) => {
          if (!animatedOnce.has(child)) pending.add(child);
        });
      }
    }
    if (pending.size && !frame) {
      frame = requestAnimationFrame(flush);
    }
  });

  observer.observe(container, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    pending.clear();
  };
}

export function animateModalOpen(backdrop: HTMLElement | null, dialog: HTMLElement | null): () => void {
  if (prefersReducedMotion()) return () => {};
  const targets: Element[] = [];
  const tl = createTimeline();

  if (backdrop) {
    targets.push(backdrop);
    tl.add(backdrop, {
      opacity: [0, 1],
      duration: 180,
      ease: 'outQuad',
    }, 0);
  }

  if (dialog) {
    targets.push(dialog);
    tl.add(dialog, {
      opacity: [0, 1],
      translateY: [16, 0],
      scale: [0.96, 1],
      duration: 340,
      ease: modalSpring,
      onComplete: () => clearTransform([dialog]),
    }, 20);

    const chips = Array.from(dialog.querySelectorAll('.prov-chip'));
    if (chips.length) {
      targets.push(...chips);
      tl.add(chips, {
        opacity: [0, 1],
        translateY: [8, 0],
        scale: [0.95, 1],
        duration: 240,
        delay: stagger(20),
        ease: 'outQuart',
        onComplete: () => clearTransform(chips),
      }, 90);
    }
  }

  return () => {
    tl.pause();
    if (targets.length) {
      utils.remove(targets);
      clearTransform(targets);
    }
  };
}

export function animateModalClose(
  backdrop: HTMLElement | null,
  dialog: HTMLElement | null,
  onDone: () => void,
): void {
  if (prefersReducedMotion() || (!backdrop && !dialog)) {
    onDone();
    return;
  }
  const tl = createTimeline({ onComplete: onDone });
  if (dialog) {
    tl.add(dialog, {
      opacity: [1, 0],
      translateY: [0, 10],
      scale: [1, 0.97],
      duration: 150,
      ease: 'inQuad',
    }, 0);
  }
  if (backdrop) {
    tl.add(backdrop, {
      opacity: [1, 0],
      duration: 160,
      ease: 'inQuad',
    }, 20);
  }
}

export function animateAuthCard(card: HTMLElement | null): () => void {
  if (!card || prefersReducedMotion()) return () => {};
  const children = Array.from(card.children);
  const targets: Element[] = [card, ...children];
  const tl = createTimeline({ defaults: { ease: 'outQuart' } });

  tl.add(card, {
    opacity: [0, 1],
    translateY: [18, 0],
    scale: [0.98, 1],
    duration: 360,
    ease: modalSpring,
    onComplete: () => clearTransform([card]),
  }, 0);

  if (children.length) {
    tl.add(children, {
      opacity: [0, 1],
      translateY: [10, 0],
      duration: 280,
      delay: stagger(40),
      onComplete: () => clearTransform(children),
    }, 70);
  }

  return () => {
    tl.pause();
    utils.remove(targets);
    clearTransform(targets);
  };
}

export function animateShake(el: HTMLElement | null): void {
  if (!el || prefersReducedMotion()) return;
  utils.remove(el);
  animate(el, {
    translateX: [0, -7, 7, -5, 5, -2, 0],
    duration: 360,
    ease: 'inOutQuad',
    onComplete: () => clearTransform([el]),
  });
}

const PRESS_SELECTOR = '.btn:not(:disabled):not([aria-disabled="true"]), .icon-btn, .nav-toggle, .copy-mini';

/**
 * Delegated anime.js spring micro-interactions for buttons across the whole app.
 */
export function bindInteractiveMotion(root: Document | HTMLElement = document): () => void {
  if (prefersReducedMotion()) return () => {};

  const onPointerDown = (e: Event) => {
    const target = (e.target as Element | null)?.closest?.(PRESS_SELECTOR);
    if (!(target instanceof HTMLElement)) return;
    utils.remove(target);
    animate(target, {
      scale: [1, 0.96, 1],
      duration: 260,
      ease: pressSpring,
      onComplete: () => {
        target.style.transform = '';
      },
    });
  };

  root.addEventListener('pointerdown', onPointerDown, { passive: true });
  return () => root.removeEventListener('pointerdown', onPointerDown);
}
