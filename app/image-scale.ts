// Shrink a chosen photo to ≤1024px JPEG so the vision request stays small (Vercel
// caps request bodies ~4.5MB; full-res phone photos blow past that as base64).
export async function fileToScaledJpeg(file: File, max = 1024): Promise<{ base64: string; mediaType: "image/jpeg" }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return { base64: canvas.toDataURL("image/jpeg", 0.85).split(",")[1], mediaType: "image/jpeg" };
}
