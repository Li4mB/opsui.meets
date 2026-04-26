import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import {
  DEFAULT_PROFILE_VISUALS,
  PROFILE_VISUAL_COLOR_OPTIONS,
  type ProfileVisualAsset,
  type ProfileVisuals,
  type SessionInfo,
} from "@opsui/shared-types";
import { getMyProfile, getSessionDisplayName, updateMyProfileVisuals } from "../lib/auth";
import { Modal } from "../components/Modal";

type VisualTarget = "avatar" | "banner";
type EditorStep = "picker" | "crop";

interface MyProfilePageProps {
  session: SessionInfo | null;
  onNavigate(pathname: string): void;
  onRefreshSession(forceRefresh?: boolean): Promise<void>;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function MyProfilePage(props: MyProfilePageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [profileVisuals, setProfileVisuals] = useState<ProfileVisuals>(() =>
    getSessionProfileVisuals(props.session),
  );
  const [editingTarget, setEditingTarget] = useState<VisualTarget | null>(null);
  const [editorStep, setEditorStep] = useState<EditorStep>("picker");
  const [pickerDraft, setPickerDraft] = useState<ProfileVisualAsset | null>(null);
  const [cropDraft, setCropDraft] = useState<ProfileVisualAsset | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const signedIn = Boolean(props.session?.authenticated);
  const displayName = getProfileDisplayName(props.session);
  const username = props.session?.actor.username?.trim();
  const profileInitials = getProfileInitials(username ?? displayName);
  const workspaceName = props.session?.actor.workspaceName ?? "My Workspace";
  const editorTitle = editingTarget === "banner" ? "Edit banner" : "Edit profile picture";
  const cropTitle = editingTarget === "banner" ? "Crop banner" : "Crop profile picture";

  useEffect(() => {
    setProfileVisuals(getSessionProfileVisuals(props.session));
  }, [props.session?.actor.profileVisuals, props.session?.actor.userId]);

  useEffect(() => {
    if (!signedIn) {
      return;
    }

    let cancelled = false;
    async function loadProfile() {
      const profile = await getMyProfile();
      if (!cancelled && profile) {
        setProfileVisuals(normalizeProfileVisuals(profile.profileVisuals));
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [signedIn, props.session?.actor.userId]);

  const activeVisual = useMemo(() => {
    if (!editingTarget) {
      return DEFAULT_PROFILE_VISUALS.avatar;
    }

    return profileVisuals[editingTarget];
  }, [editingTarget, profileVisuals]);

  function openEditor(target: VisualTarget) {
    setEditingTarget(target);
    setEditorStep("picker");
    setPickerDraft(profileVisuals[target]);
    setCropDraft(null);
    setEditorError(null);
  }

  function closeEditor() {
    if (isSaving) {
      return;
    }

    setEditingTarget(null);
    setEditorStep("picker");
    setPickerDraft(null);
    setCropDraft(null);
    setEditorError(null);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file || !editingTarget) {
      return;
    }

    setEditorError(null);
    if (!ACCEPTED_UPLOAD_TYPES.has(file.type)) {
      setEditorError("Choose an image file.");
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setEditorError("Choose an image under 5 MB.");
      return;
    }

    try {
      const imageDataUrl = await downscaleImageFile(file, editingTarget);
      setCropDraft({
        mode: "image",
        color: pickerDraft?.color ?? activeVisual.color,
        imageDataUrl,
        zoom: 0,
      });
      setEditorStep("crop");
    } catch {
      setEditorError("That image could not be loaded.");
    }
  }

  async function saveVisual(nextVisual: ProfileVisualAsset | null) {
    if (!editingTarget || !nextVisual) {
      return;
    }

    const nextVisuals: ProfileVisuals = {
      ...profileVisuals,
      [editingTarget]: nextVisual,
    };
    setIsSaving(true);
    setEditorError(null);

    const result = await updateMyProfileVisuals(nextVisuals);
    if (!result.ok) {
      setIsSaving(false);
      setEditorError(result.message ?? "That profile update could not be saved.");
      return;
    }

    setProfileVisuals(nextVisuals);
    await props.onRefreshSession(true);
    setIsSaving(false);
    closeEditor();
  }

  if (!signedIn) {
    return (
      <section className="page my-profile-page">
        <div className="my-profile-empty">
          <h1>My profile</h1>
          <button
            className="button button--primary"
            onClick={() => {
              props.onNavigate("/sign-in");
            }}
            type="button"
          >
            Sign In
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="page my-profile-page">
      <div className="my-profile-shell">
        <div className="my-profile-cover">
          <ProfileVisualSurface
            className="my-profile-cover__visual"
            initials=""
            testId="profile-banner-surface"
            variant="banner"
            visual={profileVisuals.banner}
          />
          <button
            aria-label="Edit banner"
            className="my-profile-cover__edit"
            data-testid="profile-banner-edit"
            onClick={() => {
              openEditor("banner");
            }}
            type="button"
          >
            <PenIcon />
          </button>
        </div>

        <div className="my-profile-body">
          <button
            aria-label="Edit profile picture"
            className="my-profile-avatar"
            data-testid="profile-avatar-edit"
            onClick={() => {
              openEditor("avatar");
            }}
            type="button"
          >
            <ProfileVisualSurface
              className="my-profile-avatar__visual"
              initials={profileInitials}
              testId="profile-avatar-surface"
              variant="avatar"
              visual={profileVisuals.avatar}
            />
            <span aria-hidden="true" className="my-profile-avatar__overlay">
              <PenIcon />
            </span>
          </button>

          <div className="my-profile-identity">
            <h1>{displayName}</h1>
            {username ? <p className="my-profile-identity__username">@{username}</p> : null}
            <p>{workspaceName}</p>
          </div>
        </div>
      </div>

      <Modal
        actions={
          editorStep === "picker" ? (
            <>
              <button className="button button--subtle" disabled={isSaving} onClick={closeEditor} type="button">
                Cancel
              </button>
              <button
                className="button button--primary"
                disabled={isSaving}
                onClick={() => {
                  void saveVisual(pickerDraft);
                }}
                type="button"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </>
          ) : (
            <>
              <button
                className="button button--subtle"
                disabled={isSaving}
                onClick={() => {
                  setEditorStep("picker");
                  setCropDraft(null);
                  setEditorError(null);
                }}
                type="button"
              >
                Back
              </button>
              <button className="button button--subtle" disabled={isSaving} onClick={closeEditor} type="button">
                Cancel
              </button>
              <button
                className="button button--primary"
                disabled={isSaving}
                onClick={() => {
                  void saveVisual(cropDraft);
                }}
                type="button"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </>
          )
        }
        onClose={closeEditor}
        open={Boolean(editingTarget)}
        title={editorStep === "crop" ? cropTitle : editorTitle}
      >
        {editorStep === "picker" ? (
          <div className="profile-visual-editor">
            <ProfileVisualSurface
              className="profile-visual-editor__preview"
              initials={profileInitials}
              testId="profile-editor-preview"
              variant={editingTarget ?? "avatar"}
              visual={pickerDraft ?? activeVisual}
            />

            <div className="profile-visual-editor__swatches">
              {PROFILE_VISUAL_COLOR_OPTIONS.map((option) => (
                <button
                  className={`profile-visual-editor__swatch${
                    (pickerDraft ?? activeVisual).mode === "color" &&
                    (pickerDraft ?? activeVisual).color === option.value
                      ? " is-selected"
                      : ""
                  }`}
                  key={option.value}
                  onClick={() => {
                    setPickerDraft({
                      mode: "color",
                      color: option.value,
                      zoom: 0,
                    });
                    setEditorError(null);
                  }}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="profile-visual-editor__swatch-mark"
                    style={{ "--profile-visual-color": option.value } as CSSProperties}
                  />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>

            <button
              className="button button--subtle profile-visual-editor__upload"
              onClick={() => {
                fileInputRef.current?.click();
              }}
              type="button"
            >
              Upload from file
            </button>
            <input
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="profile-visual-editor__file"
              data-testid="profile-visual-file-input"
              onChange={handleFileChange}
              ref={fileInputRef}
              type="file"
            />
            {editorError ? <p className="inline-feedback inline-feedback--error">{editorError}</p> : null}
          </div>
        ) : (
          <div className="profile-visual-editor profile-visual-editor--crop">
            <ProfileVisualSurface
              className="profile-visual-editor__crop-preview"
              initials={profileInitials}
              testId="profile-crop-preview"
              variant={editingTarget ?? "avatar"}
              visual={cropDraft ?? activeVisual}
            />

            <label className="profile-visual-editor__zoom">
              <span>Zoom</span>
              <input
                aria-label="Zoom"
                data-testid="profile-visual-zoom"
                max={100}
                min={0}
                onChange={(event) => {
                  const zoom = Number(event.target.value);
                  setCropDraft((current) => (current ? { ...current, zoom } : current));
                }}
                step={1}
                type="range"
                value={cropDraft?.zoom ?? 0}
              />
              <strong>{cropDraft?.zoom ?? 0}%</strong>
            </label>
            {editorError ? <p className="inline-feedback inline-feedback--error">{editorError}</p> : null}
          </div>
        )}
      </Modal>
    </section>
  );
}

function ProfileVisualSurface(props: {
  className: string;
  initials: string;
  testId: string;
  variant: VisualTarget;
  visual: ProfileVisualAsset;
}) {
  const scale = getVisualScale(props.visual);
  return (
    <span
      className={`profile-visual profile-visual--${props.variant} profile-visual--${props.visual.mode} ${props.className}`}
      data-testid={props.testId}
      style={{ "--profile-visual-color": props.visual.color } as CSSProperties}
    >
      {props.visual.mode === "image" && props.visual.imageDataUrl ? (
        <img
          alt=""
          data-testid={`profile-${props.variant}-image`}
          src={props.visual.imageDataUrl}
          style={{ transform: `scale(${scale})` }}
        />
      ) : props.variant === "avatar" ? (
        props.initials
      ) : null}
    </span>
  );
}

function PenIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3.4 14.9L2.7 17.3L5.1 16.6L15.8 5.9C16.4 5.3 16.4 4.4 15.8 3.8L16.2 4.2C15.6 3.6 14.7 3.6 14.1 4.2L3.4 14.9Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path d="M12.8 5.5L14.5 7.2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function getSessionProfileVisuals(session: SessionInfo | null): ProfileVisuals {
  return normalizeProfileVisuals(session?.actor.profileVisuals);
}

function getProfileDisplayName(session: SessionInfo | null): string {
  const fullName = [session?.actor.firstName, session?.actor.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

  return fullName || getSessionDisplayName(session);
}

function normalizeProfileVisuals(value: ProfileVisuals | null | undefined): ProfileVisuals {
  return {
    avatar: normalizeProfileVisual(value?.avatar, DEFAULT_PROFILE_VISUALS.avatar),
    banner: normalizeProfileVisual(value?.banner, DEFAULT_PROFILE_VISUALS.banner),
  };
}

function normalizeProfileVisual(
  value: ProfileVisualAsset | null | undefined,
  fallback: ProfileVisualAsset,
): ProfileVisualAsset {
  if (!value) {
    return { ...fallback };
  }

  return {
    mode: value.mode === "image" && value.imageDataUrl ? "image" : "color",
    color: value.color || fallback.color,
    imageDataUrl: value.mode === "image" ? value.imageDataUrl : undefined,
    zoom: Math.min(100, Math.max(0, Number.isFinite(value.zoom) ? Math.round(value.zoom) : fallback.zoom)),
  };
}

function getProfileInitials(value: string): string {
  const parts = value
    .replace(/^@/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return initials || "U";
}

function getVisualScale(visual: ProfileVisualAsset): number {
  return 1 + (Math.min(100, Math.max(0, visual.zoom)) / 100) * 1.5;
}

async function downscaleImageFile(file: File, target: VisualTarget): Promise<string> {
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(imageUrl);
    const maxWidth = target === "avatar" ? 512 : 1600;
    const maxHeight = target === "avatar" ? 512 : 400;
    const ratio = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("canvas_unavailable");
    }

    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new Error("image_load_failed"));
    };
    image.src = src;
  });
}
