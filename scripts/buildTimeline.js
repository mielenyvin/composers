import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SOURCE_TIMELINE_PATH = path.join(ROOT, "knightlab-timeline", "timeline.source.json");
const MARKDOWN_PATH = path.join(ROOT, "knightlab-timeline", "composers.md");
const OUTPUT_PATHS = [
  path.join(ROOT, "public", "timeline", "timeline.json"),
  path.join(ROOT, "knightlab-timeline", "timeline.json"),
];

marked.setOptions({
  mangle: false,
  headerIds: false,
});

function slugify(text = "") {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseMarkdownSections(markdown = "") {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const content = current.lines.join("\n").trim();
    if (content) {
      const bullets = current.lines
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "))
        .map((line) => line.replace(/^-+\s*/, "").trim());

      sections.push({
        slug: current.slug,
        title: current.title,
        html: marked.parse(content),
        bullets,
      });
    }
    current = null;
  };

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      flush();
      const rawHeading = headingMatch[1].trim();
      const anchorMatch = rawHeading.match(/(.+)\s+\{#([A-Za-z0-9_-]+)\}$/);
      const title = anchorMatch ? anchorMatch[1].trim() : rawHeading;
      const slug = anchorMatch ? anchorMatch[2].trim() : slugify(rawHeading);
      current = { title, slug, lines: [] };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  flush();

  const result = new Map();
  for (const section of sections) {
    result.set(section.slug, section);
  }
  return result;
}

function buildComposerHtml(event = {}, section = {}) {
  const text = event.text || {};
  const imageUrl = text.image_url || text.image || "";
  const imageAlt = text.image_alt || text.headline || "Composer portrait";
  const rawLabel = text.essentials_label || `${text.headline || "Essentials"} essentials`;
  const essentialsLabel = rawLabel.endsWith(":") ? rawLabel.slice(0, -1) : rawLabel;
  const playlistUrl = text.playlist_url || text.playlist || "";
  const bullets = Array.isArray(section.bullets) ? section.bullets : [];

  const imageHtml = imageUrl
    ? `<a class="tl-expandable-img-link"><img src="${imageUrl}" alt="${imageAlt}" class="tl-expandable-img" style="float:right;height:36vw;max-height:200px;margin:0 0 8px 12px;" /></a>`
    : "";

  const playlistHtml = playlistUrl
    ? `<div style="margin-top:5px"><div></div><div style="margin:10px 15px 5px 15px"><div style="font-weight:bold;margin-bottom:4px;">Key works to know:</div><div class="sc-player" data-soundcloud-playlist="${playlistUrl}"><div class="sc-player__status">Loading tracks...</div></div></div></div>`
    : "";

  let factsHtml = "";

  if (bullets.length) {
    const primary = bullets.slice(0, 3);
    const extra = bullets.slice(3);
    const primaryLis = primary
      .map((b) => `<li>${marked.parseInline(b)}</li>`)
      .join("");
    const extraLis = extra
      .map((b) => `<li class="fact fact--extra" style="display:none;">${marked.parseInline(b)}</li>`)
      .join("");
    const toggleLink = extra.length
      ? `<a href="#" class="facts-toggle" data-state="collapsed" style="display:inline-block;margin:4px 0 0 15px;font-size:14px;text-decoration:underline;color:#000;cursor:pointer;">Read more facts</a>`
      : "";
    factsHtml = `<ul>${primaryLis}${extraLis}</ul>${toggleLink}`;
  } else {
    factsHtml = section.html || "";
  }

  return `<div id="comp-content">${imageHtml}<div style="font-weight:bold;margin-bottom:4px; margin-left:15px;">${essentialsLabel}:</div>${factsHtml}<div style="clear:both;"></div>${playlistHtml}</div>`;
}

function buildTimeline(timeline = {}, sections = new Map()) {
  const clone = JSON.parse(JSON.stringify(timeline));
  clone.events = clone.events.map((event) => {
    if (!event || !event.text || !event.text.markdown_id) {
      return event;
    }

    const mdId = event.text.markdown_id;
    const section = sections.get(mdId);
    if (!section) {
      throw new Error(`Markdown section with id "${mdId}" not found. Add ## ... {#${mdId}} to ${MARKDOWN_PATH}.`);
    }

    const updated = JSON.parse(JSON.stringify(event));
    updated.text.text = buildComposerHtml(updated, section);
    return updated;
  });

  return clone;
}

async function main() {
  const [timelineRaw, markdownRaw] = await Promise.all([
    readFile(SOURCE_TIMELINE_PATH, "utf8"),
    readFile(MARKDOWN_PATH, "utf8"),
  ]);

  const timeline = JSON.parse(timelineRaw);
  const sections = parseMarkdownSections(markdownRaw);
  const generated = buildTimeline(timeline, sections);

  await Promise.all(
    OUTPUT_PATHS.map((dest) => writeFile(dest, JSON.stringify(generated, null, 2), "utf8"))
  );

  console.log(`Timeline JSON regenerated: ${OUTPUT_PATHS.join(", ")}`);
}

main().catch((error) => {
  console.error("Failed to rebuild timeline from markdown", error);
  process.exit(1);
});
