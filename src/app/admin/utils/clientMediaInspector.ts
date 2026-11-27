import type { PlaybackSyncProfile, SourceFrameIndex, SourceMediaInfo } from "@/types/news";

export { extractAudioM4aBlob } from "./m4aAudioRemuxer";

interface ClientMediaInspectionResult {
    mediaInfo: SourceMediaInfo;
    durationSec?: number;
    keyframeTimes: number[];
}

export interface ParsedBox {
    type: string;
    start: number;
    dataStart: number;
    end: number;
}

const MAX_MOOV_BYTES = 32 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 256;

const VIDEO_CODEC_MAP: Record<string, string> = {
    av01: "av1", avc1: "h264", avc3: "h264", hvc1: "hevc", hev1: "hevc", vp09: "vp9", vp08: "vp8", mp4v: "mpeg4",
};

const AUDIO_CODEC_MAP: Record<string, string> = {
    mp4a: "aac", opus: "opus", "ac-3": "ac3", "ec-3": "eac3", ".mp3": "mp3", "mp3 ": "mp3", flac: "flac",
    sowt: "pcm", twos: "pcm", lpcm: "pcm", in24: "pcm", in32: "pcm",
};

const WEBM_VIDEO_CODECS: ReadonlyArray<readonly [string, string]> = [
    ["V_AV1", "av1"], ["V_VP9", "vp9"], ["V_VP8", "vp8"], ["V_MPEGH/ISO/HEVC", "hevc"], ["V_MPEG4/ISO/AVC", "h264"],
];

const WEBM_AUDIO_CODECS: ReadonlyArray<readonly [string, string]> = [
    ["A_OPUS", "opus"], ["A_VORBIS", "vorbis"], ["A_AAC", "aac"], ["A_MPEG/L3", "mp3"],
];

export const readFourCC = (view: DataView, offset: number): string =>
    String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));

export const readUint64 = (view: DataView, offset: number): number =>
    view.getUint32(offset, false) * 4294967296 + view.getUint32(offset + 4, false);

const readInt64 = (view: DataView, offset: number): number =>
    view.getInt32(offset, false) * 4294967296 + view.getUint32(offset + 4, false);

export const getMoovDataStart = (view: DataView): number =>
    readFourCC(view, 4) === "moov" ? (view.getUint32(0, false) === 1 ? 16 : 8) : 0;

/** Shared ISO-BMFF version 0/1 timescale + duration reader for both `mdhd` and `mvhd` boxes. */
const readTimescaleDuration = (view: DataView, dataStart: number, end: number): { timescale: number; durationSec: number } | null => {
    if (dataStart + 4 > end) return null;
    const version = view.getUint8(dataStart);
    if (version === 1 && dataStart + 32 <= end) {
        const timescale = view.getUint32(dataStart + 20, false);
        return { timescale, durationSec: timescale > 0 ? readUint64(view, dataStart + 24) / timescale : 0 };
    }
    if (version === 0 && dataStart + 20 <= end) {
        const timescale = view.getUint32(dataStart + 12, false);
        return { timescale, durationSec: timescale > 0 ? view.getUint32(dataStart + 16, false) / timescale : 0 };
    }
    return null;
};

const normalizeVideoCodec = (fourcc: string): string => {
    const lc = fourcc.toLowerCase();
    return VIDEO_CODEC_MAP[lc] ?? (lc.trim() || "unknown");
};

const normalizeAudioCodec = (fourcc: string): string => {
    const lc = fourcc.toLowerCase();
    return AUDIO_CODEC_MAP[lc] ?? (lc.trim() || "unknown");
};

export const iterChildBoxes = (view: DataView, start: number, end: number): ParsedBox[] => {
    const boxes: ParsedBox[] = [];
    let pos = start;
    let guard = 0;
    while (pos + 8 <= end && guard < 2048) {
        guard += 1;
        let size = view.getUint32(pos, false);
        const type = readFourCC(view, pos + 4);
        let headerSize = 8;
        if (size === 1) {
            if (pos + 16 > end) break;
            size = readUint64(view, pos + 8);
            headerSize = 16;
        } else if (size === 0) {
            size = end - pos;
        }
        if (size < headerSize || pos + size > end) break;
        boxes.push({ type, start: pos, dataStart: pos + headerSize, end: pos + size });
        pos += size;
    }
    return boxes;
};

