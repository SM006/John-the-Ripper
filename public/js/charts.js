// ── Speed Comparison Chart ─────────────────────────

export class SpeedChart {
  constructor(canvas) {
    const ctx = canvas.getContext('2d');

    this.data = {
      labels: ['MD5', 'SHA-256', 'bcrypt'],
      datasets: [{
        label: 'Passwords / Second',
        data: [0, 0, 0],
        backgroundColor: [
          'rgba(59, 130, 246, 0.7)',   // blue
          'rgba(139, 92, 246, 0.7)',   // purple
          'rgba(20, 184, 166, 0.7)',   // teal
        ],
        borderColor: [
          'rgba(59, 130, 246, 1)',
          'rgba(139, 92, 246, 1)',
          'rgba(20, 184, 166, 1)',
        ],
        borderWidth: 1,
        borderRadius: 6,
        barPercentage: 0.6,
      }]
    };

    this.chart = new Chart(ctx, {
      type: 'bar',
      data: this.data,
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 1200, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#111119',
            titleFont: { family: 'Inter', weight: 600 },
            bodyFont: { family: 'JetBrains Mono', size: 12 },
            borderColor: '#252532',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: ctx => `${formatSpeed(ctx.raw)} p/s`
            }
          }
        },
        scales: {
          x: {
            type: 'logarithmic',
            min: 1,
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: {
              color: '#6b6b80',
              font: { family: 'JetBrains Mono', size: 10 },
              callback: v => formatSpeed(v)
            }
          },
          y: {
            grid: { display: false },
            ticks: {
              color: '#e8e8ed',
              font: { family: 'JetBrains Mono', size: 12, weight: 500 }
            }
          }
        }
      }
    });
  }

  update(algorithm, speed) {
    const idx = { md5: 0, sha256: 1, bcrypt: 2 }[algorithm];
    if (idx === undefined) return;
    this.data.datasets[0].data[idx] = speed || 1; // min 1 for log scale
    this.chart.update();
  }

  reset() {
    this.data.datasets[0].data = [0, 0, 0];
    this.chart.update();
  }
}

export function formatSpeed(val) {
  if (!val || val <= 0) return '—';
  if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return (val / 1000).toFixed(1) + 'K';
  return Math.round(val).toString();
}

export function animateCounter(el, target, duration = 1500) {
  const start = performance.now();
  const from = 0;

  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(from + (target - from) * eased);
    el.textContent = formatSpeed(current) + ' p/s';

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = formatSpeed(target) + ' p/s';
    }
  }

  requestAnimationFrame(tick);
}
