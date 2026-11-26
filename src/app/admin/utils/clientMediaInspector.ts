import type { PlaybackSyncProfile, SourceFrameIndex, SourceMediaInfo } from "@/types/news";

interface ClientMediaInspectionResult {
    mediaInfo: SourceMediaInfo;
    durationSec?: number;
    keyframeTimes: number[];
}

const MAX_MOOV_BYTES = 32 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 256;

const readFourCC = (view: DataView, offset: number): string =>
    String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
    );

const readUint64 = (view: DataView, offset: number): number => {
    const hi = view.getUint32(offset, false);
    const lo = view.getUint32(offset + 4, false);
    return hi * 4294967296 + lo;
};

const readInt64 = (view: DataView, offset: number): number => {
    const hi = view.getInt32(offset, false);
    const lo = view.getUint32(offset + 4, false);
    return hi * 4294967296 + lo;
};

const normalizeVideoCodec = (fourcc: string): string => {
    const lc = fourcc.toLowerCase();
    if (lc === 'av01') return 'av1';
    if (lc === 'avc1' || lc === 'avc3') return 'h264';
    if (lc === 'hvc1' || lc === 'hev1') return 'hevc';
    if (lc === 'vp09') return 'vp9';
    if (lc === 'vp08') return 'vp8';
    if (lc === 'mp4v') return 'mpeg4';
    return lc.trim() || 'unknown';
};

const normalizeAudioCodec = (fourcc: string): string => {
    const lc = fourcc.toLowerCase();
    if (lc === 'mp4a') return 'aac';
    if (lc === 'opus') return 'opus';
    if (lc === 'ac-3') return 'ac3';
    if (lc === 'ec-3') return 'eac3';
    if (lc === '.mp3' || lc === 'mp3 ') return 'mp3';
    if (lc === 'flac') return 'flac';
    if (lc === 'sowt' || lc === 'twos' || lc === 'lpcm' || lc === 'in24' || lc === 'in32') return 'pcm';
    return lc.trim() || 'unknown';
};

interface ParsedBox {
    type: string;
    start: number;
    dataStart: number;
    end: number;
}

