// 只传回真实区域 PNG；采样期间不编码，避免压缩和整屏传输漏掉短飞行位置。
export const assetFrameCommand = `case "panelFrames":
            case "assetFrames":
              boolean assetPanel = method.equals("panelFrames");
              JSONArray assetRegions = params.getJSONArray("regions");
              if (assetRegions.length() != (assetPanel ? 1 : 2)) throw new IllegalArgumentException("Unexpected native region count");
              long assetPixels = 0;
              for (int index = 0; index < assetRegions.length(); index++) {
                JSONObject region = assetRegions.getJSONObject(index);
                int width = region.getInt("width"), height = region.getInt("height");
                if (region.getInt("x") < 0 || region.getInt("y") < 0 || width <= 0 || height <= 0)
                  throw new IllegalArgumentException("Invalid asset region");
                assetPixels += (long) width * height;
              }
              if (assetPixels > (assetPanel ? 512000 : 128000)) throw new IllegalArgumentException("Asset regions exceed memory budget");
              java.util.ArrayList<android.graphics.Bitmap> assetBitmaps = new java.util.ArrayList<>();
              JSONArray assetFrames = new JSONArray();
              // 区域位图上限分别为 125MiB 与 117.2MiB；帧数不能先于完整时间窗耗尽。
              int assetPeriod = 20;
              JSONArray assetSamples = new JSONArray();
              long assetDeadline = android.os.SystemClock.uptimeMillis() + (assetPanel ? 3200 : 4600);
              try {
                while (android.os.SystemClock.uptimeMillis() < assetDeadline) {
                  long assetStarted = android.os.SystemClock.uptimeMillis();
                  android.graphics.Bitmap assetScreen = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
                  if (assetScreen == null) throw new IllegalStateException("Native asset screenshot returned no bitmap");
                  long assetCapturedAt = android.os.SystemClock.uptimeMillis();
                  try {
                    for (int index = 0; index < assetRegions.length(); index++) {
                      JSONObject region = assetRegions.getJSONObject(index);
                      int x = region.getInt("x"), y = region.getInt("y");
                      int width = region.getInt("width"), height = region.getInt("height");
                      if (x > assetScreen.getWidth() || y > assetScreen.getHeight()
                        || width > assetScreen.getWidth() - x || height > assetScreen.getHeight() - y)
                        throw new IllegalArgumentException("Asset region outside screenshot");
                      assetBitmaps.add(android.graphics.Bitmap.createBitmap(assetScreen, x, y, width, height));
                    }
                    if (assetPanel) assetSamples.put(assetCapturedAt);
                    int assetLast = assetBitmaps.size() - 1;
                    // 只合并逐像素完全相同的连续帧；所有实际变化都保留，超预算明确失败。
                    boolean assetDuplicate = assetPanel && assetLast > 0
                      && assetBitmaps.get(assetLast).sameAs(assetBitmaps.get(assetLast - 1))
                      && assetCapturedAt < assetDeadline - assetPeriod;
                    if (assetDuplicate) assetBitmaps.remove(assetLast).recycle();
                    else {
                      if (assetFrames.length() >= (assetPanel ? 64 : 240))
                        throw new IllegalStateException("Native region frame budget exhausted");
                      assetFrames.put(new JSONObject().put("capturedAt", assetCapturedAt));
                    }
                  } finally { assetScreen.recycle(); }
                  android.os.SystemClock.sleep(Math.max(1, assetPeriod - (android.os.SystemClock.uptimeMillis() - assetStarted)));
                }
                for (int frameIndex = 0; frameIndex < assetFrames.length(); frameIndex++) {
                  JSONArray assetPngs = new JSONArray();
                  for (int index = 0; index < assetRegions.length(); index++) {
                    java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                    if (!assetBitmaps.get(frameIndex * assetRegions.length() + index)
                      .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, bytes))
                      throw new IllegalStateException("Native asset PNG encoding failed");
                    assetPngs.put(android.util.Base64.encodeToString(bytes.toByteArray(), android.util.Base64.NO_WRAP));
                  }
                  assetFrames.getJSONObject(frameIndex).put("regions", assetPngs);
                }
                if (assetPanel && assetFrames.length() > 0)
                  assetFrames.getJSONObject(0).put("sampledAt", assetSamples);
                response.put("result", assetFrames);
              } finally { for (android.graphics.Bitmap frame : assetBitmaps) frame.recycle(); }
              break;
            `;
