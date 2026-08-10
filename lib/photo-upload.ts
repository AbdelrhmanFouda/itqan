"use client";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { app } from "@/lib/firebase";
import {
  hourlyPhotoPath, fitWithin, PHOTO_MAX_BYTES, PHOTO_QUALITY,
} from "@/lib/photos";

/**
 * Browser half of the hourly log-sheet photo.
 *
 * The bytes go straight from the phone to Firebase Storage using the CLIENT SDK
 * while the user is signed in — so unlike the Firestore writes in this app, the
 * request carries a real `request.auth` and the Storage rules genuinely apply.
 * The server never handles the image; it only records the metadata afterwards
 * (and stamps createdBy from the verified token).
 *
 * The photo is downscaled and re-encoded BEFORE upload. A phone camera file is
 * 3–8 MB; a workshop's wifi is not, and the owner pays for the bytes. A log
 * sheet at 1600px is 200–500 KB and still readable, which is the whole point of
 * photographing it.
 */

const storage = () => getStorage(app);

/** Downscale + re-encode to JPEG. Falls back to the original file if the
 *  browser cannot decode it, rather than blocking the upload. */
async function compress(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    if (!width || !height) return file;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", PHOTO_QUALITY),
    );
    // Only take the re-encode if it actually helped.
    return blob && blob.size > 0 && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export type UploadedPhoto = { path: string; url: string; sizeBytes: number };

/**
 * Compress, upload, and return what the metadata route needs.
 * Throws "too_large" if even the compressed image is implausibly big.
 */
export async function uploadHourlyPhoto(
  file: File,
  date: string,
  machine: string,
): Promise<UploadedPhoto> {
  const blob = await compress(file);
  if (blob.size > PHOTO_MAX_BYTES) throw new Error("too_large");

  const path = hourlyPhotoPath(date, machine, Date.now());
  const objectRef = ref(storage(), path);
  await uploadBytes(objectRef, blob, {
    contentType: "image/jpeg",
    // Kept for anyone browsing the bucket directly; Firestore holds the
    // authoritative record, and createdBy is set server-side, not here.
    customMetadata: { date, machine },
  });
  return { path, url: await getDownloadURL(objectRef), sizeBytes: blob.size };
}

/** Best-effort cleanup so a failed metadata write does not orphan the object. */
export async function removeUploadedPhoto(path: string): Promise<void> {
  try {
    await deleteObject(ref(storage(), path));
  } catch {
    /* already gone, or not permitted — the metadata is what the app reads */
  }
}
