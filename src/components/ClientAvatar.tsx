import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getClientPhotoSignedUrl, initialsOf } from "@/lib/clientPhoto";
import { cn } from "@/lib/utils";

interface Props {
  clientId?: string | null;
  name?: string | null;
  path?: string | null;
  updatedAt?: string | null;
  size?: number;
  className?: string;
  /** If path/updatedAt not passed, will look them up from `clients`. */
  autoFetch?: boolean;
}

export function ClientAvatar({
  clientId,
  name,
  path,
  updatedAt,
  size = 48,
  className,
  autoFetch = false,
}: Props) {
  const [resolvedPath, setResolvedPath] = useState<string | null>(path ?? null);
  const [resolvedUpdatedAt, setResolvedUpdatedAt] = useState<string | null>(updatedAt ?? null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => { setResolvedPath(path ?? null); }, [path]);
  useEffect(() => { setResolvedUpdatedAt(updatedAt ?? null); }, [updatedAt]);

  useEffect(() => {
    if (!autoFetch || !clientId || path !== undefined) return;
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("clients")
        .select("profile_photo_path, profile_photo_updated_at")
        .eq("id", clientId)
        .maybeSingle();
      if (cancelled) return;
      setResolvedPath(data?.profile_photo_path ?? null);
      setResolvedUpdatedAt(data?.profile_photo_updated_at ?? null);
    })();
    return () => { cancelled = true; };
  }, [autoFetch, clientId, path]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!resolvedPath) { setUrl(null); return; }
      const signed = await getClientPhotoSignedUrl(resolvedPath, resolvedUpdatedAt);
      if (!cancelled) setUrl(signed);
    })();
    return () => { cancelled = true; };
  }, [resolvedPath, resolvedUpdatedAt]);

  const initials = initialsOf(name);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground font-semibold overflow-hidden select-none border",
        className,
      )}
      style={style}
      aria-label={name ?? "Foto de perfil"}
    >
      {url ? (
        <img src={url} alt={name ?? "Foto"} className="w-full h-full object-cover" draggable={false} />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}
