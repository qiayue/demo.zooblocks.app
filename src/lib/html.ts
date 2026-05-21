// ---------------------------------------------------------------------------
// Tiny HTML tagged-template helper with auto-escaping.
//
// Interpolated values are escaped by default. To inject pre-rendered HTML
// (already trusted/escaped), wrap it with `raw(...)`.
// ---------------------------------------------------------------------------

export class SafeHtml {
  constructor(public readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function raw(value: string): SafeHtml {
  return new SafeHtml(value);
}

export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return '';
  const s = String(input);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(input: unknown): string {
  return escapeHtml(input);
}

function stringify(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(stringify).join('');
  return escapeHtml(value);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) out += stringify(values[i]);
  }
  return new SafeHtml(out);
}

/** Render plain text into a safe HTML <p> block, preserving paragraph breaks. */
export function paragraphs(text: string): SafeHtml {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return raw(blocks.map((b) => `<p>${escapeHtml(b).replace(/\n/g, '<br/>')}</p>`).join(''));
}
