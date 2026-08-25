// Main Application Controller (Clean, Minimal & High Contrast)
import { APP_CONFIG, CATEGORIES, STORIES, BRANCHES, PRODUCTS, FAQ_DATA, TRANSLATIONS } from './data.js';
import { GarminQuiz } from './quiz.js';
import { GarminComparator } from './compare.js';
import { BatterySimulator } from './batterySimulator.js';
import { botLink, HUMAN_TELEGRAM_URL, openBotLink, installTelegramLinkBridge, setupBackButton } from './telegram.js';

class GarminApp {
  constructor() {
    this.currentLang = localStorage.getItem('garmin_lang') || 'ru';
    this.activeCategory = 'all';
    this.searchQuery = '';
    this.selectedProduct = null;
    this.activeStoryIndex = null;
    this.storyTimer = null;

    this.quiz = null;
    this.comparator = null;
    this.batterySim = null;

    this.init();
  }

  init() {
    // Tells the Telegram client the Mini App is ready to display, and lets us
    // detect (via WebApp.initData) whether we're actually inside Telegram.
    window.Telegram?.WebApp?.ready?.();
    installTelegramLinkBridge();
    setupBackButton(() => this.closeTopOverlay());
    this.initInteractiveModules();
    this.setupLanguageSwitcher();
    this.renderStories();
    this.renderCategoryPills();
    this.renderProducts();
    this.renderShowrooms();
    this.renderFaq();
    this.setupSearch();
    this.setupModals();
    this.setupQuickLinks();
    this.applyTranslations();
  }

  initInteractiveModules() {
    this.quiz = new GarminQuiz('quizContainer', (prod) => this.openProductModal(prod));
    this.quiz.setLanguage(this.currentLang);

    this.comparator = new GarminComparator('compareContainer', (prod) => this.openProductModal(prod));
    this.comparator.setLanguage(this.currentLang);

    this.batterySim = new BatterySimulator('batteryContainer');
    this.batterySim.setLanguage(this.currentLang);
  }

  setLanguage(lang) {
    this.currentLang = lang;
    localStorage.setItem('garmin_lang', lang);
    this.applyTranslations();
    this.renderStories();
    this.renderCategoryPills();
    this.renderProducts();
    this.renderFaq();
    if (this.quiz) this.quiz.setLanguage(lang);
    if (this.comparator) this.comparator.setLanguage(lang);
    if (this.batterySim) this.batterySim.setLanguage(lang);
  }