/** Returns the first direct child box matching `type` within `[start, end)` (`P158`). */
export const findBox = (view: DataView, start: number, end: number, type: string): ParsedBox | null => {
    for (const box of iterChildBoxes(view, start, end)) {
        if (box.type === type) return box;
    }
    return null;
};

interface ParsedTrackSummary {
    kind: "vide" | "soun" | "other";
    codec?: string;
    timescale: number;
    durationSec: number;
    width: number;
    height: number;
    sampleRate?: number;
    channels?: number;
    elstMediaTimeTicks: number;
    elstEmptyDelayMovieTicks: number;
    frameCount: number;
    exactFps: number;
    isVfr: boolean;
    hasBFrames: boolean;
    keyframeTimes: number[];
    maxGopSec?: number;
    avgGopSec?: number;
}

const parseTrackBox = (view: DataView, trakStart: number, trakEnd: number): ParsedTrackSummary => {
    const out: ParsedTrackSummary = {
        kind: "other", timescale: 0, durationSec: 0, width: 0, height: 0,
        elstMediaTimeTicks: 0, elstEmptyDelayMovieTicks: 0, frameCount: 0,
        exactFps: 0, isVfr: false, hasBFrames: false, keyframeTimes: [],
    };

    let tentativeStsdW = 0;
    let tentativeStsdH = 0;
    let tentativeChannels: number | undefined;
    let tentativeSampleRate: number | undefined;
    let isRotated90 = false;
    const sttsEntries: Array<{ count: number; delta: number }> = [];
    const stssIndices: number[] = [];
    let hasStssBox = false;

    const tkhd = findBox(view, trakStart, trakEnd, "tkhd");
    if (tkhd && tkhd.dataStart + 4 <= tkhd.end) {
        const version = view.getUint8(tkhd.dataStart);
        const widthOff = tkhd.dataStart + (version === 1 ? 88 : 76);
        const matrixOff = widthOff - 36;
        if (widthOff + 8 <= tkhd.end) {
            if (matrixOff >= tkhd.dataStart) {
                const a = view.getInt32(matrixOff, false);
                const b = view.getInt32(matrixOff + 4, false);
                const c = view.getInt32(matrixOff + 12, false);
                const d = view.getInt32(matrixOff + 16, false);
                // ±90°/270° rotation matrix has a=0, d=0, b!=0, c!=0 (`P143`)
                isRotated90 = a === 0 && d === 0 && b !== 0 && c !== 0;
            }
            const tkW = view.getUint32(widthOff, false) / 65536;
            const tkH = view.getUint32(widthOff + 4, false) / 65536;
            if (tkW > 0 && tkH > 0) {
                out.width = Math.round(isRotated90 ? tkH : tkW);
                out.height = Math.round(isRotated90 ? tkW : tkH);
            }
        }
    }

    const edts = findBox(view, trakStart, trakEnd, "edts");
    const elst = edts ? findBox(view, edts.dataStart, edts.end, "elst") : null;
    if (elst && elst.dataStart + 8 <= elst.end) {
        const version = view.getUint8(elst.dataStart);
        const entryCount = view.getUint32(elst.dataStart + 4, false);
        const entrySize = version === 1 ? 20 : 12;
        let off = elst.dataStart + 8;
        for (let i = 0; i < Math.min(entryCount, 8) && off + entrySize <= elst.end; i++) {
            const segDur = version === 1 ? readUint64(view, off) : view.getUint32(off, false);
            const mediaTime = version === 1 ? readInt64(view, off + 8) : view.getInt32(off + 4, false);
            off += entrySize;
            if (mediaTime < 0) out.elstEmptyDelayMovieTicks += segDur;
            else { out.elstMediaTimeTicks = mediaTime; break; }
        }
    }

    const mdia = findBox(view, trakStart, trakEnd, "mdia");
    if (mdia) {
        const mdhd = findBox(view, mdia.dataStart, mdia.end, "mdhd");
        const td = mdhd ? readTimescaleDuration(view, mdhd.dataStart, mdhd.end) : null;
        if (td) { out.timescale = td.timescale; out.durationSec = td.durationSec; }

        const hdlr = findBox(view, mdia.dataStart, mdia.end, "hdlr");
        if (hdlr && hdlr.dataStart + 12 <= hdlr.end) {
            const hType = readFourCC(view, hdlr.dataStart + 8);
            if (hType === "vide" || hType === "soun") out.kind = hType;
        }

        const minf = findBox(view, mdia.dataStart, mdia.end, "minf");
        const stbl = minf ? findBox(view, minf.dataStart, minf.end, "stbl") : null;
        if (stbl) {
            for (const sChild of iterChildBoxes(view, stbl.dataStart, stbl.end)) {
                if (sChild.type === "stsd" && sChild.dataStart + 16 <= sChild.end) {
                    if (view.getUint32(sChild.dataStart + 4, false) > 0) {
                        const entryStart = sChild.dataStart + 8;
                        const entrySize = view.getUint32(entryStart, false);
                        out.codec = readFourCC(view, entryStart + 4);
                        if (entryStart + 36 <= sChild.end && entrySize >= 36) {
                            tentativeStsdW = view.getUint16(entryStart + 32, false);
                            tentativeStsdH = view.getUint16(entryStart + 34, false);
                            tentativeChannels = view.getUint16(entryStart + 24, false);
                            tentativeSampleRate = view.getUint32(entryStart + 32, false) >>> 16;
                        }
                    }
                } else if (sChild.type === "stts" && sChild.dataStart + 8 <= sChild.end) {
                    const count = view.getUint32(sChild.dataStart + 4, false);
                    let off = sChild.dataStart + 8;
                    const maxEntries = Math.min(count, Math.floor((sChild.end - off) / 8));
                    for (let i = 0; i < maxEntries; i++, off += 8) {
                        sttsEntries.push({ count: view.getUint32(off, false), delta: view.getUint32(off + 4, false) });
                    }
                } else if (sChild.type === "stss" && sChild.dataStart + 8 <= sChild.end) {
                    hasStssBox = true;
                    const count = view.getUint32(sChild.dataStart + 4, false);
                    let off = sChild.dataStart + 8;
                    const maxEntries = Math.min(count, Math.floor((sChild.end - off) / 4));
                    for (let i = 0; i < maxEntries; i++, off += 4) stssIndices.push(view.getUint32(off, false));
                } else if (sChild.type === "ctts" && sChild.dataStart + 8 <= sChild.end) {
                    if (view.getUint32(sChild.dataStart + 4, false) > 0) out.hasBFrames = true;
                }
            }
        }
    }

    if (out.kind === "vide") {
        if (out.width === 0 && tentativeStsdW > 0 && tentativeStsdH > 0) {
            out.width = isRotated90 ? tentativeStsdH : tentativeStsdW;
            out.height = isRotated90 ? tentativeStsdW : tentativeStsdH;
        }
    } else if (out.kind === "soun") {
        out.width = 0;
        out.height = 0;
        if (tentativeChannels && tentativeChannels > 0 && tentativeChannels <= 16) out.channels = tentativeChannels;
        if (tentativeSampleRate && tentativeSampleRate >= 8000 && tentativeSampleRate <= 192000) out.sampleRate = tentativeSampleRate;
    }

    if (out.kind === "vide" && out.timescale > 0 && sttsEntries.length > 0) {
        let totalSamples = 0;
        let totalTicks = 0;
        const distinctDeltas = new Set<number>();
        for (const e of sttsEntries) {
            totalSamples += e.count;
            totalTicks += e.count * e.delta;
            if (e.count > 1 && e.delta > 0) distinctDeltas.add(e.delta);
        }
        out.frameCount = totalSamples;
        if (totalSamples > 0 && totalTicks > 0) {
            const rawFps = (totalSamples * out.timescale) / totalTicks;
            if (Number.isFinite(rawFps) && rawFps > 0 && rawFps < 240) out.exactFps = Math.round(rawFps * 1000) / 1000;
        }
        out.isVfr = distinctDeltas.size > 2;

        if (stssIndices.length > 0) {
            const sortedIdx = stssIndices.toSorted((a, b) => a - b);
            const times: number[] = [];
            let sttsPos = 0;
            let sampleCursor = 1;
            let tickCursor = 0;
            for (const targetSample of sortedIdx) {
                if (targetSample < 1) continue;
                while (sttsPos < sttsEntries.length) {
                    const entry = sttsEntries[sttsPos]!;
                    const entryEndSample = sampleCursor + entry.count;
                    if (targetSample < entryEndSample) {
                        const ptsTicks = tickCursor + (targetSample - sampleCursor) * entry.delta;
                        const ptsSec = Math.max(0, Math.round((ptsTicks / out.timescale) * 1000) / 1000);
                        if (times.length === 0 || ptsSec > times[times.length - 1]!) times.push(ptsSec);
                        break;
                    }
                    tickCursor += entry.count * entry.delta;
                    sampleCursor = entryEndSample;
                    sttsPos += 1;
                }
            }
            out.keyframeTimes = times;
            if (times.length >= 2) {
                let maxGap = 0;
                let gapSum = 0;
                for (let i = 1; i < times.length; i++) {
                    const gap = times[i]! - times[i - 1]!;
                    if (gap > maxGap) maxGap = gap;
                    gapSum += gap;
                }
                const tailGap = out.durationSec > times[times.length - 1]! ? out.durationSec - times[times.length - 1]! : 0;
                if (tailGap > maxGap) maxGap = tailGap;
                out.maxGopSec = Math.round(maxGap * 1000) / 1000;
                out.avgGopSec = Math.round((gapSum / (times.length - 1)) * 1000) / 1000;
            } else if (times.length === 1 && out.durationSec > 0) {
                out.maxGopSec = Math.round(out.durationSec * 1000) / 1000;
                out.avgGopSec = out.maxGopSec;
            }
        } else if (!hasStssBox && out.frameCount > 0 && out.exactFps > 0) {
            const frameDur = Math.round((1 / out.exactFps) * 1000) / 1000;
            out.maxGopSec = frameDur;
            out.avgGopSec = frameDur;
        }
    }

    return out;
};

