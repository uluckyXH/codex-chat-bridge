import fs from "node:fs";
import path from "node:path";
import type { ChannelMedia } from "../protocol/channel.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".svg"]);
const EXTENSION_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".svg": "image/svg+xml",
};

interface MediaCandidate {
  value: string;
  caption?: string;
}

export function extractMediaRefs(text: string, cwd = process.cwd()): ChannelMedia[] {
  const candidates = [
    ...markdownImageRefs(text),
    ...mediaDirectiveRefs(text),
    ...bareImageRefs(text),
  ];
  const media: ChannelMedia[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const item = mediaFromCandidate(candidate, cwd);
    if (!item) continue;
    const key = item.path ?? item.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    media.push(item);
  }
  return media;
}

export function extractLocalImageMedia(text: string, cwd: string): ChannelMedia[] {
  return extractMediaRefs(text, cwd).filter((media) => Boolean(media.path));
}

function markdownImageRefs(text: string): MediaCandidate[] {
  const refs: MediaCandidate[] = [];
  const pattern = /!\[([^\]]*)]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const cleaned = cleanRef(match[2]);
    if (cleaned) refs.push({ value: cleaned, caption: match[1]?.trim() || undefined });
  }
  return refs;
}

function mediaDirectiveRefs(text: string): MediaCandidate[] {
  const refs: MediaCandidate[] = [];
  const pattern = /^\s*MEDIA\s*:\s*(.+?)\s*$/gim;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const cleaned = cleanRef(match[1]);
    if (cleaned) refs.push({ value: cleaned });
  }
  return refs;
}

function bareImageRefs(text: string): MediaCandidate[] {
  const refs: MediaCandidate[] = [];
  const extensionPattern = "png|jpe?g|gif|webp|bmp|tiff?|svg";
  const pattern = new RegExp([
    `https?://[^\\s"'<>)]*?\\.(?:${extensionPattern})(?:\\?[^\\s"'<>)]*)?`,
    `file://[^\\s"'<>)]*?\\.(?:${extensionPattern})\\b`,
    `/(?:[^\\s"'<>)]*?/)*[^\\s"'<>)]*?\\.(?:${extensionPattern})\\b`,
    `\\.\\.?/(?:[^\\s"'<>)]*?/)*[^\\s"'<>)]*?\\.(?:${extensionPattern})\\b`,
    `(?:[A-Za-z0-9_@%+=:,.-]+/)+[A-Za-z0-9_@%+=:,.-]+\\.(?:${extensionPattern})\\b`,
  ].join("|"), "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const cleaned = cleanRef(match[0]);
    if (cleaned) refs.push({ value: cleaned });
  }
  return refs;
}

function cleanRef(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
    .replace(/^<|>$/g, "")
    .replace(/^["']|["']$/g, "")
    .replace(/[),.;!?]+$/g, "");
  if (!trimmed) return undefined;
  if (trimmed.startsWith("file://")) {
    try {
      return new URL(trimmed).pathname;
    } catch {
      return undefined;
    }
  }
  return trimmed;
}

function mediaFromCandidate(candidate: MediaCandidate, cwd: string): ChannelMedia | undefined {
  if (/^https?:\/\//i.test(candidate.value)) {
    return remoteMediaFromUrl(candidate);
  }
  const filePath = resolveMediaPath(candidate.value, cwd);
  if (!filePath) return undefined;
  const ext = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return undefined;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return undefined;
    return {
      type: "image",
      path: filePath,
      name: path.basename(filePath),
      mimeType: EXTENSION_MIME[ext],
      sizeBytes: stat.size,
      caption: candidate.caption,
    };
  } catch {
    return undefined;
  }
}

function remoteMediaFromUrl(candidate: MediaCandidate): ChannelMedia | undefined {
  try {
    const url = new URL(candidate.value);
    const ext = path.extname(url.pathname).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) return undefined;
    return {
      type: "image",
      url: url.toString(),
      name: decodeURIComponent(path.basename(url.pathname)),
      mimeType: EXTENSION_MIME[ext],
      caption: candidate.caption,
    };
  } catch {
    return undefined;
  }
}

function resolveMediaPath(value: string, cwd: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return path.isAbsolute(decoded) ? path.normalize(decoded) : path.resolve(cwd, decoded);
  } catch {
    return undefined;
  }
}
