import { PNG } from 'pngjs';

export type VideoThumbnail = { pixels: Uint8Array; width: number; height: number };

type AreaSample = { index: number; weight: number };

/** 按真实重叠面积分配源像素，非整数缩小比例的边缘像素也不能整体归入某一格。
 * @param source - 原始轴长度。
 * @param target - 缩略图轴长度。
 */
function areaSamples(source: number, target: number): AreaSample[][] {
  return Array.from({ length: target }, (_, index) => {
    const start = index * source / target, end = (index + 1) * source / target;
    return Array.from({ length: Math.ceil(end) - Math.floor(start) }, (_, offset) => {
      const position = Math.floor(start) + offset;
      return { index: position, weight: Math.min(end, position + 1) - Math.max(start, position) };
    });
  });
}

/** 积分一个缩略像素覆盖的原图颜色，避免细边缘因抽样点位置而突然放大或消失。
 * @param source - 原始截图。
 * @param rows - 纵向覆盖的原图像素与权重。
 * @param columns - 横向覆盖的原图像素与权重。
 */
function areaPixel(source: PNG, rows: AreaSample[], columns: AreaSample[]): number[] {
  const color = [0, 0, 0];
  let area = 0;
  for (const row of rows) for (const column of columns) {
    const weight = row.weight * column.weight;
    const from = (row.index * source.width + column.index) * 4;
    area += weight;
    for (let channel = 0; channel < 3; channel++) color[channel] += source.data[from + channel] * weight;
  }
  return color.map(value => Math.round(value / area));
}

/** 按面积平均缩小画面，保留横向位置，避免单点采样放大编码边缘的混叠。
 * @param png - 录屏帧或已审查相位。
 */
export function videoThumbnail(png: Buffer): VideoThumbnail {
  const source = PNG.sync.read(png);
  const width = Math.min(60, source.width);
  const height = Math.max(1, Math.round(source.height * width / source.width));
  const columns = areaSamples(source.width, width), rows = areaSamples(source.height, height);
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    pixels.set(areaPixel(source, rows[y], columns[x]), (y * width + x) * 3);
  }
  return { pixels, width, height };
}

/** 计算每列相对起点的运动幅度，保留缩放面板外围的背景变暗。
 * @param before - 原生起点缩略图。
 * @param frame - 录屏帧或已审查相位的缩略图。
 */
function videoColumnMotion(before: VideoThumbnail, frame: VideoThumbnail): number[] {
  if (before.width !== frame.width || before.height !== frame.height) throw new Error('动画帧尺寸变化');
  const { width, height } = before;
  const columns = new Array<number>(width).fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 3;
    for (let channel = 0; channel < 3; channel++) {
      columns[x] += Math.abs(before.pixels[offset + channel] - frame.pixels[offset + channel]);
    }
  }
  return columns.map(value => value / (height * 3));
}

/** 仅约束同一像素在参考和终点中共同发生的同向变化，避免把移动内容误当作持续覆盖。
 * @param endpoints - 原生首尾缩略图，只用于位置诊断，不作为中途参考。
 * @param reference - 已审查中途相位。
 * @param actual - 实际录屏中途相位。
 */
export function preservesVideoColumns(endpoints: VideoThumbnail[], reference: VideoThumbnail,
  actual: VideoThumbnail): boolean {
  const [before, after] = endpoints, { width, height } = before;
  const persistent = new Array<number>(width).fill(0);
  for (let index = 0; index < before.pixels.length; index++) {
    const reviewed = reference.pixels[index] - before.pixels[index];
    const final = after.pixels[index] - before.pixels[index];
    if (reviewed * final > 0) persistent[Math.floor(index / 3) % width]
      += Math.min(Math.abs(reviewed), Math.abs(final)) / (height * 3);
  }
  // 沿用四分之一相位边界；在不同纵向位置发生的变化不能相互证明持续覆盖。
  return videoColumnMotion(before, actual).every((value, x) => value >= persistent[x] / 4);
}

/** Align a reviewed vertical slide phase without allowing horizontal displacement.
 * @param actual - Recorded phase thumbnail.
 * @param reference - Reviewed phase thumbnail.
 */
