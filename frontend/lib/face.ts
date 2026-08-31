"use client";
// Browser face recognition using @vladmandic/face-api (128-d, no Docker, runs on Vercel free)
// Models at /models (SSD + landmark + recognition) ~12MB total, cached

let loaded = false;
let loadPromise: Promise<void> | null = null;

export async function loadFaceModels() {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    // Fix WASM backend not initialized: ensure tf is ready before face-api
    const tf: any = await import("@tensorflow/tfjs");
    try {
      await tf.ready();
      // Prefer WebGL (GPU) if available, fallback to CPU/WASM — avoids WASM init race
      const current = tf.getBackend();
      if (!current || current === "cpu") {
        try { await tf.setBackend("webgl"); await tf.ready(); } catch {}
        if (tf.getBackend() !== "webgl") {
          try { await tf.setBackend("cpu"); await tf.ready(); } catch {}
        }
      }
      console.log("tf backend:", tf.getBackend());
    } catch (e) {
      console.warn("tf ready failed", e);
    }
    const faceapi: any = await import("@vladmandic/face-api");
    // Ensure face-api uses same tf instance
    // @ts-ignore
    if (faceapi.tf) {
      try { await faceapi.tf.ready(); } catch {}
    }
    const modelUrl = "/models";
    // Load tiny first (fast, low mem) + SSD for accuracy — both cached, ~12MB
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(modelUrl),
      faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
      faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl),
      faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(modelUrl),
    ]);
    loaded = true;
    console.log("face-api models loaded, tf:", tf.getBackend());
  })();
  return loadPromise;
}

export async function getDescriptorFromVideo(video: HTMLVideoElement): Promise<number[] | null> {
  await loadFaceModels();
  const faceapi: any = await import("@vladmandic/face-api");
  // Try SSD first (accurate), fallback to tiny (fast, low light) — both use same 128-d
  let result: any = null;
  try {
    const ssdOpts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 });
    result = await faceapi.detectSingleFace(video, ssdOpts).withFaceLandmarks().withFaceDescriptor();
  } catch (e) {
    console.warn("SSD fail", e);
  }
  if (!result) {
    try {
      const tinyOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 });
      result = await faceapi.detectSingleFace(video, tinyOpts).withFaceLandmarks(true).withFaceDescriptor();
    } catch (e) {
      console.warn("Tiny fail", e);
    }
  }
  if (!result || !result.descriptor) return null;
  return Array.from(result.descriptor as Float32Array);
}

export async function getDescriptorFromCanvas(canvas: HTMLCanvasElement): Promise<number[] | null> {
  await loadFaceModels();
  const faceapi: any = await import("@vladmandic/face-api");
  let result: any = null;
  try {
    const ssdOpts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 });
    result = await faceapi.detectSingleFace(canvas, ssdOpts).withFaceLandmarks().withFaceDescriptor();
  } catch {}
  if (!result) {
    try {
      const tinyOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 });
      result = await faceapi.detectSingleFace(canvas, tinyOpts).withFaceLandmarks(true).withFaceDescriptor();
    } catch {}
  }
  if (!result || !result.descriptor) return null;
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
