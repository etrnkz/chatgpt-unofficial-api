export function fnv1a(str: string): string;
export function solvePow(seed: string, difficulty: string, config: any[], maxAttempts?: number): string | null;
export function buildConfig(overrides?: Record<string, any>): any[];
export function encodeConfig(config: any[]): string;

export function parseSSELine(line: string): any;
export function processSSEEvent(d: any, state: any): any;
export function parseSSEBuffer(text: string): { content: string; conversationId: string | null; messageId: string | null };
export function streamSSEResponse(response: Response): AsyncGenerator<{ text: string; accumulated: string; done: boolean; conversationId: string | null; messageId: string | null }, void, unknown>;

export class CFBypass {
  constructor(opts?: any);
  fetch(url: string, opts?: any): Promise<{ status: number; headers: any; data: string; error?: boolean }>;
  fetchJSON(url: string, opts?: any): Promise<any>;
  fetchStream(url: string, opts?: any): Promise<Response>;
}
