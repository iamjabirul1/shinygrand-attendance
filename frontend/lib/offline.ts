"use client";
import { get, set } from "idb-keyval";

const KEY = "attendance-outbox";

export type Queued = { image_base64: string; station_id: string; client_time: string; retries: number };

export async function enqueue(q: Queued) {
  const arr: Queued[] = (await get(KEY)) || [];
  arr.push(q);
  await set(KEY, arr);
}

export async function dequeueAll(): Promise<Queued[]> {
  return (await get(KEY)) || [];
}

export async function clearQueue() {
  await set(KEY, []);
}

export async function removeOne(idx: number) {
  const arr: Queued[] = (await get(KEY)) || [];
  arr.splice(idx, 1);
  await set(KEY, arr);
}
