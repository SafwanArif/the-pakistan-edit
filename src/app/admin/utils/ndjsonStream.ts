/**
 * Streams an `application/x-ndjson` Fetch Response line-by-line with UTF-8 chunk buffering
 * and trailing-line flush, invoking `onEvent` for each parsed JSON object.
 */
export async function consumeNdjsonStream<T>(
    response: Response,
    onEvent: (event: T) => void
): Promise<void> {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const emitLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        onEvent(JSON.parse(trimmed) as T);
    };

    let completed = false;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) emitLine(line);
        }
        buffer += decoder.decode();
        if (buffer.trim()) emitLine(buffer);
        completed = true;
    } finally {
        if (!completed) {
            await reader.cancel().catch(() => { /* stream already cancelled */ });
        }
        reader.releaseLock();
    }
}
