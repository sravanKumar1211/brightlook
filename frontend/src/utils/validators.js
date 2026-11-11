// Small reusable validators. Each returns an error string or ''.
export const required = (v, name = 'This field') => (String(v ?? '').trim() ? '' : `${name} is required`);
export const positive = (v, name = 'Amount') => (Number(v) > 0 ? '' : `${name} must be greater than 0`);
export const minLen = (v, n, name = 'This field') => (String(v ?? '').trim().length >= n ? '' : `${name} must be at least ${n} characters`);
export const percent = (v) => (v !== '' && Number(v) >= 0 && Number(v) <= 100 ? '' : 'Enter a value between 0 and 100');

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'];
export const MEDIA_TYPES = [...IMAGE_TYPES, ...VIDEO_TYPES];
export const ALLOWED_TYPES = [...MEDIA_TYPES, 'application/pdf'];
export const MAX_FILE_MB = 10;
export const MAX_VIDEO_MB = 100;

const EXT_TO_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  pdf: 'application/pdf',
};

const mimeOf = (file) => file?.type || EXT_TO_MIME[file?.name?.split('.').pop()?.toLowerCase()] || '';

export const checkFile = (file, allowedTypes = ALLOWED_TYPES) => {
  if (!file) return '';
  const mime = mimeOf(file);
  if (!allowedTypes.includes(mime)) {
    const hasVideo = allowedTypes.some((t) => t.startsWith('video/'));
    const hasPdf = allowedTypes.includes('application/pdf');
    if (!hasVideo && !hasPdf) return `${file.name}: only JPEG, PNG or WebP images allowed`;
    if (!hasVideo) return `${file.name}: only JPEG, PNG, WebP or PDF allowed`;
    return `${file.name}: only JPEG, PNG, WebP, MP4, WebM, MOV or PDF allowed`;
  }
  const maxMb = mime.startsWith('video/') ? MAX_VIDEO_MB : MAX_FILE_MB;
  if (file.size > maxMb * 1024 * 1024) return `${file.name}: larger than ${maxMb} MB`;
  return '';
};
export const checkFiles = (files = [], allowedTypes = ALLOWED_TYPES) =>
  [...files].map((f) => checkFile(f, allowedTypes)).find(Boolean) || '';

/** Run a map of {field: errorString} and drop empties. */
export const collect = (checks) => Object.fromEntries(Object.entries(checks).filter(([, v]) => v));
