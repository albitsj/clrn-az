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
  const sample = { area: 0, color };
  for (const row of rows) areaRow(source, row, columns, sample);
  return color.map(value => Math.round(value / sample.area));
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
  requireSameSize(before, frame);
  const { width, height } = before;
  const columns = new Array<number>(width).fill(0);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const x = pixel % width;
    const offset = pixel * 3;
    for (let channel = 0; channel < 3; channel++) {
      columns[x] += Math.abs(before.pixels[offset + channel] - frame.pixels[offset + channel]);
    }
  }
  return columns.map(value => value / (height * 3));
}

/** 约束整列共同变化的下界，移动或缩放的前景不能抬高背景的持续覆盖要求。
 * @param endpoints - 原生首尾缩略图，只用于位置诊断，不作为中途参考。
 * @param reference - 已审查中途相位。
 * @param actual - 实际录屏中途相位。
 */
export function preservesVideoColumns(endpoints: VideoThumbnail[], reference: VideoThumbnail,
  actual: VideoThumbnail): boolean {
  const [before, after] = endpoints, { width, height } = before;
  const persistent = new Array<number>(width).fill(Infinity);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const x = pixel % width;
    const common = commonPixelMotion(before, after, reference, pixel);
    persistent[x] = Math.min(persistent[x], common);
  }
  // 沿用四分之一相位边界；只要求整列共有的背景变化，不假设前景已覆盖参考中的位置。
  return videoColumnMotion(before, actual).every((value, x) => value >= persistent[x] / 4);
}

/** Align a reviewed vertical slide phase without allowing horizontal displacement.
 * @param actual - Recorded phase thumbnail.
 * @param reference - Reviewed phase thumbnail.
 */
export function alignedVideoDistance(actual: VideoThumbnail, reference: VideoThumbnail): number {
  requireSameSize(actual, reference);
  const { width, height } = actual;
  const limit = Math.min(30, Math.floor(height * 0.4));
  let best = Infinity;
  for (let shift = -limit; shift <= limit; shift++) {
    const rows = height - Math.abs(shift);
    const difference = shiftedDifference(actual, reference, shift);
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
  requireSameSize(a, b);
  const pixels = a.width * a.height;
  const counts = Array.from({ length: 3 }, () => new Uint32Array(511));
  const clippedLow = new Uint32Array(3), clippedHigh = new Uint32Array(3);
  countFrameShifts(a, b, counts, clippedLow, clippedHigh);
  const commonShift = counts.map((values, channel) => dominantShift(values, clippedLow[channel], clippedHigh[channel]));
  let motion = 0;
  for (let offset = 0; offset < a.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const expected = Math.max(0, Math.min(255, a.data[offset + channel] + commonShift[channel]));
      motion += Math.abs(b.data[offset + channel] - expected);
    }
  }
  return motion / (pixels * 3);
}


/** 尺寸变化始终报错，不能静默对齐不同区域。
 * @param a - 首图尺寸。
 * @param b - 后图尺寸。
 */
function requireSameSize(a: { width: number; height: number }, b: { width: number; height: number }): void {
  if (a.width !== b.width || a.height !== b.height) throw new Error('动画帧尺寸变化');
}
/** 计算一个像素中相位与终点共同改变的颜色幅度。
 * @param before - 起点。
 * @param after - 终点。
 * @param reference - 审查相位。
 * @param pixel - 像素序号。
 */
function commonPixelMotion(before: VideoThumbnail, after: VideoThumbnail, reference: VideoThumbnail, pixel: number): number {
  let common = 0;
  for (let channel = 0; channel < 3; channel++) {
    const index = pixel * 3 + channel;
    const reviewed = reference.pixels[index] - before.pixels[index];
    const final = after.pixels[index] - before.pixels[index];
    common += reviewed * final > 0 ? Math.min(Math.abs(reviewed), Math.abs(final)) / 3 : 0;
  }
  return common;
}
/** 沿原有行序积分纵向平移后的差异。
 * @param actual - 实际缩略图。
 * @param reference - 审查缩略图。
 * @param shift - 纵向偏移。
 */
function shiftedDifference(actual: VideoThumbnail, reference: VideoThumbnail, shift: number): number {
  const { width, height } = actual;
  let difference = 0;
  for (let y = Math.max(0, -shift); y < Math.min(height, height - shift); y++) {
    const from = y * width * 3, to = (y + shift) * width * 3;
    for (let channel = 0; channel < width * 3; channel++) {
      difference += Math.abs(actual.pixels[from + channel] - reference.pixels[to + channel]);
    }
  }
  return difference;
}
/** 饱和像素只记录截断方向，其余像素记录真实颜色偏移。
 * @param before - 原颜色。
 * @param after - 新颜色。
 * @param channel - 颜色通道。
 * @param counts - 每通道偏移直方图。
 * @param low - 下界截断计数。
 * @param high - 上界截断计数。
 */
function countShift(before: number, after: number, channel: number, counts: Uint32Array[], low: Uint32Array, high: Uint32Array): void {
  if (after === 0) low[channel]++;
  else if (after === 255) high[channel]++;
  else counts[channel][after - before + 255]++;
}
/** 保留众数的首次获胜顺序以及全饱和画面的推断方式。
 * @param values - 颜色偏移直方图。
 * @param low - 下界截断次数。
 * @param high - 上界截断次数。
 */
function dominantShift(values: Uint32Array, low: number, high: number): number {
  const best = mostFrequentShift(values);
  if (values[best] === 0) return high >= low ? 255 : -255;
  return best - 255;
}
/** 返回首个最大计数的位置。
 * @param values - 颜色偏移直方图。
 */
function mostFrequentShift(values: Uint32Array): number {
  let best = 0;
  for (let index = 0; index < values.length; index++) {
    if (values[index] > values[best]) best = index;
  }
  return best;
}

/** 按原像素与通道顺序累计偏移直方图。
 * @param a - 起点。
 * @param b - 当前帧。
 * @param counts - 偏移直方图。
 * @param clippedLow - 下界截断计数。
 * @param clippedHigh - 上界截断计数。
 */
function countFrameShifts(a: PNG, b: PNG, counts: Uint32Array[], clippedLow: Uint32Array, clippedHigh: Uint32Array): void {
  for (let offset = 0; offset < a.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) {
      countShift(a.data[offset + channel], b.data[offset + channel], channel, counts, clippedLow, clippedHigh);
    }
  }
}

/** 积分同一源图行内的颜色，避免逐像素建立中间对象。
 * @param source - 原始图像。
 * @param row - 当前源图行及覆盖权重。
 * @param columns - 横向覆盖及权重。
 * @param sample - 累积面积与 RGB 颜色。
 */
function areaRow(source: PNG, row: AreaSample, columns: AreaSample[], sample: { area: number; color: number[] }): void {
  for (const column of columns) {
    const weight = row.weight * column.weight;
    const from = (row.index * source.width + column.index) * 4;
    sample.area += weight;
    for (let channel = 0; channel < 3; channel++) sample.color[channel] += source.data[from + channel] * weight;
  }
}