/** Parses an ISO-BMFF `moov` box ArrayBuffer into normalized video/audio metadata and exact keyframe timestamps. */
export const parseMoovBuffer = (
    moovBuf: ArrayBuffer,
    options?: { container?: "mp4" | "mov"; moovBeforeMdat?: boolean; fileSize?: number }
): ClientMediaInspectionResult | null => {
    if (moovBuf.byteLength < 16) return null;
    const view = new DataView(moovBuf);

    let videoTrack: ParsedTrackSummary | null = null;
    let audioTrack: ParsedTrackSummary | null = null;
    let mvhdTimescale = 0;
    let mvhdDurationSec = 0;
    let isFragmented = false;

    for (const child of iterChildBoxes(view, getMoovDataStart(view), moovBuf.byteLength)) {
        if (child.type === "mvhd") {
            const td = readTimescaleDuration(view, child.dataStart, child.end);
            if (td) { mvhdTimescale = td.timescale; mvhdDurationSec = td.durationSec; }
        } else if (child.type === "mvex") {
            isFragmented = true;
        } else if (child.type === "trak") {
            const parsed = parseTrackBox(view, child.dataStart, child.end);
            if (parsed.kind === "vide" && !videoTrack) videoTrack = parsed;
            else if (parsed.kind === "soun" && !audioTrack) audioTrack = parsed;
        }
    }

    if (!videoTrack) return null;

    const exactFps = videoTrack.exactFps > 0 ? videoTrack.exactFps : 30;
    const durationSec = videoTrack.durationSec > 0 ? videoTrack.durationSec : (mvhdDurationSec > 0 ? mvhdDurationSec : undefined);
    const mediaTrimSec = audioTrack && audioTrack.timescale > 0 && audioTrack.elstMediaTimeTicks > 0
        ? audioTrack.elstMediaTimeTicks / audioTrack.timescale : 0;
    const emptyEditDelaySec = audioTrack && mvhdTimescale > 0 && audioTrack.elstEmptyDelayMovieTicks > 0
        ? audioTrack.elstEmptyDelayMovieTicks / mvhdTimescale : 0;
    const audioDelaySec = Math.round((emptyEditDelaySec - mediaTrimSec) * 10000) / 10000;
    const resolvedAudioDelaySec = audioDelaySec === 0 ? 0 : (emptyEditDelaySec > 0 ? audioDelaySec : Math.round(mediaTrimSec * 10000) / 10000);
    const avDurationDeltaSec = audioTrack && videoTrack.durationSec > 0 && audioTrack.durationSec > 0
        ? Math.round((videoTrack.durationSec - audioTrack.durationSec) * 1000) / 1000 : 0;

    return {
        durationSec,
        keyframeTimes: videoTrack.keyframeTimes,
        mediaInfo: {
            width: videoTrack.width,
            height: videoTrack.height,
            exactFps,
            nominalFps: Math.round(exactFps),
            videoCodec: videoTrack.codec ? normalizeVideoCodec(videoTrack.codec) : undefined,
            audioCodec: audioTrack?.codec ? normalizeAudioCodec(audioTrack.codec) : undefined,
            hasAudio: Boolean(audioTrack),
            audioSampleRate: audioTrack?.sampleRate,
            audioChannels: audioTrack?.channels,
            audioDelaySec: Number.isFinite(resolvedAudioDelaySec) ? resolvedAudioDelaySec : 0,
            avDurationDeltaSec: Number.isFinite(avDurationDeltaSec) ? avDurationDeltaSec : 0,
            maxGopSec: videoTrack.maxGopSec,
            avgGopSec: videoTrack.avgGopSec,
            keyframeCount: videoTrack.keyframeTimes.length || undefined,
            hasBFrames: videoTrack.hasBFrames,
            isVfr: videoTrack.isVfr,
            isFragmented: isFragmented || undefined,
            moovBeforeMdat: options?.moovBeforeMdat,
            container: options?.container ?? "mp4",
            isHdr: false,
            fileSize: options?.fileSize,
        },
    };
};

