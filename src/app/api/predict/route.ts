import { NextResponse } from "next/server";
import { Client } from "@gradio/client";

export const runtime = "nodejs";

function parseFloatField(value: FormDataEntryValue | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const image = formData.get("image");
    const conf = parseFloatField(formData.get("conf"), 0.25, 0.01, 0.99);
    const iou = parseFloatField(formData.get("iou"), 0.7, 0.1, 0.95);

    if (!(image instanceof File)) {
      return NextResponse.json({ error: "File image wajib diisi." }, { status: 400 });
    }

    // Sambung ke Hugging Face Space
    const app = await Client.connect("salbiyah/pinang-api");

    // Kirim request ke Space
    // app.py: inputs=[gr.Image, gr.Slider(conf), gr.Slider(iou)]
    const result = await app.predict("/predict", [
      image,
      conf,
      iou,
    ]) as any;

    if (!result || !result.data) {
       throw new Error("Hasil dari Hugging Face kosong atau tidak valid.");
    }

    // result.data[0] = Output Gambar dari Gradio (Object URL)
    // result.data[1] = Output JSON string dari Gradio
    const outputImageData = result.data[0];
    const outputJSONString = result.data[1];
    
    // Download gambar hasil deteksi dari URL yang diberikan Hugging Face
    const imageResponse = await fetch(outputImageData.url);
    const imageBuffer = await imageResponse.arrayBuffer();
    const annotatedImage = `data:image/jpeg;base64,${Buffer.from(imageBuffer).toString("base64")}`;

    // Parse JSON
    const parsedData = JSON.parse(outputJSONString);

    return NextResponse.json({
      detections: parsedData.detections || [],
      classCounts: parsedData.classCounts || {},
      modelNames: parsedData.modelNames || {},
      annotatedImage,
      usedParams: {
        conf,
        iou,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inferensi ke Hugging Face gagal.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
