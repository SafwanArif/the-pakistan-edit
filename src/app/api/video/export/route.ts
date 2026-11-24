import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { VideoDraft } from "../../../../types/news";
import { getSceneBoundaries, getTimelineStructure, wrapMediaTime } from "../../../../types/news";
import { VIDEO_FORMAT_CONFIGS } from "../../../../config/omnichannel";
import { assertDiskHeadroom, CACHE_DIR, computeExportVbvCeiling, createFileWebStream, fileExists, probeMediaFile, resolveCachedVideoPath, spawnExec, sweepStaleExportFiles, withExportSlot } from "../../../../lib/server/videoMedia";
import { buildAssSubtitles, escapeFfmpegFilterPath } from "../../../../lib/server/ffmpegFilters";
import { buildSceneFilterStages } from "../../../../lib/server/ffmpegSceneGraph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const probeVideoInfo = async (
    filePath: string,
    signal?: AbortSignal
): Promise<{ width: number; height: number; duration: number; hasAudio: boolean; fps: number; isHdr: boolean; videoBitrate?: number }> => {
    const { durationSec, hasAudio, mediaInfo } = await probeMediaFile(filePath, { signal });
    return {
        width: mediaInfo.width,
        height: mediaInfo.height,
        duration: durationSec || 60,
        hasAudio,
        fps: mediaInfo.nominalFps,
        isHdr: mediaInfo.isHdr,
        videoBitrate: mediaInfo.videoBitrate,
    };
};

const resolveImageExt = (mimeType: string): string => {
    if (mimeType === "image/jpeg" || mimeType === "image/jpg") return ".jpg";
    if (mimeType === "image/webp") return ".webp";
    return ".png";
};