export function alignedVideoDistance(actual: VideoThumbnail, reference: VideoThumbnail): number {
  if (actual.width !== reference.width || actual.height !== reference.height) throw new Error('动画帧尺寸变化');
  const { width, height } = actual;
  const limit = Math.min(30, Math.floor(height * 0.4));
  let best = Infinity;
  for (let shift = -limit; shift <= limit; shift++) {
    let difference = 0;
    const rows = height - Math.abs(shift);
    for (let y = Math.max(0, -shift); y < Math.min(height, height - shift); y++) {
      const from = y * width * 3;
      const to = (y + shift) * width * 3;
      for (let channel = 0; channel < width * 3; channel++) {
        difference += Math.abs(actual.pixels[from + channel] - reference.pixels[to + channel]);
      }
    }
    best = Math.min(best, difference / (rows * width * 3) + Math.abs(shift) / height * 5);
  }
  return best;
}

/** Transpose coordinates so the existing slide metric can diagnose horizontal displacement.
 * @param frame - Recorded or reviewed thumbnail.
 */
function transposedThumbnail(frame: VideoThumbnail): VideoThumbnail {
  const { width, height } = frame;
  const pixels = new Uint8Array(frame.pixels.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (y * width + x) * 3;
    pixels.set(frame.pixels.subarray(from, from + 3), (x * height + y) * 3);
  }
  return { pixels, width: height, height: width };
}

/** 镜像仍直接拒绝；横向错位需同时得到中途参考与最近端点的支持，避免误拒合法缩放。
 * @param actual - 实际录屏相位。
 * @param reference - 已审查中途相位。
 * @param distance - 原有纵向对齐距离。
 * @param endpoints - 原生首尾，仅作错位反证，不参与中途相位的接受距离。
 */
export function misplacedVideoFrame(actual: VideoThumbnail, reference: VideoThumbnail,
  distance: number, endpoints: VideoThumbnail[]): boolean {
  const inverted = alignedVideoDistance(actual, mirroredThumbnail(reference));
  const horizontal = alignedVideoDistance(transposedThumbnail(actual), transposedThumbnail(reference));
  if (inverted + 6 < distance) return true;
  if (horizontal + 6 >= distance) return false;
  const nearest = endpoints.map(frame => ({ frame, distance: alignedVideoDistance(actual, frame) }))
    .sort((left, right) => left.distance - right.distance)[0];
  return alignedVideoDistance(transposedThumbnail(actual), transposedThumbnail(nearest.frame)) + 6 < nearest.distance;
}

/** Mirror only the reviewed phase to detect inverted content at the same video timing.
 * @param reference - Reviewed phase thumbnail.
 */
export function mirroredThumbnail(reference: VideoThumbnail): VideoThumbnail {
  const { width, height } = reference;
  const pixels = new Uint8Array(reference.pixels.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (y * width + width - 1 - x) * 3;
    const to = (y * width + x) * 3;
    pixels.set(reference.pixels.subarray(from, from + 3), to);
  }
  return { pixels, width, height };
}

/** Measure motion left after removing a uniform, clipped RGB shift from the whole region.
 * @param before - Exact frame before the transition.
 * @param frame - Recorded or reviewed phase.
 */
export function localMotionDistance(before: Buffer, frame: Buffer): number {
  const a = PNG.sync.read(before), b = PNG.sync.read(frame);
  if (a.width !== b.width || a.height !== b.height) throw new Error('动画帧尺寸变化');
  const pixels = a.width * a.height;
  const counts = Array.from({ length: 3 }, () => new Uint32Array(511));
  const clippedLow = new Uint32Array(3), clippedHigh = new Uint32Array(3);
  for (let offset = 0; offset < a.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) {
      // Saturated output pixels hide the actual brightness offset; derive it from unclipped pixels.
      if (b.data[offset + channel] === 0) clippedLow[channel]++;
      else if (b.data[offset + channel] === 255) clippedHigh[channel]++;
      else {
        counts[channel][b.data[offset + channel] - a.data[offset + channel] + 255]++;
      }
    }
  }
  const commonShift = counts.map((values, channel) => {
    let best = 0;
    for (let index = 0; index < values.length; index++) {
      if (values[index] > values[best]) best = index;
    }
    if (values[best] === 0) return clippedHigh[channel] >= clippedLow[channel] ? 255 : -255;
    return best - 255;
  });
  let motion = 0;
  for (let offset = 0; offset < a.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const expected = Math.max(0, Math.min(255, a.data[offset + channel] + commonShift[channel]));
      motion += Math.abs(b.data[offset + channel] - expected);
    }
  }
  return motion / (pixels * 3);
}

