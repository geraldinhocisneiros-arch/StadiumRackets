import { supabase } from "@/integrations/supabase/client";

export const CLIENT_PHOTO_BUCKET = "client-profile-photos";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const TARGET_SIZE = 800;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function initialsOf(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// Cache of signed URLs. key = path
const signedCache = new Map<string, { url: string; expires: number; version: string }>();

export async function getClientPhotoSignedUrl(
  path: string | null | undefined,
  updatedAt?: string | null,
): Promise<string | null> {
  if (!path) return null;
  const version = updatedAt ?? "0";
  const now = Date.now();
  const cached = signedCache.get(path);
  if (cached && cached.version === version && cached.expires > now + 60_000) {
    return cached.url;
  }
  const { data, error } = await supabase.storage
    .from(CLIENT_PHOTO_BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  const url = `${data.signedUrl}${data.signedUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
  signedCache.set(path, { url, version, expires: now + 3600 * 1000 });
  return url;
}

export function clearClientPhotoCache(path?: string | null) {
  if (path) signedCache.delete(path);
  else signedCache.clear();
}

export interface ProcessedImage {
  blob: Blob;
  contentType: string;
  extension: string;
}

async function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      img.src = url;
    });
    return img;
  } finally {
    // Revoke after image is decoded — cannot revoke here because img may still need src.
    // Delay revoke to next tick.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * Center-crop to square, resize to TARGET_SIZE and encode as webp.
 * The browser Image element already applies EXIF orientation on modern browsers.
 */
export async function processProfileImage(file: File): Promise<ProcessedImage> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Formato inválido. Use JPEG, PNG ou WebP.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Arquivo muito grande. Limite de 5 MB.");
  }
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_SIZE;
  canvas.height = TARGET_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Falha ao processar a imagem.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, TARGET_SIZE, TARGET_SIZE);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/webp", 0.9),
  );
  if (!blob) throw new Error("Falha ao gerar imagem otimizada.");
  return { blob, contentType: "image/webp", extension: "webp" };
}

async function removeAllPhotosForClient(clientId: string) {
  const folder = `clients/${clientId}`;
  const { data: list } = await supabase.storage
    .from(CLIENT_PHOTO_BUCKET)
    .list(folder, { limit: 100 });
  if (list && list.length) {
    await supabase.storage
      .from(CLIENT_PHOTO_BUCKET)
      .remove(list.map((f) => `${folder}/${f.name}`));
  }
}

export async function uploadClientProfilePhoto(clientId: string, file: File) {
  const processed = await processProfileImage(file);
  await removeAllPhotosForClient(clientId);
  const path = `clients/${clientId}/avatar-${Date.now()}.${processed.extension}`;
  const { error: upErr } = await supabase.storage
    .from(CLIENT_PHOTO_BUCKET)
    .upload(path, processed.blob, {
      contentType: processed.contentType,
      upsert: true,
      cacheControl: "3600",
    });
  if (upErr) throw upErr;

  // A tabela clients só aceita UPDATE direto de recepcionista/admin (RLS) —
  // um cliente do portal não tem essa permissão, e o Supabase não avisa
  // quando um UPDATE bloqueado por RLS afeta 0 linhas. Por isso a gravação
  // do caminho da foto precisa passar por uma RPC (mesmo padrão de
  // portal_update_profile), que autoriza via portal_can_view_client
  // (cobre titular e dependentes) e roda com privilégio de dono da função.
  const { error: updErr } = await (supabase as any).rpc("portal_set_profile_photo", {
    _client_id: clientId,
    _photo_path: path,
  });
  if (updErr) throw updErr;
  clearClientPhotoCache();
  return { path, updatedAt: new Date().toISOString() };
}

export async function removeClientProfilePhoto(clientId: string) {
  await removeAllPhotosForClient(clientId);
  const { error } = await (supabase as any).rpc("portal_remove_profile_photo", {
    _client_id: clientId,
  });
  if (error) throw error;
  clearClientPhotoCache();
}
