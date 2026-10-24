export enum FFFSType {
  MEMFS = "MEMFS",
  NODEFS = "NODEFS",
  NODERAWFS = "NODERAWFS",
  IDBFS = "IDBFS",
  WORKERFS = "WORKERFS",
  PROXYFS = "PROXYFS",
}

export type FileData = Uint8Array | string;

export interface FSNode {
  name: string;
  isDir: boolean;
}

export interface LogEvent {
  type: string;
  message: string;
}

export interface ProgressEvent {
  progress: number;
  time: number;
}

export type LogEventCallback = (event: LogEvent) => void;
export type ProgressEventCallback = (event: ProgressEvent) => void;

export interface FFMessageLoadConfig {
  coreURL?: string;
  wasmURL?: string;
  workerURL?: string;
  classWorkerURL?: string;
}

export interface FFMessageOptions {
  signal?: AbortSignal;
}

const FFMessageType = {
  LOAD: "LOAD",
  EXEC: "EXEC",
  FFPROBE: "FFPROBE",
  WRITE_FILE: "WRITE_FILE",
  READ_FILE: "READ_FILE",
  DELETE_FILE: "DELETE_FILE",
  RENAME: "RENAME",
  CREATE_DIR: "CREATE_DIR",
  LIST_DIR: "LIST_DIR",
  DELETE_DIR: "DELETE_DIR",
  ERROR: "ERROR",
  DOWNLOAD: "DOWNLOAD",
  PROGRESS: "PROGRESS",
  LOG: "LOG",
  MOUNT: "MOUNT",
  UNMOUNT: "UNMOUNT",
} as const;

const getMessageID = (() => {
  let messageID = 0;
  return () => messageID++;
})();

const ERROR_NOT_LOADED = new Error(
  "ffmpeg is not loaded, call `await ffmpeg.load()` first"
);
const ERROR_TERMINATED = new Error("called FFmpeg.terminate()");

export class FFmpeg {
  #worker: Worker | null = null;
  #resolves: Record<number, (value: any) => void> = {};
  #rejects: Record<number, (reason?: any) => void> = {};
  #logEventCallbacks: LogEventCallback[] = [];
  #progressEventCallbacks: ProgressEventCallback[] = [];
  public loaded = false;

