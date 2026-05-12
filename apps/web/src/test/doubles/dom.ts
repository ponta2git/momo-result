import { vi } from "vitest";

export type FakeMediaTrack = {
  stop: ReturnType<typeof vi.fn>;
  readyState: "live" | "ended";
};

export type MockMediaStream = {
  stream: MediaStream;
  track: FakeMediaTrack;
};

export function createMockMediaStream(): MockMediaStream {
  const track: FakeMediaTrack = {
    stop: vi.fn(() => {
      track.readyState = "ended";
    }),
    readyState: "live",
  };
  const fake: Pick<MediaStream, "getTracks" | "active"> = {
    getTracks: () => [track as unknown as MediaStreamTrack],
    get active() {
      return track.readyState === "live";
    },
  };
  return { stream: fake as MediaStream, track };
}

export type VideoElementSpies = {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  restore: () => void;
};

export function installVideoElementSpies(): VideoElementSpies {
  const proto = HTMLVideoElement.prototype;
  const originalPlay = proto.play;
  const originalPause = proto.pause;
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  proto.play = play as unknown as HTMLVideoElement["play"];
  proto.pause = pause as unknown as HTMLVideoElement["pause"];
  return {
    play,
    pause,
    restore: () => {
      proto.play = originalPlay;
      proto.pause = originalPause;
    },
  };
}

export type CanvasElementSpies = {
  getContext: ReturnType<typeof vi.fn>;
  toBlob: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  restore: () => void;
};

export function installCanvasElementSpies(
  blob: Blob = new Blob(["x"], { type: "image/png" }),
): CanvasElementSpies {
  const proto = HTMLCanvasElement.prototype;
  const originalGetContext = proto.getContext;
  const originalToBlob = proto.toBlob;
  const drawImage = vi.fn();
  const getContext = vi.fn(() => ({ drawImage }) as unknown as CanvasRenderingContext2D);
  const toBlob = vi.fn((cb: BlobCallback) => {
    cb(blob);
  });
  proto.getContext = getContext as unknown as HTMLCanvasElement["getContext"];
  proto.toBlob = toBlob as unknown as HTMLCanvasElement["toBlob"];
  return {
    getContext,
    toBlob,
    drawImage,
    restore: () => {
      proto.getContext = originalGetContext;
      proto.toBlob = originalToBlob;
    },
  };
}

export type VideoReadyController = {
  set: (ready: boolean) => void;
  restore: () => void;
};

export function installVideoReadyController(): VideoReadyController {
  const proto = HTMLVideoElement.prototype;
  const originalReadyState = Object.getOwnPropertyDescriptor(proto, "readyState");
  const originalVideoWidth = Object.getOwnPropertyDescriptor(proto, "videoWidth");
  const originalVideoHeight = Object.getOwnPropertyDescriptor(proto, "videoHeight");
  let ready = false;
  Object.defineProperty(proto, "readyState", {
    configurable: true,
    get: () => (ready ? 4 : 0),
  });
  Object.defineProperty(proto, "videoWidth", {
    configurable: true,
    get: () => (ready ? 640 : 0),
  });
  Object.defineProperty(proto, "videoHeight", {
    configurable: true,
    get: () => (ready ? 480 : 0),
  });
  return {
    set: (next: boolean) => {
      ready = next;
    },
    restore: () => {
      if (originalReadyState) Object.defineProperty(proto, "readyState", originalReadyState);
      else delete (proto as unknown as Record<string, unknown>)["readyState"];
      if (originalVideoWidth) Object.defineProperty(proto, "videoWidth", originalVideoWidth);
      else delete (proto as unknown as Record<string, unknown>)["videoWidth"];
      if (originalVideoHeight) Object.defineProperty(proto, "videoHeight", originalVideoHeight);
      else delete (proto as unknown as Record<string, unknown>)["videoHeight"];
    },
  };
}

export type FetchCall = [RequestInfo | URL, RequestInit | undefined];

export function fetchCallsOf(fetchMock: ReturnType<typeof vi.fn>): FetchCall[] {
  return fetchMock.mock.calls as unknown as FetchCall[];
}

export type MatchMediaController = {
  setMatches: (matches: boolean) => void;
  restore: () => void;
};

export function installMatchMediaController(initialMatches: boolean): MatchMediaController {
  const originalMatchMedia = window.matchMedia;
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  window.matchMedia = vi.fn((query: string) => {
    const media: MediaQueryList = {
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      },
      addListener: (listener) => {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      },
      dispatchEvent: () => true,
      matches,
      media: query,
      onchange: null,
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      },
      removeListener: (listener) => {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      },
    };
    return media;
  });

  return {
    restore: () => {
      window.matchMedia = originalMatchMedia;
    },
    setMatches: (next) => {
      matches = next;
      const event = { matches, media: "" } as MediaQueryListEvent;
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}
