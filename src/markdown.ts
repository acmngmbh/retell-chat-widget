function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(href: string): string | null {
  try {
    const url = new URL(href, window.location.origin);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    return null;
  }
  return null;
}

export function renderMarkdown(raw: string): string {
  const escaped = escapeHtml(raw);
  const lines = escaped.split(/\n/);
  const out: string[] = [];
  let inList = false;

  const inline = (text: string): string => {
    let next = text.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_m, label, href) => {
      const url = safeUrl(href);
      return url
        ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : label;
    });
    next = next.replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, (_m, prefix, href) => {
      const url = safeUrl(href);
      return url
        ? `${prefix}<a href="${url}" target="_blank" rel="noopener noreferrer">${href}</a>`
        : `${prefix}${href}`;
    });
    next = next.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    next = next.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    return next;
  };

  for (const line of lines) {
    const listMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (listMatch) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(listMatch[1])}</li>`);
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    if (line.trim() === "") {
      out.push("<br />");
    } else {
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("");
}
