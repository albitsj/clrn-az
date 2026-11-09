import java.util.ArrayList;
import java.util.HashMap;

// 用途：在真实 Java 编译器下执行生产驱动命令，模拟设备时钟及位图边界。
public class AssetDriverTest {
  static long now;
  static int live, maximum, screenshots, encodings;
  static boolean failEncoding;
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
    boolean recycled;
    Bitmap(int width, int height) {
      this.width = width; this.height = height; pixels = width * height;
      live += pixels; maximum = Math.max(maximum, live);
    }
    static class CompressFormat { static final int PNG = 1; }
    static Bitmap createBitmap(Bitmap screen, int x, int y, int width, int height) {
      check(!screen.recycled, "Cannot crop recycled screen");
      return new Bitmap(width, height);
    }
    int getWidth() { return width; }
    int getHeight() { return height; }
    boolean compress(int format, int quality, java.io.ByteArrayOutputStream bytes) {
      check(now >= 4600, "Encoding must follow collection");
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
    Bitmap takeScreenshot() { now += 8; screenshots++; return new Bitmap(720, 1280); }
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
  static JSONObject capture(JSONArray regions) throws Exception {
    JSONObject params = new JSONObject().put("regions", regions), response = new JSONObject();
    String method = "assetFrames";
    switch (method) {
      // ASSET_FRAME_COMMAND
      default: throw new AssertionError("Missing command");
    }
    return response;
  }
  static void reset() { now = 0; live = maximum = screenshots = encodings = 0; failEncoding = false; }
  public static void main(String[] args) throws Exception {
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
    System.out.println("native region sampling, cadence, memory, bounds and cleanup passed");
  }
}
