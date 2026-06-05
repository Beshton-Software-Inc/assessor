/**
 * Builds a single MediaStream that contains:
 *   - the user's video track (for visual context)
 *   - a mixed audio track combining the user's microphone + the AI's voice
 *
 * The user mic track passed in has browser-side echo cancellation applied, so
 * AI audio playing from the speaker is already removed from the mic capture.
 * We add the AI's remote track explicitly so both voices appear in the file.
 */
export function buildRecordingStream(
  audioCtx: AudioContext,
  userMedia: MediaStream,
  aiAudio: MediaStream,
): { stream: MediaStream; cleanup: () => void } {
  const destination = audioCtx.createMediaStreamDestination();

  const userSource = audioCtx.createMediaStreamSource(userMedia);
  userSource.connect(destination);

  const aiSource = audioCtx.createMediaStreamSource(aiAudio);
  aiSource.connect(destination);

  const combined = new MediaStream();
  for (const track of userMedia.getVideoTracks()) combined.addTrack(track);
  for (const track of destination.stream.getAudioTracks()) combined.addTrack(track);

  const cleanup = () => {
    userSource.disconnect();
    aiSource.disconnect();
  };

  return { stream: combined, cleanup };
}

export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}
