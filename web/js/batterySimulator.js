// Battery & Solar Autonomy Simulator (Clean & Minimal)
import { tr } from './i18n.js';

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
    const t = tr(this.lang);
    const fenixSolar = Math.min(48, Math.max(12, Math.round(28 + (this.sunHours * 3.5) - (this.gpsHours * 4))));
    const instinctAmoled = Math.min(28, Math.max(7, Math.round(20 + (this.sunHours * 0.5) - (this.gpsHours * 2.8))));
    const epixPro = Math.min(31, Math.max(6, Math.round(16 - (this.gpsHours * 2.5))));
    const forerunner = Math.min(23, Math.max(5, Math.round(15 - (this.gpsHours * 2.2))));
    const venu = Math.min(14, Math.max(4, Math.round(10 - (this.gpsHours * 1.5))));

    return [
      { name: 'fēnix 8 Solar (Power Glass)', days: fenixSolar, max: 48, note: t.noteSolar },
      { name: 'Instinct 3 AMOLED', days: instinctAmoled, max: 28, note: t.noteBattery },
      { name: 'Epix Pro 51mm AMOLED', days: epixPro, max: 31, note: t.noteSapphire },
      { name: 'Forerunner 970', days: forerunner, max: 23, note: t.noteSport },
      { name: 'Venu 3', days: venu, max: 14, note: t.noteDaily }
    ];
  }

  /** Tick labels under a slider: a 3-column grid (left / centre / right) so
   *  long labels wrap inside their own column instead of running into each
   *  other on narrow phones. */
  ticks(labels) {
    const align = ['text-left', 'text-center', 'text-right'];
    return `
      <div class="grid grid-cols-3 gap-1.5 text-xs text-zinc-500 mt-1.5">
        ${labels.map((label, i) => `<span class="${align[i]} min-w-0 break-words hyphens-auto">${label}</span>`).join('')}
      </div>
    `;
  }

  render() {
    if (!this.container) return;
    const t = tr(this.lang);
    const estimates = this.calculateEstimates();

    let html = `
      <div class="bg-[#0e1117] border border-white/[0.08] rounded-2xl p-5 sm:p-7 shadow-xl">
        <h3 class="text-xl sm:text-2xl font-semibold text-white tracking-tight mb-1">${t.batteryTitle}</h3>
        <p class="text-sm text-zinc-400 mb-6">${t.batteryIntro}</p>

        <!-- Sliders -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-8 bg-zinc-900/60 border border-white/[0.06] rounded-xl p-5">
          <div>
            <div class="flex justify-between items-center gap-3 text-sm font-medium mb-2.5">
              <span class="text-zinc-200">${t.sunlightExposure}</span>
              <span class="text-white font-mono text-sm whitespace-nowrap shrink-0" id="sunVal">${this.sunHours} ${t.hoursPerDay}</span>
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
            ${this.ticks([`0 ${t.hoursShort} (${t.sunTickLow})`, `3 ${t.hoursShort} (${t.sunTickMid})`, `6 ${t.hoursShort} (${t.sunTickHigh})`])}
          </div>

          <div>
            <div class="flex justify-between items-center gap-3 text-sm font-medium mb-2.5">
              <span class="text-zinc-200">${t.gpsUsageHours}</span>
              <span class="text-white font-mono text-sm whitespace-nowrap shrink-0" id="gpsVal">${this.gpsHours} ${t.hoursPerDay}</span>
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
            ${this.ticks([`0 ${t.hoursShort} (${t.gpsTickLow})`, `1 ${t.hoursShort} (${t.gpsTickMid})`, `4 ${t.hoursShort} (${t.gpsTickHigh})`])}
          </div>
        </div>

        <!-- Progress List -->
        <div class="space-y-4">
          ${estimates.map((item, i) => `
              <div>
                <div class="flex justify-between items-center gap-3 text-sm font-medium mb-1.5">
                  <span class="text-white">${item.name}</span>
                  <span class="text-white font-mono font-bold whitespace-nowrap shrink-0" data-est-days="${i}">${item.days} ${t.days}</span>
                </div>
                <div class="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                  <div
                    class="h-2 rounded-full bg-white transition-all duration-300"
                    data-est-bar="${i}"
                    style="width: ${this.percent(item.days)}%"
                  ></div>
                </div>
                <div class="text-xs text-zinc-500 mt-1">${item.note}</div>
              </div>
            `).join('')}
        </div>
      </div>
    `;

    this.container.innerHTML = html;

    // Update in place on input. Re-rendering the whole block (as this used to)
    // replaced the <input> the finger was dragging, so every drag stopped
    // after one step on phones.
    this.container.querySelector('#sunSlider').addEventListener('input', (e) => {
      this.sunHours = parseFloat(e.target.value);
      this.update();
    });

    this.container.querySelector('#gpsSlider').addEventListener('input', (e) => {
      this.gpsHours = parseFloat(e.target.value);
      this.update();
    });
  }

  percent(days) {
    return Math.round((days / 48) * 100);
  }

  update() {
    if (!this.container) return;
    const t = tr(this.lang);
    this.container.querySelector('#sunVal').textContent = `${this.sunHours} ${t.hoursPerDay}`;
    this.container.querySelector('#gpsVal').textContent = `${this.gpsHours} ${t.hoursPerDay}`;
    this.calculateEstimates().forEach((item, i) => {
      const days = this.container.querySelector(`[data-est-days="${i}"]`);
      const bar = this.container.querySelector(`[data-est-bar="${i}"]`);
      if (days) days.textContent = `${item.days} ${t.days}`;
      if (bar) bar.style.width = `${this.percent(item.days)}%`;
    });
  }
}
