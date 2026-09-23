// A fixed set of worker threads; tasks queue until a worker is free.

import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type { NameMatch } from "../src/matcher.ts";
import type { MatchTask } from "./match-worker.ts";

interface Job {
  id: number;
  task: MatchTask;
  resolve: (m: NameMatch) => void;
  reject: (e: Error) => void;
}

export class MatchPool {
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private running = new Map<Worker, Job>();
  private nextId = 0;

  constructor(size = Math.max(1, availableParallelism() - 1)) {
    for (let i = 0; i < size; i++) this.spawn();
  }

  get size() {
    return this.idle.length + this.running.size;
  }

  private spawn() {
    const worker = new Worker(new URL("./match-worker.ts", import.meta.url));
    worker.on("message", (msg: { id: number; match?: NameMatch; error?: string }) => {
      const job = this.running.get(worker);
      this.running.delete(worker);
      if (job) {
        if (msg.error !== undefined) job.reject(new Error(msg.error));
        else job.resolve(msg.match!);
      }
      this.idle.push(worker);
      this.drain();
    });
    worker.on("error", (err: Error) => {
      // A crashed worker takes its job with it; replace the worker.
      this.running.get(worker)?.reject(err);
      this.running.delete(worker);
      this.idle = this.idle.filter((w) => w !== worker);
      this.spawn();
      this.drain();
    });
    this.idle.push(worker);
  }

  private drain() {
    while (this.idle.length && this.queue.length) {
      const worker = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.running.set(worker, job);
      worker.postMessage({ id: job.id, task: job.task });
    }
  }

  run(task: MatchTask): Promise<NameMatch> {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, task, resolve, reject });
      this.drain();
    });
  }
}