  #registerHandlers = () => {
    if (this.#worker) {
      this.#worker.onmessage = ({ data: { id, type, data } }) => {
        switch (type) {
          case FFMessageType.LOAD:
            this.loaded = true;
            this.#resolves[id]?.(data);
            break;
          case FFMessageType.MOUNT:
          case FFMessageType.UNMOUNT:
          case FFMessageType.EXEC:
          case FFMessageType.FFPROBE:
          case FFMessageType.WRITE_FILE:
          case FFMessageType.READ_FILE:
          case FFMessageType.DELETE_FILE:
          case FFMessageType.RENAME:
          case FFMessageType.CREATE_DIR:
          case FFMessageType.LIST_DIR:
          case FFMessageType.DELETE_DIR:
            this.#resolves[id]?.(data);
            break;
          case FFMessageType.LOG:
            this.#logEventCallbacks.forEach((f) => f(data as LogEvent));
            break;
          case FFMessageType.PROGRESS:
            this.#progressEventCallbacks.forEach((f) =>
              f(data as ProgressEvent)
            );
            break;
          case FFMessageType.ERROR:
            this.#rejects[id]?.(new Error(String(data)));
            break;
        }
        delete this.#resolves[id];
        delete this.#rejects[id];
      };
    }
  };

  #send = (
    { type, data }: { type: string; data?: unknown },
    trans: Transferable[] = [],
    signal?: AbortSignal
  ): Promise<any> => {
    if (!this.#worker) {
      return Promise.reject(ERROR_NOT_LOADED);
    }
    return new Promise((resolve, reject) => {
      const id = getMessageID();
      this.#worker?.postMessage({ id, type, data }, trans);
      this.#resolves[id] = resolve;
      this.#rejects[id] = reject;
      signal?.addEventListener(
        "abort",
        () => {
          reject(new DOMException(`Message # ${id} was aborted`, "AbortError"));
        },
        { once: true }
      );
    });
  };

  on(event: "log", callback: LogEventCallback): void;
  on(event: "progress", callback: ProgressEventCallback): void;
  on(
    event: "log" | "progress",
    callback: LogEventCallback | ProgressEventCallback
  ): void {
    if (event === "log") {
      this.#logEventCallbacks.push(callback as LogEventCallback);
    } else if (event === "progress") {
      this.#progressEventCallbacks.push(callback as ProgressEventCallback);
    }
  }

  off(event: "log", callback: LogEventCallback): void;
  off(event: "progress", callback: ProgressEventCallback): void;
  off(
    event: "log" | "progress",
    callback: LogEventCallback | ProgressEventCallback
  ): void {
    if (event === "log") {
      this.#logEventCallbacks = this.#logEventCallbacks.filter(
        (f) => f !== callback
      );
    } else if (event === "progress") {
      this.#progressEventCallbacks = this.#progressEventCallbacks.filter(
        (f) => f !== callback
      );
    }
  }

  load = (
    { classWorkerURL, ...config }: FFMessageLoadConfig = {},
    { signal }: FFMessageOptions = {}
  ): Promise<boolean> => {
    if (!this.#worker) {
      const workerUrl = classWorkerURL || "/ffmpeg-worker.js";
      this.#worker = new Worker(workerUrl);
      this.#registerHandlers();
    }
    return this.#send(
      {
        type: FFMessageType.LOAD,
        data: config,
      },
      undefined,
      signal
    );
  };

  exec = (
    args: string[],
    timeout = -1,
    { signal }: FFMessageOptions = {}
  ): Promise<number> =>
    this.#send(
      {
        type: FFMessageType.EXEC,
        data: { args, timeout },
      },
      undefined,
      signal
    );

  ffprobe = (
    args: string[],
    timeout = -1,
    { signal }: FFMessageOptions = {}
  ): Promise<number> =>
    this.#send(
      {
        type: FFMessageType.FFPROBE,
        data: { args, timeout },
      },
      undefined,
      signal
    );

  terminate = (): void => {
    const ids = Object.keys(this.#rejects);
    for (const id of ids) {
      const numId = Number(id);
      this.#rejects[numId]?.(ERROR_TERMINATED);
      delete this.#rejects[numId];
      delete this.#resolves[numId];
    }
    if (this.#worker) {
      this.#worker.terminate();
      this.#worker = null;
      this.loaded = false;
    }
  };

  writeFile = (
    path: string,
    data: FileData,
    { signal }: FFMessageOptions = {}
  ): Promise<boolean> => {
    const trans: Transferable[] = [];
    if (data instanceof Uint8Array) {
      trans.push(data.buffer);
    }
    return this.#send(
      {
        type: FFMessageType.WRITE_FILE,
        data: { path, data },
      },
      trans,
      signal
    );
  };

  mount = (
    fsType: FFFSType | string,
    options: { files?: File[]; blobs?: Array<{ name: string; data: Blob }> },
    mountPoint: string
  ): Promise<boolean> => {
    return this.#send(
      {
        type: FFMessageType.MOUNT,
        data: { fsType, options, mountPoint },
      },
      []
    );
  };

  unmount = (mountPoint: string): Promise<boolean> => {
    return this.#send(
      {
        type: FFMessageType.UNMOUNT,
        data: { mountPoint },
      },
      []
    );
  };

  readFile = (
    path: string,
    encoding = "binary",
    { signal }: FFMessageOptions = {}
  ): Promise<FileData> =>
    this.#send(
      {
        type: FFMessageType.READ_FILE,
        data: { path, encoding },
      },
      undefined,
      signal
    );

  deleteFile = (
    path: string,
    { signal }: FFMessageOptions = {}
  ): Promise<boolean> =>
    this.#send(
      {
        type: FFMessageType.DELETE_FILE,
        data: { path },
      },
      undefined,
      signal
    );

  rename = (
    oldPath: string,
    newPath: string,
    { signal }: FFMessageOptions = {}
  ): Promise<boolean> =>
    this.#send(
      {
        type: FFMessageType.RENAME,
        data: { oldPath, newPath },
      },
      undefined,
      signal
    );

  createDir = (
    path: string,
    { signal }: FFMessageOptions = {}
  ): Promise<boolean> =>
    this.#send(
      {
        type: FFMessageType.CREATE_DIR,
        data: { path },
      },
      undefined,
      signal
    );

  listDir = (
    path: string,
    { signal }: FFMessageOptions = {}
  ): Promise<FSNode[]> =>
    this.#send(
      {
        type: FFMessageType.LIST_DIR,
        data: { path },
      },
      undefined,
      signal
    );

  deleteDir = (
    path: string,
    { signal }: FFMessageOptions = {}
  ): Promise<boolean> =>
    this.#send(
      {
        type: FFMessageType.DELETE_DIR,
        data: { path },
      },
      undefined,
      signal
    );
}
