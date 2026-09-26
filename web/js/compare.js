// Flagship Comparison Matrix Tool (Clean & Minimal)
import { FLAGSHIP_COMPARISON, PRODUCTS } from './data.js';
import { botLink } from './telegram.js';
import { formatPrice, tr } from './i18n.js';

/**
 * The comparison table keeps its own hand-written price strings, and they had
 * drifted from the catalog (Epix Pro showed 16 500 000 here but 14 500 000 on
 * its card and in the bot). The catalog is the source of truth; the table's
 * own string is only a fallback for a model the catalog doesn't carry.
 */
function priceFor(watch, lang) {
  const product = PRODUCTS.find((p) => p.id === watch.id);
  return product ? formatPrice(product.price, lang) : watch.price;
}

export class GarminComparator {
  constructor(containerId, onOrderProduct) {
    this.container = document.getElementById(containerId);
    this.onOrderProduct = onOrderProduct;
    this.selectedIds = ['fenix-8', 'forerunner-970', 'instinct-3-amoled'];
    this.lang = 'ru';
  }

  setLanguage(lang) {
    this.lang = lang;
    this.render();
  }

  toggleProduct(id) {
    if (this.selectedIds.includes(id)) {
      if (this.selectedIds.length > 2) {
        this.selectedIds = this.selectedIds.filter(x => x !== id);
      }
    } else {
      if (this.selectedIds.length >= 3) {
        this.selectedIds.shift();
      }
      this.selectedIds.push(id);
    }
    this.render();
  }

  render() {
    if (!this.container) return;
    const t = tr(this.lang);
    const activeWatches = FLAGSHIP_COMPARISON.filter(w => this.selectedIds.includes(w.id));

    let html = `
      <div class="bg-[#0e1117] border border-white/[0.08] rounded-2xl p-5 sm:p-7 shadow-xl">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h3 class="text-xl sm:text-2xl font-semibold text-white tracking-tight">${t.compareTitle}</h3>
            <p class="text-sm text-zinc-400 mt-0.5">${t.compareHint}</p>
          </div>
          <!-- Watch Selector Pills -->
          <div class="flex flex-wrap gap-1.5">
            ${FLAGSHIP_COMPARISON.map(w => {
              const active = this.selectedIds.includes(w.id);
              return `
                <button 
                  type="button" 
                  data-id="${w.id}" 
                  class="compare-pill px-3 py-1.5 rounded-lg text-xs font-medium transition border ${active ? 'bg-white text-black border-white' : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-600'}"
                >
                  ${w.name}
                </button>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Table Container -->
        <div class="overflow-x-auto pb-2 -mx-5 sm:mx-0 px-5 sm:px-0">
          <table class="w-full min-w-[540px] text-left text-sm border-collapse">
            <thead>
              <tr class="border-b border-white/[0.08]">
                <th class="p-3.5 text-zinc-400 font-medium w-1/4">${t.cmpModel}</th>
                ${activeWatches.map(w => `
                  <th class="p-3.5 text-center w-${Math.floor(75 / activeWatches.length)}%">
                    <div class="w-20 h-20 mx-auto mb-2.5 flex items-center justify-center p-1">
                      <img src="${w.image}" alt="${w.name}" class="max-h-full max-w-full object-contain" />
                    </div>
                    <div class="font-bold text-white text-sm sm:text-base">${w.name}</div>
                    <div class="text-xs text-zinc-400 font-mono mt-1">${priceFor(w, this.lang)}</div>
                  </th>
                `).join('')}
              </tr>
            </thead>
            <tbody class="divide-y divide-white/[0.04]">
              <tr>
                <td class="p-3.5 text-zinc-400 font-medium text-xs uppercase">${t.cmpDisplay}</td>
                ${activeWatches.map(w => `<td class="p-3.5 text-center text-zinc-200">${w.display}</td>`).join('')}
              </tr>
              <tr class="bg-white/[0.01]">
                <td class="p-3.5 text-zinc-400 font-medium text-xs uppercase">${t.cmpBattery}</td>
                ${activeWatches.map(w => `<td class="p-3.5 text-center text-white font-semibold">${w.battery}</td>`).join('')}
              </tr>
              <tr>
                <td class="p-3.5 text-zinc-400 font-medium text-xs uppercase">${t.cmpGps}</td>
                ${activeWatches.map(w => `<td class="p-3.5 text-center text-zinc-200">${w.gps}</td>`).join('')}
              </tr>
              <tr class="bg-white/[0.01]">
                <td class="p-3.5 text-zinc-400 font-medium text-xs uppercase">${t.cmpWater}</td>
                ${activeWatches.map(w => `<td class="p-3.5 text-center text-zinc-200">${w.water}</td>`).join('')}
              </tr>
              <tr>
                <td class="p-3.5 text-zinc-400 font-medium text-xs uppercase">${t.cmpMaps}</td>
                ${activeWatches.map(w => `<td class="p-3.5 text-center text-zinc-200">${w.maps}</td>`).join('')}
              </tr>
              <tr class="bg-white/[0.01]">
                <td class="p-3.5 text-zinc-400 font-medium text-xs uppercase">${t.cmpMic}</td>
                ${activeWatches.map(w => `<td class="p-3.5 text-center text-zinc-200">${w.mic}</td>`).join('')}
              </tr>
              <tr>
                <td class="p-3.5 text-zinc-400 font-medium text-xs uppercase">${t.cmpPay}</td>
                ${activeWatches.map(w => `<td class="p-3.5 text-center text-white font-medium">${w.pay}</td>`).join('')}
              </tr>
              <tr class="bg-white/[0.01]">
                <td class="p-3.5 text-zinc-400 font-medium text-xs uppercase">${t.cmpBestFor}</td>
                ${activeWatches.map(w => `<td class="p-3.5 text-center text-zinc-300 text-xs leading-relaxed">${w.bestFor}</td>`).join('')}
              </tr>
              <tr>
                <td class="p-3.5 text-zinc-400 font-medium text-xs uppercase">${t.cmpOrder}</td>
                ${activeWatches.map(w => {
                  const tgUrl = botLink('cmp', w.id, this.lang);
                  return `
                    <td class="p-3.5 text-center">
                      <a href="${tgUrl}" target="_blank" rel="noopener noreferrer" class="inline-block py-2 px-4 rounded-lg bg-white hover:bg-zinc-200 text-black font-semibold text-xs transition">
                        ${t.cmpOrderBtn}
                      </a>
                    </td>
                  `;
                }).join('')}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    this.container.innerHTML = html;

    this.container.querySelectorAll('.compare-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const id = pill.getAttribute('data-id');
        this.toggleProduct(id);
      });
    });
  }
}
