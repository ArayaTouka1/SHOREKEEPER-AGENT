export async function selectAudioOutput(
  deviceId: string | undefined,
  audio?: HTMLAudioElement | null,
  context?: AudioContext | null
): Promise<void> {
  if (!deviceId) return
  const routedContext = context as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null | undefined
  if (routedContext?.setSinkId) {
    await routedContext.setSinkId(deviceId)
  } else if (audio?.setSinkId) {
    await audio.setSinkId(deviceId)
  } else {
    throw new Error('当前系统不支持指定音频输出设备')
  }
}
