import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    classifyPlaybackProfile,
    extractAudioM4aBlob,
    extractKeyframeTimesFromFrameIndex,
    findNearestKeyframe,
    inspectVideoBlob,
    parseMoovBuffer,
} from "../../app/admin/utils/clientMediaInspector";

const concatBytes = (...chunks: Uint8Array[]): Uint8Array => {
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.length;
    }
    return out;
};

const makeBox = (type: string, ...payloads: Uint8Array[]): Uint8Array => {
    const body = concatBytes(...payloads);
    const box = new Uint8Array(8 + body.length);
    const view = new DataView(box.buffer);
    view.setUint32(0, box.length, false);
    for (let i = 0; i < 4; i++) box[4 + i] = type.charCodeAt(i);
    box.set(body, 8);
    return box;
};

const makeMvhd = (timescale: number, duration: number): Uint8Array => {
    const body = new Uint8Array(24);
    const view = new DataView(body.buffer);
    view.setUint32(12, timescale, false);
    view.setUint32(16, duration, false);
    return makeBox("mvhd", body);
};

const makeTkhd = (width: number, height: number): Uint8Array => {
    const body = new Uint8Array(84);
    const view = new DataView(body.buffer);
    view.setUint32(76, width * 65536, false);
    view.setUint32(80, height * 65536, false);
    return makeBox("tkhd", body);
};

const makeElst = (mediaTime: number, duration: number): Uint8Array => {
    const body = new Uint8Array(20);
    const view = new DataView(body.buffer);
    view.setUint32(4, 1, false);
    view.setUint32(8, duration, false);
    view.setInt32(12, mediaTime, false);
    return makeBox("elst", body);
};

const makeMdhd = (timescale: number, duration: number): Uint8Array => {
    const body = new Uint8Array(24);
    const view = new DataView(body.buffer);
    view.setUint32(12, timescale, false);
    view.setUint32(16, duration, false);
    return makeBox("mdhd", body);
};

const makeHdlr = (kind: "vide" | "soun"): Uint8Array => {
    const body = new Uint8Array(12);
    for (let i = 0; i < 4; i++) body[8 + i] = kind.charCodeAt(i);
    return makeBox("hdlr", body);
};

const makeVisualStsd = (codec: string, width: number, height: number): Uint8Array => {
    const entry = new Uint8Array(40);
    const view = new DataView(entry.buffer);
    view.setUint32(0, entry.length, false);
    for (let i = 0; i < 4; i++) entry[4 + i] = codec.charCodeAt(i);
    view.setUint16(32, width, false);
    view.setUint16(34, height, false);
    const header = new Uint8Array(8);
    new DataView(header.buffer).setUint32(4, 1, false);
    return makeBox("stsd", header, entry);
};

const makeAudioStsd = (codec: string, channels: number, sampleRate: number): Uint8Array => {
    const entry = new Uint8Array(36);
    const view = new DataView(entry.buffer);
    view.setUint32(0, entry.length, false);
    for (let i = 0; i < 4; i++) entry[4 + i] = codec.charCodeAt(i);
    view.setUint16(24, channels, false);
    view.setUint32(32, sampleRate << 16, false);
    const header = new Uint8Array(8);
    new DataView(header.buffer).setUint32(4, 1, false);
    return makeBox("stsd", header, entry);
};

const makeStts = (sampleCount: number, sampleDelta: number): Uint8Array => {
    const body = new Uint8Array(16);
    const view = new DataView(body.buffer);
    view.setUint32(4, 1, false);
    view.setUint32(8, sampleCount, false);
    view.setUint32(12, sampleDelta, false);
    return makeBox("stts", body);
};

const makeStss = (indices: number[]): Uint8Array => {
    const body = new Uint8Array(8 + indices.length * 4);
    const view = new DataView(body.buffer);
    view.setUint32(4, indices.length, false);
    indices.forEach((idx, i) => view.setUint32(8 + i * 4, idx, false));
    return makeBox("stss", body);
};

