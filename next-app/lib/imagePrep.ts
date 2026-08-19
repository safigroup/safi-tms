"use client";

// Ported from prepare() (index.html) — downscales a photo to a max 1600px
// edge and re-encodes as JPEG before upload, since receipts/documents are
// captured on unreliable connections where a multi-MB phone photo can fail
// to upload at all. Non-image files (PDFs) pass through untouched.
export async function prepareFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });

  const max = 1600;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 900_000) {
    URL.revokeObjectURL(img.src);
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const context = canvas.getContext("2d")!;
  context.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.82),
  );
  URL.revokeObjectURL(img.src);

  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}
