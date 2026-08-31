// The minimal slices of the Express request / response the HTTP building
// blocks touch. Declared once so the filter and the middleware agree on the
// shape without either pulling in `@types/express`.

export interface HttpRequest {
  headers: Record<string, string | undefined>;
  requestId?: string;
}

export interface HttpResponse {
  status: (code: number) => HttpResponse;
  type: (value: string) => HttpResponse;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
}
