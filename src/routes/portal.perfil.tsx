import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Camera, ImagePlus, Trash2, RefreshCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { usePortalAccounts } from "@/hooks/usePortalClientId";
import { ClientAvatar } from "@/components/ClientAvatar";
import {
  processProfileImage,
  uploadClientProfilePhoto,
  removeClientProfilePhoto,
} from "@/lib/clientPhoto";
import {
  MONTH_LABELS,
  TENNIS_CLASS_LABELS,
  TENNIS_CLASS_VALUES,
  daysInMonth,
  type TennisClass,
} from "@/lib/tennisClass";

export const Route = createFileRoute("/portal/perfil")({
  ssr: false,
  component: PortalProfilePage,
});

const CONSENT_TEXT =
  "Sua foto será utilizada apenas para identificação no sistema do Stadium Rackets e ficará visível para a equipe autorizada.";

const NONE = "__none__";

function PortalProfilePage() {
  const { accounts, activeClientId } = usePortalAccounts();
  const active = accounts.find((a) => a.clientId === activeClientId) ?? null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);

  // Read-only info
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  // Photo
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoUpdatedAt, setPhotoUpdatedAt] = useState<string | null>(null);
  const [consentAt, setConsentAt] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const confirm = useConfirm();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);

  // Editable
  const [birthDay, setBirthDay] = useState<number | null>(null);
  const [birthMonth, setBirthMonth] = useState<number | null>(null);
  const [tennisClass, setTennisClass] = useState<TennisClass | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const load = async (cid: string) => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("clients")
      .select(
        "full_name, phone, email, profile_photo_path, profile_photo_updated_at, profile_photo_consent_at, birth_day, birth_month, tennis_class",
      )
      .eq("id", cid)
      .maybeSingle();
    setFullName(data?.full_name ?? "");
    setPhone(data?.phone ?? null);
    setEmail(data?.email ?? null);
    setPhotoPath(data?.profile_photo_path ?? null);
    setPhotoUpdatedAt(data?.profile_photo_updated_at ?? null);
    setConsentAt(data?.profile_photo_consent_at ?? null);
    setConsentChecked(!!data?.profile_photo_consent_at);
    setBirthDay(data?.birth_day ?? null);
    setBirthMonth(data?.birth_month ?? null);
    setTennisClass((data?.tennis_class ?? null) as TennisClass | null);
    setLoading(false);
  };

  useEffect(() => {
    if (!activeClientId) return;
    load(activeClientId);
    setPendingFile(null);
    setPendingPreview(null);
  }, [activeClientId]);

  useEffect(() => {
    return () => {
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    };
  }, [pendingPreview]);

  // Clamp day when month changes
  useEffect(() => {
    if (birthDay && birthMonth) {
      const max = daysInMonth(birthMonth);
      if (birthDay > max) setBirthDay(max);
    }
  }, [birthMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxDay = useMemo(() => daysInMonth(birthMonth), [birthMonth]);

  const chooseFile = (source: "gallery" | "camera") => {
    if (source === "camera") cameraInputRef.current?.click();
    else fileInputRef.current?.click();
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const processed = await processProfileImage(file);
      const previewUrl = URL.createObjectURL(processed.blob);
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
      setPendingFile(
        new File([processed.blob], `avatar.${processed.extension}`, { type: processed.contentType }),
      );
      setPendingPreview(previewUrl);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível ler a imagem.");
    }
  };

  const confirmUpload = async () => {
    if (!activeClientId || !pendingFile) return;
    if (!consentChecked) {
      toast.error("Confirme o consentimento antes de enviar.");
      return;
    }
    setSavingPhoto(true);
    try {
      await uploadClientProfilePhoto(activeClientId, pendingFile);
      toast.success("Foto atualizada.");
      setPendingFile(null);
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
      setPendingPreview(null);
      await load(activeClientId);
    } catch (err: any) {
      toast.error(err?.message ?? "Falha no upload.");
    } finally {
      setSavingPhoto(false);
    }
  };

  const cancelPending = () => {
    setPendingFile(null);
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingPreview(null);
  };

  const removePhoto = async () => {
    if (!activeClientId) return;
    if (!(await confirm("Remover a foto de perfil?"))) return;
    setSavingPhoto(true);
    try {
      await removeClientProfilePhoto(activeClientId);
      toast.success("Foto removida.");
      await load(activeClientId);
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao remover foto.");
    } finally {
      setSavingPhoto(false);
    }
  };

  const saveProfile = async () => {
    if (!activeClientId) return;
    // Validation
    if (birthDay && !birthMonth) {
      toast.error("Selecione o mês do aniversário.");
      return;
    }
    if (birthDay && birthMonth && birthDay > daysInMonth(birthMonth)) {
      toast.error("Data de nascimento inválida para o mês selecionado.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await (supabase as any).rpc("portal_update_profile", {
        _client_id: activeClientId,
        _birth_day: birthDay,
        _birth_month: birthMonth,
        _tennis_class: tennisClass,
      });
      if (error) throw error;
      toast.success("Perfil atualizado com sucesso.");
      await load(activeClientId);
    } catch (err: any) {
      console.error(err);
      toast.error("Não foi possível atualizar o perfil.");
    } finally {
      setSaving(false);
    }
  };

  if (!active) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Selecione uma conta.
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Perfil</h1>
        <p className="text-sm text-muted-foreground">
          Perfil de: <strong>{active.fullName}</strong>
          {active.isDependent ? " (dependente)" : ""}
        </p>
      </div>

      {/* Photo card */}
      <Card>
        <CardHeader>
          <CardTitle>Foto de perfil</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="shrink-0">
              {pendingPreview ? (
                <div
                  className="rounded-full overflow-hidden border-2 border-primary"
                  style={{ width: 140, height: 140 }}
                >
                  <img src={pendingPreview} alt="Prévia" className="w-full h-full object-cover" />
                </div>
              ) : (
                <ClientAvatar
                  clientId={active.clientId}
                  name={active.fullName}
                  path={photoPath}
                  updatedAt={photoUpdatedAt}
                  size={140}
                />
              )}
            </div>

            <div className="flex-1 space-y-3 w-full">
              <p className="text-sm text-muted-foreground">{CONSENT_TEXT}</p>

              {!consentAt && (
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={consentChecked}
                    onCheckedChange={(v) => setConsentChecked(v === true)}
                    className="mt-0.5"
                  />
                  <span>Concordo em enviar minha foto para uso descrito acima.</span>
                </label>
              )}

              {pendingPreview ? (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={confirmUpload} disabled={savingPhoto || !consentChecked}>
                    {savingPhoto ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Salvar foto
                  </Button>
                  <Button variant="outline" onClick={cancelPending} disabled={savingPhoto}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => chooseFile("camera")} disabled={savingPhoto}>
                    <Camera className="h-4 w-4 mr-2" /> Tirar foto
                  </Button>
                  <Button variant="outline" onClick={() => chooseFile("gallery")} disabled={savingPhoto}>
                    {photoPath ? (
                      <RefreshCcw className="h-4 w-4 mr-2" />
                    ) : (
                      <ImagePlus className="h-4 w-4 mr-2" />
                    )}
                    {photoPath ? "Trocar foto" : "Adicionar foto"}
                  </Button>
                  {photoPath && (
                    <Button variant="destructive" onClick={removePhoto} disabled={savingPhoto}>
                      <Trash2 className="h-4 w-4 mr-2" /> Remover
                    </Button>
                  )}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                JPEG, PNG ou WebP. Limite 5 MB. Recorte 1:1 automático.
              </p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={onFilePicked}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={onFilePicked}
          />
        </CardContent>
      </Card>

      {/* Info + editable card */}
      <Card>
        <CardHeader>
          <CardTitle>Meus dados</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Nome completo</Label>
              <Input value={fullName} disabled readOnly />
            </div>
            <div className="space-y-1">
              <Label>Telefone</Label>
              <Input value={phone ?? ""} placeholder="—" disabled readOnly />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>E-mail</Label>
              <Input value={email ?? ""} placeholder="—" disabled readOnly />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Aniversário (dia e mês)</Label>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-[160px_220px]">
              <Select
                value={birthDay ? String(birthDay) : NONE}
                onValueChange={(v) => setBirthDay(v === NONE ? null : Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Dia" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {String(d).padStart(2, "0")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={birthMonth ? String(birthMonth) : NONE}
                onValueChange={(v) => setBirthMonth(v === NONE ? null : Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Mês" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {MONTH_LABELS.map((label, idx) => (
                    <SelectItem key={idx + 1} value={String(idx + 1)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Guardamos apenas dia e mês — o ano não é solicitado.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Classe no tênis</Label>
            <Select
              value={tennisClass ?? NONE}
              onValueChange={(v) => setTennisClass(v === NONE ? null : (v as TennisClass))}
            >
              <SelectTrigger className="sm:max-w-[280px]">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {TENNIS_CLASS_VALUES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {TENNIS_CLASS_LABELS[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="pt-2">
            <Button onClick={saveProfile} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Salvar alterações
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
