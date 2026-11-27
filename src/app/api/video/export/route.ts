import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { VideoDraft } from "@/types/news";
import { clamp, getSceneBoundaries, getTimelineStructure, wrapMediaTime } from "@/types/news";
import { VIDEO_FORMAT_CONFIGS } from "@/config/omnichannel";
import { assertDiskHeadroom, CACHE_DIR, computeExportVbvCeiling, createFileWebStream, fileExists, getWorkerThreadCount, probeMediaFile, resolveCachedVideoPath, spawnExec, sweepStaleExportFiles, withExportSlot } from "@/lib/server/videoMedia";
import { buildAssSubtitles, escapeFfmpegFilterPath } from "@/lib/server/ffmpegFilters";
import { buildSceneFilterStages, isAnimatedSceneOverlay } from "@/lib/server/ffmpegSceneGraph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

const probeVideoInfo = async (filePath: string, signal?: AbortSignal) => {
    const { durationSec, hasAudio, mediaInfo } = await probeMediaFile(filePath, { signal });
    return {
        width: mediaInfo.width, height: mediaInfo.height, duration: durationSec || 60,
        hasAudio, fps: mediaInfo.nominalFps, isHdr: mediaInfo.isHdr, videoBitrate: mediaInfo.videoBitrate,
    };
};

const resolveImageExt = (mime: string): string =>
    mime === "image/jpeg" || mime === "image/jpg" ? ".jpg" : mime === "image/webp" ? ".webp" : ".png";

const clampOffset = (raw: number | undefined, maxDur: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.min(n, Math.max(0, maxDur - 0.1)) : 0;
};

