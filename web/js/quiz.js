// "Find Your Garmin" Minimal Interactive Recommendation Engine
import { QUIZ_DATA, PRODUCTS } from './data.js';
import { botLink } from './telegram.js';
import { formatPrice, tr } from './i18n.js';

export class GarminQuiz {
  constructor(containerId, onSelectProduct) {
    this.container = document.getElementById(containerId);
    this.onSelectProduct = onSelectProduct;
    this.currentStep = 0;
    this.answers = {};
    this.lang = 'ru';
  }

  setLanguage(lang) {
    this.lang = lang;
    this.render();
  }

  start() {
    this.currentStep = 0;
    this.answers = {};
    this.render();
  }

  selectOption(stepId, optionKey) {
    this.answers[stepId] = optionKey;
    if (this.currentStep < QUIZ_DATA.questions.length - 1) {
      this.currentStep++;
      this.render();
    } else {
      this.renderResults();
    }
  }

  prevStep() {
    if (this.currentStep > 0) {
      this.currentStep--;
      this.render();
    }
  }

  calculateMatches() {
    const activity = this.answers.activity || 'running';
    const feature = this.answers.feature || 'battery';
    const budget = this.answers.budget || 'mid';

    // Accessories (heart-rate straps, sensors) are never "your watch".
    const scored = PRODUCTS.filter(p => p.category !== 'accessories').map(p => {
      let score = 0;
      const name = p.name.toLowerCase();
      const price = p.price;

      if (activity === 'running' && (p.category === 'running' || name.includes('forerunner') || name.includes('fenix'))) score += 40;
      if (activity === 'outdoor' && (p.category === 'outdoor' || name.includes('fenix') || name.includes('instinct') || name.includes('tactix') || name.includes('enduro'))) score += 40;
      if (activity === 'fitness' && (p.category === 'fitness' || name.includes('venu') || name.includes('vivoactive') || name.includes('lily'))) score += 40;
      if (activity === 'cycling' && (p.category === 'cycling' || name.includes('edge') || name.includes('varia') || name.includes('forerunner'))) score += 40;
      if (activity === 'marine' && (p.category === 'marine' || name.includes('descent') || name.includes('striker'))) score += 40;

      if (feature === 'battery' && (name.includes('solar') || name.includes('enduro') || name.includes('instinct') || name.includes('fenix 8'))) score += 30;
      if (feature === 'amoled' && (name.includes('amoled') || name.includes('venu') || name.includes('epix') || name.includes('fenix 8') || name.includes('265') || name.includes('970') || name.includes('570'))) score += 30;
      if (feature === 'maps' && (name.includes('fenix') || name.includes('epix') || name.includes('forerunner 9') || name.includes('edge') || name.includes('gpsmap'))) score += 30;
      if (feature === 'style' && (name.includes('lily') || name.includes('venu') || name.includes('vivoactive') || name.includes('vivosmart'))) score += 30;

      if (budget === 'entry') {
        if (price <= 6500000) score += 30;
        else if (price <= 9000000) score += 10;
        else score -= 20;
      } else if (budget === 'mid') {
        if (price >= 5500000 && price <= 14500000) score += 30;
        else if (price < 5500000) score += 15;
        else score += 10;
      } else if (budget === 'flagship') {
        if (price >= 13500000) score += 35;
        else score += 10;
      }

      if (p.featured) score += 10;
      return { product: p, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 3).map(s => s.product);
  }

  render() {
    if (!this.container) return;
    const t = tr(this.lang);
    const questions = QUIZ_DATA.questions;
    const currentQ = questions[this.currentStep];
    const progressPct = Math.round(((this.currentStep + 1) / questions.length) * 100);
    const title = this.lang === 'uz' ? currentQ.title_uz : (this.lang === 'en' ? currentQ.title_en : currentQ.title);

    let html = `
      <div class="rounded-2xl bg-[#0e1117] border border-white/[0.08] p-5 sm:p-7 shadow-xl">
        <!-- Progress Bar -->
        <div class="flex items-center justify-between mb-3 text-xs">
          <span class="font-medium tracking-wide text-zinc-400">
            ${t.quizStep} ${this.currentStep + 1} ${t.quizOf} ${questions.length}
          </span>
          <span class="font-mono text-zinc-400">${progressPct}%</span>
        </div>
        <div class="w-full bg-zinc-800/80 rounded-full h-1 mb-6 overflow-hidden">
          <div class="bg-cyan-400 h-1 rounded-full transition-all duration-300" style="width: ${progressPct}%"></div>
        </div>

        <!-- Question Title -->
        <h3 class="text-xl sm:text-2xl font-semibold text-white mb-6 tracking-tight leading-snug">
          ${title}
        </h3>

        <!-- Options List -->
        <div class="space-y-2.5 mb-6">
          ${currentQ.options.map(opt => {
            const label = this.lang === 'uz' ? opt.label_uz : (this.lang === 'en' ? opt.label_en : opt.label);
            const isSelected = this.answers[currentQ.id] === opt.key;
            return `
              <button 
                type="button"
                data-step="${currentQ.id}" 
                data-key="${opt.key}" 
                class="quiz-option-btn w-full p-4 rounded-xl flex items-center justify-between text-left transition-all border ${isSelected ? 'bg-cyan-500/10 border-cyan-400 text-white' : 'bg-zinc-900/60 border-white/[0.06] text-zinc-200 hover:border-zinc-700 hover:bg-zinc-900'}"
              >
                <div class="flex items-center gap-3.5">
                  <div class="w-4 h-4 rounded-full border ${isSelected ? 'border-cyan-400 bg-cyan-400' : 'border-zinc-600'} flex items-center justify-center shrink-0">
                    ${isSelected ? '<div class="w-1.5 h-1.5 rounded-full bg-black"></div>' : ''}
                  </div>
                  <span class="text-sm sm:text-base font-medium">${label}</span>
                </div>
                <svg class="w-4 h-4 text-zinc-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                </svg>
              </button>
            `;
          }).join('')}
        </div>

        <!-- Navigation Controls -->
        <div class="flex items-center justify-between pt-3 border-t border-white/[0.06]">
          ${this.currentStep > 0 ? `
            <button type="button" class="quiz-prev-btn text-xs font-medium text-zinc-400 hover:text-white transition flex items-center gap-1">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
              ${t.quizPrev}
            </button>
          ` : '<div></div>'}
          <span class="text-xs text-zinc-500">Garmin Selector</span>
        </div>
      </div>
    `;

    this.container.innerHTML = html;

    this.container.querySelectorAll('.quiz-option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const step = btn.getAttribute('data-step');
        const key = btn.getAttribute('data-key');
        this.selectOption(step, key);
      });
    });