const inspectWebmHeader = (headerBytes: Uint8Array, fileSize: number): ClientMediaInspectionResult => {
    const ascii = new TextDecoder("latin1").decode(headerBytes);
    const videoCodec = WEBM_VIDEO_CODECS.find(([marker]) => ascii.includes(marker))?.[1];
    const audioCodec = WEBM_AUDIO_CODECS.find(([marker]) => ascii.includes(marker))?.[1];
    return {
        keyframeTimes: [],
        mediaInfo: {
            width: 0, height: 0, exactFps: 30, nominalFps: 30,
            videoCodec, audioCodec, hasAudio: Boolean(audioCodec), container: "webm", isHdr: false, fileSize,
        },
    };
};

export const locateIsoBmffMoov = async (
    blob: Blob
): Promise<{ container: "mp4" | "mov"; moovBuf: ArrayBuffer; moovBeforeMdat: boolean } | null> => {
    let container: "mp4" | "mov" = "mp4";
    let moovOffset = -1;
    let moovSize = 0;
    let mdatOffset = -1;
    let pos = 0;
    let boxCount = 0;

    while (pos + 8 <= blob.size && boxCount < MAX_TOP_LEVEL_BOXES) {
        boxCount += 1;
        const hdrBuf = await blob.slice(pos, Math.min(blob.size, pos + 16)).arrayBuffer();
        if (hdrBuf.byteLength < 8) break;
        const hv = new DataView(hdrBuf);
        let size = hv.getUint32(0, false);
        const type = readFourCC(hv, 4);
        let headerSize = 8;
        if (size === 1) {
            if (hdrBuf.byteLength < 16) break;
            size = readUint64(hv, 8);
            headerSize = 16;
        } else if (size === 0) {
            size = blob.size - pos;
        }
        if (size < headerSize || pos + size > blob.size) break;

        if (type === "ftyp" && hdrBuf.byteLength >= 12) {
            if (readFourCC(hv, 8).toLowerCase() === "qt  ") container = "mov";
        } else if (type === "moov") {
            moovOffset = pos;
            moovSize = size;
            if (mdatOffset >= 0) break;
        } else if (type === "mdat" && mdatOffset < 0) {
            mdatOffset = pos;
            if (moovOffset >= 0) break;
        }
        pos += size;
    }

    if (moovOffset < 0 || moovSize < 16 || moovSize > MAX_MOOV_BYTES) return null;
    const moovBuf = await blob.slice(moovOffset, moovOffset + moovSize).arrayBuffer();
    return { container, moovBuf, moovBeforeMdat: mdatOffset < 0 || moovOffset < mdatOffset };
};

