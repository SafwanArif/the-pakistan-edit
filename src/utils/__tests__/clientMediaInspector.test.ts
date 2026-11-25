import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    classifyPlaybackProfile,
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
    });
});
