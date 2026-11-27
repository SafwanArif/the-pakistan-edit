/**
 * Streams an `application/x-ndjson` Fetch Response line-by-line with UTF-8 chunk buffering,
 * trailing-line flush, and immediate `AbortSignal` reader cancellation.
 */
export async function consumeNdjsonStream<T>(
    response: Response,
    onEvent: (event: T) => void,
    signal?: AbortSignal
): Promise<void> {
    if (!response.body || signal?.aborted) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const emitLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed || signal?.aborted) return;
        onEvent(JSON.parse(trimmed) as T);
    };

    const onAbort = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener("abort", onAbort, { once: true });

    let completed = false;
    try {
        while (true) {
            if (signal?.aborted) break;
            const { value, done } = await reader.read();
            if (done || signal?.aborted) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) emitLine(line);
        }
        if (!signal?.aborted) {
            buffer += decoder.decode();
            if (buffer.trim()) emitLine(buffer);
            completed = true;
        }
    } finally {
        signal?.removeEventListener("abort", onAbort);
        if (!completed) {
            await reader.cancel().catch(() => { /* stream already cancelled */ });
        }
        reader.releaseLock();
    }
}