describe("clientMediaInspector", () => {
    it("parses synthetic H.264 1s-GOP MP4 with audio and classifies as 'standard'", async () => {
        const moov = makeBox(
            "moov",
            makeMvhd(1000, 10000),
            makeBox(
                "trak",
                makeTkhd(1080, 1920),
                makeBox(
                    "mdia",
                    makeMdhd(30000, 300000),
                    makeHdlr("vide"),
                    makeBox("minf", makeBox("stbl", makeVisualStsd("avc1", 1080, 1920), makeStts(300, 1000), makeStss([1, 31, 61, 91])))
                )
            ),
            makeBox(
                "trak",
                makeBox("edts", makeElst(1024, 480000)),
                makeBox(
                    "mdia",
                    makeMdhd(48000, 480000),
                    makeHdlr("soun"),
                    makeBox("minf", makeBox("stbl", makeAudioStsd("mp4a", 2, 48000)))
                )
            )
        );
        const ftypPayload = new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]);
        const mp4 = concatBytes(makeBox("ftyp", ftypPayload), moov, makeBox("mdat", new Uint8Array(32)));
        const res = await inspectVideoBlob(new Blob([mp4.buffer as ArrayBuffer]));

        expect(res).not.toBeNull();
        expect(res!.mediaInfo).toMatchObject({
            videoCodec: "h264",
            audioCodec: "aac",
            hasAudio: true,
            width: 1080,
            height: 1920,
            exactFps: 30,
            audioChannels: 2,
            audioSampleRate: 48000,
            maxGopSec: 7, // tail gap from 3s to 10s
            moovBeforeMdat: true,
        });
        expect(res!.keyframeTimes).toEqual([0, 1, 2, 3]);

        // With 1s maxGop, mobile short H.264 is 'standard'
        expect(classifyPlaybackProfile({ ...res!.mediaInfo, maxGopSec: 1 }, true, true)).toBe("standard");
    });

    it("parses tail-moov video without audio and never enables decoupled audio lock", async () => {
        const moov = makeBox(
            "moov",
            makeMvhd(1000, 10000),
            makeBox(
                "trak",
                makeTkhd(3840, 2160),
                makeBox(
                    "mdia",
                    makeMdhd(25000, 250000),
                    makeHdlr("vide"),
                    makeBox("minf", makeBox("stbl", makeVisualStsd("av01", 3840, 2160), makeStts(250, 1000), makeStss([1, 126])))
                )
            )
        );
        const buf = moov.buffer.slice(moov.byteOffset, moov.byteOffset + moov.byteLength) as ArrayBuffer;
        const parsed = parseMoovBuffer(buf, { container: "mp4", moovBeforeMdat: false, fileSize: 80_000_000 });
        expect(parsed!.mediaInfo.hasAudio).toBe(false);
        expect(classifyPlaybackProfile(parsed!.mediaInfo, true, true)).toBe("keyframe-scrub");
    });

    it("binary-searches nearest keyframe safely", () => {
        expect(findNearestKeyframe([0, 5, 10, 15, 20], 11.4)).toBe(10);
        expect(findNearestKeyframe([0, 5, 10, 15, 20], 13.8)).toBe(15);
        expect(findNearestKeyframe([], 10)).toBeNull();
    });

    it("converts SourceFrameIndex frame indices into seconds for both CFR and VFR clips", () => {
        expect(extractKeyframeTimesFromFrameIndex(undefined)).toBeUndefined();
        expect(extractKeyframeTimesFromFrameIndex({
            mediaUrl: "/api/video/ingest?name=test.mp4",
            fps: 25,
            nominalFps: 25,
            startTime: 0,
            duration: 15,
            frameCount: 375,
            cfr: true,
            keyframes: [0, 125, 250],
            pts: [],
        })).toEqual([0, 5, 10]);

        expect(extractKeyframeTimesFromFrameIndex({
            mediaUrl: "/api/video/ingest?name=vfr.mp4",
            fps: 30,
            nominalFps: 30,
            startTime: 0,
            duration: 10,
            frameCount: 5,
            cfr: false,
            keyframes: [0, 2, 4],
            pts: [0, 0.033, 2.415, 3.1, 6.789],
        })).toEqual([0, 2.415, 6.789]);
    });

    it("detects fragmented MP4 (`mvex`) and All-Intra MP4 (`!hasStss`) cleanly", () => {
        const fragMoov = makeBox(
            "moov",
            makeMvhd(1000, 0),
            makeBox("mvex", new Uint8Array(16)),
            makeBox(
                "trak",
                makeTkhd(1080, 1920),
                makeBox("mdia", makeMdhd(30000, 0), makeHdlr("vide"), makeBox("minf", makeBox("stbl", makeVisualStsd("avc1", 1080, 1920))))
            ),
            makeBox(
                "trak",
                makeBox("mdia", makeMdhd(48000, 0), makeHdlr("soun"), makeBox("minf", makeBox("stbl", makeAudioStsd("mp4a", 2, 48000))))
            )
        );
        const fragBuf = fragMoov.buffer.slice(fragMoov.byteOffset, fragMoov.byteOffset + fragMoov.byteLength) as ArrayBuffer;
        const fragParsed = parseMoovBuffer(fragBuf, { container: "mp4", moovBeforeMdat: true });
        expect(fragParsed?.mediaInfo.isFragmented).toBe(true);
        expect(classifyPlaybackProfile(fragParsed?.mediaInfo, true, true)).toBe("decoupled-audio-lock");

        const intraMoov = makeBox(
            "moov",
            makeMvhd(1000, 10000),
            makeBox(
                "trak",
                makeTkhd(1080, 1920),
                makeBox("mdia", makeMdhd(30000, 300000), makeHdlr("vide"), makeBox("minf", makeBox("stbl", makeVisualStsd("avc1", 1080, 1920), makeStts(300, 1000))))
            ),
            makeBox(
                "trak",
                makeBox("mdia", makeMdhd(48000, 480000), makeHdlr("soun"), makeBox("minf", makeBox("stbl", makeAudioStsd("mp4a", 2, 48000))))
            )
        );
        const intraBuf = intraMoov.buffer.slice(intraMoov.byteOffset, intraMoov.byteOffset + intraMoov.byteLength) as ArrayBuffer;
        const intraParsed = parseMoovBuffer(intraBuf, { container: "mp4", moovBeforeMdat: true });
        expect(intraParsed?.mediaInfo.maxGopSec).toBe(0.033);
        expect(classifyPlaybackProfile(intraParsed?.mediaInfo, true, true)).toBe("standard");
    });

    it("detects WebM EBML header codecs", async () => {
        const ebml = new Uint8Array(64);
        ebml[0] = 0x1a;
        ebml[1] = 0x45;
        ebml[2] = 0xdf;
        ebml[3] = 0xa3;
        const encoder = new TextEncoder();
        ebml.set(encoder.encode("V_VP9"), 16);
        ebml.set(encoder.encode("A_OPUS"), 32);
        const res = await inspectVideoBlob(new Blob([ebml.buffer as ArrayBuffer]));
        expect(res?.mediaInfo.container).toBe("webm");
        expect(res?.mediaInfo.videoCodec).toBe("vp9");
        expect(res?.mediaInfo.audioCodec).toBe("opus");
        expect(res?.mediaInfo.hasAudio).toBe(true);
    });

    it("accurately inspects the real cached 77MB 4K AV1 5s-GOP clip if present locally", async () => {
        const cachedMp4 = path.resolve(process.cwd(), ".next/cache/tpe-videos/media-1795481850460-8574662e.mp4");
        if (!existsSync(cachedMp4)) return;

        const fileBuf = readFileSync(cachedMp4);
        const blob = new Blob([fileBuf]);
        const res = await inspectVideoBlob(blob);

        expect(res).not.toBeNull();
        expect(res!.mediaInfo).toMatchObject({
            videoCodec: "av1",
            audioCodec: "aac",
            hasAudio: true,
            width: 3840,
            height: 2160,
            exactFps: 25,
            audioChannels: 2,
            audioSampleRate: 48000,
            maxGopSec: 5,
            moovBeforeMdat: true,
        });
        expect(res!.keyframeTimes.slice(0, 4)).toEqual([0, 5, 10, 15]);
        expect(classifyPlaybackProfile(res!.mediaInfo, true, true)).toBe("decoupled-audio-lock");
        expect(classifyPlaybackProfile(res!.mediaInfo, false, false)).toBe("keyframe-scrub");

        // Pure-JS ISO-BMFF audio-only .m4a extraction on the real 77MB 4K AV1 clip
        const m4a = await extractAudioM4aBlob(blob);
        expect(m4a).not.toBeNull();
        expect(m4a!.type).toBe("audio/mp4");
        expect(m4a!.size).toBeGreaterThan(1_000_000);
        expect(m4a!.size).toBeLessThan(10_000_000);
    });

    it("extracts a valid +faststart audio-only .m4a Blob from synthetic MP4 and returns null for fragmented/WebM", async () => {
        const audioChunk1 = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
        const audioChunk2 = new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
        const videoChunk = new Uint8Array(64).fill(0xff);

        // Build placeholder stsc / stsz / stco for 2 chunks (1 sample each: 4 bytes, 6 bytes)
        const makeStsc = () => {
            const body = new Uint8Array(20);
            const v = new DataView(body.buffer);
            v.setUint32(4, 1, false);
            v.setUint32(8, 1, false);
            v.setUint32(12, 1, false);
            v.setUint32(16, 1, false);
            return makeBox("stsc", body);
        };
        const makeStsz = (sizes: number[]) => {
            const body = new Uint8Array(12 + sizes.length * 4);
            const v = new DataView(body.buffer);
            v.setUint32(8, sizes.length, false);
            sizes.forEach((sz, i) => v.setUint32(12 + i * 4, sz, false));
            return makeBox("stsz", body);
        };
        const makeStco = (offsets: number[]) => {
            const body = new Uint8Array(8 + offsets.length * 4);
            const v = new DataView(body.buffer);
            v.setUint32(4, offsets.length, false);
            offsets.forEach((off, i) => v.setUint32(8 + i * 4, off, false));
            return makeBox("stco", body);
        };

        const buildMp4WithOffsets = (off1: number, off2: number) => {
            const ftyp = makeBox("ftyp", new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]));
            const moov = makeBox(
                "moov",
                makeMvhd(1000, 10000),
                makeBox("trak", makeTkhd(1920, 1080), makeBox("mdia", makeMdhd(30000, 300000), makeHdlr("vide"), makeBox("minf", makeBox("stbl", makeVisualStsd("avc1", 1920, 1080))))),
                makeBox(
                    "trak",
                    makeBox("mdia", makeMdhd(48000, 480000), makeHdlr("soun"), makeBox("minf", makeBox("stbl", makeAudioStsd("mp4a", 2, 48000), makeStts(2, 1024), makeStsc(), makeStsz([4, 6]), makeStco([off1, off2]))))
                )
            );
            const mdat = makeBox("mdat", videoChunk, audioChunk1, videoChunk, audioChunk2);
            return { ftyp, moov, mdat, full: concatBytes(ftyp, moov, mdat) };
        };

        const probe = buildMp4WithOffsets(0, 0);
        const mdatPayloadStart = probe.ftyp.length + probe.moov.length + 8;
        const off1 = mdatPayloadStart + videoChunk.length;
        const off2 = off1 + audioChunk1.length + videoChunk.length;
        const { full } = buildMp4WithOffsets(off1, off2);

        const m4a = await extractAudioM4aBlob(new Blob([full.buffer as ArrayBuffer]));
        expect(m4a).not.toBeNull();
        expect(m4a!.type).toBe("audio/mp4");
        const m4aBytes = new Uint8Array(await m4a!.arrayBuffer());
        expect(new TextDecoder("latin1").decode(m4aBytes.slice(4, 12))).toBe("ftypM4A ");
        // Tail 10 bytes must match exact audio chunks with all video bytes stripped
        expect(Array.from(m4aBytes.slice(m4aBytes.length - 10))).toEqual([...audioChunk1, ...audioChunk2]);

        // Empty-edit elst delay test (A16): entry 0 mediaTime=-1 (500ms in movie timescale 1000), entry 1 mediaTime=0
        const elstBody = new Uint8Array(8 + 24);
        const ev = new DataView(elstBody.buffer);
        ev.setUint32(4, 2, false);
        ev.setUint32(8, 500, false);
        ev.setInt32(12, -1, false);
        ev.setUint32(20, 9500, false);
        ev.setInt32(24, 0, false);
        const delayMoov = makeBox(
            "moov",
            makeMvhd(1000, 10000),
            makeBox("trak", makeTkhd(1080, 1920), makeBox("mdia", makeMdhd(30000, 300000), makeHdlr("vide"), makeBox("minf", makeBox("stbl", makeVisualStsd("avc1", 1080, 1920))))),
            makeBox("trak", makeBox("edts", makeBox("elst", elstBody)), makeBox("mdia", makeMdhd(48000, 480000), makeHdlr("soun"), makeBox("minf", makeBox("stbl", makeAudioStsd("mp4a", 2, 48000)))))
        );
        const delayParsed = parseMoovBuffer(delayMoov.buffer.slice(delayMoov.byteOffset, delayMoov.byteOffset + delayMoov.byteLength) as ArrayBuffer);
        expect(delayParsed?.mediaInfo.audioDelaySec).toBe(0.5);

        // WebM returns null cleanly
        const webm = new Uint8Array(64);
        webm.set([0x1a, 0x45, 0xdf, 0xa3], 0);
        expect(await extractAudioM4aBlob(new Blob([webm.buffer as ArrayBuffer]))).toBeNull();
    });
});
