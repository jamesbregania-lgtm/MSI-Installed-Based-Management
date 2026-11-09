const fs = require('fs/promises');
const os = require('os');
const path = require('path');

/**
 * Service-report images on the server's disk.
 *
 * The folder sits outside the app folder by default: Hostinger's Git deploy
 * rewrites the app folder on every push, which would take the images with it.
 * Set UPLOAD_DIR to move it.
 */

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function uploadRoot() {
  const configured = String(process.env.UPLOAD_DIR || '').trim();
  return path.resolve(configured || path.join(os.homedir(), 'matsol-uploads'));
}

/**
 * The image type from the file's first bytes, never from its name or the
 * Content-Type the browser sent. Null for anything but JPEG, PNG or WebP.
 */
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** "2026/11/<id>.jpg" — relative to the upload root, with forward slashes. */
function relativePathFor(id, mime, now = new Date()) {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}/${month}/${id}.${EXTENSIONS[mime]}`;
}

/**
 * The absolute path of a stored file, refusing anything that would resolve
 * outside the upload root.
 */
function absolutePathFor(relativePath) {
  const root = uploadRoot();
  const full = path.resolve(root, String(relativePath || ''));
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('Photo path escapes the upload folder.');
  }
  return full;
}

async function writePhotoFile(relativePath, buffer) {
  const full = absolutePathFor(relativePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer, { flag: 'wx' });
}

async function removePhotoFile(relativePath) {
  try {
    await fs.unlink(absolutePathFor(relativePath));
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }
}

/** A file name safe to store and show: no folders, no control characters. */
function cleanOriginalName(raw) {
  let name = String(raw || '');
  try { name = decodeURIComponent(name); } catch { /* keep it as sent */ }
  name = path.basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (name || 'image').slice(0, 200);
}

module.exports = {
  MAX_PHOTO_BYTES,
  uploadRoot,
  detectImageType,
  relativePathFor,
  absolutePathFor,
  writePhotoFile,
  removePhotoFile,
  cleanOriginalName
};
