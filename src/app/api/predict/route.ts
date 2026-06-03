import { NextResponse } from "next/server";
import { Client } from "@gradio/client";

export const runtime = "nodejs";

let gradioClientPromise: Promise<Client> | null = null;

function getGradioClient() {
  if (!gradioClientPromise) {
    gradioClientPromise = Client.connect("salbiyah/pinang-api").catch((err) => {
      gradioClientPromise = null;
      throw err;
    });
  }
  return gradioClientPromise;
}

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
    const imgsz = parseFloatField(formData.get("imgsz"), 768, 300, 1200);
    const lite = formData.get("lite") === "1";

    if (!(image instanceof File)) {
      return NextResponse.json({ error: "File image wajib diisi." }, { status: 400 });
    }

    const bytes = await image.arrayBuffer();
    const base64Str = Buffer.from(bytes).toString("base64");

    const app = await getGradioClient();

    // Kirim request ke Space endpoint baru (/predict_api)
    // app.py: inputs=[gr.Textbox(base64Str), gr.Number(conf), gr.Number(iou), gr.Number(imgsz)]
    const result = await app.predict("/predict_api", [
      base64Str,
      conf,
      iou,
      imgsz,
    ]) as any;

    if (!result || !result.data) {
       throw new Error("Hasil dari Hugging Face kosong atau tidak valid.");
    }

    const outputJSONString = result.data[0];
    const parsedData = typeof outputJSONString === "string" ? JSON.parse(outputJSONString) : outputJSONString;

    if (parsedData.python_error) {
       throw new Error(`[Python Error] ${parsedData.python_error}\nTrace: ${parsedData.trace}`);
    }

    const annotatedImage = parsedData.image_base64
      ? `data:image/jpeg;base64,${parsedData.image_base64}`
      : "";

    return NextResponse.json({
      detections: parsedData.detections || [],
      classCounts: parsedData.classCounts || {},
      modelNames: parsedData.modelNames || {},
      imageWidth: parsedData.imageWidth || 800,
      imageHeight: parsedData.imageHeight || 800,
      modelPath: parsedData.modelPath || "salbiyah/pinang-api (YOLOv8)",
      ...(lite ? {} : { annotatedImage }),
      usedParams: {
        conf,
        iou,
        imgsz,
      },
    });
  } catch (error: any) {
    console.error("Gradio Error Details:", error);
    
    let errorDetails = "";
    try {
      errorDetails = JSON.stringify(error, Object.getOwnPropertyNames(error));
    } catch {
      errorDetails = String(error);
    }
    
    return NextResponse.json({ 
      error: error?.message || "Inferensi ke Hugging Face gagal.", 
      details: errorDetails 
    }, { status: 500 });
  }
}
