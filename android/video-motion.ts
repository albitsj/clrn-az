import { PNG } from 'pngjs';

export type VideoThumbnail = { pixels: Uint8Array; width: number; height: number };

/** Keep horizontal position and visual detail while making video comparisons inexpensive.
 * @param png - Recorded frame or reviewed phase.
 */
export function videoThumbnail(png: Buffer): VideoThumbnail {
  const source = PNG.sync.read(png);
  const width = Math.min(60, source.width);
  const height = Math.max(1, Math.round(source.height * width / source.width));
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (Math.floor((y + 0.5) * source.height / height) * source.width
      + Math.floor((x + 0.5) * source.width / width)) * 4;
    const to = (y * width + x) * 3;
    for (let channel = 0; channel < 3; channel++) pixels[to + channel] = source.data[from + channel];
  }
  return { pixels, width, height };
}

/** Preserve horizontal coverage of motion, including dimmed backdrop outside a scaling panel.
 * @param before - Exact start thumbnail.
 * @param frame - Recorded frame or reviewed phase thumbnail.
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

/** Require persistent changes to cover the same columns, even at a later scale/opacity.
 * @param endpoints - Start and end thumbnails, never additional accepted middle phases.
 * @param reference - Reviewed middle thumbnail.
 * @param actual - Recorded middle thumbnail.
 */
export function preservesVideoColumns(endpoints: VideoThumbnail[], reference: VideoThumbnail,
  actual: VideoThumbnail): boolean {
  const [before, after] = endpoints;
  const endMotion = videoColumnMotion(before, after);
  const reviewedMotion = videoColumnMotion(before, reference);
  // Reuse the existing one-quarter phase bound locally; unchanged margins impose no constraint.
  return videoColumnMotion(before, actual)
    .every((value, x) => value >= Math.min(reviewedMotion[x], endMotion[x]) / 4);
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

/** Reject content that matches better after mirroring or lateral displacement.
 * @param actual - Recorded phase thumbnail.
 * @param reference - Reviewed phase thumbnail.
 * @param distance - Original vertical-only match distance.
 */
export function misplacedVideoFrame(actual: VideoThumbnail, reference: VideoThumbnail, distance: number): boolean {
  const inverted = alignedVideoDistance(actual, mirroredThumbnail(reference));
  const horizontal = alignedVideoDistance(transposedThumbnail(actual), transposedThumbnail(reference));
  return Math.min(inverted, horizontal) + 6 < distance;
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

