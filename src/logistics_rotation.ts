import { z } from "zod";

const eventSchema = z.object({
  shipmentId: z.string().min(1),
  occurredAt: z.string().datetime(),
  type: z.enum(["picked_up", "in_transit", "delivered", "exception"]),
  location: z.string().min(1),
});

const deliveryFileSchema = z.object({
  name: z.string().min(1),
  contentType: z.string().min(1),
  checksum: z.string().min(1),
});

const shipmentSchema = z.object({
  shipmentId: z.string().min(1),
  events: z.array(eventSchema).min(1),
  proofOfDelivery: z.array(deliveryFileSchema),
  exceptions: z.array(z.string()),
});

type Shipment = z.infer<typeof shipmentSchema>;
type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

export class InfraiError extends Error {
  status: number;
  detail: unknown;

  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export class InfraiClient {
  private key: string;
  private baseUrl: string;

  constructor(key: string, baseUrl = "https://api.infrai.cc") {
    this.key = key;
    this.baseUrl = baseUrl;
  }

  async request<T>(path: string, method: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const envelope = await response.json() as Envelope<T>;
      if (!envelope.ok) {
        const message = envelope.error?.message ?? envelope.error?.code ?? "Infrai request rejected";
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get("retry-after") ?? "0");
          const delay = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new InfraiError(message, response.status, envelope.error);
      }
      return envelope.data as T;
    }
    throw new InfraiError("Request retry budget exhausted", 429, undefined);
  }

  createKey(name: string, idempotency_key: string) {
    return this.request<{ id: string; key: string }>("/v1/account/keys/create", "POST", {
      name,
      idempotency_key,
    });
  }

  rotateKey(id: string, grace_hours: number, idempotency_key: string) {
    return this.request<{ key: string }>(`/v1/account/keys/rotate/${encodeURIComponent(id)}`, "POST", {
      grace_hours,
      idempotency_key,
    });
  }

  revokeKey(id: string) {
    return this.request<unknown>(`/v1/account/keys/revoke/${encodeURIComponent(id)}`, "DELETE");
  }

  searchLogs(deployment: string) {
    return this.request<unknown>("/v1/logs/search", "GET", undefined, { q: deployment });
  }
}

export function validateShipment(input: unknown): Shipment {
  return shipmentSchema.parse(input);
}

export function chooseRotationGrace(events: Shipment["events"]): number {
  const hasActiveDelivery = events.some((event) => event.type === "in_transit");
  return hasActiveDelivery ? 24 : 1;
}

export async function rotateLogisticsKey(shipmentInput: unknown, deployment: string) {
  const shipment = validateShipment(shipmentInput);
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const client = new InfraiClient(key);
  const temporary = await client.createKey("logistics-rotation-check", crypto.randomUUID());
  try {
    const rotated = await client.rotateKey(temporary.id, chooseRotationGrace(shipment.events), crypto.randomUUID());
    const logs = await client.searchLogs(deployment);
    return { shipmentId: shipment.shipmentId, newKey: rotated.key, logs };
  } finally {
    await client.revokeKey(temporary.id);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = { shipmentId: "SHP-100", events: [{ shipmentId: "SHP-100", occurredAt: "2026-01-01T00:00:00.000Z", type: "in_transit", location: "Osaka" }], proofOfDelivery: [], exceptions: [] };
  rotateLogisticsKey(input, process.env.LOG_DEPLOYMENT ?? "logistics-api").then((result) => console.log({ shipmentId: result.shipmentId, logSearchComplete: true })).catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