/** Inspects an uploaded `Blob` / `File` locally in `< 5ms` by reading only its container header (`moov` or EBML). */
export const inspectVideoBlob = async (blob: Blob): Promise<ClientMediaInspectionResult | null> => {
    try {
        if (!blob || blob.size < 16) return null;
        const probeHead = await blob.slice(0, Math.min(blob.size, 64)).arrayBuffer();
        if (new DataView(probeHead).getUint32(0, false) === 0x1a45dfa3) {
            const ebmlSlice = await blob.slice(0, Math.min(blob.size, 65536)).arrayBuffer();
            return inspectWebmHeader(new Uint8Array(ebmlSlice), blob.size);
        }
        const located = await locateIsoBmffMoov(blob);
        if (!located) return null;
        return parseMoovBuffer(located.moovBuf, {
            container: located.container, moovBeforeMdat: located.moovBeforeMdat, fileSize: blob.size,
        });
    } catch {
        return null;
    }
};

/** Binary-searches the nearest IDR keyframe timestamp in `keyframeTimes` (returns `null` when unavailable). */
export const findNearestKeyframe = (keyframeTimes: readonly number[] | undefined, targetSec: number): number | null => {
    if (!keyframeTimes || keyframeTimes.length === 0) return null;
    const safeTarget = Math.max(0, Number.isFinite(targetSec) ? targetSec : 0);
    let lo = 0;
    let hi = keyframeTimes.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (keyframeTimes[mid]! < safeTarget) lo = mid + 1;
        else hi = mid;
    }
    const curr = keyframeTimes[lo]!;
    const prev = lo > 0 ? keyframeTimes[lo - 1]! : curr;
    return Math.abs(prev - safeTarget) <= Math.abs(curr - safeTarget) ? prev : curr;
};

