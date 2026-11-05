"use client";

/* Inventory photos are user-supplied data URLs, which next/image cannot resize
   or cache, so plain img tags are the right fit for this screen. */
/* eslint-disable @next/next/no-img-element */

import { useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/app/components/ui";
import { errorMessage } from "@/app/lib/api";
import { ProductImagePlaceholder } from "./InventoryCard";

const MAX_PHOTO_DIMENSION = 720;

function loadImageElement(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to read that image file"));
    image.src = source;
  });
}

// Photos are down-scaled and re-encoded in the browser so a saved item stays a
// small data URL instead of the original camera file.
async function readImageAsDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a PNG, JPG, or WebP image file.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Choose an image smaller than 8 MB.");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(objectUrl);
    const scale = Math.min(
      1,
      MAX_PHOTO_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight, 1),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to process that image");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encoded = canvas.toDataURL("image/webp", 0.82);
    return encoded.startsWith("data:image/webp") ? encoded : canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function ItemPhotoField({
  value,
  disabled = false,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      onChange(await readImageAsDataUrl(file));
    } catch (cause) {
      setError(errorMessage(cause, "Unable to use that image"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="item-photo-field">
      <span className="item-photo-field__preview">
        {value ? <img src={value} alt="" /> : <ProductImagePlaceholder />}
      </span>
      <div className="item-photo-field__copy">
        <strong>Product photo</strong>
        <span className="item-photo-field__hint">
          Shown on the inventory card. PNG, JPG, or WebP.
        </span>
        <div className="item-photo-field__actions">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon="photo"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? "Processing…" : value ? "Change photo" : "Add photo"}
          </Button>
          {value && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || busy}
              onClick={() => onChange("")}
            >
              Remove
            </Button>
          )}
        </div>
        {error && (
          <span className="item-photo-field__error" role="alert">
            {error}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        className="item-photo-field__input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={choosePhoto}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