const iterChildBoxes = (view: DataView, start: number, end: number): ParsedBox[] => {
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

interface ParsedTrackSummary {
    kind: 'vide' | 'soun' | 'other';
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
        kind: 'other',
        timescale: 0,
        durationSec: 0,
        width: 0,
        height: 0,
        elstMediaTimeTicks: 0,
        elstEmptyDelayMovieTicks: 0,
        frameCount: 0,
        exactFps: 0,
        isVfr: false,
        hasBFrames: false,
        keyframeTimes: [],
    };

    let tentativeStsdW = 0;
    let tentativeStsdH = 0;
    let tentativeChannels: number | undefined;
    let tentativeSampleRate: number | undefined;

    const sttsEntries: Array<{ count: number; delta: number }> = [];
    const stssIndices: number[] = [];
    let hasStssBox = false;

    for (const child of iterChildBoxes(view, trakStart, trakEnd)) {
        if (child.type === 'tkhd' && child.dataStart + 4 <= child.end) {
            const version = view.getUint8(child.dataStart);
            const widthOff = child.dataStart + (version === 1 ? 88 : 76);
            if (widthOff + 8 <= child.end) {
                const tkW = view.getUint32(widthOff, false) / 65536;
                const tkH = view.getUint32(widthOff + 4, false) / 65536;
                if (tkW > 0 && tkH > 0) {
                    out.width = Math.round(tkW);
                    out.height = Math.round(tkH);
                }
            }
        } else if (child.type === 'edts') {
            for (const edChild of iterChildBoxes(view, child.dataStart, child.end)) {
                if (edChild.type === 'elst' && edChild.dataStart + 8 <= edChild.end) {
                    const version = view.getUint8(edChild.dataStart);
                    const entryCount = view.getUint32(edChild.dataStart + 4, false);
                    const entrySize = version === 1 ? 20 : 12;
                    let off = edChild.dataStart + 8;
                    for (let i = 0; i < Math.min(entryCount, 8) && off + entrySize <= edChild.end; i++) {
                        const segDur = version === 1 ? readUint64(view, off) : view.getUint32(off, false);
                        const mediaTime = version === 1 ? readInt64(view, off + 8) : view.getInt32(off + 4, false);
                        off += entrySize;
                        if (mediaTime < 0) {
                            out.elstEmptyDelayMovieTicks += segDur;
                        } else {
                            out.elstMediaTimeTicks = mediaTime;
                            break;
                        }
                    }
                }
            }
        } else if (child.type === 'mdia') {
            for (const mChild of iterChildBoxes(view, child.dataStart, child.end)) {
                if (mChild.type === 'mdhd' && mChild.dataStart + 4 <= mChild.end) {
                    const version = view.getUint8(mChild.dataStart);
                    if (version === 1 && mChild.dataStart + 32 <= mChild.end) {
                        out.timescale = view.getUint32(mChild.dataStart + 20, false);
                        const dur = readUint64(view, mChild.dataStart + 24);
                        if (out.timescale > 0) out.durationSec = dur / out.timescale;
                    } else if (version === 0 && mChild.dataStart + 20 <= mChild.end) {
                        out.timescale = view.getUint32(mChild.dataStart + 12, false);
                        const dur = view.getUint32(mChild.dataStart + 16, false);
                        if (out.timescale > 0) out.durationSec = dur / out.timescale;
                    }
                } else if (mChild.type === 'hdlr' && mChild.dataStart + 12 <= mChild.end) {
                    const hType = readFourCC(view, mChild.dataStart + 8);
                    if (hType === 'vide' || hType === 'soun') out.kind = hType;
                } else if (mChild.type === 'minf') {
                    for (const minfChild of iterChildBoxes(view, mChild.dataStart, mChild.end)) {
                        if (minfChild.type !== 'stbl') continue;
                        for (const sChild of iterChildBoxes(view, minfChild.dataStart, minfChild.end)) {
                            if (sChild.type === 'stsd' && sChild.dataStart + 16 <= sChild.end) {
                                const entryCount = view.getUint32(sChild.dataStart + 4, false);
                                if (entryCount > 0) {
                                    const entryStart = sChild.dataStart + 8;
                                    const entrySize = view.getUint32(entryStart, false);
                                    const fourcc = readFourCC(view, entryStart + 4);
                                    out.codec = fourcc;
                                    if (entryStart + 36 <= sChild.end && entrySize >= 36) {
                                        // Record both visual and audio fields; resolve strictly after `hdlr` kind is finalized
                                        tentativeStsdW = view.getUint16(entryStart + 32, false);
                                        tentativeStsdH = view.getUint16(entryStart + 34, false);
                                        tentativeChannels = view.getUint16(entryStart + 24, false);
                                        tentativeSampleRate = view.getUint32(entryStart + 32, false) >>> 16;
                                    }
                                }
                            } else if (sChild.type === 'stts' && sChild.dataStart + 8 <= sChild.end) {
                                const count = view.getUint32(sChild.dataStart + 4, false);
                                let off = sChild.dataStart + 8;
                                const maxEntries = Math.min(count, Math.floor((sChild.end - off) / 8));
                                for (let i = 0; i < maxEntries; i++) {
                                    const sampleCount = view.getUint32(off, false);
                                    const sampleDelta = view.getUint32(off + 4, false);
                                    sttsEntries.push({ count: sampleCount, delta: sampleDelta });
                                    off += 8;
                                }
                            } else if (sChild.type === 'stss' && sChild.dataStart + 8 <= sChild.end) {
                                hasStssBox = true;
                                const count = view.getUint32(sChild.dataStart + 4, false);
                                let off = sChild.dataStart + 8;
                                const maxEntries = Math.min(count, Math.floor((sChild.end - off) / 4));
                                for (let i = 0; i < maxEntries; i++) {
                                    stssIndices.push(view.getUint32(off, false));
                                    off += 4;
                                }
                            } else if (sChild.type === 'ctts' && sChild.dataStart + 8 <= sChild.end) {
                                const count = view.getUint32(sChild.dataStart + 4, false);
                                if (count > 0) out.hasBFrames = true;
                            }
                        }
                    }
                }
            }
        }
    }

    if (out.kind === 'vide') {
        if (out.width === 0 && tentativeStsdW > 0 && tentativeStsdH > 0) {
            out.width = tentativeStsdW;
            out.height = tentativeStsdH;
        }
    } else if (out.kind === 'soun') {
        out.width = 0;
        out.height = 0;
        if (tentativeChannels && tentativeChannels > 0 && tentativeChannels <= 16) {
            out.channels = tentativeChannels;
        }
        if (tentativeSampleRate && tentativeSampleRate >= 8000 && tentativeSampleRate <= 192000) {
            out.sampleRate = tentativeSampleRate;
        }
    }

    if (out.kind === 'vide' && out.timescale > 0 && sttsEntries.length > 0) {
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
            if (Number.isFinite(rawFps) && rawFps > 0 && rawFps < 240) {
                out.exactFps = Math.round(rawFps * 1000) / 1000;
            }
        }
        out.isVfr = distinctDeltas.size > 2;

        // Convert 1-based stss keyframe sample indices into exact sorted seconds via cumulative stts walk
        if (stssIndices.length > 0) {
            const sortedIdx = [...stssIndices].sort((a, b) => a - b);
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
                        const offsetInEntry = targetSample - sampleCursor;
                        const ptsTicks = tickCursor + offsetInEntry * entry.delta;
                        const ptsSec = Math.max(0, Math.round((ptsTicks / out.timescale) * 1000) / 1000);
                        if (times.length === 0 || ptsSec > times[times.length - 1]!) {
                            times.push(ptsSec);
                        }
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
                const tailGap = out.durationSec > times[times.length - 1]!
                    ? out.durationSec - times[times.length - 1]!
                    : 0;
                if (tailGap > maxGap) maxGap = tailGap;
                out.maxGopSec = Math.round(maxGap * 1000) / 1000;
                out.avgGopSec = Math.round((gapSum / (times.length - 1)) * 1000) / 1000;
            } else if (times.length === 1 && out.durationSec > 0) {
                out.maxGopSec = Math.round(out.durationSec * 1000) / 1000;
                out.avgGopSec = out.maxGopSec;
            }
        } else if (!hasStssBox && out.frameCount > 0 && out.exactFps > 0) {
            // ISO-BMFF spec: absence of an `stss` box means every sample is an IDR sync frame (All-Intra)
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
    options?: { container?: 'mp4' | 'mov'; moovBeforeMdat?: boolean; fileSize?: number }
): ClientMediaInspectionResult | null => {
    if (moovBuf.byteLength < 16) return null;
    const view = new DataView(moovBuf);
    const rootType = readFourCC(view, 4);
    const startOffset = rootType === 'moov'
        ? (view.getUint32(0, false) === 1 ? 16 : 8)
        : 0;

    let videoTrack: ParsedTrackSummary | null = null;
    let audioTrack: ParsedTrackSummary | null = null;
    let mvhdTimescale = 0;
    let mvhdDurationSec = 0;
    let isFragmented = false;

    for (const child of iterChildBoxes(view, startOffset, moovBuf.byteLength)) {
        if (child.type === 'mvhd' && child.dataStart + 4 <= child.end) {
            const version = view.getUint8(child.dataStart);
            if (version === 1 && child.dataStart + 32 <= child.end) {
                const ts = view.getUint32(child.dataStart + 20, false);
                const dur = readUint64(view, child.dataStart + 24);
                mvhdTimescale = ts;
                if (ts > 0) mvhdDurationSec = dur / ts;
            } else if (version === 0 && child.dataStart + 20 <= child.end) {
                const ts = view.getUint32(child.dataStart + 12, false);
                const dur = view.getUint32(child.dataStart + 16, false);
                mvhdTimescale = ts;
                if (ts > 0) mvhdDurationSec = dur / ts;
            }
        } else if (child.type === 'mvex') {
            isFragmented = true;
        } else if (child.type === 'trak') {
            const parsed = parseTrackBox(view, child.dataStart, child.end);
            if (parsed.kind === 'vide' && !videoTrack) videoTrack = parsed;
            else if (parsed.kind === 'soun' && !audioTrack) audioTrack = parsed;
        }
    }

    if (!videoTrack) return null;

    const exactFps = videoTrack.exactFps > 0 ? videoTrack.exactFps : 30;
    const durationSec = videoTrack.durationSec > 0 ? videoTrack.durationSec : (mvhdDurationSec > 0 ? mvhdDurationSec : undefined);
    const mediaTrimSec = audioTrack && audioTrack.timescale > 0 && audioTrack.elstMediaTimeTicks > 0
        ? audioTrack.elstMediaTimeTicks / audioTrack.timescale
        : 0;
    const emptyEditDelaySec = audioTrack && mvhdTimescale > 0 && audioTrack.elstEmptyDelayMovieTicks > 0
        ? audioTrack.elstEmptyDelayMovieTicks / mvhdTimescale
        : 0;
    const audioDelaySec = Math.round((emptyEditDelaySec - mediaTrimSec) * 10000) / 10000;
    const resolvedAudioDelaySec = audioDelaySec === 0 ? 0 : (emptyEditDelaySec > 0 ? audioDelaySec : Math.round(mediaTrimSec * 10000) / 10000);
    const avDurationDeltaSec = audioTrack && videoTrack.durationSec > 0 && audioTrack.durationSec > 0
        ? Math.round((videoTrack.durationSec - audioTrack.durationSec) * 1000) / 1000
        : 0;

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
            audioDelaySec: resolvedAudioDelaySec,
            avDurationDeltaSec,
            maxGopSec: videoTrack.maxGopSec,
            avgGopSec: videoTrack.avgGopSec,
            keyframeCount: videoTrack.keyframeTimes.length || undefined,
            hasBFrames: videoTrack.hasBFrames,
            isVfr: videoTrack.isVfr,
            isFragmented: isFragmented || undefined,
            moovBeforeMdat: options?.moovBeforeMdat,
            container: options?.container ?? 'mp4',
            isHdr: false,
            fileSize: options?.fileSize,
        },
    };
};

