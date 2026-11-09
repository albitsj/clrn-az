import java.util.ArrayList;
import java.util.HashMap;

// 用途：在真实 Java 编译器下执行生产驱动命令，模拟设备时钟及位图边界。
public class AssetDriverTest {
  static long now, expectedDeadline;
  static int live, maximum, screenshots, encodings, firstScreenshotDelay;
  static boolean failEncoding, continuousPanelMotion;
  static class JSONObject extends HashMap<String, Object> {
    public JSONObject put(String key, Object value) { super.put(key, value); return this; }
    int getInt(String key) { return ((Number) get(key)).intValue(); }
    JSONArray getJSONArray(String key) { return (JSONArray) get(key); }
  }
  static class JSONArray extends ArrayList<Object> {
    JSONArray put(Object value) { add(value); return this; }
    int length() { return size(); }
    JSONObject getJSONObject(int index) { return (JSONObject) get(index); }
  }
  static class Clock {
    static long uptimeMillis() { return now; }
    static void sleep(long delay) { now += delay; }
  }
  static class Bitmap {
    int width, height, pixels;
    long imageId;
    boolean recycled;
    Bitmap(int width, int height) {
      this.width = width; this.height = height; pixels = width * height;
      imageId = continuousPanelMotion || (now >= 400 && now < 700) ? now : (now < 400 ? 1 : 2);
      live += pixels; maximum = Math.max(maximum, live);
    }
    static class CompressFormat { static final int PNG = 1; }
    static Bitmap createBitmap(Bitmap screen, int x, int y, int width, int height) {
      check(!screen.recycled, "Cannot crop recycled screen");
      Bitmap cropped = new Bitmap(width, height); cropped.imageId = screen.imageId; return cropped;
    }
    boolean sameAs(Bitmap other) { return width == other.width && height == other.height && imageId == other.imageId; }
    int getWidth() { return width; }
    int getHeight() { return height; }
    boolean compress(int format, int quality, java.io.ByteArrayOutputStream bytes) {
      check(now >= expectedDeadline, "Encoding must follow collection");
      check(format == CompressFormat.PNG && quality == 100, "Lossless PNG required");
      encodings++;
      return !failEncoding;
    }
    void recycle() {
      check(!recycled, "Bitmap recycled twice");
      recycled = true; live -= pixels;
    }
  }
  static class Automation {
    Bitmap takeScreenshot() { now += 8 + (screenshots == 0 ? firstScreenshotDelay : 0); screenshots++; return new Bitmap(720, 1280); }
  }
  static class InstrumentationRegistry {
    static InstrumentationRegistry getInstrumentation() { return new InstrumentationRegistry(); }
    Automation getUiAutomation() { return new Automation(); }
  }
  static class Base64 {
    static final int NO_WRAP = 2;
    static String encodeToString(byte[] bytes, int flags) { return "PNG"; }
  }
  static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }
  static JSONObject region(int x, int y, int width, int height) {
    return new JSONObject().put("x", x).put("y", y).put("width", width).put("height", height);
  }
  static JSONObject capture(String method, JSONArray regions) throws Exception {
    expectedDeadline = method.equals("motionFrames") ? 0 : (method.equals("panelFrames") ? 3200 : 4600);
    JSONObject params = new JSONObject().put("regions", regions), response = new JSONObject();
    switch (method) {
      // ASSET_FRAME_COMMAND
      // MOTION_FRAME_COMMAND
      default: throw new AssertionError("Missing command");
    }
    return response;
  }
  static JSONObject capture(JSONArray regions) throws Exception { return capture("assetFrames", regions); }
  static void reset() { now = 0; live = maximum = screenshots = encodings = firstScreenshotDelay = 0; failEncoding = continuousPanelMotion = false; }
  static void verifyMotion() throws Exception {
    for (int delay : new int[] {0, 700, 1500}) {
      reset(); firstScreenshotDelay = delay;
      JSONArray frames = capture("challengeFrames", new JSONArray()).getJSONArray("result");
      int first = frames.getJSONObject(0).getInt("capturedAt");
      int last = frames.getJSONObject(frames.length() - 1).getInt("capturedAt");
      check(first == delay + 8, "First screenshot must retain its actual timestamp");
      check(last - first >= 4000, "First screenshot latency consumed four-second observation window");
      check(now < delay + 4800, "Collection must remain bounded after the first screenshot");
      check(frames.length() <= 110 && maximum <= 110 * 720 * 1280, "Existing bitmap budget exceeded");
      check(encodings == frames.length() && live == 0, "Encoding and cleanup must retain every frame");
      for (int index = 1; index < frames.length(); index++)
        check(frames.getJSONObject(index).getInt("capturedAt") > frames.getJSONObject(index - 1).getInt("capturedAt"), "Capture timestamps must increase");
    }
    reset(); firstScreenshotDelay = 700;
    JSONArray frames = capture("motionFrames", new JSONArray()).getJSONArray("result");
    check(frames.length() == 20 && now < 3200, "Ordinary motion sampling must retain its existing limits");
    check(live == 0, "Ordinary motion sampling leaked bitmaps");
    System.out.println("native motion first-frame latency, bounded window and cleanup passed");
  }
  public static void main(String[] args) throws Exception {
    if (args.length > 0) { verifyMotion(); return; }
    JSONArray regions = new JSONArray().put(region(0, 460, 180, 230)).put(region(120, 700, 220, 340));
    reset();
    JSONArray frames = capture(regions).getJSONArray("result");
    check(frames.length() == 230, "Full 4.6 second sampling window required");
    check(frames.getJSONObject(0).getInt("capturedAt") == 8, "Actual screenshot timestamp required");
    check(frames.getJSONObject(229).getInt("capturedAt") == 4588, "No early frame cap");
    check(encodings == 460 && live == 0, "Both regions encoded and all bitmaps recycled");
    check(maximum <= 720 * 1280 + 230 * 116200, "Only cropped regions retained");
    reset(); failEncoding = true;
    try { capture(regions); throw new AssertionError("Encoding failure ignored"); }
    catch (IllegalStateException expected) { check(live == 0, "Encoding failure leaked bitmaps"); }
    reset();
    try { capture(new JSONArray().put(region(0, 0, 720, 1280)).put(region(0, 0, 1, 1)));
      throw new AssertionError("Memory budget ignored"); }
    catch (IllegalArgumentException expected) { check(screenshots == 0, "Oversized request captured screen"); }
    reset();
    try { capture(new JSONArray().put(region(0, 460, 180, 230)).put(region(710, 700, 220, 340)));
      throw new AssertionError("Bounds ignored"); }
    catch (IllegalArgumentException expected) { check(live == 0, "Bounds failure leaked bitmaps"); }
    reset();
    try { capture(new JSONArray().put(region(-1, 0, 1, 1)).put(region(0, 0, 1, 1)));
      throw new AssertionError("Negative region accepted"); }
    catch (IllegalArgumentException expected) { check(screenshots == 0, "Invalid request captured screen"); }
    reset();
    frames = capture("panelFrames", new JSONArray().put(region(0, 500, 720, 680))).getJSONArray("result");
    check(frames.length() == 18 && now == 3200, "Panel sampling must cover complete 3.2 seconds");
    check(frames.getJSONObject(17).getInt("capturedAt") == 3188, "Panel timestamps must remain actual");
    check(encodings == 18 && live == 0, "Panel region must be lossless and recycled");
    check(maximum <= 720 * 1280 + 64 * 720 * 680, "Panel memory budget exceeded");
    check(screenshots == 160, "Duplicate frames must not reduce physical sampling cadence");
    check(frames.getJSONObject(0).getJSONArray("sampledAt").length() == 160, "All capture times required");
    reset(); continuousPanelMotion = true;
    try { capture("panelFrames", new JSONArray().put(region(0, 500, 720, 680)));
      throw new AssertionError("Changing frames were silently dropped"); }
    catch (IllegalStateException expected) { check(live == 0, "Frame budget failure leaked bitmaps"); }
    reset();
    try { capture("panelFrames", regions); throw new AssertionError("Panel region count ignored"); }
    catch (IllegalArgumentException expected) { check(screenshots == 0, "Invalid panel request captured screen"); }
    reset();
    try { capture("panelFrames", new JSONArray().put(region(0, 0, 720, 720)));
      throw new AssertionError("Panel memory budget ignored"); }
    catch (IllegalArgumentException expected) { check(screenshots == 0, "Oversized panel captured screen"); }
    System.out.println("native region sampling, cadence, memory, bounds and cleanup passed");
  }
}
