// Battery & Solar Autonomy Simulator (Clean & Minimal)
import { TRANSLATIONS } from './data.js';

export class BatterySimulator {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.sunHours = 3;
    this.gpsHours = 1;
    this.lang = 'ru';
  }

  setLanguage(lang) {
    this.lang = lang;
    this.render();
  }

  calculateEstimates() {
    const fenixSolar = Math.min(48, Math.max(12, Math.round(28 + (this.sunHours * 3.5) - (this.gpsHours * 4))));
    const instinctAmoled = Math.min(28, Math.max(7, Math.round(20 + (this.sunHours * 0.5) - (this.gpsHours * 2.8))));
    const epixPro = Math.min(31, Math.max(6, Math.round(16 - (this.gpsHours * 2.5))));
    const forerunner = Math.min(23, Math.max(5, Math.round(15 - (this.gpsHours * 2.2))));
    const venu = Math.min(14, Math.max(4, Math.round(10 - (this.gpsHours * 1.5))));

    return [
      { name: 'fēnix 8 Solar (Power Glass)', days: fenixSolar, max: 48, note: 'Солнечная подзарядка активна' },
      { name: 'Instinct 3 AMOLED', days: instinctAmoled, max: 28, note: 'Усиленная батарея' },
      { name: 'Epix Pro 51mm AMOLED', days: epixPro, max: 31, note: 'Сапфировый AMOLED' },
      { name: 'Forerunner 970', days: forerunner, max: 23, note: 'Спортивный смарт-режим' },
      { name: 'Venu 3', days: venu, max: 14, note: 'Повседневный режим' }
    ];
  }

  render() {
    if (!this.container) return;
    const t = TRANSLATIONS[this.lang] || TRANSLATIONS.ru;
    const estimates = this.calculateEstimates();

    let html = `
      <div class="bg-[#0e1117] border border-white/[0.08] rounded-2xl p-5 sm:p-7 shadow-xl">
        <h3 class="text-xl sm:text-2xl font-semibold text-white tracking-tight mb-1">${t.batteryTitle}</h3>
        <p class="text-sm text-zinc-400 mb-6">Интерактивный расчет времени работы в зависимости от условий использования</p>

        <!-- Sliders -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-8 bg-zinc-900/60 border border-white/[0.06] rounded-xl p-5">
          <div>
            <div class="flex justify-between items-center text-sm font-medium mb-2.5">
              <span class="text-zinc-200">${t.sunlightExposure}</span>
              <span class="text-white font-mono text-sm" id="sunVal">${this.sunHours} ч/день</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="6" 
              step="0.5" 
              value="${this.sunHours}" 
              id="sunSlider" 
              class="w-full accent-white cursor-pointer h-1.5 bg-zinc-700 rounded-lg"
            />
            <div class="flex justify-between text-xs text-zinc-500 mt-1.5">
              <span>0 ч (В помещении)</span>
              <span>3 ч (Город)</span>
              <span>6 ч (Активный отдых)</span>
            </div>
          </div>

          <div>
            <div class="flex justify-between items-center text-sm font-medium mb-2.5">
              <span class="text-zinc-200">${t.gpsUsageHours}</span>
              <span class="text-white font-mono text-sm" id="gpsVal">${this.gpsHours} ч/день</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="4" 
              step="0.5" 
              value="${this.gpsHours}" 
              id="gpsSlider" 
              class="w-full accent-white cursor-pointer h-1.5 bg-zinc-700 rounded-lg"
            />
            <div class="flex justify-between text-xs text-zinc-500 mt-1.5">
              <span>0 ч (Смарт-режим)</span>
              <span>1 ч (Ежедневный бег)</span>
              <span>4 ч (Длительные походы)</span>
            </div>
          </div>
        </div>

        <!-- Progress List -->
        <div class="space-y-4">
          ${estimates.map(item => {
            const pct = Math.round((item.days / 48) * 100);
            return `
              <div>
                <div class="flex justify-between items-center text-sm font-medium mb-1.5">
                  <span class="text-white">${item.name}</span>
                  <span class="text-white font-mono font-bold">${item.days} ${t.days}</span>
                </div>
                <div class="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                  <div 
                    class="h-2 rounded-full bg-white transition-all duration-300" 
                    style="width: ${pct}%"
                  ></div>
                </div>
                <div class="text-xs text-zinc-500 mt-1">${item.note}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    this.container.innerHTML = html;

    const sunSlider = this.container.querySelector('#sunSlider');
    const gpsSlider = this.container.querySelector('#gpsSlider');

    sunSlider.addEventListener('input', (e) => {
      this.sunHours = parseFloat(e.target.value);
      this.render();
    });

    gpsSlider.addEventListener('input', (e) => {
      this.gpsHours = parseFloat(e.target.value);
      this.render();
    });
  }
}