const inspectWebmHeader = (headerBytes: Uint8Array, fileSize: number): ClientMediaInspectionResult => {
    const ascii = new TextDecoder('latin1').decode(headerBytes);
    const videoCodec = ascii.includes('V_AV1')
        ? 'av1'
        : ascii.includes('V_VP9')
            ? 'vp9'
            : ascii.includes('V_VP8')
                ? 'vp8'
                : ascii.includes('V_MPEGH/ISO/HEVC')
                    ? 'hevc'
                    : ascii.includes('V_MPEG4/ISO/AVC')
                        ? 'h264'
                        : undefined;
    const audioCodec = ascii.includes('A_OPUS')
        ? 'opus'
        : ascii.includes('A_VORBIS')
            ? 'vorbis'
            : ascii.includes('A_AAC')
                ? 'aac'
                : ascii.includes('A_MPEG/L3')
                    ? 'mp3'
                    : undefined;
    return {
        keyframeTimes: [],
        mediaInfo: {
            width: 0,
            height: 0,
            exactFps: 30,
            nominalFps: 30,
            videoCodec,
            audioCodec,
            hasAudio: Boolean(audioCodec),
            container: 'webm',
            isHdr: false,
            fileSize,
        },
    };
};

const locateIsoBmffMoov = async (
    blob: Blob
): Promise<{ container: 'mp4' | 'mov'; moovBuf: ArrayBuffer; moovBeforeMdat: boolean } | null> => {
    let container: 'mp4' | 'mov' = 'mp4';
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

        if (type === 'ftyp' && hdrBuf.byteLength >= 12) {
            const brand = readFourCC(hv, 8).toLowerCase();
            if (brand === 'qt  ') container = 'mov';
        } else if (type === 'moov') {
            moovOffset = pos;
            moovSize = size;
            if (mdatOffset >= 0) break;
        } else if (type === 'mdat' && mdatOffset < 0) {
            mdatOffset = pos;
            if (moovOffset >= 0) break;
        }
        pos += size;
    }

    if (moovOffset < 0 || moovSize < 16 || moovSize > MAX_MOOV_BYTES) return null;
    const moovBuf = await blob.slice(moovOffset, moovOffset + moovSize).arrayBuffer();
    return { container, moovBuf, moovBeforeMdat: mdatOffset < 0 || moovOffset < mdatOffset };
};