/** Renders the multi-scene timeline via native FFmpeg (`libx264` + `48kHz AAC`) with zero dropped frames. */
export async function POST(request: Request) {
    const tempFiles: string[] = [];
    const uid = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    void sweepStaleExportFiles();

    try {
        const formData = await request.formData();
        const draftRaw = formData.get("draft");
        if (typeof draftRaw !== "string") {
            return NextResponse.json({ error: "Missing draft payload" }, { status: 400 });
        }
        const draft = JSON.parse(draftRaw) as VideoDraft;
        const format = VIDEO_FORMAT_CONFIGS[draft.aspectRatio];
        if (!format) {
            return NextResponse.json({ error: "Unsupported video aspect ratio" }, { status: 400 });
        }
        const scenes = draft.scenes?.length ? draft.scenes : [];
        if (!scenes.length) {
            return NextResponse.json({ error: "No timeline scenes to export" }, { status: 400 });
        }
        if (scenes.length > 25) {
            return NextResponse.json({ error: "Timeline exceeds maximum 25 scenes per export" }, { status: 400 });
        }

        const masterPath = await resolveCachedVideoPath(draft.videoUrl);
        if (!masterPath) {
            return NextResponse.json({ error: "Master video must be uploaded to the studio first." }, { status: 400 });
        }
        await fs.promises.mkdir(CACHE_DIR, { recursive: true });
        await assertDiskHeadroom();
        const masterInfo = await probeVideoInfo(masterPath, request.signal);

        const { width: W, height: H } = format;
        const is45 = draft.aspectRatio === "4:5";
        const is916 = draft.aspectRatio === "9:16";
        const targetFps = masterInfo.fps || 30;
        const quantizedScenes = scenes.map((s) => {
            const rawDur = Math.min(180, Math.max(0.5, Number(s.duration) || 5));
            const dur = Math.max(1, Math.round(rawDur * targetFps)) / targetFps;
            return { ...s, duration: dur };
        });
        const bounds = getSceneBoundaries(quantizedScenes);
        const { hasReHook, storyIdx: setupIdx, storyOffset: setupOffset } = getTimelineStructure(quantizedScenes);

        const args: string[] = [];
        const filters: string[] = [];
        let inputIdx = 0;
        const concatInputs: string[] = [];

        const saveTempBlob = async (blob: Blob, ext: string): Promise<string> => {
            const p = path.join(CACHE_DIR, `exp-${uid}-${tempFiles.length}${ext}`);
            await fs.promises.writeFile(p, Buffer.from(await blob.arrayBuffer()));
            tempFiles.push(p);
            return p;
        };

        for (let i = 0; i < quantizedScenes.length; i++) {
            const s = quantizedScenes[i]!;
            const b = bounds[i]!;
            const dur = s.duration;
            const ovBlob = formData.get(`overlay_${i}`);
            if (!(ovBlob instanceof Blob)) {
                return NextResponse.json({ error: `Missing overlay_${i}` }, { status: 400 });
            }
            const ovPath = await saveTempBlob(ovBlob, ".png");

            const customMediaBlob = formData.get(`sceneMedia_${i}`);
            const cachedSceneVideo = await resolveCachedVideoPath(s.mediaUrl);
            const isImage = s.mediaType === "image";

            let srcPath = masterPath;
            let srcInfo = masterInfo;
            if (customMediaBlob instanceof Blob) {
                const ext = isImage ? resolveImageExt(customMediaBlob.type) : ".mp4";
                srcPath = await saveTempBlob(customMediaBlob, ext);
                if (isImage) {
                    const probed = await probeVideoInfo(srcPath, request.signal).catch(() => null);
                    srcInfo = {
                        width: probed?.width ?? W,
                        height: probed?.height ?? H,
                        duration: dur,
                        hasAudio: false,
                        fps: targetFps,
                        isHdr: false,
                    };
                } else {
                    srcInfo = await probeVideoInfo(srcPath, request.signal);
                }
            } else if (cachedSceneVideo && !isImage) {
                srcPath = cachedSceneVideo;
                srcInfo = await probeVideoInfo(srcPath, request.signal);
            }

            const mediaIdx = inputIdx++;
            let loopTrim = "";
            let aLoopTrim = "";
            let customLoopVideoSource: string | null = null;
            let customLoopAudioSource: string | null = null;
            if (isImage) {
                args.push("-framerate", String(targetFps), "-loop", "1", "-t", dur.toFixed(3), "-i", srcPath);
            } else {
                const rawStart = i === 0
                    ? (s.clipStartOffset ?? 0)
                    : (hasReHook && i === 1 ? (s.clipStartOffset ?? 0) : (srcPath === masterPath ? wrapMediaTime(draft, b.start, srcInfo.duration) : 0));
                const needsLoop = rawStart + dur > srcInfo.duration - 0.1;
                if (needsLoop) {
                    const loopStart = i === 0
                        ? (s.clipStartOffset ?? 0)
                        : (hasReHook && i === 1 ? (s.clipStartOffset ?? 0) : (srcPath === masterPath && i >= setupIdx ? setupOffset : 0));
                    args.push("-fflags", "+genpts+discardcorrupt", "-stream_loop", "-1", "-i", srcPath);
                    const firstPassDur = Math.max(0.1, srcInfo.duration - rawStart);
                    if (rawStart > loopStart + 0.05 && firstPassDur < dur - 0.05) {
                        const remDur = dur - firstPassDur;
                        customLoopVideoSource = `v_loop_src_${i}`;
                        filters.push(`[${mediaIdx}:v]split=2[vp1_${i}][vp2_${i}]`);
                        filters.push(`[vp1_${i}]trim=start=${rawStart.toFixed(3)}:duration=${firstPassDur.toFixed(3)},setpts=PTS-STARTPTS[vt1_${i}]`);
                        filters.push(`[vp2_${i}]trim=start=${loopStart.toFixed(3)}:duration=${remDur.toFixed(3)},setpts=PTS-STARTPTS[vt2_${i}]`);
                        filters.push(`[vt1_${i}][vt2_${i}]concat=n=2:v=1:a=0[${customLoopVideoSource}]`);
                        if (srcInfo.hasAudio) {
                            customLoopAudioSource = `a_loop_src_${i}`;
                            filters.push(`[${mediaIdx}:a]asplit=2[ap1_${i}][ap2_${i}]`);
                            filters.push(`[ap1_${i}]atrim=start=${rawStart.toFixed(3)}:duration=${firstPassDur.toFixed(3)},asetpts=PTS-STARTPTS[at1_${i}]`);
                            filters.push(`[ap2_${i}]atrim=start=${loopStart.toFixed(3)}:duration=${remDur.toFixed(3)},asetpts=PTS-STARTPTS[at2_${i}]`);
                            filters.push(`[at1_${i}][at2_${i}]concat=n=2:v=0:a=1[${customLoopAudioSource}]`);
                        }
                    } else {
                        loopTrim = `trim=start=${rawStart.toFixed(3)}:duration=${dur.toFixed(3)},`;
                        aLoopTrim = `atrim=start=${rawStart.toFixed(3)}:duration=${dur.toFixed(3)},`;
                    }
                } else {
                    args.push("-fflags", "+genpts+discardcorrupt", "-ss", Math.max(0, rawStart).toFixed(3), "-t", dur.toFixed(3), "-i", srcPath);
                }
            }

            const ovIdx = inputIdx++;
            args.push("-framerate", String(targetFps), "-loop", "1", "-t", dur.toFixed(3), "-i", ovPath);

            const stage = buildSceneFilterStages({
                index: i,
                scene: s,
                scenes: quantizedScenes,
                draft,
                start: b.start,
                duration: dur,
                width: W,
                height: H,
                targetFps,
                is45,
                isImage,
                hasReHook,
                setupIdx,
                srcWidth: srcInfo.width,
                srcHeight: srcInfo.height,
                srcHasAudio: srcInfo.hasAudio,
                srcIsHdr: !isImage && srcInfo.isHdr,
                mediaIdx,
                overlayIdx: ovIdx,
                customLoopVideoSource,
                customLoopAudioSource,
                loopTrim,
                aLoopTrim,
            });
            filters.push(...stage.filters);
            concatInputs.push(`${stage.vMap}${stage.aMap}`);
        }

        const outroBlob = formData.get("outroOverlay");
        if (draft.enableOutro && outroBlob instanceof Blob) {
            const rawOutroDur = Math.min(15, Math.max(1, Number(draft.outroDuration) || 5));
            const outroDur = Math.max(1, Math.round(rawOutroDur * targetFps)) / targetFps;
            const outroPath = await saveTempBlob(outroBlob, ".png");
            const oIdx = inputIdx++;
            args.push("-framerate", String(targetFps), "-loop", "1", "-t", outroDur.toFixed(3), "-i", outroPath);
            filters.push(`[${oIdx}:v]fps=${targetFps},scale=${W}:${H}:flags=lanczos+accurate_rnd+full_chroma_int:out_color_matrix=bt709:out_range=tv,fade=t=in:st=0:d=0.25:color=#050505,format=yuv420p,setsar=1,settb=1/90000[v_outro]`);
            filters.push(`anullsrc=r=48000:cl=stereo:d=${outroDur.toFixed(3)}[a_outro]`);
            concatInputs.push(`[v_outro][a_outro]`);
        }

        const segCount = concatInputs.length;
        const assContent = buildAssSubtitles(draft, quantizedScenes, bounds, W, H, is45, is916, masterInfo.duration);
        const shouldLoudnorm = draft.normalizeAudio !== false && !draft.isMuted && (draft.volume ?? 1) > 0;
        let finalVideoMap = "[vout]";
        let finalAudioMap = "[aout]";

        if (assContent) {
            const assPath = path.join(CACHE_DIR, `subs-${uid}.ass`);
            await fs.promises.writeFile(assPath, assContent, "utf8");
            tempFiles.push(assPath);
            const fontsDir = path.join(process.cwd(), "tools", "fonts");
            const fontsDirArg = (await fileExists(fontsDir)) ? `:fontsdir='${escapeFfmpegFilterPath(fontsDir)}'` : "";
            filters.push(`${concatInputs.join("")}concat=n=${segCount}:v=1:a=1[v_cat][a_cat]`);
            filters.push(`[v_cat]ass='${escapeFfmpegFilterPath(assPath)}'${fontsDirArg}[vsub]`);
            finalVideoMap = "[vsub]";
        } else {
            filters.push(`${concatInputs.join("")}concat=n=${segCount}:v=1:a=1[vout][a_cat]`);
        }

        if (shouldLoudnorm) {
            filters.push(`[a_cat]alimiter=limit=0.841:attack=5:release=50,loudnorm=I=-14:TP=-1.5:LRA=11:linear=true,aresample=48000[anorm]`);
            finalAudioMap = "[anorm]";
        } else {
            finalAudioMap = "[a_cat]";
        }

        const filterScriptPath = path.join(CACHE_DIR, `filter-${uid}.txt`);
        await fs.promises.writeFile(filterScriptPath, filters.join(";\n"), "utf8");
        tempFiles.push(filterScriptPath);

        const outPath = path.join(CACHE_DIR, `export-${uid}.mp4`);
        tempFiles.push(outPath);

        const renderThreads = String(Math.max(2, os.cpus().length - 2));
        const vbvCeiling = computeExportVbvCeiling(draft.sourceMediaInfo?.videoBitrate ?? masterInfo.videoBitrate);
        await withExportSlot(() => spawnExec("ffmpeg", [
            "-y", "-hide_banner", "-loglevel", "error",
            ...args,
            "-filter_complex_script", filterScriptPath,
            "-map", finalVideoMap, "-map", finalAudioMap,
            "-map_metadata", "-1", "-dn", "-sn",
            "-threads", renderThreads,
            "-max_muxing_queue_size", "4096",
            "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-profile:v", "high", "-level", "4.2",
            ...(vbvCeiling ? ["-maxrate", `${vbvCeiling.maxrateKbps}k`, "-bufsize", `${vbvCeiling.bufsizeKbps}k`] : []),
            "-g", String(targetFps * 2), "-keyint_min", String(targetFps * 2), "-sc_threshold", "0",
            "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
            "-r", String(targetFps),
            "-c:a", "aac", "-b:a", "320k", "-ar", "48000",
            "-movflags", "+faststart",
            outPath,
        ], { signal: request.signal, timeoutMs: 300_000 }), request.signal);

        const stat = await fs.promises.stat(outPath);
        const outIdx = tempFiles.indexOf(outPath);
        if (outIdx !== -1) tempFiles.splice(outIdx, 1);

        return new Response(createFileWebStream(outPath, { unlinkOnClose: true }), {
            status: 200,
            headers: {
                "Content-Type": "video/mp4",
                "Content-Length": String(stat.size),
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "FFmpeg export failed";
        console.error("VIDEO_EXPORT_ERROR:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    } finally {
        await Promise.all(tempFiles.map((f) => fs.promises.unlink(f).catch(() => {})));
    }
}
