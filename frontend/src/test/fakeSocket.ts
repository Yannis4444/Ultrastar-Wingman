/**
 * Stands in for the browser socket: no test may open a real connection (jsdom
 * would try). `deliver` is how a test plays a backend broadcast.
 */
export class FakeSocket {
  static last: FakeSocket | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }

  static deliver(message: unknown): void {
    FakeSocket.last?.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(message) }),
    );
  }
}
