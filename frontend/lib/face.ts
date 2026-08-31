"use client";
// Browser face recognition using @vladmandic/face-api (128-d, no Docker, runs on Vercel free)
// Models at /models (SSD + landmark + recognition) ~12MB total, cached

let loaded = false;
let loadPromise: Promise<void> | null = null;

export async function loadFaceModels() {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const faceapi = await import("@vladmandic/face-api");
    // @ts-ignore - faceapi needs to be global for some internals
    const modelUrl = "/models";
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(modelUrl),
      faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
      faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl),
      faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(modelUrl),
    ]);
    loaded = true;
    console.log("face-api models loaded");
  })();
  return loadPromise;
}

export async function getDescriptorFromVideo(video: HTMLVideoElement): Promise<number[] | null> {
  await loadFaceModels();
  const faceapi: any = await import("@vladmandic/face-api");
  // Use SSD for best accuracy (like mobile apps), fallback to tiny if needed
  const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });
  const result: any = await faceapi
    .detectSingleFace(video, options)
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!result) return null;
  // result.descriptor is Float32Array 128
  return Array.from(result.descriptor as Float32Array);
}

export async function getDescriptorFromCanvas(canvas: HTMLCanvasElement): Promise<number[] | null> {
  await loadFaceModels();
  const faceapi: any = await import("@vladmandic/face-api");
  const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });
  const result: any = await faceapi
    .detectSingleFace(canvas, options)
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!result) return null;
  return Array.from(result.descriptor as Float32Array);
}

export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  const denom = Math.sqrt(nA) * Math.sqrt(nB) + 1e-9;
  return 1 - dot / denom;
}
