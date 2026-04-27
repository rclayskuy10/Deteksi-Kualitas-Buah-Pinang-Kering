import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type PythonDetection = {
  className: string;
  confidence: number;
  box: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
};

type PythonResponse = {
  detections: PythonDetection[];
  imageWidth: number;
  imageHeight: number;
  modelNames: Record<string, string>;
  classCounts: Record<string, number>;
};

function parseFloatField(value: FormDataEntryValue | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function parseIntField(value: FormDataEntryValue | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

async function runPythonInference(args: string[]): Promise<PythonResponse> {
  const workspaceRoot = path.resolve(process.cwd(), "..");
  const venvPython =
    process.platform === "win32"
      ? path.join(workspaceRoot, ".venv", "Scripts", "python.exe")
      : path.join(workspaceRoot, ".venv", "bin", "python");

  let pythonCommand = process.env.PYTHON_PATH || "python";

  try {
    await fs.access(venvPython);
    pythonCommand = venvPython;
  } catch {
    // Use PYTHON_PATH or system python when local venv does not exist.
  }

  return new Promise((resolve, reject) => {
    const child = spawn(pythonCommand, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(stderr || `Python process exited with code ${code?.toString() ?? "unknown"}.`),
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as PythonResponse;
        resolve(parsed);
      } catch {
        reject(new Error("Tidak bisa membaca output JSON dari script Python."));
      }
    });
  });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const image = formData.get("image");
    const conf = parseFloatField(formData.get("conf"), 0.25, 0.01, 0.99);
    const iou = parseFloatField(formData.get("iou"), 0.7, 0.1, 0.95);
    const imgsz = parseIntField(formData.get("imgsz"), 768, 320, 1280);

    if (!(image instanceof File)) {
      return NextResponse.json({ error: "File image wajib diisi." }, { status: 400 });
    }

    const extension = ".jpg";
    const rootDir = process.cwd();
    const tempRoot = path.join(rootDir, ".tmp");
    const uploadDir = path.join(tempRoot, "uploads");
    const outputDir = path.join(tempRoot, "outputs");
    const id = randomUUID();
    const inputPath = path.join(uploadDir, `${id}${extension}`);
    const outputPath = path.join(outputDir, `${id}.jpg`);

    await fs.mkdir(uploadDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });

    const bytes = await image.arrayBuffer();
    await fs.writeFile(inputPath, Buffer.from(bytes));

    const defaultModel = path.resolve(
      /* turbopackIgnore: true */ rootDir,
      "..",
      "Model Fix",
      "weights",
      "best.pt",
    );
    const modelPath = process.env.MODEL_PATH || defaultModel;
    const scriptPath = path.join(/* turbopackIgnore: true */ rootDir, "python", "predict.py");

    await fs.access(modelPath);

    const result = await runPythonInference([
      scriptPath,
      "--model",
      modelPath,
      "--source",
      inputPath,
      "--output",
      outputPath,
      "--conf",
      conf.toString(),
      "--imgsz",
      imgsz.toString(),
      "--iou",
      iou.toString(),
    ]);

    const outputBuffer = await fs.readFile(outputPath);
    const annotatedImage = `data:image/jpeg;base64,${outputBuffer.toString("base64")}`;

    await Promise.allSettled([fs.unlink(inputPath), fs.unlink(outputPath)]);

    return NextResponse.json({
      ...result,
      annotatedImage,
      modelPath,
      usedParams: {
        conf,
        iou,
        imgsz,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inferensi gagal dijalankan.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
