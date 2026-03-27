import { createMediaControlHeaders } from "./control-auth";
import type {
  CreateMediaSessionInput,
  CreateMediaSessionResult,
  MediaAdapter,
  RecordingControlInput,
} from "./types";

interface ControlPlaneFetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export class CloudflareRealtimeAdapter implements MediaAdapter {
  constructor(
    private readonly controlPlane: ControlPlaneFetcher = globalThis,
    private readonly controlPlaneSecret?: string,
  ) {}

  async createSession(input: CreateMediaSessionInput): Promise<CreateMediaSessionResult> {
    return this.postJson<CreateMediaSessionResult>("/v1/control/sessions", input);
  }

  async startRecording(input: RecordingControlInput): Promise<{ recordingId: string }> {
    return this.postJson<{ recordingId: string }>("/v1/control/recordings/start", input);
  }

  async stopRecording(input: RecordingControlInput): Promise<{ stopped: true }> {
    return this.postJson<{ stopped: true }>("/v1/control/recordings/stop", input);
  }

  private async postJson<T>(path: string, payload: unknown): Promise<T> {
    const bodyText = JSON.stringify(payload);
    const response = await this.controlPlane.fetch(`https://media.internal${path}`, {
      method: "POST",
      headers: await createMediaControlHeaders(bodyText, this.controlPlaneSecret),
      body: bodyText,
    });

    const body = (await response.json().catch(() => null)) as T | { error?: string } | null;
    if (!response.ok || !body) {
      const error =
        typeof body === "object" && body && "error" in body && typeof body.error === "string"
          ? body.error
          : `media_control_request_failed_${response.status}`;
      throw new Error(error);
    }

    return body as T;
  }
}
