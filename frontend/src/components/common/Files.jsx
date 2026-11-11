import { useEffect, useState } from 'react';
import { fileUrl } from '../../services/api.js';
import { ALLOWED_TYPES, checkFiles } from '../../utils/validators.js';

/** Image thumbnails, inline video players (both with lightbox preview) + document links. */
export function AttachmentGallery({ files = [] }) {
  const [open, setOpen] = useState(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const images = files.filter((f) => f.mimeType?.startsWith('image/'));
  const videos = files.filter((f) => f.mimeType?.startsWith('video/'));
  const docs = files.filter((f) => !f.mimeType?.startsWith('image/') && !f.mimeType?.startsWith('video/'));
  if (!files.length) return null;
  const mediaSrc = (f) => fileUrl(f.id, false, f.url);
  return (
    <>
      {(images.length > 0 || videos.length > 0) && (
        <div className="gallery">
          {images.map((f) => (
            <img key={f.id} src={mediaSrc(f)} alt={f.name} loading="lazy" tabIndex={0}
              onClick={() => setOpen(f)} onKeyDown={(e) => e.key === 'Enter' && setOpen(f)} />
          ))}
          {videos.map((f) => (
            <div key={f.id} className="gallery-video">
              <video src={mediaSrc(f)} controls preload="metadata" playsInline aria-label={f.name} />
              <div className="row between small muted" style={{ marginTop: '.25rem' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }} title={f.name}>{f.name}</span>
                <button type="button" className="btn ghost sm" style={{ padding: '.1rem .45rem', minHeight: 24, fontSize: '.75rem' }} onClick={() => setOpen(f)}>Expand</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <div className="row small" style={{ marginTop: '.5rem' }}>
          {docs.map((f) => <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noreferrer">📄 {f.name}</a>)}
        </div>
      )}
      {open && (
        <div className="lightbox" role="dialog" aria-label="Media preview" onClick={() => setOpen(null)} tabIndex={-1}>
          <button type="button" className="lightbox-close" aria-label="Close preview" onClick={() => setOpen(null)}>✕</button>
          {open.mimeType?.startsWith('video/')
            ? <video src={mediaSrc(open)} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
            : <img src={mediaSrc(open)} alt={open.name} onClick={(e) => e.stopPropagation()} />}
        </div>
      )}
    </>
  );
}

/** File input with client-side type/size checks (server re-validates actual content). */
export function FilePicker({ label, name, multiple, max, files, onChange, accept = 'image/jpeg,image/png,image/webp,application/pdf', error }) {
  const allowed = accept ? accept.split(',').map((s) => s.trim()).filter(Boolean) : ALLOWED_TYPES;
  const handle = (e) => {
    const list = [...e.target.files];
    const problem = (max && list.length > max ? `Select at most ${max} files` : '') || checkFiles(list, allowed);
    onChange(problem ? [] : list, problem);
    if (problem) e.target.value = '';
  };
  return (
    <div className={`field ${error ? 'invalid' : ''}`}>
      <label htmlFor={name}>{label}</label>
      <input autoComplete="off" id={name} name={name} type="file" multiple={multiple} accept={accept} onChange={handle} />
      {files?.length > 0 && <div className="small muted">{files.map((f) => f.name).join(', ')}</div>}
      {error && <div className="error-text" role="alert">{error}</div>}
    </div>
  );
}
