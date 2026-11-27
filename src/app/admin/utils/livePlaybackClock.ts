interface LivePlaybackFrame {
    time: number;
    zoom?: number;
    posX?: number;
    posY?: number;
    isLetterbox?: boolean;
}

type LivePlaybackListener = (frame: Readonly<LivePlaybackFrame>) => void;

export interface LivePlaybackClock {
    emit: (time: number, zoom?: number, posX?: number, posY?: number, isLetterbox?: boolean) => void;
    subscribe: (listener: LivePlaybackListener) => () => void;
    getTime: () => number;
}

/**
 * Zero-allocation 120Hz/144Hz playback pub/sub channel bridging `useSmoothFramingLoop`
 * directly to scrubber playheads, timecode readouts, and framing telemetry without React re-renders.
 */
export const createLivePlaybackClock = (initialTime = 0): LivePlaybackClock => {
    const listeners = new Set<LivePlaybackListener>();
    const frame: LivePlaybackFrame = { time: Number.isFinite(initialTime) ? initialTime : 0 };

    return {
        emit(time, zoom, posX, posY, isLetterbox) {
            if (!Number.isFinite(time)) return;
            frame.time = time;
            frame.zoom = zoom;
            frame.posX = posX;
            frame.posY = posY;
            frame.isLetterbox = isLetterbox;
            for (const fn of listeners) fn(frame);
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        getTime() {
            return frame.time;
        },
    };
};