/** Renders the multi-scene timeline via native FFmpeg (`libx264` + `48kHz AAC`) with zero dropped frames. */
export async function POST(request: Request) {
    if (process.env.VERCEL === "1") {
        return NextResponse.json(
            { error: "Server-side FFmpeg MP4 export is unavailable on serverless deployments. Use PNG Overlays (.ZIP) or run the studio locally." },
            { status: 501 }
        );
    }
    if (request.signal.aborted) return new Response(null, { status: 499 });

    const tempFiles: string[] = [];
    let tempSeq = 0;
    const uid = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    void sweepStaleExportFiles();

    const writeTempBuffer = async (buf: Buffer, ext: string): Promise<string> => {
        const p = path.join(CACHE_DIR, `exp-${uid}-${tempSeq++}${ext}`);
        tempFiles.push(p);
        await fs.promises.writeFile(p, buf);
        return p;
    };

    try {
        const formData = await request.formData();
        const draftRaw = formData.get("draft");
        if (typeof draftRaw !== "string") return badRequest("Missing draft payload");

        let draft: VideoDraft;
        try { draft = JSON.parse(draftRaw) as VideoDraft; } catch { return badRequest("Invalid draft JSON payload"); }
        if (!draft || typeof draft !== "object") return badRequest("Invalid draft payload");

        const format = VIDEO_FORMAT_CONFIGS[draft.aspectRatio];
        if (!format) return badRequest("Unsupported video aspect ratio");

        const scenes = Array.isArray(draft.scenes) ? draft.scenes : [];
        if (!scenes.length || !scenes.every((s) => s && typeof s === "object")) return badRequest("No valid timeline scenes to export");
        if (scenes.length > 25) return badRequest("Timeline exceeds maximum 25 scenes per export");

        const masterPath = await resolveCachedVideoPath(draft.videoUrl);
        if (!masterPath) return badRequest("Master video must be uploaded to the studio first.");

        await fs.promises.mkdir(CACHE_DIR, { recursive: true });
        await assertDiskHeadroom();

        const probeCache = new Map<string, ReturnType<typeof probeVideoInfo>>();
        const getCachedProbe = (filePath: string) => {
            let pending = probeCache.get(filePath);
            if (!pending) { pending = probeVideoInfo(filePath, request.signal); probeCache.set(filePath, pending); }
            return pending;
        };
        const masterInfo = await getCachedProbe(masterPath);

        const { width: W, height: H } = format;
        const is45 = draft.aspectRatio === "4:5";
        const is916 = draft.aspectRatio === "9:16";
        const targetFps = masterInfo.fps || 30;
        const quantizedScenes = scenes.map((s) => ({
            ...s,
            duration: Math.max(1, Math.round(clamp(Number(s.duration) || 5, 0.5, 180) * targetFps)) / targetFps,
        }));
        const exportDraft: VideoDraft = { ...draft, scenes: quantizedScenes };
        const exportAudioVol = draft.isMuted ? 0 : clamp(Number.isFinite(draft.volume) ? draft.volume! : 1, 0, 1);
        const bounds = getSceneBoundaries(quantizedScenes);
        const { hasReHook, storyIdx: setupIdx, storyOffset: setupOffset } = getTimelineStructure(quantizedScenes);

        const args: string[] = [];
        const filters: string[] = [];
        const concatInputs: string[] = [];
        const overlayPathByHash = new Map<string, string>();
        let inputIdx = 0;
        let hasAnyRealAudio = false;

        const saveDeduplicatedOverlay = async (blob: Blob): Promise<string> => {
            const buf = Buffer.from(await blob.arrayBuffer());
            const hash = crypto.createHash("sha1").update(buf).digest("hex");
            const existing = overlayPathByHash.get(hash);
            if (existing) return existing;
            const p = await writeTempBuffer(buf, ".png");
            overlayPathByHash.set(hash, p);
            return p;
        };

        for (let i = 0; i < quantizedScenes.length; i++) {
            const s = quantizedScenes[i]!;
            const b = bounds[i]!;
            const dur = s.duration;
            const ovBlob = formData.get(`overlay_${i}`);
            if (!(ovBlob instanceof Blob) || ovBlob.size === 0) return badRequest(`Missing overlay_${i}`);
            const ovPath = await saveDeduplicatedOverlay(ovBlob);

            const rawCustomBlob = formData.get(`sceneMedia_${i}`);
            const customMediaBlob = rawCustomBlob instanceof Blob && rawCustomBlob.size > 0 ? rawCustomBlob : null;
            const isImage = s.mediaType === "image" && customMediaBlob !== null;
            const cachedSceneVideo = !customMediaBlob && s.mediaType !== "image" ? await resolveCachedVideoPath(s.mediaUrl) : null;

            let srcPath = masterPath;
            let srcInfo = masterInfo;
            if (customMediaBlob) {
                srcPath = await writeTempBuffer(Buffer.from(await customMediaBlob.arrayBuffer()), isImage ? resolveImageExt(customMediaBlob.type) : ".mp4");
                const probed = await getCachedProbe(srcPath);
                srcInfo = isImage
                    ? { width: probed.width || W, height: probed.height || H, duration: dur, hasAudio: false, fps: targetFps, isHdr: false, videoBitrate: undefined }
                    : probed;
            } else if (cachedSceneVideo) {
                srcPath = cachedSceneVideo;
                srcInfo = await getCachedProbe(srcPath);
            }

            if (!isImage && srcInfo.hasAudio && exportAudioVol > 0) hasAnyRealAudio = true;

            const mediaIdx = inputIdx++;
            let loopTrim = "";
            let aLoopTrim = "";
            let customLoopVideoSource: string | null = null;
            let customLoopAudioSource: string | null = null;

            if (isImage) {
                args.push("-framerate", String(targetFps), "-loop", "1", "-t", dur.toFixed(3), "-i", srcPath);
            } else {
                const rawStart = i === 0 || (hasReHook && i === 1) || srcPath !== masterPath
                    ? clampOffset(s.clipStartOffset, srcInfo.duration)
                    : clampOffset(wrapMediaTime(exportDraft, b.start, srcInfo.duration), srcInfo.duration);
                const needsLoop = rawStart + dur > srcInfo.duration - 0.1;

                if (needsLoop) {
                    const loopStart = i === 0 || (hasReHook && i === 1) || srcPath !== masterPath || i < setupIdx
                        ? clampOffset(s.clipStartOffset, srcInfo.duration)
                        : clampOffset(setupOffset, srcInfo.duration);
                    const firstPassDur = Math.max(0.1, srcInfo.duration - rawStart);

                    if (rawStart > loopStart + 0.05 && firstPassDur < dur - 0.05) {
                        const remDur = dur - firstPassDur;
                        const loopIdx = inputIdx++;
                        args.push("-fflags", "+genpts+discardcorrupt", "-ss", rawStart.toFixed(3), "-t", firstPassDur.toFixed(3), "-i", srcPath);
                        args.push("-fflags", "+genpts+discardcorrupt", "-stream_loop", "-1", "-i", srcPath);

                        customLoopVideoSource = `v_loop_src_${i}`;
                        filters.push(
                            `[${mediaIdx}:v]setpts=PTS-STARTPTS[vt1_${i}]`,
                            `[${loopIdx}:v]trim=start=${loopStart.toFixed(3)}:duration=${remDur.toFixed(3)},setpts=PTS-STARTPTS[vt2_${i}]`,
                            `[vt1_${i}][vt2_${i}]concat=n=2:v=1:a=0[${customLoopVideoSource}]`,
                        );
                        if (srcInfo.hasAudio && exportAudioVol > 0) {
                            customLoopAudioSource = `a_loop_src_${i}`;
                            filters.push(
                                `[${mediaIdx}:a]asetpts=PTS-STARTPTS,apad=whole_dur=${firstPassDur.toFixed(3)},atrim=0:${firstPassDur.toFixed(3)}[at1_${i}]`,
                                `[${loopIdx}:a]atrim=start=${loopStart.toFixed(3)}:duration=${remDur.toFixed(3)},asetpts=PTS-STARTPTS[at2_${i}]`,
                                `[at1_${i}][at2_${i}]concat=n=2:v=0:a=1[${customLoopAudioSource}]`,
                            );
                        }
                    } else {
                        args.push("-fflags", "+genpts+discardcorrupt", "-stream_loop", "-1", "-i", srcPath);
                        loopTrim = `trim=start=${rawStart.toFixed(3)}:duration=${dur.toFixed(3)},`;
                        aLoopTrim = `atrim=start=${rawStart.toFixed(3)}:duration=${dur.toFixed(3)},`;
                    }
                } else {
                    args.push("-fflags", "+genpts+discardcorrupt", "-ss", rawStart.toFixed(3), "-t", dur.toFixed(3), "-i", srcPath);
                }
            }

            const ovIdx = inputIdx++;
            if (isAnimatedSceneOverlay(exportDraft, quantizedScenes, i)) {
                args.push("-framerate", String(targetFps), "-loop", "1", "-t", dur.toFixed(3), "-i", ovPath);
            } else {
                args.push("-i", ovPath);
            }

            const stage = buildSceneFilterStages({
                index: i, scenes: quantizedScenes, draft: exportDraft, start: b.start, duration: dur,
                width: W, height: H, targetFps, is45, isImage,
                srcWidth: srcInfo.width, srcHeight: srcInfo.height, srcHasAudio: srcInfo.hasAudio, srcIsHdr: !isImage && srcInfo.isHdr,
                mediaIdx, overlayIdx: ovIdx, customLoopVideoSource, customLoopAudioSource, loopTrim, aLoopTrim,
            });
            filters.push(...stage.filters);
            concatInputs.push(`${stage.vMap}${stage.aMap}`);
        }

        const outroBlob = formData.get("outroOverlay");
        if (draft.enableOutro && outroBlob instanceof Blob && outroBlob.size > 0) {
            const outroDur = Math.max(1, Math.round(clamp(Number(draft.outroDuration) || 5, 1, 15) * targetFps)) / targetFps;
            const outroPath = await writeTempBuffer(Buffer.from(await outroBlob.arrayBuffer()), ".png");
            const oIdx = inputIdx++;
            args.push("-i", outroPath);
            filters.push(
                `[${oIdx}:v]scale=${W}:${H}:flags=lanczos+accurate_rnd+full_chroma_int:out_color_matrix=bt709:out_range=tv,format=yuv420p,loop=loop=-1:size=1:start=0,fps=${targetFps},trim=duration=${outroDur.toFixed(3)},fade=t=in:st=0:d=0.25:color=#050505,setsar=1,settb=1/90000[v_outro]`,
                `anullsrc=r=48000:cl=stereo:d=${outroDur.toFixed(3)}[a_outro]`,
            );
            concatInputs.push(`[v_outro][a_outro]`);
        }

        const segCount = concatInputs.length;
        const assContent = buildAssSubtitles(exportDraft, quantizedScenes, bounds, W, H, is45, is916, masterInfo.duration);
        let finalVideoMap = "[vout]";
        let finalAudioMap = "[a_cat]";

        if (assContent) {
            const assPath = path.join(CACHE_DIR, `subs-${uid}.ass`);
            tempFiles.push(assPath);
            await fs.promises.writeFile(assPath, assContent, "utf8");
            const fontsDir = path.join(process.cwd(), "tools", "fonts");
            const fontsDirArg = (await fileExists(fontsDir)) ? `:fontsdir='${escapeFfmpegFilterPath(fontsDir)}'` : "";
            filters.push(
                `${concatInputs.join("")}concat=n=${segCount}:v=1:a=1[v_cat][a_cat]`,
                `[v_cat]ass='${escapeFfmpegFilterPath(assPath)}'${fontsDirArg}[vsub]`,
            );
            finalVideoMap = "[vsub]";
        } else {
            filters.push(`${concatInputs.join("")}concat=n=${segCount}:v=1:a=1[vout][a_cat]`);
        }

        if (draft.normalizeAudio !== false && hasAnyRealAudio) {
            filters.push(`[a_cat]alimiter=limit=0.841:attack=5:release=50,loudnorm=I=-14:TP=-1.5:LRA=11:linear=true,aresample=48000[anorm]`);
            finalAudioMap = "[anorm]";
        }

        const filterScriptPath = path.join(CACHE_DIR, `filter-${uid}.txt`);
        tempFiles.push(filterScriptPath);
        await fs.promises.writeFile(filterScriptPath, filters.join(";\n"), "utf8");

        const outPath = path.join(CACHE_DIR, `export-${uid}.mp4`);
        tempFiles.push(outPath);

        const vbvCeiling = computeExportVbvCeiling(draft.sourceMediaInfo?.videoBitrate || masterInfo.videoBitrate);
        await withExportSlot(() => spawnExec("ffmpeg", [
            "-y", "-hide_banner", "-loglevel", "error", ...args,
            "-filter_complex_script", filterScriptPath,
            "-map", finalVideoMap, "-map", finalAudioMap,
            "-map_metadata", "-1", "-dn", "-sn",
            "-threads", getWorkerThreadCount(), "-max_muxing_queue_size", "4096",
            "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-profile:v", "high", "-level", "4.2",
            ...(vbvCeiling ? ["-maxrate", `${vbvCeiling.maxrateKbps}k`, "-bufsize", `${vbvCeiling.bufsizeKbps}k`] : []),
            "-g", String(targetFps * 2), "-keyint_min", String(targetFps * 2), "-sc_threshold", "0",
            "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
            "-r", String(targetFps), "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-movflags", "+faststart", outPath,
        ], { signal: request.signal, timeoutMs: 300_000 }), request.signal);

        const stat = await fs.promises.stat(outPath);
        const outIdx = tempFiles.indexOf(outPath);
        if (outIdx !== -1) tempFiles.splice(outIdx, 1);

        return new Response(createFileWebStream(outPath, { unlinkOnClose: true }), {
            status: 200,
            headers: { "Content-Type": "video/mp4", "Content-Length": String(stat.size), "Cache-Control": "no-store" },
        });
    } catch (error) {
        if (request.signal.aborted) return new Response(null, { status: 499 });
        const message = error instanceof Error ? error.message : "FFmpeg export failed";
        console.error("VIDEO_EXPORT_ERROR:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    } finally {
        await Promise.all(tempFiles.map((f) => fs.promises.unlink(f).catch(() => {})));
    }
}