  setupLanguageSwitcher() {
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lang = btn.getAttribute('data-lang');
        document.querySelectorAll('.lang-btn').forEach(b => {
          b.classList.remove('active', 'bg-white', 'text-black');
          b.classList.add('text-zinc-400');
        });
        btn.classList.add('active', 'bg-white', 'text-black');
        btn.classList.remove('text-zinc-400');
        this.setLanguage(lang);
      });
    });
  }

  applyTranslations() {
    const t = TRANSLATIONS[this.currentLang] || TRANSLATIONS.ru;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) {
        el.textContent = t[key];
      }
    });

    const searchInput = document.getElementById('catalogSearch');
    if (searchInput) {
      searchInput.placeholder = t.searchPlaceholder;
    }

    this.syncBotLinks();
  }

  // Static markup carries a hardcoded Russian deep link so the buttons work even
  // before JS boots; rewrite them whenever the language changes.
  syncBotLinks() {
    document.querySelectorAll('[data-bot-link]').forEach(el => {
      el.href = botLink(el.getAttribute('data-bot-link'), null, this.currentLang);
    });
  }

  // --- STORY HIGHLIGHTS ---
  renderStories() {
    const container = document.getElementById('storiesContainer');
    if (!container) return;

    container.innerHTML = STORIES.map((s, idx) => `
      <button 
        type="button" 
        class="story-item flex flex-col items-center gap-2 shrink-0 focus:outline-none group"
        data-story-idx="${idx}"
      >
        <div class="w-16 h-16 sm:w-18 sm:h-18 rounded-full p-[1.5px] border border-zinc-700 group-hover:border-white transition-all">
          <div class="w-full h-full rounded-full bg-[#11141a] p-1 flex items-center justify-center overflow-hidden">
            <img src="${s.thumb}" alt="${s.title}" class="w-full h-full object-contain" />
          </div>
        </div>
        <span class="text-xs font-medium text-zinc-300 truncate max-w-[70px] text-center">${s.title}</span>
      </button>
    `).join('');

    container.querySelectorAll('.story-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-story-idx'), 10);
        this.openStory(idx);
      });
    });
  }

  openStory(idx) {
    if (idx < 0 || idx >= STORIES.length) return;
    this.activeStoryIndex = idx;
    const story = STORIES[idx];
    const modal = document.getElementById('storyModal');
    const content = document.getElementById('storyContent');

    content.innerHTML = `
      <div class="relative w-full h-full bg-[#0a0c10] text-white flex flex-col justify-between p-6 sm:p-8 rounded-3xl border border-white/[0.1] overflow-hidden shadow-2xl">
        <!-- Progress Bar -->
        <div class="flex gap-1.5 w-full mb-4">
          ${STORIES.map((_, i) => `
            <div class="h-1 flex-1 bg-white/20 rounded-full overflow-hidden">
              <div class="h-full bg-white transition-all duration-300 ${i < idx ? 'w-full' : (i === idx ? 'story-progress-active' : 'w-0')}"></div>
            </div>
          `).join('')}
        </div>

        <!-- Story Header -->
        <div class="flex items-center justify-between z-10">
          <div class="flex items-center gap-3">
            <img src="${story.thumb}" class="w-10 h-10 rounded-full border border-white/20 bg-zinc-900 p-0.5 object-contain" />
            <div>
              <div class="text-sm font-bold text-white">${story.title}</div>
              <div class="text-xs text-zinc-400 uppercase tracking-wider">${story.badge}</div>
            </div>
          </div>
          <button type="button" id="closeStoryBtn" class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition">✕</button>
        </div>

        <!-- Story Body -->
        <div class="my-auto text-center py-6 z-10">
          <div class="w-48 h-48 mx-auto mb-6 flex items-center justify-center p-2">
            <img src="${story.thumb}" alt="${story.storyTitle}" class="max-h-full max-w-full object-contain" />
          </div>
          <h2 class="text-2xl sm:text-3xl font-bold text-white mb-3 tracking-tight">${story.storyTitle}</h2>
          <p class="text-sm sm:text-base text-zinc-300 leading-relaxed max-w-md mx-auto">${story.storySubtitle}</p>
        </div>

        <!-- Action Button -->
        <div class="z-10 pt-2">
          <button type="button" id="storyActionBtn" class="w-full py-4 rounded-xl bg-white hover:bg-zinc-200 text-black font-semibold text-sm flex items-center justify-center gap-2 transition">
            ${story.actionText}
          </button>
        </div>
      </div>
    `;

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    document.getElementById('closeStoryBtn').addEventListener('click', () => this.closeStory());

    document.getElementById('storyActionBtn').addEventListener('click', () => {
      this.closeStory();
      if (story.actionTarget === 'openQuiz') {
        document.getElementById('quizSection')?.scrollIntoView({ behavior: 'smooth' });
      } else if (story.actionTarget === 'openBranches') {
        document.getElementById('showroomsSection')?.scrollIntoView({ behavior: 'smooth' });
      } else if (story.actionTarget === 'contactTelegram') {
        openBotLink(botLink('story', null, this.currentLang));
      } else if (story.actionTarget.startsWith('product:')) {
        const pId = story.actionTarget.split(':')[1];
        const prod = PRODUCTS.find(p => p.id === pId);
        if (prod) this.openProductModal(prod);
      }
    });

    clearTimeout(this.storyTimer);
    this.storyTimer = setTimeout(() => {
      if (this.activeStoryIndex < STORIES.length - 1) {
        this.openStory(this.activeStoryIndex + 1);
      } else {
        this.closeStory();
      }
    }, 6000);
  }

  closeStory() {
    clearTimeout(this.storyTimer);
    const modal = document.getElementById('storyModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  }

  /** Closes whichever modal is currently open, for the Telegram BackButton.
   *  Returns true if something was closed, false if the page had nothing
   *  open (so the caller knows to close the Mini App itself instead). */
  closeTopOverlay() {
    const storyModal = document.getElementById('storyModal');
    if (storyModal && !storyModal.classList.contains('hidden')) {
      this.closeStory(); // also clears the story auto-advance timer
      return true;
    }

    const productModal = document.getElementById('productModal');
    if (productModal && !productModal.classList.contains('hidden')) {
      productModal.classList.add('hidden');
      productModal.classList.remove('flex');
      return true;
    }

    return false;
  }

  // --- CATEGORIES ---
  renderCategoryPills() {
    const container = document.getElementById('categoryPills');
    if (!container) return;

    container.innerHTML = CATEGORIES.map(cat => {
      const active = this.activeCategory === cat.slug;
      const title = this.currentLang === 'uz' ? cat.title_uz : (this.currentLang === 'en' ? cat.title_en : cat.title);
      return `
        <button 
          type="button" 
          data-slug="${cat.slug}" 
          class="cat-pill px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider shrink-0 transition-all border ${active ? 'bg-white text-black border-white' : 'bg-zinc-900/80 text-zinc-300 border-zinc-800 hover:border-zinc-600'}"
        >
          ${title}
        </button>
      `;
    }).join('');

    container.querySelectorAll('.cat-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeCategory = btn.getAttribute('data-slug');
        this.renderCategoryPills();
        this.renderProducts();
      });
    });
  }

  // --- SEARCH ---
  setupSearch() {
    const searchInput = document.getElementById('catalogSearch');
    const clearBtn = document.getElementById('clearSearchBtn');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim().toLowerCase();
        if (clearBtn) {
          if (this.searchQuery) clearBtn.classList.remove('hidden');
          else clearBtn.classList.add('hidden');
        }
        this.renderProducts();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        this.searchQuery = '';
        clearBtn.classList.add('hidden');
        this.renderProducts();
      });
    }
  }

  // --- PRODUCTS GRID ---
  renderProducts() {
    const grid = document.getElementById('productsGrid');
    const countBadge = document.getElementById('productsCount');
    if (!grid) return;

    const t = TRANSLATIONS[this.currentLang] || TRANSLATIONS.ru;

    let filtered = PRODUCTS.filter(p => {
      if (this.activeCategory !== 'all' && p.category !== this.activeCategory) {
        return false;
      }
      if (this.searchQuery) {
        const name = p.name.toLowerCase();
        const desc = (p.description || '').toLowerCase();
        const tag = (p.tagline || '').toLowerCase();
        if (!name.includes(this.searchQuery) && !desc.includes(this.searchQuery) && !tag.includes(this.searchQuery)) {
          return false;
        }
      }
      return true;
    });

    if (countBadge) {
      countBadge.textContent = `${filtered.length} моделей`;
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="col-span-full py-16 text-center">
          <div class="text-base font-semibold text-white">Модели не найдены</div>
          <p class="text-sm text-zinc-400 mt-1">Попробуйте изменить категорию или поисковый запрос</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(p => {
      const name = this.currentLang === 'uz' ? (p.name_uz || p.name) : (this.currentLang === 'en' ? (p.name_en || p.name) : p.name);
      const tagline = this.currentLang === 'uz' ? (p.tagline_uz || p.tagline) : (this.currentLang === 'en' ? (p.tagline_en || p.tagline) : p.tagline);
      const formattedPrice = Number(p.price).toLocaleString('ru-RU') + ' сум';

      return `
        <div 
          class="product-card group rounded-2xl bg-[#0e1117] border border-white/[0.06] hover:border-zinc-600 p-4 flex flex-col justify-between transition-all duration-200 cursor-pointer"
          data-product-id="${p.id}"
        >
          <div>
            <div class="relative w-full aspect-square bg-zinc-900/60 rounded-xl p-3 mb-3 flex items-center justify-center overflow-hidden">
              <div class="absolute top-2 left-2 flex flex-col gap-1 z-10">
                ${p.featured ? '<span class="text-[9px] font-bold px-2 py-0.5 rounded bg-white text-black uppercase tracking-wider">Хит</span>' : ''}
              </div>
              <img 
                src="${p.image}" 
                alt="${name}" 
                loading="lazy" 
                class="max-h-full max-w-full object-contain transition-transform duration-200 group-hover:scale-105" 
              />
            </div>

            <div class="text-xs text-zinc-400 font-mono truncate mb-1">${tagline || p.category.toUpperCase()}</div>
            <h3 class="font-semibold text-white text-sm sm:text-base leading-snug line-clamp-2 mb-2">${name}</h3>
          </div>

          <div class="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2 mt-auto">
            <div>
              <div class="font-bold text-white text-sm sm:text-base font-mono">${formattedPrice}</div>
            </div>
            <div class="w-8 h-8 rounded-lg bg-zinc-800 text-zinc-300 group-hover:bg-white group-hover:text-black transition flex items-center justify-center shrink-0">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
              </svg>
            </div>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.product-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-product-id');
        const prod = PRODUCTS.find(p => p.id === id);
        if (prod) this.openProductModal(prod);
      });
    });
  }

  // --- PRODUCT DETAIL MODAL ---
  openProductModal(prod) {
    this.selectedProduct = prod;
    const modal = document.getElementById('productModal');
    const content = document.getElementById('productModalContent');
    const t = TRANSLATIONS[this.currentLang] || TRANSLATIONS.ru;

    const name = this.currentLang === 'uz' ? (prod.name_uz || prod.name) : (this.currentLang === 'en' ? (prod.name_en || prod.name) : prod.name);
    const desc = this.currentLang === 'uz' ? (prod.description_uz || prod.description) : (this.currentLang === 'en' ? (prod.description_en || prod.description) : prod.description);
    const formattedPrice = Number(prod.price).toLocaleString('ru-RU') + ' сум';

    // Opens the AI consultant already knowing which model the customer is on.
    const tgUrl = botLink('card', prod.id, this.currentLang);

    content.innerHTML = `
      <div class="relative bg-[#0e1117] border border-white/[0.1] text-white rounded-3xl p-6 sm:p-8 max-h-[85vh] overflow-y-auto shadow-2xl">
        <button type="button" id="closeProductModalBtn" class="absolute top-4 right-4 w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center z-10 transition">
          ✕
        </button>

        <div class="w-full aspect-video sm:aspect-[2/1] bg-zinc-900/60 rounded-2xl p-4 mb-6 flex items-center justify-center relative">
          <img src="${prod.image}" alt="${name}" class="max-h-full max-w-full object-contain" />
        </div>

        <div class="mb-4">
          <div class="text-xs font-mono uppercase tracking-widest text-zinc-400 mb-1">${prod.category}</div>
          <h2 class="text-2xl sm:text-3xl font-bold text-white tracking-tight">${name}</h2>
          <div class="text-2xl sm:text-3xl font-bold text-white font-mono mt-2">${formattedPrice}</div>
        </div>

        <p class="text-sm sm:text-base text-zinc-300 leading-relaxed mb-6 bg-zinc-900/60 border border-white/[0.04] rounded-xl p-4">
          ${desc || 'Официальное сертифицированное устройство Garmin с гарантией 1 год.'}
        </p>

        <div class="mb-6">
          <h3 class="text-xs uppercase tracking-wider font-semibold text-zinc-400 mb-3">Характеристики</h3>
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="bg-zinc-900 border border-white/[0.04] rounded-xl p-3.5">
              <div class="text-zinc-400 text-xs">${t.specBattery}</div>
              <div class="font-semibold text-white mt-0.5">${prod.specs.battery}</div>
            </div>
            <div class="bg-zinc-900 border border-white/[0.04] rounded-xl p-3.5">
              <div class="text-zinc-400 text-xs">${t.specDisplay}</div>
              <div class="font-semibold text-white mt-0.5">${prod.specs.display}</div>
            </div>
            <div class="bg-zinc-900 border border-white/[0.04] rounded-xl p-3.5">
              <div class="text-zinc-400 text-xs">${t.specWater}</div>
              <div class="font-semibold text-white mt-0.5">${prod.specs.waterRating}</div>
            </div>
            <div class="bg-zinc-900 border border-white/[0.04] rounded-xl p-3.5">
              <div class="text-zinc-400 text-xs">${t.specGps}</div>
              <div class="font-semibold text-white mt-0.5">${prod.specs.gps}</div>
            </div>
          </div>
        </div>

        <div class="mb-8">
          <h3 class="text-xs uppercase tracking-wider font-semibold text-zinc-400 mb-3">Особенности модели</h3>
          <div class="flex flex-wrap gap-2">
            ${(prod.specs.keyFeatures || []).map(f => `
              <span class="text-xs px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300">
                ${f}
              </span>
            `).join('')}
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sticky bottom-0 bg-[#0e1117]/95 backdrop-blur pt-3 border-t border-white/[0.08]">
          <a 
            href="${tgUrl}" 
            target="_blank" 
            rel="noopener noreferrer" 
            class="py-4 px-6 rounded-xl bg-white hover:bg-zinc-200 text-black font-semibold text-sm flex items-center justify-center gap-2 transition"
          >
            <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
            ${t.orderViaTelegram}
          </a>
          <a 
            href="tel:${APP_CONFIG.phoneClean}" 
            class="py-4 px-6 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-sm border border-zinc-700 flex items-center justify-center gap-2 transition"
          >
            ${t.quickCallBtn}
          </a>
        </div>
      </div>
    `;

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    document.getElementById('closeProductModalBtn').addEventListener('click', () => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
  }

  // --- SHOWROOMS ---
  renderShowrooms() {
    const container = document.getElementById('showroomsGrid');
    if (!container) return;
    const t = TRANSLATIONS[this.currentLang] || TRANSLATIONS.ru;

    container.innerHTML = BRANCHES.map(b => `
      <div class="bg-[#0e1117] border border-white/[0.08] rounded-2xl p-5 sm:p-6 flex flex-col justify-between shadow-xl">
        <div>
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-bold text-white text-base sm:text-lg">${b.name}</h3>
            <span class="text-xs text-zinc-400 font-mono">10:00 — 20:00</span>
          </div>
          <div class="space-y-2 text-sm text-zinc-300 mb-6">
            <div class="flex items-start gap-2.5">
              <span class="text-zinc-500 shrink-0">Адрес:</span>
              <span>${b.address}</span>
            </div>
            <div class="flex items-center gap-2.5">
              <span class="text-zinc-500 shrink-0">Телефон:</span>
              <a href="tel:${b.phone.replace(/[^0-9+]/g, '')}" class="text-white hover:underline font-mono">${b.phone}</a>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2.5 pt-4 border-t border-white/[0.06]">
          <a 
            href="${b.map_url}" 
            target="_blank" 
            rel="noopener noreferrer" 
            class="py-2.5 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-xs text-center border border-zinc-700 transition"
          >
            ${t.showOnYandex}
          </a>
          <a 
            href="tel:${b.phone.replace(/[^0-9+]/g, '')}" 
            class="py-2.5 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-xs text-center border border-zinc-700 transition"
          >
            ${t.callShowroom}
          </a>
        </div>
      </div>
    `).join('');
  }

  // --- FAQ ---
  renderFaq() {
    const container = document.getElementById('faqAccordion');
    if (!container) return;

    container.innerHTML = FAQ_DATA.map((item, idx) => {
      const q = this.currentLang === 'uz' ? item.q_uz : (this.currentLang === 'en' ? item.q_en : item.q_ru);
      const a = this.currentLang === 'uz' ? item.a_uz : (this.currentLang === 'en' ? item.a_en : item.a_ru);

      return `
        <div class="faq-item border border-white/[0.08] bg-[#0e1117] rounded-2xl overflow-hidden transition-all">
          <button type="button" class="faq-toggle w-full p-4 sm:p-5 flex items-center justify-between text-left font-medium text-sm sm:text-base text-white hover:text-zinc-200 transition">
            <span>${q}</span>
            <svg class="faq-icon w-4 h-4 text-zinc-400 shrink-0 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
            </svg>
          </button>
          <div class="faq-content hidden px-4 sm:px-5 pb-4 sm:pb-5 text-sm text-zinc-300 leading-relaxed border-t border-white/[0.04] pt-3">
            ${a}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.faq-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        const content = item.querySelector('.faq-content');
        const icon = item.querySelector('.faq-icon');
        const isHidden = content.classList.contains('hidden');

        container.querySelectorAll('.faq-content').forEach(c => c.classList.add('hidden'));
        container.querySelectorAll('.faq-icon').forEach(i => i.classList.remove('rotate-180'));

        if (isHidden) {
          content.classList.remove('hidden');
          icon.classList.add('rotate-180');
        }
      });
    });
  }

  setupModals() {
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.add('hidden');
          modal.classList.remove('flex');
        }
      });
    });
  }

  setupQuickLinks() {
    document.querySelectorAll('[data-scroll-to]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = btn.getAttribute('data-scroll-to');
        document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.garminApp = new GarminApp();
});