const buildM4aFtypBox = (): Uint8Array => {
    // 28-byte ISO-BMFF ftyp: major='M4A ', minor=0, compatible=['M4A ', 'mp42', 'isom']
    const out = new Uint8Array(28);
    new DataView(out.buffer).setUint32(0, 28, false);
    const brands = 'ftypM4A \0\0\0\0M4A mp42isom';
    for (let i = 0; i < brands.length; i++) out[4 + i] = brands.charCodeAt(i);
    return out;
};

/**
 * Extracts a pure, `+faststart` audio-only `.m4a` `Blob` from a non-fragmented ISO-BMFF MP4/MOV `Blob`
 * in `< 25ms` with zero dependencies and zero video-byte reads (slices only audio chunks via `blob.slice()`).
 * Returns `null` for WebM/MKV, fragmented MP4 (`mvex`), or audio-less clips so callers fall back cleanly.
 */
export const extractAudioM4aBlob = async (blob: Blob): Promise<Blob | null> => {
    try {
        if (!blob || blob.size < 32) return null;
        const probeHead = await blob.slice(0, 16).arrayBuffer();
        if (probeHead.byteLength < 8 || new DataView(probeHead).getUint32(0, false) === 0x1a45dfa3) return null;

        const located = await locateIsoBmffMoov(blob);
        if (!located) return null;
        const { moovBuf } = located;
        const moovBytes = new Uint8Array(moovBuf);
        const view = new DataView(moovBuf);
        const rootType = readFourCC(view, 4);
        const moovDataStart = rootType === 'moov' ? (view.getUint32(0, false) === 1 ? 16 : 8) : 0;

        let mvhdBox: ParsedBox | null = null;
        let audioTrakBox: ParsedBox | null = null;
        let stscBox: ParsedBox | null = null;
        let stszBox: ParsedBox | null = null;
        let chunkOffsetBox: (ParsedBox & { is64: boolean }) | null = null;

        for (const child of iterChildBoxes(view, moovDataStart, moovBuf.byteLength)) {
            if (child.type === 'mvex') return null; // Fragmented MP4 requires moof/trun remuxing -> fallback
            if (child.type === 'mvhd' && !mvhdBox) {
                mvhdBox = child;
            } else if (child.type === 'trak' && !audioTrakBox) {
                let isSoun = false;
                let foundStsc: ParsedBox | null = null;
                let foundStsz: ParsedBox | null = null;
                let foundChunkOff: (ParsedBox & { is64: boolean }) | null = null;
                for (const tChild of iterChildBoxes(view, child.dataStart, child.end)) {
                    if (tChild.type !== 'mdia') continue;
                    for (const mChild of iterChildBoxes(view, tChild.dataStart, tChild.end)) {
                        if (mChild.type === 'hdlr' && mChild.dataStart + 12 <= mChild.end) {
                            isSoun = readFourCC(view, mChild.dataStart + 8) === 'soun';
                        } else if (mChild.type === 'minf') {
                            for (const minfChild of iterChildBoxes(view, mChild.dataStart, mChild.end)) {
                                if (minfChild.type !== 'stbl') continue;
                                for (const sChild of iterChildBoxes(view, minfChild.dataStart, minfChild.end)) {
                                    if (sChild.type === 'stsc') foundStsc = sChild;
                                    else if (sChild.type === 'stsz') foundStsz = sChild;
                                    else if (sChild.type === 'stco') foundChunkOff = { ...sChild, is64: false };
                                    else if (sChild.type === 'co64') foundChunkOff = { ...sChild, is64: true };
                                }
                            }
                        }
                    }
                }
                if (isSoun && foundStsc && foundStsz && foundChunkOff) {
                    audioTrakBox = child;
                    stscBox = foundStsc;
                    stszBox = foundStsz;
                    chunkOffsetBox = foundChunkOff;
                }
            }
        }

        if (!mvhdBox || !audioTrakBox || !stscBox || !stszBox || !chunkOffsetBox) return null;
        if (chunkOffsetBox.dataStart + 8 > chunkOffsetBox.end || stscBox.dataStart + 8 > stscBox.end || stszBox.dataStart + 12 > stszBox.end) return null;

        const chunkCount = view.getUint32(chunkOffsetBox.dataStart + 4, false);
        const entryByteSize = chunkOffsetBox.is64 ? 8 : 4;
        if (chunkCount === 0 || chunkOffsetBox.dataStart + 8 + chunkCount * entryByteSize > chunkOffsetBox.end) return null;

        // Parse stsc (1-based chunk index -> samples per chunk)
        const stscCount = view.getUint32(stscBox.dataStart + 4, false);
        if (stscCount === 0 || stscBox.dataStart + 8 + stscCount * 12 > stscBox.end) return null;
        const stsc: Array<{ firstChunk: number; spc: number }> = [];
        for (let i = 0; i < stscCount; i++) {
            const off = stscBox.dataStart + 8 + i * 12;
            stsc.push({ firstChunk: view.getUint32(off, false), spc: view.getUint32(off + 4, false) });
        }

        // Parse stsz (uniform sample size or per-sample size table)
        const uniformSampleSize = view.getUint32(stszBox.dataStart + 4, false);
        const sampleCount = view.getUint32(stszBox.dataStart + 8, false);
        if (sampleCount === 0) return null;
        if (uniformSampleSize === 0 && stszBox.dataStart + 12 + sampleCount * 4 > stszBox.end) return null;

        // Compute exact byte range for each audio chunk & coalesce adjacent slices to minimize BlobPart count
        const newChunkRelOffsets = new Float64Array(chunkCount);
        const slices: Blob[] = [];
        let sampleIdx = 0;
        let stscIdx = 0;
        let totalAudioBytes = 0;
        let runStart = -1;
        let runEnd = -1;

        for (let c = 0; c < chunkCount; c++) {
            const chunkNum = c + 1;
            while (stscIdx + 1 < stsc.length && stsc[stscIdx + 1]!.firstChunk <= chunkNum) {
                stscIdx += 1;
            }
            const spc = stsc[stscIdx]!.spc;
            if (sampleIdx + spc > sampleCount) return null;

            let chunkBytes = 0;
            if (uniformSampleSize > 0) {
                chunkBytes = spc * uniformSampleSize;
            } else {
                const tableBase = stszBox.dataStart + 12;
                for (let s = 0; s < spc; s++) {
                    chunkBytes += view.getUint32(tableBase + (sampleIdx + s) * 4, false);
                }
            }
            sampleIdx += spc;

            const offPos = chunkOffsetBox.dataStart + 8 + c * entryByteSize;
            const srcOffset = chunkOffsetBox.is64 ? readUint64(view, offPos) : view.getUint32(offPos, false);
            if (srcOffset < 0 || srcOffset + chunkBytes > blob.size) return null;

            newChunkRelOffsets[c] = totalAudioBytes;
            totalAudioBytes += chunkBytes;

            if (chunkBytes > 0) {
                if (runStart >= 0 && srcOffset === runEnd) {
                    runEnd = srcOffset + chunkBytes;
                } else {
                    if (runStart >= 0) slices.push(blob.slice(runStart, runEnd));
                    runStart = srcOffset;
                    runEnd = srcOffset + chunkBytes;
                }
            }
        }
        if (runStart >= 0) slices.push(blob.slice(runStart, runEnd));
        if (totalAudioBytes <= 0 || slices.length === 0) return null;

        // Build `+faststart` `.m4a`: [ftyp][moov(mvhd + cloned soun trak with rewritten stco/co64)][mdat]
        const ftyp = buildM4aFtypBox();
        const mvhdSlice = moovBytes.subarray(mvhdBox.start, mvhdBox.end);
        const trakSlice = moovBytes.subarray(audioTrakBox.start, audioTrakBox.end);
        const newMoovSize = 8 + mvhdSlice.length + trakSlice.length;
        const newMoov = new Uint8Array(newMoovSize);
        const newMoovView = new DataView(newMoov.buffer);
        newMoovView.setUint32(0, newMoovSize, false);
        newMoov[4] = 0x6d; newMoov[5] = 0x6f; newMoov[6] = 0x6f; newMoov[7] = 0x76; // 'moov'
        newMoov.set(mvhdSlice, 8);
        const trakDestStart = 8 + mvhdSlice.length;
        newMoov.set(trakSlice, trakDestStart);

        const use64Mdat = totalAudioBytes + 8 > 0xffffffff;
        const mdatHeaderSize = use64Mdat ? 16 : 8;
        const mdatDataStart = ftyp.length + newMoovSize + mdatHeaderSize;
        if (!chunkOffsetBox.is64 && mdatDataStart + totalAudioBytes > 0xffffffff) return null;

        // Patch chunk offsets in-place inside cloned soun trak (exact same byte length -> zero parent box resizing!)
        const tableDestOffset = trakDestStart + (chunkOffsetBox.dataStart - audioTrakBox.start) + 8;
        for (let c = 0; c < chunkCount; c++) {
            const absOff = mdatDataStart + newChunkRelOffsets[c]!;
            const dest = tableDestOffset + c * entryByteSize;
            if (chunkOffsetBox.is64) {
                newMoovView.setUint32(dest, Math.floor(absOff / 4294967296), false);
                newMoovView.setUint32(dest + 4, absOff >>> 0, false);
            } else {
                newMoovView.setUint32(dest, absOff >>> 0, false);
            }
        }

        const mdatHeader = new Uint8Array(mdatHeaderSize);
        const mdatView = new DataView(mdatHeader.buffer);
        if (use64Mdat) {
            mdatView.setUint32(0, 1, false);
            mdatHeader[4] = 0x6d; mdatHeader[5] = 0x64; mdatHeader[6] = 0x61; mdatHeader[7] = 0x74;
            const totalMdat = totalAudioBytes + 16;
            mdatView.setUint32(8, Math.floor(totalMdat / 4294967296), false);
            mdatView.setUint32(12, totalMdat >>> 0, false);
        } else {
            mdatView.setUint32(0, (totalAudioBytes + 8) >>> 0, false);
            mdatHeader[4] = 0x6d; mdatHeader[5] = 0x64; mdatHeader[6] = 0x61; mdatHeader[7] = 0x74;
        }

        return new Blob([ftyp.buffer as ArrayBuffer, newMoov.buffer as ArrayBuffer, mdatHeader.buffer as ArrayBuffer, ...slices], {
            type: 'audio/mp4',
        });
    } catch {
        return null;
    }
};

