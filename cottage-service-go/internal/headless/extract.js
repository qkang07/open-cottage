() => {
  const doc = document;
  const meta = (name) => {
    const el =
      doc.querySelector(`meta[name="${name}"]`) ??
      doc.querySelector(`meta[property="${name}"]`);
    return el?.getAttribute("content") ?? "";
  };

  const og = {};
  doc.querySelectorAll('meta[property^="og:"]').forEach((el) => {
    const prop = el.getAttribute("property") ?? "";
    const content = el.getAttribute("content") ?? "";
    if (prop && content) og[prop.replace("og:", "")] = content;
  });

  const extractContent = () => {
    const clone = doc.cloneNode(true);
    clone
      .querySelectorAll(
        "script, style, noscript, svg, iframe, nav, header, footer, aside, .sidebar, .nav, .menu, .ad, .advertisement, .comment, .comments",
      )
      .forEach((el) => el.remove());

    let main =
      clone.querySelector("article") ??
      clone.querySelector("main") ??
      clone.querySelector('[role="main"]') ??
      clone.querySelector(
        ".post-content, .article-content, .entry-content, .content, #content",
      );

    if (!main) main = clone.body ?? clone.documentElement;
    if (!main) return "";

    const parts = [];
    main
      .querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, code, table")
      .forEach((el) => {
        const tag = el.tagName.toLowerCase();
        const text = el.innerText?.trim();
        if (!text) return;
        if (/^h[1-6]$/.test(tag)) {
          parts.push(`${"#".repeat(Number(tag[1]))} ${text}`);
        } else if (tag === "li") {
          parts.push(`- ${text}`);
        } else if (tag === "blockquote") {
          parts.push(`> ${text}`);
        } else if (tag === "pre" || tag === "code") {
          parts.push("```\n" + text + "\n```");
        } else {
          parts.push(text);
        }
      });

    if (parts.length === 0) {
      return (main.innerText ?? "").replace(/\s+/g, " ").trim();
    }
    return parts.join("\n\n");
  };

  const title =
    doc.querySelector("title")?.textContent?.trim() ??
    meta("og:title") ??
    doc.querySelector("h1")?.textContent?.trim() ??
    "";

  const publishDate =
    meta("article:published_time") ??
    meta("date") ??
    meta("publish_date") ??
    doc.querySelector("time[datetime]")?.getAttribute("datetime") ??
    "";

  const headings = [];
  doc.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const text = el.innerText?.trim();
    if (text) headings.push({ level: Number(tag[1]), text });
  });

  const linkSet = new Set();
  const links = [];
  doc.querySelectorAll("a[href]").forEach((el) => {
    const href = el.getAttribute("href") ?? "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    if (linkSet.has(href)) return;
    linkSet.add(href);
    if (links.length < 50) {
      links.push({
        text: (el.innerText ?? "").trim().slice(0, 100),
        href,
      });
    }
  });

  const imgSet = new Set();
  const images = [];
  doc.querySelectorAll("img[src]").forEach((el) => {
    const src = el.getAttribute("src") ?? "";
    if (!src || src.startsWith("data:") || imgSet.has(src)) return;
    imgSet.add(src);
    if (images.length < 30) {
      images.push({ src, alt: el.getAttribute("alt") ?? "" });
    }
  });

  const content = extractContent();
  const textContent = content.replace(/[#>*`\-]/g, "").replace(/\s+/g, " ").trim();
  const chineseChars = (textContent.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const englishWords = textContent
    .replace(/[\u4e00-\u9fff]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0).length;

  return {
    finalUrl: location.href,
    title,
    description: meta("description") || meta("og:description") || "",
    author: meta("author") || meta("article:author") || "",
    publishDate,
    language: doc.documentElement.getAttribute("lang") ?? "",
    og,
    content,
    textContent,
    headings,
    links,
    images,
    wordCount: chineseChars + englishWords,
  };
}
