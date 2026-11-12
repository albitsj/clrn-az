/** Android 35 screenrecord 带头 RGB_888 帧；不推算或插入任何中间画面。 */
export const surfaceSize = { width: 240, height: 426 };
const payloadBytes = surfaceSize.width * surfaceSize.height * 3;
const packetBytes = payloadBytes + 20;

/** 按实际包边界解码，限制分配及总帧数，拒绝格式漂移。 */
export class SurfaceFrameParser {
  private pending: Buffer = Buffer.alloc(0);
  private count = 0;

  /** 接收任意分块的 ADB 二进制流。
   * @param chunk - 尚未解析的原始字节。
   */
  push(chunk: Buffer): Buffer[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    const frames: Buffer[] = [];
    while (this.pending.length >= 20) {
      this.validateHeader();
      if (this.pending.length < packetBytes) break;
      if (++this.count > 240) throw new Error('原始采帧超过 240 帧预算');
      frames.push(Buffer.from(this.pending.subarray(20, packetBytes)));
      this.pending = this.pending.subarray(packetBytes);
    }
    return frames;
  }

  /** 只在明确停止窗口后允许丢弃尚未完整接收的最后一个包。 */
  tailBytes(): number { return this.pending.length; }

  /** 固定协议来自 android-15.0.0_r1 FrameOutput.cpp。 */
  private validateHeader(): void {
    const values = Array.from({ length: 5 }, (_, index) => this.pending.readUInt32LE(index * 4));
    const expected = [payloadBytes + 16, surfaceSize.width, surfaceSize.height, surfaceSize.width * 3, 3];
    if (!values.every((value, index) => value === expected[index])) {
      throw new Error(`Android 原始帧头无效：${values.join(',')}`);
    }
  }
}
