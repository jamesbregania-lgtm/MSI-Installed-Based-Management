// ── Service-report image picker (activity and ad-hoc modals) ──
//
// One image per update, picked from the phone's files (a CamScanner export),
// never the camera. It uploads as soon as it is picked; the save then sends
// only its id. The image is shrunk in the browser first, so a 4 MB scan is
// stored as a few hundred KB.

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// Long side after shrinking: small print on a scanned A4 page stays readable.
const PHOTO_MAX_DIMENSION = 1600;
const PHOTO_JPEG_QUALITY = 0.8;

function loadImageForShrinking(file) {
    if (typeof createImageBitmap === 'function') {
        return createImageBitmap(file, { imageOrientation: 'from-image' })
            .catch(() => createImageBitmap(file));
    }
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Unreadable image.')); };
        img.src = url;
    });
}

/**
 * A smaller JPEG of `file`, or the file itself when shrinking can't help
 * (already small, or the browser can't decode it — the server checks it anyway).
 */
async function shrinkPhoto(file) {
    try {
        const image = await loadImageForShrinking(file);
        const width = image.width;
        const height = image.height;
        if (!width || !height) return file;

        const scale = Math.min(1, PHOTO_MAX_DIMENSION / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        // JPEG has no transparency: a transparent PNG would otherwise turn black.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        if (typeof image.close === 'function') image.close();

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', PHOTO_JPEG_QUALITY));
        return blob && blob.size < file.size ? blob : file;
    } catch (err) {
        return file;
    }
}

/**
 * Wires one picker. Elements are found inside `root` by data-photo-* hooks:
 *   input (type=file), attach (button), chip (shown once attached),
 *   name (file name text), remove (button).
 * Returns { reset, getPhotoId, isUploading, validate }.
 */
function createPhotoPicker(root) {
    const input = root ? root.querySelector('[data-photo-input]') : null;
    const attachBtn = root ? root.querySelector('[data-photo-attach]') : null;
    const chip = root ? root.querySelector('[data-photo-chip]') : null;
    const nameEl = root ? root.querySelector('[data-photo-name]') : null;
    const removeBtn = root ? root.querySelector('[data-photo-remove]') : null;
    const hintEl = root ? root.querySelector('[data-photo-hint]') : null;

    let photoId = null;
    let uploading = false;
    // Bumped on every pick/reset, so a slow upload that finishes after the
    // user removed it (or closed the modal) is ignored.
    let generation = 0;

    function render(name, state) {
        const attached = Boolean(name);
        if (attachBtn) attachBtn.hidden = attached;
        if (hintEl) hintEl.hidden = attached;
        if (chip) {
            chip.hidden = !attached;
            chip.classList.toggle('is-uploading', state === 'uploading');
        }
        if (nameEl) nameEl.textContent = state === 'uploading' ? `${name} — uploading…` : (name || '');
        if (removeBtn) removeBtn.disabled = state === 'uploading';
        if (root) root.classList.remove('photo-picker-invalid');
    }

    function reset() {
        generation += 1;
        photoId = null;
        uploading = false;
        if (input) input.value = '';
        render('', 'empty');
    }

    async function upload(file) {
        const myGeneration = ++generation;
        uploading = true;
        photoId = null;
        render(file.name, 'uploading');

        try {
            const body = await shrinkPhoto(file);
            const response = await fetch(`/client/${encodeURIComponent(CLIENT_ID)}/photos`, {
                method: 'POST',
                headers: {
                    'Content-Type': body.type || file.type || 'application/octet-stream',
                    'X-File-Name': encodeURIComponent(file.name || 'image'),
                    Accept: 'application/json'
                },
                body
            });
            const payload = await readJsonResponse(response);
            if (myGeneration !== generation) return;
            if (!response.ok || !payload.ok || !payload.photo) {
                throw new Error(payload.error || 'Failed to upload the image.');
            }
            photoId = payload.photo.id;
            uploading = false;
            render(file.name, 'attached');
        } catch (error) {
            if (myGeneration !== generation) return;
            reset();
            showToast(error.message || 'Failed to upload the image.', 'warning');
        }
    }

    if (attachBtn && input) {
        attachBtn.addEventListener('click', () => {
            if (photoId || uploading) {
                showToast('Only one image can be attached. Remove it first to choose another.', 'warning');
                return;
            }
            input.click();
        });
    }

    if (input) {
        input.addEventListener('change', () => {
            const files = Array.from(input.files || []);
            input.value = '';
            if (!files.length) return;
            if (files.length > 1 || photoId || uploading) {
                showToast('Only one image can be attached.', 'warning');
                return;
            }
            const file = files[0];
            // Some Android file pickers send no type; fall back to the extension.
            const type = String(file.type || '').toLowerCase();
            const typeOk = type ? PHOTO_TYPES.has(type) : /\.(jpe?g|png|webp)$/i.test(file.name || '');
            if (!typeOk) {
                showToast('Only JPG, PNG or WebP images can be attached. Export your scan as JPG.', 'warning');
                return;
            }
            if (file.size > PHOTO_MAX_BYTES) {
                showToast('Image is larger than 5 MB. Choose a smaller image.', 'warning');
                return;
            }
            upload(file);
        });
    }

    if (removeBtn) removeBtn.addEventListener('click', reset);

    /** True when an image is attached; otherwise shows why and returns false. */
    function validate() {
        if (uploading) {
            showToast('Please wait for the image to finish uploading.', 'warning');
            return false;
        }
        if (!photoId) {
            if (root) root.classList.add('photo-picker-invalid');
            showToast('Attach an image of the service report before saving.', 'warning');
            if (attachBtn) attachBtn.focus();
            return false;
        }
        return true;
    }

    reset();

    return {
        reset,
        validate,
        getPhotoId: () => photoId,
        isUploading: () => uploading,
        hasInput: () => Boolean(photoId || uploading)
    };
}
