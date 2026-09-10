'use client';

/**
 * src/components/manager/image-upload-field.tsx
 *
 * "Upload a photo" control for the Manager console (Store Settings hero
 * image, Menu Maker item photos). Picks a file, resizes + compresses it
 * client-side to a ~900px JPEG, then:
 *
 *   1. tries to upload it to Firebase Storage and store the download URL;
 *   2. if Storage isn't set up / reachable, falls back to storing the
 *      compressed image inline as a `data:` URI (works with zero infra —
 *      no bucket, no rules deploy).
 *
 * A "paste a link instead" input is kept for anyone hosting images
 * elsewhere. The parent just gets a string back via `onChange`.
 */

import { useRef, useState } from 'react';
import { app } from '@/lib/firebase/client';

const MAX_EDGE = 800;
const JPEG_QUALITY = 0.68;

async function compress(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('decode failed'));
    i.src = dataUrl;
  });
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

async function tryStorageUpload(pathPrefix: string, dataUrl: string): Promise<string | null> {
  try {
    const { getStorage, ref, uploadString, getDownloadURL } = await import('firebase/storage');
    const storage = getStorage(app);
    const objectRef = ref(storage, `${pathPrefix}-${Date.now()}.jpg`);
    await uploadString(objectRef, dataUrl, 'data_url');
    return await getDownloadURL(objectRef);
  } catch {
    return null; // Storage not enabled / rules / offline — caller falls back
  }
}

export function ImageUploadField({
  value,
  onChange,
  pathPrefix,
  label = 'Photo',
  hint,
}: {
  value: string;
  onChange: (url: string) => void;
  /** Firebase Storage object path without extension, e.g.
   *  `tenants/t1/branches/b1/hero`. */
  pathPrefix: string;
  label?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'idle' | 'stored' | 'inline'>('idle');
  const [showUrl, setShowUrl] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErr('Pick an image file.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const compressed = await compress(file);
      const hosted = await tryStorageUpload(pathPrefix, compressed);
      if (hosted) {
        onChange(hosted);
        setMode('stored');
      } else {
        onChange(compressed);
        setMode('inline');
      }
    } catch {
      setErr("Couldn't process that image. Try a different one.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-2 text-xs text-[#6B7280]">
      <span className="font-medium">{label}</span>

      <div className="flex items-start gap-3">
        <div className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#E5E7EB] bg-[#F9FAFB]">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-[10px] text-[#9CA3AF]">No image</span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="h-9 rounded-lg bg-[#0F5257] px-3 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Uploading…' : value ? 'Replace' : 'Upload photo'}
            </button>
            {value ? (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setMode('idle');
                }}
                className="h-9 rounded-lg border border-[#E5E7EB] px-3 text-xs font-semibold text-[#1F2937]"
              >
                Remove
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowUrl((s) => !s)}
              className="h-9 rounded-lg border border-[#E5E7EB] px-3 text-xs font-semibold text-[#1F2937]"
            >
              Paste a link
            </button>
          </div>

          {showUrl ? (
            <input
              value={/^https?:\/\//i.test(value) ? value : ''}
              onChange={(e) => {
                onChange(e.target.value.trim());
                setMode('idle');
              }}
              placeholder="https://…/photo.jpg"
              className="h-9 rounded-lg border border-[#E5E7EB] px-2 text-sm text-[#1F2937]"
            />
          ) : null}

          {err ? <span className="text-[#BA1A1A]">{err}</span> : null}
          {mode === 'inline' ? (
            <span className="text-[10px] text-[#9CA3AF]">
              Stored with the record (Firebase Storage isn’t enabled yet — that’s fine for a few photos).
            </span>
          ) : mode === 'stored' ? (
            <span className="text-[10px] text-[#16A34A]">Uploaded to Firebase Storage.</span>
          ) : hint ? (
            <span className="text-[10px] text-[#9CA3AF]">{hint}</span>
          ) : null}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  );
}
