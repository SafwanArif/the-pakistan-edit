import {
    findBox,
    getMoovDataStart,
    iterChildBoxes,
    locateIsoBmffMoov,
    readFourCC,
    readUint64,
    type ParsedBox,
} from "./clientMediaInspector";

const writeFourCC = (bytes: Uint8Array, offset: number, fourcc: string) => {
    for (let i = 0; i < 4; i++) bytes[offset + i] = fourcc.charCodeAt(i);
};

/** Pre-built 28-byte ISO-BMFF `ftyp` box: major='M4A ', minor=0, compatible=['M4A ', 'mp42', 'isom']. */
const M4A_FTYP_BOX: Uint8Array = (() => {
    const out = new Uint8Array(28);
    new DataView(out.buffer).setUint32(0, 28, false);
    const brands = "ftypM4A \0\0\0\0M4A mp42isom";
    for (let i = 0; i < brands.length; i++) out[4 + i] = brands.charCodeAt(i);
    return out;
})();

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
        const moovChildren = iterChildBoxes(view, getMoovDataStart(view), moovBuf.byteLength);

        let mvhdBox: ParsedBox | null = null;
        let audioTrakBox: ParsedBox | null = null;
        let stscBox: ParsedBox | null = null;
        let stszBox: ParsedBox | null = null;
        let chunkOffsetBox: (ParsedBox & { is64: boolean }) | null = null;

        for (const child of moovChildren) {
            if (child.type === "mvex") return null; // Fragmented MP4 requires moof/trun remuxing -> fallback
            if (child.type === "mvhd" && !mvhdBox) { mvhdBox = child; continue; }
            if (child.type !== "trak" || audioTrakBox) continue;

            const mdia = findBox(view, child.dataStart, child.end, "mdia");
            const hdlr = mdia ? findBox(view, mdia.dataStart, mdia.end, "hdlr") : null;
            if (!mdia || !hdlr || hdlr.dataStart + 12 > hdlr.end || readFourCC(view, hdlr.dataStart + 8) !== "soun") continue;
            const minf = findBox(view, mdia.dataStart, mdia.end, "minf");
            const stbl = minf ? findBox(view, minf.dataStart, minf.end, "stbl") : null;
            if (!stbl) continue;

            const foundStsc = findBox(view, stbl.dataStart, stbl.end, "stsc");
            const foundStsz = findBox(view, stbl.dataStart, stbl.end, "stsz");
            const stco = findBox(view, stbl.dataStart, stbl.end, "stco");
            const co64 = stco ? null : findBox(view, stbl.dataStart, stbl.end, "co64");
            const foundChunkOff = stco ? { ...stco, is64: false } : co64 ? { ...co64, is64: true } : null;

            if (foundStsc && foundStsz && foundChunkOff) {
                audioTrakBox = child;
                stscBox = foundStsc;
                stszBox = foundStsz;
                chunkOffsetBox = foundChunkOff;
            }
        }

        if (!mvhdBox || !audioTrakBox || !stscBox || !stszBox || !chunkOffsetBox) return null;
        if (chunkOffsetBox.dataStart + 8 > chunkOffsetBox.end || stscBox.dataStart + 8 > stscBox.end || stszBox.dataStart + 12 > stszBox.end) return null;

        const chunkCount = view.getUint32(chunkOffsetBox.dataStart + 4, false);
        const entryByteSize = chunkOffsetBox.is64 ? 8 : 4;
        if (chunkCount === 0 || chunkOffsetBox.dataStart + 8 + chunkCount * entryByteSize > chunkOffsetBox.end) return null;

        const stscCount = view.getUint32(stscBox.dataStart + 4, false);
        if (stscCount === 0 || stscBox.dataStart + 8 + stscCount * 12 > stscBox.end) return null;
        const stsc: Array<{ firstChunk: number; spc: number }> = [];
        for (let i = 0; i < stscCount; i++) {
            const off = stscBox.dataStart + 8 + i * 12;
            stsc.push({ firstChunk: view.getUint32(off, false), spc: view.getUint32(off + 4, false) });
        }
        if (stsc[0]!.firstChunk !== 1) return null;

        const uniformSampleSize = view.getUint32(stszBox.dataStart + 4, false);
        const sampleCount = view.getUint32(stszBox.dataStart + 8, false);
        if (sampleCount === 0) return null;
        if (uniformSampleSize === 0 && stszBox.dataStart + 12 + sampleCount * 4 > stszBox.end) return null;

        const newChunkRelOffsets = new Float64Array(chunkCount);
        const slices: Blob[] = [];
        let sampleIdx = 0;
        let stscIdx = 0;
        let totalAudioBytes = 0;
        let runStart = -1;
        let runEnd = -1;

        for (let c = 0; c < chunkCount; c++) {
            const chunkNum = c + 1;
            while (stscIdx + 1 < stsc.length && stsc[stscIdx + 1]!.firstChunk <= chunkNum) stscIdx += 1;
            const spc = stsc[stscIdx]!.spc;
            if (sampleIdx + spc > sampleCount) return null;

            let chunkBytes = 0;
            if (uniformSampleSize > 0) {
                chunkBytes = spc * uniformSampleSize;
            } else {
                const tableBase = stszBox.dataStart + 12;
                for (let s = 0; s < spc; s++) chunkBytes += view.getUint32(tableBase + (sampleIdx + s) * 4, false);
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
        const mvhdSlice = moovBytes.subarray(mvhdBox.start, mvhdBox.end);
        const trakSlice = moovBytes.subarray(audioTrakBox.start, audioTrakBox.end);
        const newMoovSize = 8 + mvhdSlice.length + trakSlice.length;
        const newMoov = new Uint8Array(newMoovSize);
        const newMoovView = new DataView(newMoov.buffer);
        newMoovView.setUint32(0, newMoovSize, false);
        writeFourCC(newMoov, 4, "moov");
        newMoov.set(mvhdSlice, 8);
        const trakDestStart = 8 + mvhdSlice.length;
        newMoov.set(trakSlice, trakDestStart);

        const use64Mdat = totalAudioBytes + 8 > 0xffffffff;
        const mdatHeaderSize = use64Mdat ? 16 : 8;
        const mdatDataStart = M4A_FTYP_BOX.length + newMoovSize + mdatHeaderSize;
        if (!chunkOffsetBox.is64 && mdatDataStart + totalAudioBytes > 0xffffffff) return null;

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
        writeFourCC(mdatHeader, 4, "mdat");
        if (use64Mdat) {
            mdatView.setUint32(0, 1, false);
            const totalMdat = totalAudioBytes + 16;
            mdatView.setUint32(8, Math.floor(totalMdat / 4294967296), false);
            mdatView.setUint32(12, totalMdat >>> 0, false);
        } else {
            mdatView.setUint32(0, (totalAudioBytes + 8) >>> 0, false);
        }

        return new Blob([M4A_FTYP_BOX.buffer as ArrayBuffer, newMoov.buffer as ArrayBuffer, mdatHeader.buffer as ArrayBuffer, ...slices], {
            type: "audio/mp4",
        });
    } catch {
        return null;
    }
};
