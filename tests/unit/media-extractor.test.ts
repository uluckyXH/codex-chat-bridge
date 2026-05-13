import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractMediaRefs } from "../../src/bridge/media-extractor.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "media-extractor-test-"));
}

test("extractMediaRefs extracts local images from markdown, absolute, relative, and file URL refs", () => {
  const root = tempDir();
  const nested = path.join(root, "nested");
  fs.mkdirSync(nested, { recursive: true });
  const markdownImage = path.join(root, "markdown.png");
  const absoluteImage = path.join(root, "absolute.jpg");
  const relativeImage = path.join(nested, "relative.webp");
  const fileUrlImage = path.join(root, "file-url.gif");
  fs.writeFileSync(markdownImage, "png");
  fs.writeFileSync(absoluteImage, "jpg");
  fs.writeFileSync(relativeImage, "webp");
  fs.writeFileSync(fileUrlImage, "gif");

  const media = extractMediaRefs([
    "最终截图如下：![结果](./markdown.png)",
    `绝对路径: ${absoluteImage}`,
    "相对路径: nested/relative.webp",
    `file url: ${pathToFileURL(fileUrlImage).toString()}`,
    "不存在文件: ./missing.png",
    `重复引用: ${absoluteImage}`,
  ].join("\n"), root);

  assert.deepEqual(media.map((item) => item.path).sort(), [
    absoluteImage,
    fileUrlImage,
    markdownImage,
    relativeImage,
  ].sort());
  assert.equal(media.find((item) => item.path === markdownImage)?.caption, "结果");
  assert.equal(media.find((item) => item.path === absoluteImage)?.mimeType, "image/jpeg");
  assert.equal(media.find((item) => item.path === markdownImage)?.sizeBytes, 3);
});

test("extractMediaRefs keeps remote markdown image URLs as media URLs", () => {
  const media = extractMediaRefs("远程图：![chart](https://example.com/chart.png?width=800)", process.cwd());

  assert.equal(media.length, 1);
  assert.equal(media[0].url, "https://example.com/chart.png?width=800");
  assert.equal(media[0].name, "chart.png");
  assert.equal(media[0].mimeType, "image/png");
  assert.equal(media[0].caption, "chart");
});