    const prevBtn = this.container.querySelector('.quiz-prev-btn');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => this.prevStep());
    }
  }

  renderResults() {
    const t = tr(this.lang);
    const topMatches = this.calculateMatches();
    const primary = topMatches[0] || PRODUCTS[0];
    const alternates = topMatches.slice(1);

    const name = this.lang === 'uz' ? (primary.name_uz || primary.name) : (this.lang === 'en' ? (primary.name_en || primary.name) : primary.name);
    const desc = this.lang === 'uz' ? (primary.description_uz || primary.description) : (this.lang === 'en' ? (primary.description_en || primary.description) : primary.description);
    const formattedPrice = formatPrice(primary.price, this.lang);

    // The bot greets the customer with the model the quiz recommended.
    const tgUrl = botLink('quiz', primary.id, this.lang);

    let html = `
      <div class="rounded-2xl bg-[#0e1117] border border-white/[0.08] p-5 sm:p-7 shadow-xl">
        <div class="flex items-center justify-between mb-4">
          <div class="text-xs font-semibold uppercase tracking-wider text-cyan-400">
            ${t.quizResultTitle}
          </div>
          <button type="button" class="quiz-restart-btn text-xs text-zinc-400 hover:text-white transition">
            ${t.quizRestart}
          </button>
        </div>

        <h2 class="text-2xl sm:text-3xl font-bold text-white mb-5 tracking-tight break-words">${name}</h2>

        <!-- Featured Result Card -->
        <div class="bg-zinc-900/80 border border-white/[0.06] rounded-xl p-5 mb-5 flex flex-col sm:flex-row items-center gap-5">
          <div class="w-36 h-36 sm:w-40 sm:h-40 shrink-0 flex items-center justify-center p-2">
            <img src="${primary.image}" alt="${name}" class="max-h-full max-w-full object-contain" />
          </div>
          <div class="flex-1 text-center sm:text-left">
            <div class="text-2xl sm:text-3xl font-bold text-white font-mono mb-2">${formattedPrice}</div>
            <p class="text-sm text-zinc-300 leading-relaxed line-clamp-3 mb-4">${desc}</p>
            <div class="flex flex-wrap gap-2 justify-center sm:justify-start">
              ${(primary.specs.keyFeatures || []).slice(0, 3).map(f => `
                <span class="text-xs px-2.5 py-1 rounded bg-zinc-800 text-zinc-300 border border-zinc-700/50">${f}</span>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Action CTAs -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <a href="${tgUrl}" target="_blank" rel="noopener noreferrer" class="w-full py-3.5 px-4 rounded-xl bg-white hover:bg-zinc-200 text-black font-semibold text-center text-sm flex items-center justify-center gap-2 transition">
            <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
            ${t.orderViaTelegram}
          </a>
          <button type="button" class="quiz-view-details-btn w-full py-3.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-center text-sm border border-zinc-700 transition">
            ${t.viewDetails}
          </button>
        </div>

        ${alternates.length > 0 ? `
          <div class="border-t border-white/[0.06] pt-4">
            <h4 class="text-xs uppercase tracking-wider text-zinc-400 font-semibold mb-3">${t.quizAlternatives}</h4>
            <div class="grid grid-cols-2 gap-2.5">
              ${alternates.map(alt => `
                <!-- On phones the thumbnail shrinks (and hides below 360px) so an
                     8-digit price fits inside the card instead of spilling out. -->
                <div class="quiz-alt-card bg-zinc-900/60 border border-white/[0.06] hover:border-zinc-600 rounded-xl p-2.5 sm:p-3 flex items-center gap-2 sm:gap-3 cursor-pointer transition" data-id="${alt.id}">
                  <img src="${alt.image}" alt="${alt.name}" loading="lazy" class="hidden min-[360px]:block w-10 h-10 sm:w-12 sm:h-12 object-contain shrink-0" />
                  <div class="min-w-0">
                    <div class="text-xs sm:text-sm font-semibold text-white truncate">${this.lang === 'uz' ? (alt.name_uz || alt.name) : alt.name}</div>
                    <div class="text-[11px] sm:text-xs text-zinc-400 font-mono mt-0.5">${formatPrice(alt.price, this.lang)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    this.container.innerHTML = html;

    this.container.querySelector('.quiz-restart-btn').addEventListener('click', () => this.start());

    this.container.querySelector('.quiz-view-details-btn').addEventListener('click', () => {
      if (this.onSelectProduct) this.onSelectProduct(primary);
    });

    this.container.querySelectorAll('.quiz-alt-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        const altProd = PRODUCTS.find(p => p.id === id);
        if (altProd && this.onSelectProduct) this.onSelectProduct(altProd);
      });
    });
  }
}