/** Converts server-indexed `SourceFrameIndex` (0-based frame indices) into sorted keyframe timestamps in seconds. */
export const extractKeyframeTimesFromFrameIndex = (frameIndex: SourceFrameIndex | undefined): number[] | undefined => {
    if (!frameIndex?.keyframes?.length) return undefined;
    const rawFps = frameIndex.fps > 0 ? frameIndex.fps : frameIndex.nominalFps;
    const fps = Number.isFinite(rawFps) && rawFps > 0 ? rawFps : 0;
    const times: number[] = [];
    for (const rawIdx of frameIndex.keyframes) {
        if (!Number.isFinite(rawIdx) || rawIdx < 0) continue;
        const frameIdx = Math.trunc(rawIdx);
        let t: number | undefined;
        if (!frameIndex.cfr && frameIndex.pts && frameIdx < frameIndex.pts.length) {
            const ptsVal = frameIndex.pts[frameIdx];
            if (ptsVal !== undefined && Number.isFinite(ptsVal)) t = ptsVal;
        }
        if (t === undefined && fps > 0) t = frameIdx / fps;
        if (t !== undefined && Number.isFinite(t)) {
            const rounded = Math.max(0, Math.round(t * 1000) / 1000);
            if (times.length === 0 || rounded > times[times.length - 1]!) times.push(rounded);
        }
    }
    return times.length > 0 ? times : undefined;
};

/** Classifies a clip + runtime environment into a deterministic playback sync strategy (`decoupled-audio-lock`, `keyframe-scrub`, or `standard`). */
export const classifyPlaybackProfile = (
    mediaInfo: SourceMediaInfo | undefined,
    isCompactOrTouch: boolean,
    isBlobUrl: boolean
): PlaybackSyncProfile => {
    const hasAudio = mediaInfo?.hasAudio !== false;
    const codec = (mediaInfo?.videoCodec || "").toLowerCase();
    const isAv1 = codec === "av1" || codec.startsWith("av01");
    const isHevc = codec === "hevc" || codec === "h265" || codec.startsWith("hvc1") || codec.startsWith("hev1");
    const isHighRes = (mediaInfo?.width ?? 0) >= 2560 || (mediaInfo?.height ?? 0) >= 2160;
    const maxGop = mediaInfo?.maxGopSec ?? 0;
    const isTailMoovLarge = mediaInfo?.moovBeforeMdat === false && (mediaInfo?.fileSize ?? 0) >= 20 * 1024 * 1024;
    const hasAvDelta = Math.abs(mediaInfo?.avDurationDeltaSec ?? 0) > 0.5;
    const isFragmented = mediaInfo?.isFragmented === true;

    if ((isCompactOrTouch || isBlobUrl) && hasAudio) {
        if (isAv1 || isHevc || isHighRes || maxGop >= 3.5 || isTailMoovLarge || hasAvDelta || isFragmented) return "decoupled-audio-lock";
        if (isCompactOrTouch && isBlobUrl && !mediaInfo) return "decoupled-audio-lock";
    }
    if (maxGop > 2.5 || isAv1 || isHighRes) return "keyframe-scrub";
    return "standard";
};
