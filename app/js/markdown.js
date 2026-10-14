// Minimal Markdown → HTML for bundled legal documents and release notes (headings, tables, lists, links, bold, code).
export function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/&lt;(https?:[^&]+)&gt;/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const out = []; const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,3} /.test(l)) { const n = l.match(/^#+/)[0].length; out.push(`<h${n + 1}>${inline(l.slice(n + 1))}</h${n + 1}>`); }
    else if (/^\|/.test(l)) {
      const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]); i--;
      const cells = (r) => r.split('|').slice(1, -1).map((c) => c.trim());
      out.push('<table class="legal-table"><tr>' + cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr>' + rows.slice(2).map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</table>');
    } else if (/^[-*] /.test(l)) { const items = []; while (i < lines.length && /^[-*] /.test(lines[i])) items.push(lines[i++].slice(2)); i--; out.push('<ul>' + items.map((t) => `<li>${inline(t)}</li>`).join('') + '</ul>'); }
    else if (l.trim()) { const para = [l]; while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|\||[-*] )/.test(lines[i + 1])) para.push(lines[++i]); out.push(`<p>${inline(para.join(' '))}</p>`); }
  }
  return out.join('');
}