/**
 * Inspects an uploaded `Blob` / `File` locally in `< 5ms` by reading only its container header (`moov` or EBML header)
 * to extract video/audio codecs, GOP spacing, `+faststart` health, and exact `stss` keyframe timestamps.
 */
export const inspectVideoBlob = async (blob: Blob): Promise<ClientMediaInspectionResult | null> => {
    try {
        if (!blob || blob.size < 16) return null;
        const probeHead = await blob.slice(0, Math.min(blob.size, 64)).arrayBuffer();
        const headView = new DataView(probeHead);

        // EBML (WebM / MKV) magic: 0x1A 0x45 0xDF 0xA3
        if (headView.getUint32(0, false) === 0x1a45dfa3) {
            const ebmlSlice = await blob.slice(0, Math.min(blob.size, 65536)).arrayBuffer();
            return inspectWebmHeader(new Uint8Array(ebmlSlice), blob.size);
        }

        const located = await locateIsoBmffMoov(blob);
        if (!located) return null;
        return parseMoovBuffer(located.moovBuf, {
            container: located.container,
            moovBeforeMdat: located.moovBeforeMdat,
            fileSize: blob.size,
        });
    } catch {
        return null;
    }
};

/** Binary-searches the nearest IDR keyframe timestamp in `keyframeTimes` (returns `null` when unavailable). */
export const findNearestKeyframe = (
    keyframeTimes: readonly number[] | undefined,
    targetSec: number
): number | null => {
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

/**
 * Converts server-indexed `SourceFrameIndex` (which stores 0-based frame indices in `keyframes`)
 * into sorted keyframe timestamps in seconds, handling both CFR (`idx / fps`) and VFR (`pts[idx]`).
 */
export const extractKeyframeTimesFromFrameIndex = (
    frameIndex: SourceFrameIndex | undefined
): number[] | undefined => {
    if (!frameIndex || !frameIndex.keyframes || frameIndex.keyframes.length === 0) return undefined;
    const fps = frameIndex.fps > 0 ? frameIndex.fps : frameIndex.nominalFps;
    const times: number[] = [];
    for (const frameIdx of frameIndex.keyframes) {
        if (!Number.isFinite(frameIdx) || frameIdx < 0) continue;
        let t: number | undefined;
        if (!frameIndex.cfr && frameIndex.pts && frameIdx < frameIndex.pts.length) {
            const ptsVal = frameIndex.pts[frameIdx];
            if (ptsVal !== undefined && Number.isFinite(ptsVal)) t = ptsVal;
        }
        if (t === undefined && fps > 0) {
            t = frameIdx / fps;
        }
        if (t !== undefined && Number.isFinite(t)) {
            const rounded = Math.max(0, Math.round(t * 1000) / 1000);
            if (times.length === 0 || rounded > times[times.length - 1]!) {
                times.push(rounded);
            }
        }
    }
    return times.length > 0 ? times : undefined;
};

/**
 * Classifies a clip + runtime environment into a deterministic playback sync strategy:
 * - `'decoupled-audio-lock'`: Muted `<video>` + audio-master companion `<audio>` rail (isolates Android Chrome's
 *   4K AV1 / HEVC / long-GOP / fragmented / tail-`moov` `MediaCodec` seek desync completely).
 * - `'keyframe-scrub'`: Native `<video>` audio with real `stss` keyframe-snapped scrubbing during drags.
 * - `'standard'`: Fast native `<video>` playback + desktop dual-deck standby.
 */
export const classifyPlaybackProfile = (
    mediaInfo: SourceMediaInfo | undefined,
    isCompactOrTouch: boolean,
    isBlobUrl: boolean
): PlaybackSyncProfile => {
    const hasAudio = mediaInfo?.hasAudio !== false;
    const codec = (mediaInfo?.videoCodec || '').toLowerCase();
    const isAv1 = codec === 'av1' || codec.startsWith('av01');
    const isHevc = codec === 'hevc' || codec === 'h265' || codec.startsWith('hvc1') || codec.startsWith('hev1');
    const isHighRes = (mediaInfo?.width ?? 0) >= 2560 || (mediaInfo?.height ?? 0) >= 2160;
    const maxGop = mediaInfo?.maxGopSec ?? 0;
    const isTailMoovLarge = mediaInfo?.moovBeforeMdat === false && (mediaInfo?.fileSize ?? 0) >= 20 * 1024 * 1024;
    const hasAvDelta = Math.abs(mediaInfo?.avDurationDeltaSec ?? 0) > 0.5;
    const isFragmented = mediaInfo?.isFragmented === true;

    if ((isCompactOrTouch || isBlobUrl) && hasAudio) {
        if (isAv1 || isHevc || isHighRes || maxGop >= 3.5 || isTailMoovLarge || hasAvDelta || isFragmented) {
            return 'decoupled-audio-lock';
        }
        // Fail-safe on mobile blob URLs when container metadata could not be inspected
        if (isCompactOrTouch && isBlobUrl && !mediaInfo) {
            return 'decoupled-audio-lock';
        }
    }

    if (maxGop > 2.5 || isAv1 || isHighRes) {
        return 'keyframe-scrub';
    }

    return 'standard';
};
