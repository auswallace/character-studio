export interface SSECallbacks {
  onImage: (url: string, index: number, total: number) => void;
  onVideo?: (url: string, hasAudio: boolean) => void;
  onProgress: (stage: string) => void;
  onDone: (data: { recordId: string; name: string; imageCount: number; failedCount: number; elapsed: string }) => void;
  onError: (message: string) => void;
}

export async function readSSEStream(response: Response, callbacks: SSECallbacks): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let currentEvent = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7);
      } else if (line.startsWith('data: ') && currentEvent) {
        let data: Record<string, unknown>;
        try { data = JSON.parse(line.slice(6)); } catch { currentEvent = ''; continue; }

        switch (currentEvent) {
          case 'image':
            callbacks.onImage(data.url as string, Number(data.index), Number(data.total));
            break;
          case 'video':
            callbacks.onVideo?.(data.url as string, data.hasAudio as boolean);
            break;
          case 'progress':
            callbacks.onProgress(data.stage as string);
            break;
          case 'done':
            callbacks.onDone({
              recordId: data.recordId as string,
              name: data.name as string,
              imageCount: data.imageCount as number,
              failedCount: data.failedCount as number,
              elapsed: data.elapsed as string,
            });
            break;
          case 'error':
            callbacks.onError(data.message as string);
            break;
        }
        currentEvent = '';
      }
    }
  }
}
