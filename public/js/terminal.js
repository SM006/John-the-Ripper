// ── Terminal Component ─────────────────────────────
// Renders john the ripper output with basic ANSI color support

const ANSI_MAP = {
  '\x1b[31m': 't-red',
  '\x1b[32m': 't-green',
  '\x1b[33m': 't-yellow',
  '\x1b[36m': 't-cyan',
  '\x1b[90m': 't-dim',
  '\x1b[1m':  't-bold',
  '\x1b[0m':  null, // reset
};

const ANSI_REGEX = /\x1b\[\d+m/g;

export class Terminal {
  constructor(outputEl, bodyEl) {
    this.output = outputEl;
    this.body = bodyEl;
    this.autoScroll = true;

    this.body.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = this.body;
      this.autoScroll = (scrollHeight - scrollTop - clientHeight) < 40;
    });
  }

  write(text) {
    // Split by ANSI codes and build styled spans
    const parts = text.split(/(\x1b\[\d+m)/);
    let currentClass = null;

    for (const part of parts) {
      if (ANSI_MAP.hasOwnProperty(part)) {
        currentClass = ANSI_MAP[part];
        continue;
      }
      if (!part) continue;

      const span = document.createElement('span');
      span.textContent = part;
      if (currentClass) span.className = currentClass;
      this.output.appendChild(span);
    }

    if (this.autoScroll) {
      this.scrollToBottom();
    }
  }

  writeLine(text, className) {
    const div = document.createElement('div');
    div.textContent = text;
    if (className) div.className = className;
    this.output.appendChild(div);
    if (this.autoScroll) this.scrollToBottom();
  }

  clear() {
    this.output.innerHTML = '';
  }

  scrollToBottom() {
    requestAnimationFrame(() => {
      this.body.scrollTop = this.body.scrollHeight;
    });
  }
}
